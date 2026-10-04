'use client';

import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { ReactNode, useLayoutEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// 骨架屏
// ---------------------------------------------------------------------------

/** 海报卡片骨架：2:3 海报 + 两行文字，带流动高光 */
export function PosterSkeleton({ compact = false }: { compact?: boolean }) {
  return (
    <div className='flex flex-col gap-2' aria-hidden='true'>
      <div
        className={`o-skeleton aspect-[2/3] w-full ${
          compact ? 'rounded-[18px]' : 'rounded-[20px]'
        }`}
      />
      <div className='o-skeleton h-3.5 w-4/5 rounded-full' />
      {!compact && <div className='o-skeleton h-3 w-2/5 rounded-full' />}
    </div>
  );
}

/** “继续观看”横向卡片骨架 */
export function ContinueCardSkeleton() {
  return (
    <div
      aria-hidden='true'
      className='flex w-[300px] flex-none gap-3 rounded-[24px] bg-o-surface p-2.5 md:w-[340px] md:gap-3.5 md:rounded-[28px] md:p-3'
    >
      <div className='o-skeleton h-[108px] w-[72px] flex-none rounded-[14px] !bg-o-neutral-300/60 md:h-[126px] md:w-[84px] md:rounded-2xl' />
      <div className='flex flex-1 flex-col gap-2 py-1'>
        <div className='o-skeleton h-4 w-3/4 rounded-full !bg-o-neutral-300/60' />
        <div className='o-skeleton h-3 w-1/2 rounded-full !bg-o-neutral-300/60' />
        <div className='flex-1' />
        <div className='o-skeleton h-1.5 w-full rounded-full !bg-o-neutral-300/60' />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 区块标题：Caprasimo 标题 + 右侧操作
// ---------------------------------------------------------------------------
export function SectionHeader({
  title,
  href,
  actionLabel,
  onAction,
  onNavigate,
  size = 'lg',
}: {
  title: string;
  href?: string;
  actionLabel?: string;
  onAction?: () => void;
  onNavigate?: () => void;
  size?: 'lg' | 'md';
}) {
  const heading = size === 'lg' ? 'text-xl md:text-[25px]' : 'text-xl';
  return (
    <div className='flex items-center gap-4'>
      <h2
        className={`m-0 font-heading leading-[1.12] tracking-[-0.015em] ${heading}`}
      >
        {title}
      </h2>
      {href && actionLabel && (
        <Link
          href={href}
          onClick={onNavigate}
          className='o-btn o-btn-ghost ml-auto min-h-9 text-[13px]'
        >
          {actionLabel}
          <ChevronRight className='h-3.5 w-3.5' strokeWidth={2.75} />
        </Link>
      )}
      {!href && actionLabel && onAction && (
        <button
          type='button'
          onClick={onAction}
          className='o-btn o-btn-ghost ml-auto text-[13px]'
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 分段切换：描边胶囊，选中项为主色，带滑动指示器
// ---------------------------------------------------------------------------
export function SegmentedTabs<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
  ariaLabel,
}: {
  options: { label: string; value: T }[];
  value: T;
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
  ariaLabel?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [indicator, setIndicator] = useState<{ left: number; width: number }>();
  const activeIndex = options.findIndex((o) => o.value === value);

  useLayoutEffect(() => {
    const update = () => {
      const el = itemRefs.current[activeIndex];
      if (el) setIndicator({ left: el.offsetLeft, width: el.offsetWidth });
    };
    update();
    const ro = new ResizeObserver(update);
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [activeIndex, options.length]);

  const pad =
    size === 'sm' ? 'px-3.5 py-2 text-[13px]' : 'px-5 py-[9px] text-sm';

  return (
    <div
      ref={containerRef}
      role='tablist'
      aria-label={ariaLabel}
      className='relative inline-flex flex-none self-start overflow-hidden rounded-full border border-o-divider font-semibold'
    >
      {indicator && (
        <span
          aria-hidden='true'
          className='absolute inset-y-0 rounded-full bg-o-accent transition-[left,width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]'
          style={{ left: indicator.left, width: indicator.width }}
        />
      )}
      {options.map((opt, i) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            ref={(el) => {
              itemRefs.current[i] = el;
            }}
            type='button'
            role='tab'
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            className={`relative whitespace-nowrap transition-colors duration-200 ${pad} ${
              active ? 'text-o-on-accent' : 'text-o-ink hover:bg-o-ink/[0.06]'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 空状态
// ---------------------------------------------------------------------------
export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className='flex animate-o-rise flex-col items-center gap-3 rounded-[32px] bg-o-surface px-6 py-12 text-center'>
      <span className='flex h-14 w-14 items-center justify-center rounded-full bg-o-accent-100 text-o-accent-700'>
        {icon}
      </span>
      <p className='m-0 font-heading text-xl'>{title}</p>
      {hint && (
        <p className='m-0 max-w-sm text-sm text-o-neutral-700'>{hint}</p>
      )}
      {action}
    </div>
  );
}

/** 列表项进场动画的错峰延迟（最多 12 个，避免长列表等待过久） */
export const staggerStyle = (index: number) => ({
  animationDelay: `${Math.min(index, 12) * 35}ms`,
});
