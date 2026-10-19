import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import type { Request } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { SelectionService } from './selection.service';
import type { BatchDecisionRequest, DecisionRequest, DecisionType } from '@shared/api.interface';

const VALID_DECISIONS: DecisionType[] = ['untouched', 'keep', 'discard', 'pending'];
const VALID_EXPORT_DECISIONS = ['keep', 'pending'] as const;

@Controller('api/selection')
export class SelectionController {
  constructor(private readonly selectionService: SelectionService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  async upload(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('未上传文件');
    }
    return this.selectionService.uploadAndParse(file);
  }

  @Get('batches')
  async getBatches() {
    return this.selectionService.getBatchList();
  }

  @Get('image-proxy')
  async proxyImage(@Query('url') url: string, @Res() res: Response) {
    if (!url) {
      res.status(400).end();
      return;
    }
    try {
      const { buffer, contentType } = await this.selectionService.proxyImage(url);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(buffer);
    } catch {
      res.status(404).end();
    }
  }

  @Get('batches/:batchId/progress')
  async getProgress(@Param('batchId') batchId: string) {
    return this.selectionService.getBatchProgress(batchId);
  }

  @Get('batches/:batchId/products')
  async getProducts(
    @Param('batchId') batchId: string,
    @Query('page', ParseIntPipe) page: number,
    @Query('pageSize', ParseIntPipe) pageSize: number,
    @Query('decision') decision?: string,
  ) {
    if (page < 1) {
      throw new BadRequestException('page 必须大于等于 1');
    }
    if (pageSize < 1 || pageSize > 100) {
      throw new BadRequestException('pageSize 必须在 1-100 之间');
    }
    const filterDecision = decision && VALID_DECISIONS.includes(decision as DecisionType)
      ? (decision as DecisionType)
      : undefined;
    return this.selectionService.getProducts(batchId, page, pageSize, filterDecision);
  }

  @Patch('products/:productId/decision')
  async setDecision(
    @Param('productId') productId: string,
    @Body() body: DecisionRequest,
  ) {
    const decision = body.decision;
    if (!VALID_DECISIONS.includes(decision)) {
      throw new BadRequestException('无效的 decision 值');
    }
    return this.selectionService.setDecision(productId, decision);
  }

  @Post('batches/:batchId/batch-decision')
  async batchDecision(
    @Param('batchId') batchId: string,
    @Body() body: BatchDecisionRequest,
  ) {
    if (!body.productIds || !Array.isArray(body.productIds)) {
      throw new BadRequestException('productIds 必须是数组');
    }
    if (body.decision !== 'pending' && body.decision !== 'discard') {
      throw new BadRequestException('批量操作仅支持 pending 或 discard');
    }
    return this.selectionService.batchSetDecision(batchId, body.productIds, body.decision);
  }

  @Get('batches/:batchId/export')
  async exportBatch(
    @Param('batchId') batchId: string,
    @Query('decision') decision: string,
    @Res() res: Response,
  ) {
    if (!VALID_EXPORT_DECISIONS.includes(decision as typeof VALID_EXPORT_DECISIONS[number])) {
      throw new BadRequestException('decision 只能是 keep 或 pending');
    }
    const { buffer, fileName } = await this.selectionService.exportBatch(
      batchId,
      decision as 'keep' | 'pending',
    );
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    );
    res.send(buffer);
  }

  @Delete('batches/:batchId')
  async deleteBatch(@Param('batchId') batchId: string, @Req() req: Request) {
    const userId = req.userContext?.userId ?? '';
    return this.selectionService.deleteBatch(batchId, userId);
  }
}
