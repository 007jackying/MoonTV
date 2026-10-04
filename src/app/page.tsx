/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps, no-console */

'use client';

import { Heart, X } from 'lucide-react';
import { Suspense, useEffect, useState } from 'react';
import Swal from 'sweetalert2';

import {
  BangumiCalendarData,
  GetBangumiCalendarData,
} from '@/lib/bangumi.client';
// 客户端收藏 API
import {
  clearAllFavorites,
  getAllFavorites,
  getAllPlayRecords,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { getDoubanCategories } from '@/lib/douban.client';
import { DoubanItem } from '@/lib/types';

import ContinueWatching from '@/components/ContinueWatching';
import { useI18n } from '@/components/LanguageProvider';
import { useNavigationLoading } from '@/components/NavigationLoadingProvider';
import PageLayout from '@/components/PageLayout';
import ScrollableRow from '@/components/ScrollableRow';
import { useSite } from '@/components/SiteProvider';
import {
  EmptyState,
  PosterSkeleton,
  SectionHeader,
  SegmentedTabs,
  staggerStyle,
} from '@/components/ui/Organic';
import VideoCard from '@/components/VideoCard';

function HomeClient() {
  const [activeTab, setActiveTab] = useState<'home' | 'history' | 'favorites'>(
    'home'
  );
  const [hotMovies, setHotMovies] = useState<DoubanItem[]>([]);
  const [hotTvShows, setHotTvShows] = useState<DoubanItem[]>([]);
  const [hotVarietyShows, setHotVarietyShows] = useState<DoubanItem[]>([]);
  const [bangumiCalendarData, setBangumiCalendarData] = useState<
    BangumiCalendarData[]
  >([]);
  const [loading, setLoading] = useState(true);
  const { announcement } = useSite();
  const { startLoading } = useNavigationLoading();
  const { t } = useI18n();

  const [showAnnouncement, setShowAnnouncement] = useState(false);

  // 检查是否启用简洁模式
  const [simpleMode, setSimpleMode] = useState(false);
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
    if (typeof window !== 'undefined') {
      const savedSimpleMode = localStorage.getItem('simpleMode');
      if (savedSimpleMode !== null) {
        setSimpleMode(JSON.parse(savedSimpleMode));
      }
    }
  }, []);

  // 检查公告弹窗状态
  useEffect(() => {
    if (typeof window !== 'undefined' && announcement) {
      const hasSeenAnnouncement = localStorage.getItem('hasSeenAnnouncement');
      if (hasSeenAnnouncement !== announcement) {
        setShowAnnouncement(true);
      } else {
        setShowAnnouncement(Boolean(!hasSeenAnnouncement && announcement));
      }
    }
  }, [announcement]);

  // 收藏夹数据
  type FavoriteItem = {
    id: string;
    source: string;
    title: string;
    poster: string;
    episodes: number;
    source_name: string;
    currentEpisode?: number;
    search_title?: string;
  };

  const [favoriteItems, setFavoriteItems] = useState<FavoriteItem[]>([]);

  useEffect(() => {
    const fetchRecommendData = async () => {
      try {
        setLoading(true);

        // 检查是否启用简洁模式
        const savedSimpleMode = localStorage.getItem('simpleMode');
        const isSimpleMode = savedSimpleMode
          ? JSON.parse(savedSimpleMode)
          : false;

        if (isSimpleMode) {
          // 简洁模式下跳过豆瓣数据获取
          setLoading(false);
          return;
        }

        // 并行获取热门电影、热门剧集和热门综艺
        const [moviesData, tvShowsData, varietyShowsData, bangumiCalendarData] =
          await Promise.all([
            getDoubanCategories({
              kind: 'movie',
              category: '热门',
              type: '全部',
            }),
            getDoubanCategories({ kind: 'tv', category: 'tv', type: 'tv' }),
            getDoubanCategories({ kind: 'tv', category: 'show', type: 'show' }),
            GetBangumiCalendarData(),
          ]);

        if (moviesData.code === 200) {
          setHotMovies(moviesData.list);
        }

        if (tvShowsData.code === 200) {
          setHotTvShows(tvShowsData.list);
        }

        if (varietyShowsData.code === 200) {
          setHotVarietyShows(varietyShowsData.list);
        }

        setBangumiCalendarData(bangumiCalendarData);
      } catch (error) {
        console.error('获取推荐数据失败:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchRecommendData();
  }, []);

  // 处理收藏数据更新的函数
  const updateFavoriteItems = async (allFavorites: Record<string, any>) => {
    const allPlayRecords = await getAllPlayRecords();

    // 根据保存时间排序（从近到远）
    const sorted = Object.entries(allFavorites)
      .sort(([, a], [, b]) => b.save_time - a.save_time)
      .map(([key, fav]) => {
        const plusIndex = key.indexOf('+');
        const source = key.slice(0, plusIndex);
        const id = key.slice(plusIndex + 1);

        // 查找对应的播放记录，获取当前集数
        const playRecord = allPlayRecords[key];
        const currentEpisode = playRecord?.index;

        return {
          id,
          source,
          title: fav.title,
          year: fav.year,
          poster: fav.cover,
          episodes: fav.total_episodes,
          source_name: fav.source_name,
          currentEpisode,
          search_title: fav?.search_title,
        } as FavoriteItem;
      });
    setFavoriteItems(sorted);
  };

  // 当切换到收藏夹时加载收藏数据
  useEffect(() => {
    if (activeTab !== 'favorites') return;

    const loadFavorites = async () => {
      const allFavorites = await getAllFavorites();
      await updateFavoriteItems(allFavorites);
    };

    loadFavorites();

    // 监听收藏更新事件
    const unsubscribe = subscribeToDataUpdates(
      'favoritesUpdated',
      (newFavorites: Record<string, any>) => {
        updateFavoriteItems(newFavorites);
      }
    );

    return unsubscribe;
  }, [activeTab]);

  const handleCloseAnnouncement = (announcement: string) => {
    setShowAnnouncement(false);
    localStorage.setItem('hasSeenAnnouncement', announcement); // 记录已查看弹窗
  };

  const handleClearFavorites = async () => {
    const { isConfirmed } = await Swal.fire({
      title: t.confirmClear,
      text: t.confirmClearFavorites,
      showCancelButton: true,
      confirmButtonText: t.confirmOk,
      cancelButtonText: t.cancel,
    });
    if (!isConfirmed) return;
    await clearAllFavorites();
    setFavoriteItems([]);
    Swal.fire({
      toast: true,
      position: 'top-end',
      title: t.cleared,
      timer: 1600,
      showConfirmButton: false,
    });
  };

  // 今日新番（Bangumi 每日放送）
  const todayAnimes = (() => {
    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const currentWeekday = weekdays[new Date().getDay()];
    return (
      bangumiCalendarData.find((item) => item.weekday.en === currentWeekday)
        ?.items || []
    );
  })();

  const rows: {
    key: string;
    title: string;
    href: string;
    items: {
      id: string | number;
      title: string;
      poster: string;
      rate: string;
      year: string;
      bangumi?: boolean;
    }[];
    type?: string;
  }[] = [
    {
      key: 'movie',
      title: t.hotMovies,
      href: '/douban?type=movie',
      type: 'movie',
      items: hotMovies.map((m) => ({ ...m, id: m.id })),
    },
    {
      key: 'tv',
      title: t.hotTv,
      href: '/douban?type=tv',
      items: hotTvShows.map((m) => ({ ...m, id: m.id })),
    },
    {
      key: 'anime',
      title: t.newAnime,
      href: '/douban?type=anime',
      items: todayAnimes.map((a) => ({
        id: a.id,
        title: a.name_cn || a.name,
        poster:
          a.images.large ||
          a.images.common ||
          a.images.medium ||
          a.images.small ||
          a.images.grid,
        rate: a.rating?.score?.toString() || '',
        year: a.air_date?.split('-')?.[0] || '',
        bangumi: true,
      })),
    },
    {
      key: 'show',
      title: t.hotVariety,
      href: '/douban?type=show',
      items: hotVarietyShows.map((m) => ({ ...m, id: m.id })),
    },
  ];

  const rowItemClass =
    'w-[112px] flex-none snap-start sm:w-[150px] lg:w-[168px] 2xl:w-[188px]';

  const tabOptions = (
    simpleMode
      ? [
          { label: t.tabHistory, value: 'history' },
          { label: t.tabFavorites, value: 'favorites' },
        ]
      : [
          { label: t.tabHome, value: 'home' },
          { label: t.tabHistory, value: 'history' },
          { label: t.tabFavorites, value: 'favorites' },
        ]
  ) as { label: string; value: 'home' | 'history' | 'favorites' }[];

  return (
    <PageLayout>
      <div className='mx-auto flex w-full max-w-[1760px] flex-col gap-[26px] px-4 pb-7 pt-2 md:gap-10 md:px-10 md:pb-12 md:pt-4'>
        {/* 顶部 Tab 切换 */}
        <SegmentedTabs
          options={tabOptions}
          value={simpleMode && activeTab === 'home' ? 'history' : activeTab}
          onChange={setActiveTab}
        />

        {activeTab === 'history' ? (
          <ContinueWatching showAll={true} />
        ) : activeTab === 'favorites' ? (
          <section className='flex flex-col gap-4'>
            <SectionHeader
              title={t.myFavorites}
              actionLabel={favoriteItems.length > 0 ? t.clear : undefined}
              onAction={handleClearFavorites}
            />
            {favoriteItems.length === 0 ? (
              <EmptyState
                icon={<Heart className='h-6 w-6' strokeWidth={2.5} />}
                title={t.noFavorites}
                hint={t.emptyHint}
              />
            ) : (
              <div className='grid grid-cols-3 gap-x-2.5 gap-y-5 sm:grid-cols-[repeat(auto-fill,minmax(150px,1fr))] sm:gap-x-5 sm:gap-y-7'>
                {favoriteItems.map((item, i) => (
                  <div
                    key={item.id + item.source}
                    className='animate-o-rise'
                    style={staggerStyle(i)}
                  >
                    <VideoCard
                      query={item.search_title}
                      {...item}
                      from='favorite'
                      type={item.episodes > 1 ? 'tv' : ''}
                    />
                  </div>
                ))}
              </div>
            )}
          </section>
        ) : (
          <>
            {/* 继续观看 - 组件内部已处理简洁模式 */}
            <ContinueWatching />

            {/* 简洁模式下不显示推荐，服务器端渲染时也先不渲染 */}
            {isClient &&
              !simpleMode &&
              rows.map((row) =>
                !loading && row.items.length === 0 ? null : (
                  <section
                    key={row.key}
                    className='flex flex-col gap-3 md:gap-4'
                  >
                    <SectionHeader
                      title={row.title}
                      href={row.href}
                      actionLabel={t.seeAll}
                      onNavigate={startLoading}
                    />
                    <ScrollableRow>
                      {loading
                        ? Array.from({ length: 8 }).map((_, i) => (
                            <div key={i} className={rowItemClass}>
                              <PosterSkeleton />
                            </div>
                          ))
                        : row.items.map((item, i) => (
                            <div
                              key={`${item.id}-${i}`}
                              className={`${rowItemClass} animate-o-rise`}
                              style={staggerStyle(i)}
                            >
                              <VideoCard
                                from='douban'
                                title={item.title}
                                poster={item.poster}
                                douban_id={Number(item.id)}
                                rate={item.rate}
                                year={item.year}
                                type={row.type}
                                isBangumi={item.bangumi}
                              />
                            </div>
                          ))}
                    </ScrollableRow>
                  </section>
                )
              )}
          </>
        )}
      </div>

      {announcement && showAnnouncement && (
        <div className='fixed inset-0 z-[1000] flex animate-o-pop items-center justify-center bg-o-video-ink/50 p-4 backdrop-blur-sm'>
          <div
            role='dialog'
            aria-modal='true'
            aria-labelledby='announcement-title'
            className='flex w-full max-w-md flex-col gap-4 rounded-[32px] bg-o-surface p-6 shadow-o-lg md:p-7'
          >
            <div className='flex items-start justify-between gap-4'>
              <h3
                id='announcement-title'
                className='m-0 font-heading text-[25px] leading-tight'
              >
                {t.notice}
              </h3>
              <button
                onClick={() => handleCloseAnnouncement(announcement)}
                className='o-btn o-btn-icon -mr-2 -mt-1'
                aria-label={t.cancel}
              >
                <X className='h-5 w-5' strokeWidth={2.75} />
              </button>
            </div>
            <p className='m-0 rounded-[20px] bg-o-bg px-4 py-3 leading-relaxed text-o-neutral-800'>
              {announcement}
            </p>
            <button
              onClick={() => handleCloseAnnouncement(announcement)}
              className='o-btn o-btn-primary o-press w-full py-3'
            >
              {t.gotIt}
            </button>
          </div>
        </div>
      )}
    </PageLayout>
  );
}

export default function Home() {
  return (
    <Suspense>
      <HomeClient />
    </Suspense>
  );
}
