'use client';

import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { DoubanItem } from '@/lib/types';

import { useNavigationLoading } from './NavigationLoadingProvider';
import ScrollableRow from './ScrollableRow';
import VideoCard from './VideoCard';

/**
 * 首页的一条海报行：自己取数据，滚到附近才取。
 *
 * 首页从 4 个分类扩到十几个之后，一次性拉全部 = 十几个豆瓣请求 + 三百张卡片同时挂载，
 * 电视盒子会直接卡死在开机第一屏。改成「进视野前一屏才开始拉」——
 * 打开首页只有前两行在工作，往下走一行才多一行，这也是 Netflix/Prime 的做法。
 *
 * 之前这段逻辑在 page.tsx 里被复制了四遍（每遍 60 行，只差分类名）。
 */

export interface HomeRailProps {
  title: string;
  /** 「查看更多」跳去哪 */
  href: string;
  load: () => Promise<DoubanItem[]>;
  /** 首屏的行直接取数据，不用等 IntersectionObserver 那一跳 */
  eager?: boolean;
  isBangumi?: boolean;
}

const SKELETONS = Array.from({ length: 10 });

export default function HomeRail({
  title,
  href,
  load,
  eager,
  isBangumi,
}: HomeRailProps) {
  const ref = useRef<HTMLElement>(null);
  const [items, setItems] = useState<DoubanItem[] | null>(null);
  const { startLoading } = useNavigationLoading();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let started = false;
    const run = () => {
      if (started) return;
      started = true;
      load()
        .then(setItems)
        .catch(() => setItems([]));
    };

    if (eager) {
      run();
      return;
    }

    // 提前一屏开始拉，滚到的时候图基本已经在了
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          io.disconnect();
          run();
        }
      },
      { rootMargin: '900px 0px' }
    );
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 拉回来是空的（分类下线、豆瓣挂了）就整行收起来。
  // 留一个只有标题的空行，比少一行更像坏了。
  if (items && items.length === 0) return null;

  return (
    <section ref={ref} className='tv-rail-section mb-8'>
      <div className='mb-4 flex items-center justify-between'>
        <h2 className='tv-rail-title text-xl font-bold text-gray-800 dark:text-gray-200'>
          {title}
        </h2>
        <Link
          href={href}
          onClick={startLoading}
          className='tv-rail-more flex items-center text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
        >
          查看更多
          <ChevronRight className='w-4 h-4 ml-1' />
        </Link>
      </div>
      <ScrollableRow>
        {items
          ? items.map((item, index) => (
              <div
                key={`${item.id}-${index}`}
                className='min-w-[120px] w-[120px] sm:min-w-[180px] sm:w-44'
              >
                <VideoCard
                  from='douban'
                  title={item.title}
                  poster={item.poster}
                  douban_id={Number(item.id)}
                  rate={item.rate}
                  year={item.year}
                  isBangumi={isBangumi}
                />
              </div>
            ))
          : SKELETONS.map((_, index) => (
              <div
                key={index}
                className='min-w-[120px] w-[120px] sm:min-w-[180px] sm:w-44'
              >
                <div className='skeleton-shine relative aspect-[2/3] w-full overflow-hidden rounded-lg' />
                <div className='skeleton-shine mt-2 h-4 rounded' />
              </div>
            ))}
      </ScrollableRow>
    </section>
  );
}
