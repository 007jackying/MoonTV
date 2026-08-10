'use client';

import { useEffect, useRef, useState } from 'react';

import MoonPhase from './MoonPhase';

interface Focused {
  title: string;
  poster: string;
  year?: string;
  rate?: string;
  sourceName?: string;
  episode?: string;
  progress?: number;
}

/**
 * 沉浸式列表的背景与信息块（Android TV「Immersive list」）。
 *
 * 焦点落在哪张卡上，背景就换成那部片子的图，上方信息块同步显示标题和信息。
 * 这样用户不用离开当前行就能判断"要不要看这部"，符合指南说的渐进式呈现。
 *
 * 做法是监听 document 的 focusin，从事件目标往上找带 data-tv-card 的祖先，
 * 直接读它的 data-* 属性，不用改动任何一行列表渲染逻辑。
 *
 * 只在首页挂载：豆瓣/搜索是密集网格，整屏跟着焦点换背景会很吵。
 */
export default function TvImmersiveBackdrop() {
  const [isTv, setIsTv] = useState(false);
  const [item, setItem] = useState<Focused | null>(null);
  // 当前背景对应的标题，给兜底逻辑判重用，避免 MutationObserver ↔ setState 相互触发
  const shownTitleRef = useRef<string | null>(null);

  useEffect(() => {
    setIsTv(document.documentElement.classList.contains('tv'));
  }, []);

  // 没有焦点落在卡片上时，用页面上第一张卡片兜底。
  // 首页第一行是「继续观看」，所以打开应用看到的就是上次没看完的那部 —— 正好是
  // 用户最可能想接着看的东西，而不是一块空白。
  //
  // 列表变化时也要重新兜底：切到「收藏夹」后如果不重算，背景会一直停在
  // 首页那部片子上，和眼前的内容对不上。
  useEffect(() => {
    if (!isTv) return;

    const seed = () => {
      // 用户已经自己选中某张卡了，不要抢
      if (document.activeElement?.closest('[data-tv-card]')) return;
      const card = document.querySelector<HTMLElement>('[data-tv-card][data-tv-title]');
      if (!card) {
        // 一张卡都没有（比如空的收藏夹）：必须把背景清掉。
        // 否则屏幕上一部片子都没有，背后却还挂着上一部的剧照和"看到 7%"。
        shownTitleRef.current = null;
        setItem(null);
        return;
      }
      if (card.dataset.tvTitle === shownTitleRef.current) return;
      card.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    };

    seed();
    let debounce = 0;
    const observer = new MutationObserver(() => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(seed, 150);
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      window.clearTimeout(debounce);
      observer.disconnect();
    };
  }, [isTv]);

  useEffect(() => {
    if (!isTv) return;

    const onFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement | null;
      const card = target?.closest<HTMLElement>('[data-tv-card]');
      if (!card) return; // 焦点在导航或其他控件上时，保留上一张背景

      const d = card.dataset;
      if (!d.tvTitle) return;
      shownTitleRef.current = d.tvTitle;
      const raw = d.tvProgress ? Number(d.tvProgress) : NaN;
      setItem({
        title: d.tvTitle,
        poster: d.tvPoster || '',
        year: d.tvYear || undefined,
        rate: d.tvRate || undefined,
        sourceName: d.tvSource || undefined,
        episode: d.tvEpisode || undefined,
        progress: Number.isFinite(raw) ? raw / 100 : undefined,
      });
    };

    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, [isTv]);

  if (!isTv) return null;

  return (
    <>
      <div className='tv-immersive-bg' aria-hidden='true'>
        {item?.poster && (
          // 这里刻意用原生 <img>：背景图随焦点每移动一张卡就换一次，
          // next/image 会为每个尺寸变体走一趟优化服务，纯装饰性的背景不值得，
          // 在 2GB 的电视盒子上反而更慢。
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={item.poster}
            src={item.poster}
            alt=''
            className='is-shown'
            referrerPolicy='no-referrer'
          />
        )}
        <div className='tv-immersive-scrim' />
      </div>

      {/* 信息块与背景同区，占内容区左侧。没有内容时不占位，避免首屏一块空白 */}
      <div className='tv-immersive-block' data-empty={item ? undefined : ''}>
        {item && (
          <>
            <h1 className='tv-immersive-title'>{item.title}</h1>
            <div className='tv-immersive-meta'>
              {item.rate && <span className='tv-data'>{item.rate}</span>}
              {item.year && <span className='tv-data'>{item.year}</span>}
              {item.sourceName && <span>{item.sourceName}</span>}
              {item.progress !== undefined && (
                <span className='flex items-center gap-2'>
                  <MoonPhase
                    progress={item.progress}
                    size={20}
                    className='text-[color:var(--tv-moonlight)]'
                  />
                  <span className='tv-data'>
                    看到 {Math.round(item.progress * 100)}%
                  </span>
                </span>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
