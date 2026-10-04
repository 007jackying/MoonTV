'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useI18n } from './LanguageProvider';

interface ScrollableRowProps {
  children: React.ReactNode;
  /** 每次点击箭头滚动的距离；默认滚动一屏的 85% */
  scrollDistance?: number;
  gap?: 'sm' | 'md' | 'lg';
}

const GAP = { sm: 'gap-3', md: 'gap-3 md:gap-4', lg: 'gap-3 md:gap-5' };

/**
 * 横向滚动行：触屏直接滑动，桌面悬停时显示左右箭头，
 * 两侧在可继续滚动时做渐隐提示。
 */
export default function ScrollableRow({
  children,
  scrollDistance,
  gap = 'lg',
}: ScrollableRowProps) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const checkScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const { scrollWidth, clientWidth, scrollLeft } = el;
    setCanLeft(scrollLeft > 1);
    setCanRight(scrollWidth - (scrollLeft + clientWidth) > 1);
  }, []);

  useEffect(() => {
    checkScroll();
    const el = containerRef.current;
    if (!el) return;
    // 尺寸或子节点变化（数据加载完成）时重新计算
    const ro = new ResizeObserver(checkScroll);
    ro.observe(el);
    const mo = new MutationObserver(checkScroll);
    mo.observe(el, { childList: true });
    return () => {
      ro.disconnect();
      mo.disconnect();
    };
  }, [checkScroll]);

  const scrollBy = (dir: 1 | -1) => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollBy({
      left: dir * (scrollDistance ?? el.clientWidth * 0.85),
      behavior: 'smooth',
    });
  };

  const arrow =
    'absolute top-[38%] z-10 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-o-bg text-o-ink shadow-o-lg transition-[opacity,transform] duration-200 hover:scale-105 group-hover/row:opacity-100 md:flex';

  return (
    <div className='group/row relative'>
      <div
        ref={containerRef}
        onScroll={checkScroll}
        className={`scrollbar-hide -mx-4 flex snap-x snap-proximity overflow-x-auto scroll-px-4 px-4 pb-3 pt-1 md:-mx-10 md:scroll-px-10 md:px-10 ${GAP[gap]}`}
        style={{
          // 可继续滚动的一侧渐隐
          maskImage: `linear-gradient(to right, ${
            canLeft ? 'transparent, black 48px' : 'black, black'
          }, ${canRight ? 'black calc(100% - 48px), transparent' : 'black, black'})`,
          WebkitMaskImage: `linear-gradient(to right, ${
            canLeft ? 'transparent, black 48px' : 'black, black'
          }, ${canRight ? 'black calc(100% - 48px), transparent' : 'black, black'})`,
        }}
      >
        {children}
      </div>
      {canLeft && (
        <button
          type='button'
          onClick={() => scrollBy(-1)}
          aria-label={t.scrollLeft}
          className={`${arrow} -left-2 opacity-0`}
        >
          <ChevronLeft className='h-5 w-5' strokeWidth={2.75} />
        </button>
      )}
      {canRight && (
        <button
          type='button'
          onClick={() => scrollBy(1)}
          aria-label={t.scrollRight}
          className={`${arrow} -right-2 opacity-0`}
        >
          <ChevronRight className='h-5 w-5' strokeWidth={2.75} />
        </button>
      )}
    </div>
  );
}
