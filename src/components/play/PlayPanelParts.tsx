'use client';

import {
  Activity,
  ArrowUpDown,
  Gauge,
  List,
  Loader2,
  Search,
  Zap,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { shortEpisodeLabel } from '@/lib/i18n';
import { SearchResult } from '@/lib/types';

import { VideoInfo } from './useSourceSpeedTest';
import { useI18n } from '../LanguageProvider';

// ---------------------------------------------------------------------------
// 分辨率标签
// ---------------------------------------------------------------------------
export function QualityTag({ info }: { info?: VideoInfo }) {
  const { t } = useI18n();
  if (!info || info.quality === '未知') return null;
  if (info.hasError) {
    return (
      <span className='o-tag o-tag-neutral ml-auto flex-none font-bold'>
        {t.testFailed}
      </span>
    );
  }
  const cls = ['4K', '2K'].includes(info.quality)
    ? 'o-tag-accent'
    : ['1080p', '720p'].includes(info.quality)
    ? 'o-tag-sage'
    : 'o-tag-neutral';
  return (
    <span className={`o-tag ${cls} ml-auto flex-none font-bold`}>
      {info.quality}
    </span>
  );
}

// ---------------------------------------------------------------------------
// 测速数据：速度 / 延迟 / 集数（保留原始数值）
// ---------------------------------------------------------------------------
export function SourceStats({
  info,
  measuring,
  episodes,
  withIcons = false,
  trailing,
}: {
  info?: VideoInfo;
  measuring: boolean;
  episodes: number;
  withIcons?: boolean;
  trailing?: React.ReactNode;
}) {
  const { t } = useI18n();
  const icon = (Icon: typeof Gauge) =>
    withIcons ? <Icon className='h-3.5 w-3.5' strokeWidth={2.75} /> : null;

  return (
    <div className='flex min-w-0 items-center gap-x-4 gap-y-1 text-[13px] font-semibold tabular-nums'>
      {info && !info.hasError ? (
        <>
          <span className='flex items-center gap-[5px] whitespace-nowrap text-o-sage-700'>
            {icon(Gauge)}
            {info.loadSpeed}
          </span>
          {info.pingTime > 0 && (
            <span className='flex items-center gap-[5px] whitespace-nowrap text-o-accent-700'>
              {icon(Activity)}
              {info.pingTime} ms
            </span>
          )}
        </>
      ) : info?.hasError ? (
        <span className='whitespace-nowrap text-o-neutral-700'>
          {t.noSpeedData}
        </span>
      ) : measuring ? (
        <span className='flex items-center gap-[5px] whitespace-nowrap text-o-neutral-700'>
          <Loader2 className='h-3.5 w-3.5 animate-spin' strokeWidth={2.75} />
          {t.measuring}
        </span>
      ) : null}
      {episodes > 1 && (
        <span className='flex items-center gap-[5px] whitespace-nowrap text-o-neutral-700'>
          {icon(List)}
          {t.epsCount(episodes)}
        </span>
      )}
      {trailing}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 当前源状态圆点
// ---------------------------------------------------------------------------
export function SourceDot({ dim = false }: { dim?: boolean }) {
  return (
    <span
      className={`h-2.5 w-2.5 flex-none rounded-full ${
        dim
          ? 'bg-o-neutral-500'
          : 'bg-o-sage shadow-[0_0_0_4px_rgb(var(--o-sage-200))]'
      }`}
    />
  );
}

// ---------------------------------------------------------------------------
// 其它源列表中的一行
// ---------------------------------------------------------------------------
export function SourceRow({
  source,
  info,
  measuring,
  pending,
  currentTitle,
  disabled,
  onSelect,
  tone = 'bg',
}: {
  source: SearchResult;
  info?: VideoInfo;
  measuring: boolean;
  pending: boolean;
  currentTitle: string;
  disabled: boolean;
  onSelect: () => void;
  tone?: 'bg' | 'surface';
}) {
  const { t } = useI18n();
  const titleDiffers =
    source.title &&
    source.title.trim().toLowerCase() !== currentTitle.trim().toLowerCase();
  return (
    <button
      type='button'
      onClick={onSelect}
      disabled={disabled}
      aria-busy={pending}
      className={`flex w-full flex-none flex-col gap-1 rounded-[18px] px-3.5 py-2 text-left transition-colors disabled:cursor-default ${
        pending
          ? 'bg-o-accent-100 shadow-[0_0_0_2px_rgb(var(--o-accent))]'
          : tone === 'bg'
          ? 'bg-o-bg hover:bg-o-accent-100'
          : 'bg-o-surface hover:bg-o-accent-100'
      }`}
    >
      <div className='flex w-full min-w-0 items-center gap-2.5'>
        <span className='truncate text-[15px] font-bold'>
          {source.source_name}
        </span>
        {titleDiffers && (
          <span className='truncate text-xs text-o-neutral-700'>
            {source.title}
          </span>
        )}
        <QualityTag info={info} />
      </div>
      <SourceStats
        info={info}
        measuring={measuring}
        episodes={source.episodes?.length || 0}
        trailing={
          pending ? (
            <span className='ml-auto whitespace-nowrap text-o-accent-700'>
              {t.switchingState}
            </span>
          ) : undefined
        }
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// 自动优选按钮
// ---------------------------------------------------------------------------
export function AutoPickButton({
  picking,
  disabled,
  onPick,
  onCancel,
}: {
  picking: boolean;
  disabled: boolean;
  onPick: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  if (picking) {
    return (
      <span className='flex items-center gap-1 text-[13px]'>
        <span className='flex items-center gap-1.5 font-semibold text-o-neutral-700'>
          <Loader2 className='h-3.5 w-3.5 animate-spin' strokeWidth={2.75} />
          {t.autoPicking}
        </span>
        <button
          type='button'
          onClick={onCancel}
          className='o-btn o-btn-ghost px-2.5 py-1 text-[13px]'
        >
          {t.cancel}
        </button>
      </span>
    );
  }
  return (
    <button
      type='button'
      onClick={onPick}
      disabled={disabled}
      className='o-btn o-btn-ghost px-2.5 py-1 text-[13px]'
    >
      <Zap className='h-3.5 w-3.5' strokeWidth={2.75} />
      {t.autoPick}
    </button>
  );
}

export function WrongMatchButton({ onClick }: { onClick: () => void }) {
  const { t } = useI18n();
  return (
    <button
      type='button'
      onClick={onClick}
      className='o-btn o-btn-ghost flex-none self-start text-[13px]'
    >
      <Search className='h-3.5 w-3.5' strokeWidth={2.75} />
      {t.wrongMatch}
    </button>
  );
}

// ---------------------------------------------------------------------------
// 选集：分页（超过 100 集时）+ 网格
// ---------------------------------------------------------------------------
const PAGE_SIZE = 100;

export function useEpisodeOrder(total: number, currentIndex: number) {
  const [descending, setDescending] = useState(false);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const [page, setPage] = useState(Math.floor(currentIndex / PAGE_SIZE));

  // 当前集变化时跳到它所在的分页
  useEffect(() => {
    setPage(Math.floor(currentIndex / PAGE_SIZE));
  }, [currentIndex]);

  const indices = useMemo(() => {
    const start = page * PAGE_SIZE;
    const end = Math.min(total, start + PAGE_SIZE);
    const list = Array.from({ length: end - start }, (_, i) => start + i);
    return descending ? list.reverse() : list;
  }, [page, total, descending]);

  const ranges = useMemo(() => {
    const list = Array.from({ length: pageCount }, (_, i) => ({
      index: i,
      label: `${i * PAGE_SIZE + 1}-${Math.min(total, (i + 1) * PAGE_SIZE)}`,
    }));
    return descending ? list.reverse() : list;
  }, [pageCount, total, descending]);

  return {
    descending,
    toggleOrder: () => setDescending((d) => !d),
    page,
    setPage,
    pageCount,
    ranges,
    indices,
  };
}

export function EpisodeHeader({
  total,
  descending,
  onToggleOrder,
  large = false,
}: {
  total: number;
  descending: boolean;
  onToggleOrder: () => void;
  large?: boolean;
}) {
  const { t } = useI18n();
  const label = descending ? t.sortForward : t.sortReverse;
  return (
    <div className='flex flex-none items-center gap-2'>
      <h4 className='m-0 font-heading text-xl leading-tight tracking-[-0.015em]'>
        {t.episodes}
      </h4>
      <span className='text-[13px] text-o-neutral-700'>{total}</span>
      <button
        type='button'
        onClick={onToggleOrder}
        title={label}
        aria-label={label}
        aria-pressed={descending}
        className={`ml-auto flex items-center justify-center rounded-full border border-o-divider transition-colors hover:bg-o-ink/[0.07] ${
          large ? 'h-11 w-11' : 'h-8 w-8'
        } ${descending ? 'bg-o-accent-100 text-o-accent-800' : ''}`}
      >
        <ArrowUpDown
          className={large ? 'h-[15px] w-[15px]' : 'h-3.5 w-3.5'}
          strokeWidth={2.75}
        />
      </button>
    </div>
  );
}

export function EpisodeRanges({
  ranges,
  page,
  onSelect,
}: {
  ranges: { index: number; label: string }[];
  page: number;
  onSelect: (index: number) => void;
}) {
  if (ranges.length <= 1) return null;
  return (
    <div className='scrollbar-hide -mx-1 flex flex-none gap-1.5 overflow-x-auto px-1'>
      {ranges.map((r) => (
        <button
          key={r.index}
          type='button'
          onClick={() => onSelect(r.index)}
          className={`flex-none rounded-full px-3 py-[5px] text-[13px] font-semibold tabular-nums transition-colors ${
            r.index === page
              ? 'bg-o-accent-200 text-o-accent-800'
              : 'hover:bg-o-ink/[0.07]'
          }`}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}

export function EpisodeGrid({
  indices,
  titles,
  currentIndex,
  onSelect,
  size,
  scrollable = false,
}: {
  indices: number[];
  titles: string[];
  currentIndex: number;
  onSelect: (index: number) => void;
  size: 'desktop' | 'mobile';
  scrollable?: boolean;
}) {
  const labels = indices.map((i) => shortEpisodeLabel(titles[i], i));
  // 集名不是纯数字（如 “HD中字”、“上”、“预告”）时改用更宽的格子
  const wide = labels.some((l) => l.length > 4);
  const activeRef = useRef<HTMLButtonElement>(null);

  // 只在面板内部滚动，让当前集可见
  useEffect(() => {
    const el = activeRef.current;
    const parent = el?.parentElement;
    if (!el || !parent || !scrollable) return;
    // 网格是 relative 的，offsetTop 直接相对于它
    const top = el.offsetTop;
    if (
      top < parent.scrollTop ||
      top + el.offsetHeight > parent.scrollTop + parent.clientHeight
    ) {
      parent.scrollTop = top - parent.clientHeight / 2 + el.offsetHeight / 2;
    }
  }, [currentIndex, scrollable]);

  const tile =
    size === 'desktop' ? 'h-9 rounded-xl' : 'h-[46px] rounded-[14px]';
  const idle = size === 'desktop' ? 'bg-o-bg' : 'bg-o-surface';

  return (
    <div
      className={`relative grid content-start gap-2 ${
        wide ? 'grid-cols-3' : 'grid-cols-6'
      } ${scrollable ? 'min-h-0 overflow-y-auto pb-1' : ''}`}
    >
      {indices.map((i, n) => {
        const active = i === currentIndex;
        return (
          <button
            key={i}
            ref={active ? activeRef : undefined}
            type='button'
            onClick={() => onSelect(i)}
            title={titles[i] || undefined}
            aria-current={active ? 'true' : undefined}
            className={`flex min-w-0 items-center justify-center px-1 text-sm tabular-nums transition-colors ${tile} ${
              active
                ? 'bg-o-accent font-bold text-o-on-accent shadow-o-md'
                : `${idle} font-semibold text-o-ink hover:bg-o-accent-100`
            }`}
          >
            <span className='truncate'>{labels[n]}</span>
          </button>
        );
      })}
    </div>
  );
}
