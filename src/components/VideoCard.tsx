/* eslint-disable @typescript-eslint/no-explicit-any */

import { ExternalLink, Heart, Link, PlayCircleIcon, Trash2 } from 'lucide-react';
import Image from 'next/image';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import React, { useCallback, useMemo, useState } from 'react';

import {
  deleteFavorite,
  deletePlayRecord,
  generateStorageKey,
  isFavorited,
  saveFavorite,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { SearchResult } from '@/lib/types';
import { processImageUrl } from '@/lib/utils';

import { ImagePlaceholder } from '@/components/ImagePlaceholder';
import MobileActionSheet from '@/components/MobileActionSheet';
import MoonPhase from '@/components/MoonPhase';
import { useNavigationLoading } from '@/components/NavigationLoadingProvider';

interface VideoCardProps {
  id?: string;
  source?: string;
  title?: string;
  query?: string;
  poster?: string;
  episodes?: number;
  source_name?: string;
  progress?: number;
  year?: string;
  from: 'playrecord' | 'favorite' | 'search' | 'douban';
  currentEpisode?: number;
  douban_id?: number;
  onDelete?: () => void;
  rate?: string;
  items?: SearchResult[];
  type?: string;
  isBangumi?: boolean;
}

export default function VideoCard({
  id,
  title = '',
  query = '',
  poster = '',
  episodes,
  source,
  source_name,
  progress = 0,
  year,
  from,
  currentEpisode,
  douban_id,
  onDelete,
  rate,
  items,
  type = '',
  isBangumi = false,
}: VideoCardProps) {
  const router = useRouter();
  const { startLoading } = useNavigationLoading();
  const [favorited, setFavorited] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const [favoriteChecked, setFavoriteChecked] = useState(false); // 是否已经检查过收藏状态
  const [isActionOpen, setIsActionOpen] = useState(false);
  const [longPressTimer, setLongPressTimer] = useState<number | null>(null);
  // 长按已经弹出了操作面板，随后 touchend 合成的那次 click 不能再跳去播放页 ——
  // 否则面板只闪一帧，手机上根本点不到收藏/删除。
  const longPressedRef = React.useRef(false);

  const isAggregate = from === 'search' && !!items?.length;

  const aggregateData = useMemo(() => {
    if (!isAggregate || !items) return null;
    const countMap = new Map<number, number>();
    const episodeCountMap = new Map<number, number>();
    items.forEach((item) => {
      if (item.douban_id && item.douban_id !== 0) {
        countMap.set(item.douban_id, (countMap.get(item.douban_id) || 0) + 1);
      }
      const len = item.episodes?.length || 0;
      if (len > 0) {
        episodeCountMap.set(len, (episodeCountMap.get(len) || 0) + 1);
      }
    });

    const getMostFrequent = (map: Map<number, number>) => {
      let maxCount = 0;
      let result: number | undefined;
      map.forEach((cnt, key) => {
        if (cnt > maxCount) {
          maxCount = cnt;
          result = key;
        }
      });
      return result;
    };

    return {
      first: items[0],
      mostFrequentDoubanId: getMostFrequent(countMap),
      mostFrequentEpisodes: getMostFrequent(episodeCountMap) || 0,
    };
  }, [isAggregate, items]);

  const actualTitle = aggregateData?.first.title ?? title;
  const actualPoster = aggregateData?.first.poster ?? poster;
  const actualSource = aggregateData?.first.source ?? source;
  const actualId = aggregateData?.first.id ?? id;
  const actualDoubanId = aggregateData?.mostFrequentDoubanId ?? douban_id;
  const actualEpisodes = aggregateData?.mostFrequentEpisodes ?? episodes;
  const actualYear = aggregateData?.first.year ?? year;
  const actualQuery = query || '';
  const actualSearchType = isAggregate
    ? aggregateData?.first.episodes?.length === 1
      ? 'movie'
      : 'tv'
    : type;

  // 检查收藏状态函数
  const checkFavoriteStatus = useCallback(async () => {
    if (from === 'douban' || !actualSource || !actualId) return;
    try {
      const fav = await isFavorited(actualSource, actualId);
      setFavorited(fav);
      setFavoriteChecked(true);

      // 延迟订阅收藏更新
      const storageKey = generateStorageKey(actualSource, actualId);
      subscribeToDataUpdates('favoritesUpdated', (newFavorites: Record<string, any>) => {
        const isNowFavorited = !!newFavorites[storageKey];
        setFavorited(isNowFavorited);
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('检查收藏状态失败', err);
    }
  }, [from, actualSource, actualId]);

  const handleToggleFavorite = useCallback(
    async (e?: React.MouseEvent) => {
      e?.preventDefault();
      e?.stopPropagation();
      if (from === 'douban' || !actualSource || !actualId) return;
      try {
        if (favorited) {
          await deleteFavorite(actualSource, actualId);
          setFavorited(false);
        } else {
          await saveFavorite(actualSource, actualId, {
            title: actualTitle,
            source_name: source_name || '',
            year: actualYear || '',
            cover: actualPoster,
            total_episodes: actualEpisodes ?? 1,
            save_time: Date.now(),
            search_title: actualQuery || '',
          });
          setFavorited(true);
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('切换收藏状态失败', err);
      }
    },
    [
      from,
      actualSource,
      actualId,
      actualTitle,
      source_name,
      actualYear,
      actualPoster,
      actualEpisodes,
      actualQuery,
      favorited,
    ]
  );

  const handleDeleteRecord = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (from !== 'playrecord' || !actualSource || !actualId) return;
      try {
        await deletePlayRecord(actualSource, actualId);
        onDelete?.();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('删除播放记录失败', err);
      }
    },
    [from, actualSource, actualId, onDelete]
  );

  // 播放链接：卡片整体是一个 <a>，因此支持新标签页打开、键盘访问与触屏点击
  const href = useMemo(() => {
    if (from === 'douban') {
      return `/play?title=${encodeURIComponent(actualTitle.trim())}${
        actualYear ? `&year=${actualYear}` : ''
      }${actualSearchType ? `&stype=${actualSearchType}` : ''}`;
    }
    if (actualSource && actualId) {
      return `/play?source=${actualSource}&id=${actualId}&title=${encodeURIComponent(
        actualTitle
      )}${actualYear ? `&year=${actualYear}` : ''}${
        isAggregate ? '&prefer=true' : ''
      }${
        actualQuery ? `&stitle=${encodeURIComponent(actualQuery.trim())}` : ''
      }${actualSearchType ? `&stype=${actualSearchType}` : ''}`;
    }
    return '';
  }, [
    from,
    actualSource,
    actualId,
    actualTitle,
    actualYear,
    isAggregate,
    actualQuery,
    actualSearchType,
  ]);

  const handleClick = useCallback(() => {
    if (!href) return;
    startLoading();
    router.push(href);
  }, [href, router, startLoading]);

  const config = useMemo(() => {
    const configs = {
      playrecord: {
        showSourceName: true,
        showProgress: true,
        showPlayButton: true,
        showHeart: true,
        showCheckCircle: true,
        showDoubanLink: !!actualDoubanId,
        showRating: false,
      },
      favorite: {
        showSourceName: true,
        showProgress: false,
        showPlayButton: true,
        showHeart: true,
        showCheckCircle: false,
        showDoubanLink: !!actualDoubanId,
        showRating: false,
      },
      search: {
        showSourceName: true,
        showProgress: false,
        showPlayButton: true,
        showHeart: !isAggregate,
        showCheckCircle: false,
        showDoubanLink: !!actualDoubanId,
        showRating: false,
      },
      douban: {
        showSourceName: false,
        showProgress: false,
        showPlayButton: true,
        showHeart: false,
        showCheckCircle: false,
        showDoubanLink: true,
        showRating: !!rate,
      },
    };
    return configs[from] || configs.search;
  }, [from, isAggregate, actualDoubanId, rate]);

  // 鼠标悬停或遥控器聚焦时懒加载收藏状态
  const revealCard = useCallback(() => {
    if (from === 'favorite' && !favorited) {
      // 收藏夹里的卡片直接默认已收藏，不检查数据库
      setFavorited(true);
      setFavoriteChecked(true);
      return;
    }
    if (config.showHeart && !favoriteChecked) {
      checkFavoriteStatus();
    }
  }, [from, favorited, config.showHeart, favoriteChecked, checkFavoriteStatus]);

  // 渲染
  return (
    // focus-within mirrors every hover state so a TV remote sees what a mouse sees.
    // scroll-mx keeps the focused card off the edge when a row auto-scrolls.
    <div
      // data-tv-* 供 TvImmersiveBackdrop 读取：焦点落到这张卡时用它换背景和信息块
      data-tv-card=''
      data-tv-title={actualTitle}
      data-tv-poster={processImageUrl(actualPoster)}
      data-tv-year={actualYear || ''}
      data-tv-rate={rate || ''}
      data-tv-source={source_name || ''}
      data-tv-progress={
        config.showProgress && progress !== undefined ? String(progress) : ''
      }
      className="group relative w-full rounded-lg bg-transparent cursor-pointer transition-all duration-300 ease-in-out hover:scale-[1.05] hover:z-[500] focus-within:scale-[1.05] focus-within:z-[500] scroll-mx-16 scroll-my-8"
      style={{ userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none' }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsActionOpen(true);
      }}
      onTouchStart={(e) => {
        e.stopPropagation();
        if (longPressTimer) {
          window.clearTimeout(longPressTimer);
        }
        longPressedRef.current = false;
        const timerId = window.setTimeout(() => {
          longPressedRef.current = true;
          setIsActionOpen(true);
        }, 500);
        setLongPressTimer(timerId);
      }}
      onTouchMove={() => {
        // 滚动时取消长按，避免滑动列表时误弹操作面板
        if (longPressTimer) {
          window.clearTimeout(longPressTimer);
          setLongPressTimer(null);
        }
      }}
      onTouchEnd={() => {
        if (longPressTimer) {
          window.clearTimeout(longPressTimer);
          setLongPressTimer(null);
        }
      }}
      onTouchCancel={() => {
        if (longPressTimer) {
          window.clearTimeout(longPressTimer);
          setLongPressTimer(null);
        }
      }}
      onMouseEnter={revealCard}
      // 遥控器没有 mouseenter，聚焦时同样要拉取收藏状态
      onFocus={revealCard}
    >
      <NextLink
        href={href || '#'}
        // ponytail: 一屏 25 张卡 = 25 次 /play RSC 预取，每次都是一个 edge invocation。
        // /play 本来就要在客户端解析播放源，预取省不了什么。
        prefetch={false}
        className='block outline-none'
        onClick={(e) => {
          if (!href || longPressedRef.current) {
            e.preventDefault();
            longPressedRef.current = false;
            return;
          }
          startLoading();
        }}
      >
      {/* 图片和播放按钮 */}
      <div className='tv-card-poster relative aspect-[2/3] overflow-hidden rounded-lg transition-shadow group-focus-within:ring-4 group-focus-within:ring-green-500'>
        {!isLoading && <ImagePlaceholder aspectRatio='aspect-[2/3]' />}
        <Image
          src={processImageUrl(actualPoster)}
          alt={actualTitle}
          fill
          className='object-cover'
          referrerPolicy='no-referrer'
          loading='lazy'
          onLoad={() => setIsLoading(true)}
          onError={(e) => {
            const img = e.target as HTMLImageElement;
            if (!img.dataset.retried) {
              img.dataset.retried = 'true';
              setTimeout(() => {
                img.src = processImageUrl(actualPoster);
              }, 2000);
            }
          }}
        />

        <div className='absolute inset-0 bg-gradient-to-t from-black/80 via-black-20 to-transparent opacity-0 transition-opacity duration-300 ease-in-out group-hover:opacity-100 group-focus-within:opacity-100' />

      {/* 播放按钮 */}
      {config.showPlayButton && (
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition">
              <PlayCircleIcon
                size={50}
                strokeWidth={0.8}
                className="tv-card-play text-white fill-transparent hover:fill-green-500 hover:scale-[1.1] group-focus-within:fill-green-500 group-focus-within:scale-[1.1] transition pointer-events-none"
              />
            </div>
          )}

        {(config.showHeart || config.showCheckCircle) && (
          <div className='absolute bottom-3 right-3 flex gap-3 opacity-0 translate-y-2 transition-all duration-300 ease-in-out group-hover:opacity-100 group-focus-within:opacity-100 group-hover:translate-y-0 group-focus-within:translate-y-0'>
            {config.showCheckCircle && (
              <Trash2
                onClick={handleDeleteRecord}
                size={20}
                className='text-white transition-all duration-300 ease-out hover:stroke-red-500 hover:scale-[1.1]'
              />
            )}
            {config.showHeart && (
              <Heart
                onClick={handleToggleFavorite}
                size={20}
                className={`transition-all duration-300 ease-out ${
                  favorited
                    ? 'fill-red-600 stroke-red-600'
                    : 'fill-transparent stroke-white hover:stroke-red-400'
                } hover:scale-[1.1]`}
              />
            )}
          </div>
        )}

        {/* ⭐ 评分显示（左上角小圆圈，可跳转豆瓣或 Bangumi） */}
        {config.showRating && rate && actualDoubanId && (
          <div
            className="tv-rate-badge absolute top-2 left-2 bg-pink-500 text-white text-[10px] sm:text-xs font-bold px-2 py-0.5 rounded-full shadow-md cursor-pointer hover:bg-pink-600 transition"
          >
            {rate}
          </div>
        )}


        {/* 📅 年份显示（左上角） */}
        {from === 'search' && actualYear && actualYear.toLowerCase() !== 'unknown' && (
        <div
          className="absolute top-2 left-2 bg-black/60 text-white text-[10px] sm:text-xs font-medium px-2 py-0.5 rounded-full shadow-md"
        >
          {actualYear}
        </div>
        )}

        {/* 🔗 豆瓣/Bangumi跳转链接（左下角） */}
        {config.showDoubanLink && actualDoubanId && (
          <div
            onClick={(e) => {
              e.preventDefault(); // 阻止卡片链接跳转
              e.stopPropagation();

              if (isBangumi) {
                // 动漫 → Bangumi
                window.open(`https://bangumi.tv/subject/${actualDoubanId}`, "_blank");
              } else {
                // 默认 → 豆瓣
                window.open(`https://movie.douban.com/subject/${actualDoubanId}`, "_blank");
              }
            }}
            className="tv-douban-link absolute bottom-2 left-2 bg-green-500 text-white text-xs font-bold w-8 h-8 rounded-full flex items-center justify-center shadow-md hover:bg-green-600 hover:scale-[1.1] transition-all duration-300 ease-out opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 cursor-pointer"
            title={isBangumi ? "跳转到 Bangumi" : "跳转到豆瓣"}
          >
            <svg
              width='16'
              height='16'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              strokeWidth='2'
              strokeLinecap='round'
              strokeLinejoin='round'
            >
              <path d='M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71'></path>
              <path d='M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71'></path>
            </svg>
          </div>
        )}

        {/* 电视端观看进度：月相。
            4dp 高的进度条在 3 米外看不见，月亮的形状可以，而且它不只靠颜色传达信息。
            放左上角——有进度的卡片不会同时显示评分/年份徽章，不会打架。 */}
        {config.showProgress && progress !== undefined && (
          <div className='tv-only-moon absolute top-2 left-2 z-10 hidden'>
            <MoonPhase
              progress={progress / 100}
              size={30}
              className='text-[color:var(--tv-moonlight)] drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)]'
            />
          </div>
        )}

        {/* 集数 */}
        {actualEpisodes && actualEpisodes > 1 && (
          <div className='tv-episode-badge absolute top-2 right-2 bg-green-500 text-white text-xs font-semibold px-2 py-1 rounded-md shadow-md transition-all duration-300 ease-out group-hover:scale-110 group-focus-within:scale-110'>
            {currentEpisode ? `${currentEpisode}/${actualEpisodes}` : actualEpisodes}
          </div>
        )}

{/* 播放源徽章 */}
{isAggregate && items && items.length > 0 && (
  <div className="absolute bottom-2 right-2 flex flex-col items-end">
    <div className="relative group/sources">
      {/* 小圆圈按钮：默认显示 */}
      <div
        className="bg-gray-700 text-white text-xs sm:text-xs w-6 h-6 sm:w-7 sm:h-7 rounded-full flex items-center justify-center shadow-md hover:bg-gray-600 hover:scale-[1.1] transition-all duration-300 ease-out cursor-pointer"
        onClick={(e) => {
          e.preventDefault(); // 阻止卡片链接跳转
          e.stopPropagation();
          setShowSources((prev) => !prev); // 点击切换列表显示
        }}
      >
        {items.length}
      </div>

{/* 播放源列表弹窗 */}
{showSources && (
  <div
    className="absolute bottom-full mb-2 right-0 sm:right-0 z-50"
    onClick={(e) => {
      // 弹层在卡片链接内部，不拦住就会点一下源名直接跳去播放页
      e.preventDefault();
      e.stopPropagation();
    }}
  >
    <div className="bg-gray-800/90 backdrop-blur-sm text-white text-xs sm:text-xs rounded-lg shadow-xl border border-white/10 p-1 sm:p-1.5 min-w-[70px] sm:min-w-[90px] max-w-[120px] sm:max-w-[160px] max-h-20 sm:max-h-40 overflow-auto">
      <div className="space-y-0.5 sm:space-y-1">
        {items.map((item, idx) => (
          <div key={idx} className="flex items-center gap-1 sm:gap-1.5">
            <div className="w-0.5 h-0.5 sm:w-1 sm:h-1 bg-blue-400 rounded-full flex-shrink-0"></div>
            <span className="truncate text-[10px] sm:text-xs leading-tight" title={item.source_name}>
              {item.source_name}
            </span>
          </div>
        ))}
      </div>

      {/* 小箭头 */}
      <div className="absolute top-full right-2 sm:right-3 w-0 h-0 border-l-[4px] border-r-[4px] border-t-[4px] sm:border-l-[6px] sm:border-r-[6px] sm:border-t-[6px] border-transparent border-t-gray-800/90"></div>
    </div>
  </div>
)}
{/* 播放源列表弹窗 */}

    </div>
  </div>
)}


      </div>

      {config.showProgress && progress !== undefined && (
        <>
          {/* 桌面/手机：细进度条 */}
          <div className='tv-hide-on-tv mt-1 h-1 w-full bg-gray-200 rounded-full overflow-hidden'>
            <div
              className='h-full bg-green-500 transition-all duration-500 ease-out'
              style={{ width: `${progress}%` }}
            />
          </div>
        </>
      )}

      <div className='mt-2 text-center'>
        <div className='relative'>
          <span className='tv-card-title block text-sm font-semibold truncate text-gray-900 dark:text-gray-100 transition-colors duration-300 ease-in-out group-hover:text-green-600 group-focus-within:text-green-600 dark:group-hover:text-green-400 dark:group-focus-within:text-green-400 peer'>
            {actualTitle}
          </span>
          <div className='absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-1 bg-gray-800 text-white text-xs rounded-md shadow-lg opacity-0 invisible peer-hover:opacity-100 peer-hover:visible transition-all duration-200 ease-out delay-100 whitespace-nowrap pointer-events-none'>
            {actualTitle}
            <div className='absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-800'></div>
          </div>
        </div>
        {config.showSourceName && source_name && (
          <span className='block text-xs text-gray-500 dark:text-gray-400 mt-1'>
            <span className='tv-card-source inline-block border rounded px-2 py-0.5 border-gray-500/60 dark:border-gray-400/60 transition-all duration-300 ease-in-out group-hover:border-green-500/60 group-focus-within:border-green-500/60 group-hover:text-green-600 group-focus-within:text-green-600 dark:group-hover:text-green-400 dark:group-focus-within:text-green-400'>
              {source_name}
            </span>
          </span>
        )}
      </div>
      </NextLink>

      {/* 右键 / 长按 操作面板 */}
      <MobileActionSheet
        isOpen={isActionOpen}
        onClose={() => setIsActionOpen(false)}
        title={actualTitle}
        poster={processImageUrl(actualPoster)}
        sourceName={source_name}
        isAggregate={isAggregate}
        sources={isAggregate && items ? items.map(i => i.source_name || '').filter(Boolean) : []}
        currentEpisode={currentEpisode}
        totalEpisodes={actualEpisodes || undefined}
        origin="vod"
        actions={[
          {
            id: 'play',
            label: '播放',
            icon: <PlayCircleIcon size={20} />,
            color: 'primary',
            onClick: () => handleClick(),
          },
          {
            id: 'play-new-tab',
            label: '在新标签页播放',
            icon: <ExternalLink size={20} />,
            color: 'default',
            onClick: () => {
              if (href) window.open(href, '_blank');
            },
          },
          ...(from !== 'douban' && !(from === 'search' && isAggregate) && actualSource && actualId
            ? [
                favorited
                  ? {
                      id: 'unfavorite',
                      label: '取消收藏',
                      icon: <Heart size={18} className="fill-red-600 stroke-red-600" />,
                      color: 'danger' as const,
                      onClick: (e?: React.MouseEvent) => handleToggleFavorite(e as React.MouseEvent),
                    }
                  : {
                      id: 'favorite',
                      label: '加入收藏',
                      icon: <Heart size={18} className="fill-transparent stroke-gray-600" />,
                      color: 'primary' as const,
                      onClick: (e?: React.MouseEvent) => handleToggleFavorite(e as React.MouseEvent),
                    },
              ]
            : []),
          ...(from === 'playrecord' && actualSource && actualId
            ? [
                {
                  id: 'delete-record',
                  label: '删除播放记录',
                  icon: <Trash2 size={18} />,
                  color: 'danger' as const,
                  onClick: (e?: React.MouseEvent) => handleDeleteRecord(e as React.MouseEvent),
                },
              ]
            : []),
          ...(actualDoubanId
            ? [
                {
                  id: 'open-link',
                  label: isBangumi ? '打开 Bangumi 页面' : '打开豆瓣页面',
                  icon: <Link size={18} />,
                  onClick: () => {
                    if (isBangumi) {
                      window.open(`https://bangumi.tv/subject/${actualDoubanId}`, '_blank');
                    } else {
                      window.open(`https://movie.douban.com/subject/${actualDoubanId}`, '_blank');
                    }
                  },
                },
              ]
            : []),
        ]}
      />
    </div>
  );
}
