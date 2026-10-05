/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  ExternalLink,
  Heart,
  Link,
  Play,
  PlayCircleIcon,
  Server,
  Star,
  Trash2,
} from 'lucide-react';
import Image from 'next/image';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { withAdultFilterParam } from '@/lib/adult-filter.client';
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

import { useI18n } from '@/components/LanguageProvider';
import MobileActionSheet from '@/components/MobileActionSheet';
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
  const { t } = useI18n();
  const [imageLoaded, setImageLoaded] = useState(false);
  // 收藏状态订阅：卸载时取消，避免泄漏和对已卸载组件 setState
  const unsubscribeRef = useRef<(() => void) | null>(null);
  useEffect(() => () => unsubscribeRef.current?.(), []);
  const [showSources, setShowSources] = useState(false);
  const [favoriteChecked, setFavoriteChecked] = useState(false); // 是否已经检查过收藏状态
  const [isActionOpen, setIsActionOpen] = useState(false);
  const [longPressTimer, setLongPressTimer] = useState<number | null>(null);

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
      unsubscribeRef.current?.();
      unsubscribeRef.current = subscribeToDataUpdates(
        'favoritesUpdated',
        (newFavorites: Record<string, any>) => {
          const isNowFavorited = !!newFavorites[storageKey];
          setFavorited(isNowFavorited);
        }
      );
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

  /**
   * 悬停/触摸时预热详情请求。
   * 播放页的关键路径是 /api/detail?source=&id=，提前发起能让 DNS、TLS
   * 握手和服务端到上游 CMS 的连接在用户点击之前就完成。
   * 只对带 source+id 的卡片有意义（豆瓣卡片没有源可问）。
   */
  const prefetchedRef = useRef(false);
  const warmDetail = useCallback(() => {
    if (prefetchedRef.current) return;
    if (from === 'douban' || !actualSource || !actualId) return;
    prefetchedRef.current = true;
    // URL 必须和播放页的关键路径请求逐字一致（含 filterAdult），
    // 否则浏览器 / CDN 缓存的这份响应在点击后根本用不上。
    void fetch(
      withAdultFilterParam(
        `/api/detail?source=${encodeURIComponent(
          actualSource
        )}&id=${encodeURIComponent(actualId)}`
      )
    ).catch(() => {
      /* 预热失败无所谓，真正的请求会在播放页重新发起 */
    });
  }, [from, actualSource, actualId]);

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

  // 卡片下方的辅助信息
  const metaText = (() => {
    if (
      from === 'playrecord' &&
      currentEpisode &&
      actualEpisodes &&
      actualEpisodes > 1
    ) {
      return t.epOf(currentEpisode, actualEpisodes);
    }
    if (from === 'douban' || isAggregate) {
      const y = actualYear && actualYear !== 'unknown' ? actualYear : '';
      if (isAggregate) {
        return [
          y,
          actualEpisodes && actualEpisodes > 1
            ? t.episodesShort(actualEpisodes)
            : t.movie,
        ]
          .filter(Boolean)
          .join(' · ');
      }
      return y;
    }
    return [
      source_name,
      actualEpisodes && actualEpisodes > 1
        ? t.episodesShort(actualEpisodes)
        : '',
    ]
      .filter(Boolean)
      .join(' · ');
  })();

  const iconBtn =
    'flex h-8 w-8 items-center justify-center rounded-full bg-o-video-ink/60 text-o-video-paper backdrop-blur-sm transition-[transform,background-color] duration-200 hover:scale-110 hover:bg-o-video-ink/80';

  // 渲染
  return (
    <div
      className='group relative w-full transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-1'
      style={{
        userSelect: 'none',
        WebkitUserSelect: 'none',
        WebkitTouchCallout: 'none',
      }}
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
        const timerId = window.setTimeout(() => {
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
      onMouseEnter={() => {
        // 收藏夹里的卡片直接默认已收藏，不检查数据库
        if (from === 'favorite' && !favorited) {
          setFavorited(true);
          setFavoriteChecked(true);
          return;
        }
        if (config.showHeart && !favoriteChecked) {
          checkFavoriteStatus();
        }
      }}
    >
      <NextLink
        href={href || '#'}
        className='block rounded-[20px] focus-visible:outline-offset-4'
        title={actualTitle}
        onPointerEnter={warmDetail}
        onPointerDown={warmDetail}
        onClick={(e) => {
          if (!href) {
            e.preventDefault();
            return;
          }
          startLoading();
        }}
      >
        {/* 海报 */}
        <div className='relative aspect-[2/3] overflow-hidden rounded-[18px] bg-o-surface shadow-o-sm transition-shadow duration-300 group-hover:shadow-o-lg md:rounded-[20px]'>
          {!imageLoaded && <div className='o-skeleton absolute inset-0' />}
          <Image
            src={processImageUrl(actualPoster)}
            alt={actualTitle}
            fill
            sizes='(max-width: 768px) 33vw, 180px'
            className={`o-washed object-cover group-hover:scale-[1.04] ${
              imageLoaded ? 'opacity-100' : 'opacity-0'
            } transition-opacity duration-500`}
            referrerPolicy='no-referrer'
            loading='lazy'
            onLoad={() => setImageLoaded(true)}
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

          {/* 悬停遮罩 + 播放按钮 */}
          <div className='pointer-events-none absolute inset-0 bg-gradient-to-t from-o-video-ink/70 via-o-video-ink/10 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100' />
          {config.showPlayButton && (
            <div className='pointer-events-none absolute inset-0 flex items-center justify-center'>
              <span className='flex h-12 w-12 scale-75 items-center justify-center rounded-full bg-o-accent text-o-video-paper opacity-0 shadow-o-lg transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover:scale-100 group-hover:opacity-100'>
                <Play
                  size={20}
                  className='ml-0.5 fill-current'
                  strokeWidth={2.75}
                />
              </span>
            </div>
          )}

          {/* 评分（豆瓣 / Bangumi） */}
          {config.showRating && rate && (
            <span className='absolute left-2 top-2 flex items-center gap-1 rounded-full bg-o-bg px-2 py-0.5 text-[11px] font-bold text-o-accent-800 md:left-2.5 md:top-2.5 md:px-[9px] md:py-[3px] md:text-xs'>
              <Star size={11} className='fill-current' strokeWidth={2.75} />
              {rate}
            </span>
          )}

          {/* 年份（搜索结果） */}
          {from === 'search' &&
            actualYear &&
            actualYear.toLowerCase() !== 'unknown' && (
              <span className='absolute left-2 top-2 rounded-full bg-o-bg px-2 py-0.5 text-[11px] font-bold md:left-2.5 md:top-2.5 md:px-[9px] md:py-[3px] md:text-xs'>
                {actualYear}
              </span>
            )}

          {/* 集数 */}
          {actualEpisodes && actualEpisodes > 1 && from !== 'search' && (
            <span className='absolute right-2 top-2 rounded-full bg-o-video-ink/65 px-2 py-0.5 text-[11px] font-bold tabular-nums text-o-video-paper backdrop-blur-sm md:right-2.5 md:top-2.5'>
              {currentEpisode
                ? `${currentEpisode}/${actualEpisodes}`
                : actualEpisodes}
            </span>
          )}

          {/* 悬停操作：删除记录 / 收藏 / 豆瓣 */}
          <div className='absolute bottom-2.5 left-2.5 flex translate-y-2 gap-1.5 opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100'>
            {config.showDoubanLink && actualDoubanId ? (
              <span
                role='button'
                tabIndex={-1}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  window.open(
                    isBangumi
                      ? `https://bangumi.tv/subject/${actualDoubanId}`
                      : `https://movie.douban.com/subject/${actualDoubanId}`,
                    '_blank'
                  );
                }}
                className={iconBtn}
                title={isBangumi ? t.openBangumi : t.openDouban}
              >
                <ExternalLink size={14} strokeWidth={2.75} />
              </span>
            ) : null}
            {config.showCheckCircle && (
              <span
                role='button'
                tabIndex={-1}
                onClick={handleDeleteRecord}
                className={iconBtn}
                title={t.removeRecord}
              >
                <Trash2 size={14} strokeWidth={2.75} />
              </span>
            )}
            {config.showHeart && (
              <span
                role='button'
                tabIndex={-1}
                onClick={handleToggleFavorite}
                className={iconBtn}
                title={favorited ? t.unfavorite : t.favorite}
              >
                <Heart
                  size={14}
                  strokeWidth={2.75}
                  className={favorited ? 'fill-o-accent text-o-accent' : ''}
                />
              </span>
            )}
          </div>

          {/* 聚合搜索：可用源数量 */}
          {isAggregate && items && items.length > 0 && (
            <div className='absolute bottom-2 right-2 md:bottom-2.5 md:right-2.5'>
              <span
                role='button'
                tabIndex={-1}
                className='flex h-6 items-center gap-1 rounded-full bg-o-sage-700 px-2 text-[11px] font-bold text-o-sage-100 transition-transform hover:scale-105 md:h-[30px] md:gap-[5px] md:px-2.5 md:text-xs'
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setShowSources((prev) => !prev);
                }}
              >
                <Server size={12} strokeWidth={2.75} />
                {t.sourcesCount(items.length)}
              </span>

              {showSources && (
                <div className='absolute bottom-full right-0 z-50 mb-2 max-h-40 w-36 animate-o-pop overflow-auto rounded-[16px] bg-o-surface p-1.5 text-xs shadow-o-lg'>
                  {items.map((item, idx) => (
                    <div
                      key={idx}
                      className='truncate rounded-[10px] px-2 py-1 font-semibold'
                      title={item.source_name}
                    >
                      {item.source_name}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 播放进度 */}
        {config.showProgress && progress !== undefined && (
          <div className='mt-2 h-1.5 w-full overflow-hidden rounded-full bg-o-neutral-300'>
            <div
              className='h-full rounded-full bg-o-accent transition-[width] duration-500 ease-out'
              style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
            />
          </div>
        )}

        {/* 标题与信息 */}
        <div className='mt-2'>
          <div className='truncate text-[13px] font-semibold transition-colors duration-200 group-hover:text-o-accent-700 md:text-sm'>
            {actualTitle}
          </div>
          {metaText && (
            <div className='truncate text-[11px] text-o-neutral-700 md:text-xs'>
              {metaText}
            </div>
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
        sources={
          isAggregate && items
            ? items.map((i) => i.source_name || '').filter(Boolean)
            : []
        }
        currentEpisode={currentEpisode}
        totalEpisodes={actualEpisodes || undefined}
        origin='vod'
        actions={[
          {
            id: 'play',
            label: t.play,
            icon: <PlayCircleIcon size={20} />,
            color: 'primary',
            onClick: () => handleClick(),
          },
          {
            id: 'play-new-tab',
            label: t.playNewTab,
            icon: <ExternalLink size={20} />,
            color: 'default',
            onClick: () => {
              if (href) window.open(href, '_blank');
            },
          },
          ...(from !== 'douban' &&
          !(from === 'search' && isAggregate) &&
          actualSource &&
          actualId
            ? [
                favorited
                  ? {
                      id: 'unfavorite',
                      label: t.unfavorite,
                      icon: (
                        <Heart
                          size={18}
                          className='fill-o-accent text-o-accent'
                        />
                      ),
                      color: 'danger' as const,
                      onClick: (e?: React.MouseEvent) =>
                        handleToggleFavorite(e as React.MouseEvent),
                    }
                  : {
                      id: 'favorite',
                      label: t.favorite,
                      icon: <Heart size={18} />,
                      color: 'primary' as const,
                      onClick: (e?: React.MouseEvent) =>
                        handleToggleFavorite(e as React.MouseEvent),
                    },
              ]
            : []),
          ...(from === 'playrecord' && actualSource && actualId
            ? [
                {
                  id: 'delete-record',
                  label: t.removeRecord,
                  icon: <Trash2 size={18} />,
                  color: 'danger' as const,
                  onClick: (e?: React.MouseEvent) =>
                    handleDeleteRecord(e as React.MouseEvent),
                },
              ]
            : []),
          ...(actualDoubanId
            ? [
                {
                  id: 'open-link',
                  label: isBangumi ? t.openBangumi : t.openDouban,
                  icon: <Link size={18} />,
                  onClick: () => {
                    if (isBangumi) {
                      window.open(
                        `https://bangumi.tv/subject/${actualDoubanId}`,
                        '_blank'
                      );
                    } else {
                      window.open(
                        `https://movie.douban.com/subject/${actualDoubanId}`,
                        '_blank'
                      );
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
