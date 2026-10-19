import { Inject, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from "@lark-apaas/fullstack-nestjs-core";
import { eq, desc, asc, count, and, inArray, isNull } from 'drizzle-orm';
import { batches, products } from "@server/database/schema";
import type {
  BatchInfo,
  BatchListResponse,
  BatchProgressResponse,
  DecisionType,
  ProductInfo,
  ProductListResponse,
  UploadResponse,
} from '@shared/api.interface';
import * as XLSX from 'xlsx';
import * as ExcelJS from 'exceljs';
import * as QRCode from 'qrcode';
// eslint-disable-next-line import/no-extraneous-dependencies
import JSZip from 'jszip';

const BATCH_SIZE = 2000;
const DECISIONS: DecisionType[] = ['untouched', 'keep', 'discard', 'pending'];

function shouldFilterCategory(category: string): boolean {
  if (!category) return false;
  if (category.startsWith('保健') || category.startsWith('食品饮料')) return true;
  if (category.includes('健康')) return true;
  return false;
}

function extractProductIdFromTikTok(url: string): string | null {
  if (!url) return null;
  const match = url.match(/\/product\/(\d+)/);
  return match ? match[1] : null;
}

function extractProductIdFromFastMoss(url: string): string | null {
  if (!url) return null;
  const match = url.match(/\/detail\/(\d+)/);
  return match ? match[1] : null;
}

function resolveProductId(
  row: unknown[],
  headerMap: ColumnMap,
): { productId: string | null; productUrl: string | null } {
  const tiktokUrl = col(row, headerMap.productUrl) ?? '';
  const fromTikTok = extractProductIdFromTikTok(tiktokUrl);
  if (fromTikTok) {
    return { productId: fromTikTok, productUrl: tiktokUrl };
  }

  const fastmossUrl = col(row, headerMap.fastmossUrl) ?? '';
  const fromFastMoss = extractProductIdFromFastMoss(fastmossUrl);
  if (fromFastMoss) {
    const agencyUrl = `https://shop.tiktok.com/view/product/${fromFastMoss}?source=agency&region=br`;
    return { productId: fromFastMoss, productUrl: agencyUrl };
  }

  const idCol = col(row, headerMap.productIdCol) ?? '';
  const idMatch = idCol.match(/^(\d+)$/);
  if (idMatch) {
    const pid = idMatch[1];
    const agencyUrl = `https://shop.tiktok.com/view/product/${pid}?source=agency&region=br`;
    return { productId: pid, productUrl: agencyUrl };
  }

  return { productId: null, productUrl: tiktokUrl || null };
}

function toInt(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? Math.floor(num) : null;
}

function toStr(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

interface ColumnMap {
  title: number | null;
  region: number | null;
  productUrl: number | null;
  fastmossUrl: number | null;
  productIdCol: number | null;
  imageUrl: number | null;
  category: number | null;
  shopName: number | null;
  shopType: number | null;
  operationMode: number | null;
  price: number | null;
  priceBrl: number | null;
  shopSales: number | null;
  firstThreeDaysSales: number | null;
  recentThreeDaysSales: number | null;
  totalSales: number | null;
  firstThreeDaysRevenue: number | null;
  firstThreeDaysRevenueBrl: number | null;
  recentThreeDaysRevenue: number | null;
  recentThreeDaysRevenueBrl: number | null;
  totalRevenue: number | null;
  totalRevenueBrl: number | null;
  influencerCount: number | null;
  commissionRate: number | null;
}

function buildHeaderMap(headerRow: unknown[]): ColumnMap {
  const nameToIndex = new Map<string, number>();
  for (let i = 0; i < headerRow.length; i++) {
    const raw = headerRow[i];
    if (raw === null || raw === undefined) continue;
    const name = String(raw).trim();
    if (!name) continue;
    nameToIndex.set(name, i);
  }

  const find = (names: string[]): number | null => {
    for (const n of names) {
      const idx = nameToIndex.get(n);
      if (idx !== undefined) return idx;
    }
    return null;
  };

  return {
    title: find(['商品标题', '商品名称']),
    region: find(['地区', '国家/地区', '国家/地区 ']),
    productUrl: find([
      '商品链接',
      'TikTok官网商品详情页',
      'TikTok 官网商品详情页',
      'TikTok商品落地页地址',
      'TikTok商品落地页',
    ]),
    fastmossUrl: find([
      'FastMoss商品详情页',
      'FastMoss 商品详情页',
      'FastMoss商品详情页地址',
    ]),
    productIdCol: find(['商品ID', '商品id']),
    imageUrl: find(['图片链接', '商品封面链接', '商品图片']),
    category: find(['商品类目全路径', '商品类目', '商品分类', '类目名']),
    shopName: find(['店铺名称', '所属店铺名称', '店铺名']),
    shopType: find(['店铺类型']),
    operationMode: find(['运营模式']),
    price: find(['售价']),
    priceBrl: find([
      '售价(BRL)', '售价(brl)', '售价（BRL）', '售价（brl）',
      '售价', '商品售价',
    ]),
    shopSales: find(['店铺销量', '店铺总销量', '销量']),
    firstThreeDaysSales: find(['起始三日销量']),
    recentThreeDaysSales: find(['近3日销量', '近三日销量', '7天销量', '范围销量']),
    totalSales: find(['总销量']),
    firstThreeDaysRevenue: find(['起始三日销售额']),
    firstThreeDaysRevenueBrl: find(['起始三日销售额(BRL)', '起始三日销售额(brl)', '起始三日销售额（BRL）', '起始三日销售额（brl）']),
    recentThreeDaysRevenue: find(['近三日销售额', '近3日销售额', '7天销售额', '范围销售额']),
    recentThreeDaysRevenueBrl: find(['近三日销售额(BRL)', '近三日销售额(brl)', '近三日销售额（BRL）', '近三日销售额（brl）', '范围销售额(BRL)', '范围销售额(brl)', '范围销售额（BRL）', '范围销售额（brl）']),
    totalRevenue: find(['总销售额', '销售额']),
    totalRevenueBrl: find(['总销售额(BRL)', '总销售额(brl)', '总销售额（BRL）', '总销售额（brl）']),
    influencerCount: find([
      '关联达人数', '关联达人总数', '带货达人总数',
      '总关联达人', '关联达人',
    ]),
    commissionRate: find(['佣金比例']),
  };
}

function col(row: unknown[], idx: number | null): string | null {
  if (idx === null) return null;
  return toStr(row[idx]);
}

function colInt(row: unknown[], idx: number | null): number | null {
  if (idx === null) return null;
  return toInt(row[idx]);
}

@Injectable()
export class SelectionService {
  constructor(@Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase) {}

  async uploadAndParse(file: Express.Multer.File): Promise<UploadResponse> {
    const workbook = XLSX.read(file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const rows: unknown[][] = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: '',
    });

    if (rows.length === 0) {
      return { batchId: '', fileName: '', totalCount: 0, filteredCount: 0 };
    }

    const headerMap = buildHeaderMap(rows[0]);
    const dataRows = rows.slice(1);
    const totalCount = dataRows.length;

    // Fix filename encoding (multer parses multipart filename as latin1 by default)
    const fileName = Buffer.from(file.originalname, 'latin1').toString('utf8');

    // Create batch
    const [batch] = await this.db
      .insert(batches)
      .values({
        fileName,
        totalCount,
        pendingCount: 0,
        status: 'processing',
      })
      .returning({ id: batches.id, fileName: batches.fileName });

    const filteredProducts: typeof products.$inferInsert[] = [];
    let sortIndex = 1;

    for (const row of dataRows) {
      const category = col(row, headerMap.category) ?? '';
      if (shouldFilterCategory(category)) continue;

      const { productId, productUrl } = resolveProductId(row, headerMap);
      if (!productId) continue;

      filteredProducts.push({
        batchId: batch.id,
        productId,
        title: col(row, headerMap.title) ?? '',
        region: col(row, headerMap.region),
        productUrl: productUrl ?? '',
        imageUrl: col(row, headerMap.imageUrl),
        category,
        shopName: col(row, headerMap.shopName),
        shopType: col(row, headerMap.shopType),
        operationMode: col(row, headerMap.operationMode),
        shopSales: colInt(row, headerMap.shopSales),
        price: col(row, headerMap.price),
        priceBrl: col(row, headerMap.priceBrl),
        firstThreeDaysSales: colInt(row, headerMap.firstThreeDaysSales),
        recentThreeDaysSales: colInt(row, headerMap.recentThreeDaysSales),
        totalSales: colInt(row, headerMap.totalSales),
        firstThreeDaysRevenue: col(row, headerMap.firstThreeDaysRevenue),
        firstThreeDaysRevenueBrl: col(row, headerMap.firstThreeDaysRevenueBrl),
        recentThreeDaysRevenue: col(row, headerMap.recentThreeDaysRevenue),
        recentThreeDaysRevenueBrl: col(row, headerMap.recentThreeDaysRevenueBrl),
        totalRevenue: col(row, headerMap.totalRevenue),
        totalRevenueBrl: col(row, headerMap.totalRevenueBrl),
        influencerCount: colInt(row, headerMap.influencerCount),
        decision: 'untouched' as DecisionType,
        sortIndex,
      });
      sortIndex += 1;
    }

    // Batch insert
    const filteredCount = filteredProducts.length;
    for (let i = 0; i < filteredProducts.length; i += BATCH_SIZE) {
      const chunk = filteredProducts.slice(i, i + BATCH_SIZE);
      await this.db.insert(products).values(chunk);
    }

    // Update batch status
    await this.db
      .update(batches)
      .set({
        status: 'ready',
        pendingCount: filteredCount,
      })
      .where(eq(batches.id, batch.id));

    return {
      batchId: batch.id,
      fileName: batch.fileName,
      totalCount,
      filteredCount,
    };
  }

  async getBatchList(): Promise<BatchListResponse> {
    const batchList = await this.db
      .select()
      .from(batches)
      .where(isNull(batches.deletedAt))
      .orderBy(desc(batches.createdAt));

    if (batchList.length === 0) {
      return { items: [] };
    }

    const batchIds = batchList.map((b) => b.id);

    // Group by batch_id and decision
    const decisionCounts = await this.db
      .select({
        batchId: products.batchId,
        decision: products.decision,
        count: count(),
      })
      .from(products)
      .where(inArray(products.batchId, batchIds))
      .groupBy(products.batchId, products.decision);

    const countsMap = new Map<string, Record<string, number>>();
    for (const row of decisionCounts) {
      if (!countsMap.has(row.batchId)) {
        countsMap.set(row.batchId, { untouched: 0, keep: 0, discard: 0, pending: 0 });
      }
      const m = countsMap.get(row.batchId)!;
      const dec = row.decision as DecisionType;
      if (DECISIONS.includes(dec)) {
        m[dec] = Number(row.count);
      }
    }

    const items: BatchInfo[] = batchList.map((b) => {
      const c = countsMap.get(b.id) ?? { untouched: 0, keep: 0, discard: 0, pending: 0 };
      return {
        id: b.id,
        fileName: b.fileName,
        totalCount: b.totalCount,
        pendingCount: b.pendingCount,
        status: b.status,
        createdAt: b.createdAt.toISOString(),
        keepCount: c.keep,
        discardCount: c.discard,
        pendingDecisionCount: c.pending,
        untouchedCount: c.untouched,
      };
    });

    return { items };
  }

  async getBatchProgress(batchId: string): Promise<BatchProgressResponse> {
    const rows = await this.db
      .select({
        decision: products.decision,
        count: count(),
      })
      .from(products)
      .where(eq(products.batchId, batchId))
      .groupBy(products.decision);

    const result: Record<string, number> = {
      untouched: 0,
      keep: 0,
      discard: 0,
      pending: 0,
    };
    for (const row of rows) {
      const dec = row.decision as DecisionType;
      if (DECISIONS.includes(dec)) {
        result[dec] = Number(row.count);
      }
    }

    const total = result.untouched + result.keep + result.discard + result.pending;
    const processed = result.keep + result.discard + result.pending;

    return {
      total,
      keep: result.keep,
      discard: result.discard,
      pending: result.pending,
      untouched: result.untouched,
      processed,
    };
  }

  async getProducts(
    batchId: string,
    page: number,
    pageSize: number,
    filterDecision?: DecisionType,
  ): Promise<ProductListResponse> {
    const offset = (page - 1) * pageSize;

    const whereCondition = filterDecision
      ? and(eq(products.batchId, batchId), eq(products.decision, filterDecision))
      : eq(products.batchId, batchId);

    const [totalResult, itemsResult] = await Promise.all([
      this.db
        .select({ count: count() })
        .from(products)
        .where(whereCondition),
      this.db
        .select()
        .from(products)
        .where(whereCondition)
        .orderBy(asc(products.sortIndex))
        .limit(pageSize)
        .offset(offset),
    ]);

    const total = Number(totalResult[0]?.count ?? 0);
    const items: ProductInfo[] = itemsResult.map((p) => ({
      id: p.id,
      batchId: p.batchId,
      productId: p.productId,
      title: p.title,
      region: p.region,
      productUrl: p.productUrl,
      shopUrl: `https://shop.tiktok.com/view/product/${p.productId}?source=agency&region=br`,
      imageUrl: p.imageUrl,
      category: p.category,
      shopName: p.shopName,
      shopType: p.shopType,
      operationMode: p.operationMode,
      shopSales: p.shopSales,
      price: p.price,
      priceBrl: p.priceBrl,
      firstThreeDaysSales: p.firstThreeDaysSales,
      recentThreeDaysSales: p.recentThreeDaysSales,
      totalSales: p.totalSales,
      firstThreeDaysRevenue: p.firstThreeDaysRevenue,
      firstThreeDaysRevenueBrl: p.firstThreeDaysRevenueBrl,
      recentThreeDaysRevenue: p.recentThreeDaysRevenue,
      recentThreeDaysRevenueBrl: p.recentThreeDaysRevenueBrl,
      totalRevenue: p.totalRevenue,
      totalRevenueBrl: p.totalRevenueBrl,
      influencerCount: p.influencerCount,
      decision: p.decision as DecisionType,
      sortIndex: p.sortIndex,
    }));

    return { items, total, page, pageSize, filterDecision: filterDecision ?? null };
  }

  async setDecision(productId: string, decision: DecisionType): Promise<{ decision: DecisionType }> {
    // Get the product's batchId first
    const productResult = await this.db
      .select({ batchId: products.batchId })
      .from(products)
      .where(eq(products.id, productId));

    if (productResult.length === 0) {
      throw new NotFoundException('商品不存在');
    }

    const batchId = productResult[0].batchId;

    const updated = await this.db
      .update(products)
      .set({ decision })
      .where(eq(products.id, productId))
      .returning({ decision: products.decision });

    if (updated.length === 0) {
      throw new NotFoundException('商品不存在');
    }

    // Recalculate pendingCount (= untouched count) for the batch
    const untouchedResult = await this.db
      .select({ count: count() })
      .from(products)
      .where(and(eq(products.batchId, batchId), eq(products.decision, 'untouched')));

    const untouchedCount = Number(untouchedResult[0]?.count ?? 0);

    await this.db
      .update(batches)
      .set({ pendingCount: untouchedCount })
      .where(eq(batches.id, batchId));

    return { decision: updated[0].decision as DecisionType };
  }

  async batchSetDecision(
    batchId: string,
    productIds: string[],
    decision: 'pending' | 'discard',
  ): Promise<{ updatedCount: number }> {
    if (productIds.length === 0) {
      return { updatedCount: 0 };
    }
    const MAX_BATCH = 500;
    if (productIds.length > MAX_BATCH) {
      throw new BadRequestException(`单次最多处理 ${MAX_BATCH} 个商品`);
    }

    const updated = await this.db
      .update(products)
      .set({ decision })
      .where(
        and(
          eq(products.batchId, batchId),
          inArray(products.id, productIds),
        ),
      )
      .returning({ id: products.id });

    if (updated.length > 0) {
      const untouchedResult = await this.db
        .select({ count: count() })
        .from(products)
        .where(and(eq(products.batchId, batchId), eq(products.decision, 'untouched')));

      const untouchedCount = Number(untouchedResult[0]?.count ?? 0);

      await this.db
        .update(batches)
        .set({ pendingCount: untouchedCount })
        .where(eq(batches.id, batchId));
    }

    return { updatedCount: updated.length };
  }

  async exportBatch(batchId: string, decision: 'keep' | 'pending'): Promise<{ buffer: Buffer; fileName: string }> {
    const [batchResult, productRows] = await Promise.all([
      this.db.select({ fileName: batches.fileName }).from(batches).where(and(eq(batches.id, batchId), isNull(batches.deletedAt))),
      this.db
        .select({
          title: products.title,
          productId: products.productId,
          productUrl: products.productUrl,
          imageUrl: products.imageUrl,
        })
        .from(products)
        .where(and(eq(products.batchId, batchId), eq(products.decision, decision)))
        .orderBy(asc(products.sortIndex)),
    ]);

    if (batchResult.length === 0) {
      throw new NotFoundException('批次不存在');
    }

    const baseName = batchResult[0].fileName.replace(/\.xlsx?$/i, '');
    const suffix = decision === 'keep' ? '要' : '待定';
    const fileName = `${baseName}_${suffix}.xlsx`;

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('选品');

    worksheet.columns = [
      { key: 'index', width: 20.625 },
      { key: 'productId', width: 20.625 },
      { key: 'image', width: 13 },
      { key: 'qrcode', width: 13 },
      { key: 'title', width: 100.625 },
    ];

    worksheet.getColumn(1).width = 20.625;
    worksheet.getColumn(2).width = 20.625;
    worksheet.getColumn(3).width = 13;
    worksheet.getColumn(4).width = 13;
    worksheet.getColumn(5).width = 100.625;

    const headerRow = worksheet.getRow(1);
    headerRow.values = ['序号', '产品ID', '产品图片', '产品详情', '视频标题'];
    headerRow.font = { bold: true, size: 11 };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    headerRow.border = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' },
    };
    headerRow.height = 20;

    const ROW_HEIGHT = 100;
    const IMG_CELL_SIZE_PX = 95;
    const QR_SIZE_PX = 95;

    for (let i = 0; i < productRows.length; i++) {
      const rowIndex = i + 2;
      const row = worksheet.getRow(rowIndex);
      const product = productRows[i];
      const productIdNum = product.productId || extractProductIdFromTikTok(product.productUrl) || '';

      row.getCell(1).value = i + 1;
      row.getCell(2).value = productIdNum;
      row.getCell(5).value = product.title;

      row.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      row.getCell(5).alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
      row.height = ROW_HEIGHT;

      for (let c = 1; c <= 5; c++) {
        row.getCell(c).border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };
      }

      if (product.imageUrl) {
        try {
          const imgResponse = await fetch(product.imageUrl, {
            signal: AbortSignal.timeout(8000),
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MiaodaExport/1.0)' },
          });
          if (imgResponse.ok) {
            const imgArrayBuffer = await imgResponse.arrayBuffer();
            const imgBuffer = Buffer.from(imgArrayBuffer as unknown as Uint8Array) as unknown as ExcelJS.Buffer;
            const imgId = workbook.addImage({
              buffer: imgBuffer,
              extension: 'jpeg',
            });
            worksheet.addImage(imgId, {
              tl: { col: 2 + 0.05, row: rowIndex - 1 + 0.05 },
              ext: { width: IMG_CELL_SIZE_PX, height: IMG_CELL_SIZE_PX },
              editAs: 'oneCell',
            });
          }
        } catch {
          // skip image on error
        }
      }

      if (productIdNum) {
        try {
          const qrUrl = `https://shop.tiktok.com/view/product/${productIdNum}?source=agency&region=br`;
          const qrDataUrl = await QRCode.toDataURL(qrUrl, {
            errorCorrectionLevel: 'H',
            margin: 1,
            width: 512,
          });
          const qrBase64 = qrDataUrl.replace(/^data:image\/png;base64,/, '');
          const qrBuffer = Buffer.from(qrBase64, 'base64') as unknown as ExcelJS.Buffer;
          const qrImgId = workbook.addImage({
            buffer: qrBuffer,
            extension: 'png',
          });
          worksheet.addImage(qrImgId, {
            tl: { col: 3 + 0.05, row: rowIndex - 1 + 0.05 },
            ext: { width: QR_SIZE_PX, height: QR_SIZE_PX },
            editAs: 'oneCell',
          });
        } catch {
          // skip qr on error
        }
      }
    }

    let buffer = await workbook.xlsx.writeBuffer();

    const zip = await JSZip.loadAsync(buffer as unknown as Blob);
    const sheetXml = await zip.file('xl/worksheets/sheet1.xml')!.async('string');
    const splitColsXml =
      '<cols>' +
      '<col min="1" max="1" width="20.625" customWidth="1"/>' +
      '<col min="2" max="2" width="20.625" customWidth="1"/>' +
      '<col min="3" max="3" width="13" customWidth="1"/>' +
      '<col min="4" max="4" width="13" customWidth="1"/>' +
      '<col min="5" max="5" width="100.625" customWidth="1"/>' +
      '</cols>';
    const newSheetXml = sheetXml.replace(/<cols>.*<\/cols>/s, splitColsXml);
    zip.file('xl/worksheets/sheet1.xml', newSheetXml);
    buffer = (await zip.generateAsync({ type: 'nodebuffer' })) as unknown as ArrayBuffer;

    return { buffer: Buffer.from(buffer as unknown as Uint8Array), fileName };
  }

  async proxyImage(url: string): Promise<{ buffer: Buffer; contentType: string }> {
    const allowedHosts = ['image.zhenghedata.com', 's.500fd.com'];
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      throw new BadRequestException('无效的图片 URL');
    }
    if (!allowedHosts.includes(parsedUrl.hostname)) {
      throw new BadRequestException('不支持的图片来源');
    }

    const response = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MiaodaImageProxy/1.0)',
      },
    });

    if (!response.ok) {
      throw new Error(`图片获取失败: ${response.status}`);
    }

    const contentType = response.headers.get('content-type') ?? 'image/jpeg';
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    return { buffer, contentType };
  }

  async deleteBatch(batchId: string, userId: string): Promise<{ deletedBatchId: string }> {
    const batch = await this.db
      .select({ id: batches.id })
      .from(batches)
      .where(and(eq(batches.id, batchId), isNull(batches.deletedAt)));

    if (batch.length === 0) {
      throw new NotFoundException('批次不存在');
    }

    await this.db
      .update(batches)
      .set({
        deletedAt: new Date(),
        deletedBy: userId,
      })
      .where(eq(batches.id, batchId));

    return { deletedBatchId: batchId };
  }
}
