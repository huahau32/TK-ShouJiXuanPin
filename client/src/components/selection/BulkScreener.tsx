import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ExternalLink, Loader2 } from 'lucide-react';
import { logger } from '@lark-apaas/client-toolkit/logger';
import { toast } from 'sonner';
import { UniversalLink } from '@lark-apaas/client-toolkit/components/UniversalLink';
import { resolveAppUrl } from '@lark-apaas/client-toolkit/utils/resolveAppUrl';
import { Image } from '@client/src/components/ui/image';
import { Button } from '@client/src/components/ui/button';
import * as selection from '@client/src/api/selection';
import type {
  BatchProgressResponse,
  DecisionType,
  ProductInfo,
} from '@shared/api.interface';

const BULK_PAGE_SIZE = 60;
const CARD_MIN_WIDTH = 230;
const GRID_GAP = 16;
const CONTAINER_PADDING = 20;

const DECISION_LABEL: Record<DecisionType, string> = {
  untouched: '未处理',
  keep: '要',
  discard: '弃',
  pending: '待定',
};

const DECISION_BG_CLASS: Record<DecisionType, string> = {
  untouched: 'bg-gray-400',
  keep: 'bg-green-500',
  discard: 'bg-red-500',
  pending: 'bg-amber-400',
};

const DECISION_TEXT_CLASS: Record<DecisionType, string> = {
  untouched: 'text-white',
  keep: 'text-white',
  discard: 'text-white',
  pending: 'text-gray-900',
};

function getImageProxyUrl(originalUrl: string | null): string | null {
  if (!originalUrl) return null;
  return resolveAppUrl(`/api/selection/image-proxy?url=${encodeURIComponent(originalUrl)}`);
}

function formatPrice(priceBrl: string | null, price: string | null): string {
  const value = priceBrl ?? price;
  if (!value) return '--';
  if (value.includes('R$')) return value;
  return `R$ ${value}`;
}

interface BulkScreenerProps {
  batchId: string;
  progress: BatchProgressResponse | null;
  onProgressRefresh: () => Promise<void>;
}

const BulkScreener = ({ batchId, progress, onProgressRefresh }: BulkScreenerProps) => {
  const [products, setProducts] = useState<ProductInfo[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filterDecision, setFilterDecision] = useState<DecisionType | 'untouched-only'>('untouched-only');
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [imageErrors, setImageErrors] = useState<Record<string, number>>({});
  const [columns, setColumns] = useState(6);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const updateColumns = () => {
      if (!gridRef.current) return;
      const containerWidth = gridRef.current.offsetWidth;
      const cols = Math.max(2, Math.floor((containerWidth + GRID_GAP) / (CARD_MIN_WIDTH + GRID_GAP)));
      setColumns(cols);
    };
    updateColumns();
    window.addEventListener('resize', updateColumns);
    return () => window.removeEventListener('resize', updateColumns);
  }, [products.length]);

  const loadPage = useCallback(async (page: number, decision: DecisionType | 'untouched-only') => {
    setLoading(true);
    try {
      const queryDecision = decision === 'untouched-only' ? 'untouched' : decision;
      const data = await selection.getProducts(batchId, page, BULK_PAGE_SIZE, queryDecision);
      if (page === 1) {
        setProducts(data.items);
      } else {
        setProducts((prev) => [...prev, ...data.items]);
      }
      setHasMore(data.items.length === BULK_PAGE_SIZE && data.items.length > 0);
      setCurrentPage(page);
    } catch (error) {
      logger.error('加载商品失败', error);
      toast.error('加载失败，请重试');
    } finally {
      setLoading(false);
    }
  }, [batchId]);

  useEffect(() => {
    setProducts([]);
    setSelectedIds(new Set());
    setHasMore(true);
    loadPage(1, filterDecision);
  }, [batchId, filterDecision, loadPage]);

  const handleLoadMore = useCallback(() => {
    if (loading || !hasMore) return;
    loadPage(currentPage + 1, filterDecision);
  }, [currentPage, filterDecision, hasMore, loading, loadPage]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleSelectAllVisible = useCallback(() => {
    if (products.length === 0) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      let allSelected = true;
      for (const p of products) {
        if (!next.has(p.id)) {
          allSelected = false;
          break;
        }
      }
      if (allSelected) {
        for (const p of products) {
          next.delete(p.id);
        }
      } else {
        for (const p of products) {
          next.add(p.id);
        }
      }
      return next;
    });
  }, [products]);

  const handleClearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  const handleToggleRow = useCallback((rowIndex: number) => {
    const start = rowIndex * columns;
    const end = Math.min(start + columns, products.length);
    const rowIds = products.slice(start, end).map((p: ProductInfo) => p.id);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allSelected = rowIds.every((id: string) => next.has(id));
      if (allSelected) {
        for (const id of rowIds) next.delete(id);
      } else {
        for (const id of rowIds) next.add(id);
      }
      return next;
    });
  }, [columns, products]);

  const isRowAllSelected = useCallback((rowIndex: number): boolean => {
    const start = rowIndex * columns;
    const end = Math.min(start + columns, products.length);
    if (start >= products.length) return false;
    for (let i = start; i < end; i++) {
      if (!selectedIds.has(products[i].id)) return false;
    }
    return true;
  }, [columns, products, selectedIds]);

  const handleBatchAction = useCallback(async (decision: 'pending' | 'discard') => {
    if (selectedIds.size === 0) return;
    setSubmitting(true);
    const ids = Array.from(selectedIds);
    const prevProducts = products;
    const prevSelected = selectedIds;

    setProducts((prev) =>
      prev.map((p) =>
        prevSelected.has(p.id) ? { ...p, decision } : p,
      ),
    );
    setSelectedIds(new Set());

    try {
      await selection.batchSetDecision(batchId, ids, decision);
      await onProgressRefresh();
      toast.success(`已批量标记为"${DECISION_LABEL[decision]}"`);
    } catch (error) {
      logger.error('批量操作失败', error);
      toast.error('批量操作失败，请重试');
      setProducts(prevProducts);
      setSelectedIds(prevSelected);
    } finally {
      setSubmitting(false);
    }
  }, [batchId, onProgressRefresh, products, selectedIds]);

  const handleImageError = useCallback((id: string) => {
    setImageErrors((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }));
  }, []);

  const allVisibleSelected = useMemo(() => {
    if (products.length === 0) return false;
    return products.every((p) => selectedIds.has(p.id));
  }, [products, selectedIds]);

  const totalRows = useMemo(() => {
    if (columns === 0) return 0;
    return Math.ceil(products.length / columns);
  }, [products.length, columns]);

  const filterOptions: { key: DecisionType | 'untouched-only'; label: string }[] = [
    { key: 'untouched-only', label: '未处理' },
    { key: 'pending', label: '待定' },
    { key: 'keep', label: '要' },
    { key: 'discard', label: '弃' },
    { key: 'untouched', label: '全部' },
  ];

  const totalSelected = selectedIds.size;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col pb-20">
      <div className="fixed top-[140px] left-0 right-0 z-30 bg-gray-50/95 backdrop-blur-sm border-b border-gray-200">
        <div className="w-full px-5 py-2.5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-700">筛选：</span>
              <div className="flex gap-1 flex-wrap">
                {filterOptions.map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setFilterDecision(opt.key)}
                    className={`px-3 py-1 text-xs rounded-full border transition-colors ${
                      filterDecision === opt.key
                        ? 'bg-blue-500 text-white border-blue-500'
                        : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    {opt.label}
                    {opt.key !== 'untouched' && opt.key !== 'untouched-only' && progress ? (
                      <span className="ml-1 opacity-75">({progress[opt.key as DecisionType]})</span>
                    ) : null}
                    {(opt.key === 'untouched-only') && progress ? (
                      <span className="ml-1 opacity-75">({progress.untouched})</span>
                    ) : null}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSelectAllVisible}
                className="px-3 py-1.5 text-xs rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50"
              >
                {allVisibleSelected ? '取消全选' : '全选本页'}
              </button>
              <button
                type="button"
                onClick={handleClearSelection}
                disabled={totalSelected === 0}
                className="px-3 py-1.5 text-xs rounded-md border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                清空选择
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="fixed bottom-4 left-0 right-0 z-50 w-full px-5 pointer-events-none">
        <div className="pointer-events-auto max-w-full mx-auto grid grid-cols-3 items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-5 py-3 shadow-lg shadow-amber-900/10">
          <div className="flex items-center gap-2 justify-start">
            <span className="text-sm font-medium text-amber-900">已选 {totalSelected} 个</span>
            {submitting && <Loader2 className="w-4 h-4 text-amber-700 animate-spin" />}
          </div>
          <div className="flex items-center gap-2 justify-center">
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleBatchAction('discard')}
              disabled={totalSelected === 0 || submitting}
              className="bg-white text-red-600 border-red-300 hover:bg-red-50 hover:text-red-700"
            >
              批量弃
            </Button>
            <Button
              size="sm"
              onClick={() => handleBatchAction('pending')}
              disabled={totalSelected === 0 || submitting}
              className="bg-amber-400 text-gray-900 hover:bg-amber-500 border-amber-400"
            >
              批量加待定
            </Button>
          </div>
        </div>
      </div>

      <div className="flex-1 w-full px-5 py-4 pt-14">
        {products.length === 0 && loading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
            <p className="mt-3 text-sm text-gray-500">加载中...</p>
          </div>
        ) : products.length === 0 && !loading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <p className="text-sm text-gray-500">暂无商品</p>
          </div>
        ) : (
          <div
            ref={gridRef}
            className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-4"
            data-ai-section-type="card-menu"
          >
            {products.map((product, idx) => {
              const isSelected = selectedIds.has(product.id);
              const proxySrc = getImageProxyUrl(product.imageUrl);
              const hasError = imageErrors[product.id] !== undefined;
              const imgKey = `${product.id}-${imageErrors[product.id] ?? 0}`;
              const globalIndex = product.sortIndex;
              const colIndex = idx % columns;
              const isLastInRow = colIndex === columns - 1 || idx === products.length - 1;
              const rowIndex = Math.floor(idx / columns);
              const isRowSelected = isRowAllSelected(rowIndex);

              return (
                <div
                  key={product.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleSelect(product.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggleSelect(product.id);
                    }
                  }}
                  aria-pressed={isSelected}
                  aria-label={`选择 ${product.title}`}
                  className={`relative bg-white rounded-lg overflow-hidden border cursor-pointer transition-all ${
                    isSelected
                      ? 'border-blue-500 ring-2 ring-blue-500/30 shadow-md'
                      : 'border-gray-200 hover:border-gray-300 hover:shadow-sm'
                  } ${product.decision === 'discard' ? 'opacity-50' : ''}`}
                >
                  <div className="relative w-full aspect-square bg-gray-100 overflow-hidden">
                    {proxySrc && !hasError ? (
                      <Image
                        key={imgKey}
                        src={proxySrc}
                        alt={product.title}
                        className="w-full h-full object-cover"
                        loading="lazy"
                        onError={() => handleImageError(product.id)}
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">
                        无图
                      </div>
                    )}
                    <span
                      className={`absolute top-1.5 left-1.5 z-10 px-1.5 py-0.5 text-[10px] font-medium rounded ${DECISION_BG_CLASS[product.decision]} ${DECISION_TEXT_CLASS[product.decision]}`}
                    >
                      {DECISION_LABEL[product.decision]}
                    </span>
                    <span className="absolute top-1.5 left-1/2 -translate-x-1/2 z-10 px-1.5 py-0.5 text-[10px] font-medium rounded bg-white/90 text-gray-700 border border-gray-200">
                      #{globalIndex}
                    </span>
                    <div
                      className={`absolute top-1.5 right-1.5 z-10 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                        isSelected
                          ? 'bg-blue-500 border-blue-500'
                          : 'bg-white/80 border-gray-300'
                      }`}
                    >
                      {isSelected && <Check className="w-3 h-3 text-white" />}
                    </div>
                    {isLastInRow && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleRow(rowIndex);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            e.stopPropagation();
                            handleToggleRow(rowIndex);
                          }
                        }}
                        aria-label={isRowSelected ? `取消选择第${rowIndex + 1}行` : `选择第${rowIndex + 1}行`}
                        className={`absolute bottom-1.5 right-1.5 z-20 w-6 h-6 rounded-md border flex items-center justify-center transition-all ${
                          isRowSelected
                            ? 'bg-blue-500 border-blue-500 text-white'
                            : 'bg-white/90 border-gray-300 text-gray-500 hover:bg-white hover:border-blue-400 hover:text-blue-500'
                        }`}
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  <div className="p-2 space-y-0.5">
                    <h3 className="text-xs font-medium text-gray-900 line-clamp-2 leading-snug h-8">
                      {product.title}
                    </h3>
                    <p className="text-[10px] text-gray-500 truncate">
                      {product.category || '未知类目'}
                    </p>
                    <div className="flex items-center justify-between gap-1 pt-0.5">
                      <span className="text-sm font-bold text-red-500">
                        {formatPrice(product.priceBrl, product.price)}
                      </span>
                      <UniversalLink
                        to={product.productUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-[10px] text-blue-600 hover:text-blue-700 shrink-0 flex items-center gap-0.5"
                        aria-label="打开商品页"
                      >
                        详情
                        <ExternalLink className="w-3 h-3" />
                      </UniversalLink>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="py-6 flex items-center justify-center">
          {loading && products.length > 0 ? (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Loader2 className="w-4 h-4 animate-spin" />
              加载中...
            </div>
          ) : hasMore ? (
            <Button
              variant="outline"
              size="sm"
              onClick={handleLoadMore}
              disabled={loading}
            >
              加载更多
            </Button>
          ) : products.length > 0 ? (
            <p className="text-sm text-gray-400">已全部加载</p>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default BulkScreener;
