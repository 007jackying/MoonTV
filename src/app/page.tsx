/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps, no-console */

'use client';

import { X } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import Swal from 'sweetalert2';

import { GetBangumiCalendarData } from '@/lib/bangumi.client';
// 客户端收藏 API
import {
  clearAllFavorites,
  getAllFavorites,
  getAllPlayRecords,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { getDoubanCategories } from '@/lib/douban.client';
import { DoubanItem } from '@/lib/types';

import CapsuleSwitch from '@/components/CapsuleSwitch';
import ContinueWatching from '@/components/ContinueWatching';
import HomeRail, { HomeRailProps } from '@/components/HomeRail';
import PageLayout from '@/components/PageLayout';
import { useSite } from '@/components/SiteProvider';
import VideoCard from '@/components/VideoCard';

/**
 * 首页的分类行。
 *
 * 原来只有 4 行（电影 / 剧集 / 新番 / 综艺），电视屏幕往下滚两下就到底了。
 * 扩到十几行是安全的：每一行自己负责取数据，而且只在快滚到的时候才取
 * （见 HomeRail），所以打开首页依然只有前两个请求。
 *
 * 分类值必须来自豆瓣 recent_hot 接口认识的那一组（和 DoubanSelector 里的一致），
 * 随便编一个 type 回来的是空列表，那一行会自己收起来。
 */
const movies = (category: string, type: string) => async () => {
  const r = await getDoubanCategories({ kind: 'movie', category, type });
  return r.code === 200 ? r.list : [];
};

const tv = (category: string, type: string) => async () => {
  const r = await getDoubanCategories({ kind: 'tv', category, type });
  return r.code === 200 ? r.list : [];
};

/** 今天放送的番剧。Bangumi 的字段和豆瓣不一样，在这里抹平成 DoubanItem。 */
const bangumiToday = async (): Promise<DoubanItem[]> => {
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const today = weekdays[new Date().getDay()];
  const calendar = await GetBangumiCalendarData();
  const items = calendar.find((d) => d.weekday.en === today)?.items || [];
  return items.map((a) => ({
    id: String(a.id),
    title: a.name_cn || a.name,
    poster:
      a.images.large ||
      a.images.common ||
      a.images.medium ||
      a.images.small ||
      a.images.grid,
    rate: a.rating?.score?.toString() || '',
    year: a.air_date?.split('-')?.[0] || '',
  }));
};

const RAILS: HomeRailProps[] = [
  // 前两行开屏就要有东西，不等 IntersectionObserver
  {
    title: '热门电影',
    href: '/douban?type=movie',
    load: movies('热门', '全部'),
    eager: true,
  },
  {
    title: '热门剧集',
    href: '/douban?type=tv',
    load: tv('tv', 'tv'),
    eager: true,
  },
  {
    title: '今日新番',
    href: '/douban?type=anime',
    load: bangumiToday,
    isBangumi: true,
  },
  {
    title: '豆瓣高分',
    href: '/douban?type=movie',
    load: movies('豆瓣高分', '全部'),
  },
  { title: '热门综艺', href: '/douban?type=show', load: tv('show', 'show') },
  { title: '国产剧集', href: '/douban?type=tv', load: tv('tv', 'tv_domestic') },
  { title: '欧美剧集', href: '/douban?type=tv', load: tv('tv', 'tv_american') },
  { title: '韩国剧集', href: '/douban?type=tv', load: tv('tv', 'tv_korean') },
  { title: '日本剧集', href: '/douban?type=tv', load: tv('tv', 'tv_japanese') },
  {
    title: '动画剧集',
    href: '/douban?type=anime',
    load: tv('tv', 'tv_animation'),
  },
  {
    title: '华语电影',
    href: '/douban?type=movie',
    load: movies('热门', '华语'),
  },
  {
    title: '欧美电影',
    href: '/douban?type=movie',
    load: movies('热门', '欧美'),
  },
  {
    title: '日本电影',
    href: '/douban?type=movie',
    load: movies('热门', '日本'),
  },
  {
    title: '韩国电影',
    href: '/douban?type=movie',
    load: movies('热门', '韩国'),
  },
  {
    title: '纪录片',
    href: '/douban?type=tv',
    load: tv('tv', 'tv_documentary'),
  },
  {
    title: '冷门佳片',
    href: '/douban?type=movie',
    load: movies('冷门佳片', '全部'),
  },
  {
    title: '最新上映',
    href: '/douban?type=movie',
    load: movies('最新', '全部'),
  },
];

function HomeClient() {
  const [activeTab, setActiveTab] = useState<'home' | 'history' | 'favorites'>(
    'home'
  );
  // 电视端「收藏 / 历史」在顶部导航里，用 ?tab= 切换；桌面仍然用页面中间的胶囊
  const tabParam = useSearchParams().get('tab');
  useEffect(() => {
    if (tabParam === 'history' || tabParam === 'favorites')
      setActiveTab(tabParam);
    else if (tabParam === null) setActiveTab('home');
  }, [tabParam]);
  const { announcement } = useSite();

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
    // 电视端不弹免责声明：这是自用的私人盒子，开机第一件事不该是拿遥控器
    // 关掉一个法律弹窗。桌面/手机保持原样。
    if (document.documentElement.classList.contains('tv')) return;
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

  // 豆瓣数据不在这里取了：每条分类行自己负责，而且滚到附近才取（见 HomeRail）。

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

  return (
    <PageLayout>
      <div className='px-2 sm:px-10 py-4 sm:py-8 overflow-visible'>
        {/* 顶部 Tab 切换 */}
        <div className='tv-tabs-row mb-8 flex justify-center'>
          <CapsuleSwitch
            options={
              simpleMode
                ? [
                    { label: '历史', value: 'history' },
                    { label: '收藏夹', value: 'favorites' },
                  ]
                : [
                    { label: '首页', value: 'home' },
                    { label: '历史', value: 'history' },
                    { label: '收藏夹', value: 'favorites' },
                  ]
            }
            active={simpleMode && activeTab === 'home' ? 'history' : activeTab}
            onChange={(value) =>
              setActiveTab(value as 'home' | 'history' | 'favorites')
            }
          />
        </div>

        {/*
          原来这里有一块跟随焦点切换的沉浸式背景 + 大标题信息块（Netflix 首页那种）。
          拿掉了：它吃掉屏幕上沿 330dp，1080p 的电视上只剩一行半海报，
          而背景图每次移动焦点都要换一张，在 2GB 的盒子上是持续的解码开销。
          换来的是首页能一眼看到两整行片子 —— 电视首页的价值在片子，不在配图。
          组件 TvImmersiveBackdrop.tsx 和 .tv-immersive-* 样式一并删了。
        */}
        <div className='w-full max-w-screen-2xl mx-auto'>
          {activeTab === 'history' ? (
            // 历史视图 - 显示所有播放记录的网格布局
            <ContinueWatching showAll={true} />
          ) : activeTab === 'favorites' ? (
            // 收藏夹视图
            <section className='mb-8'>
              <div className='mb-4 flex items-center justify-between'>
                <h2 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
                  我的收藏
                </h2>
                {favoriteItems.length > 0 && (
                  <button
                    className='text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
                    onClick={async () => {
                      const { isConfirmed } = await Swal.fire({
                        title: '确认清空',
                        text: '确定要清空所有收藏吗？',
                        icon: 'warning',
                        showCancelButton: true,
                        confirmButtonText: '确定',
                        cancelButtonText: '取消',
                      });
                      if (isConfirmed) {
                        await clearAllFavorites();
                        setFavoriteItems([]);
                        Swal.fire({
                          icon: 'success',
                          title: '已清空',
                          text: '所有收藏已清空',
                          timer: 2000,
                          showConfirmButton: false,
                        });
                      }
                    }}
                  >
                    清空
                  </button>
                )}
              </div>
              <div className='tv-poster-grid justify-start grid grid-cols-3 gap-x-2 gap-y-8 sm:gap-y-12 px-0 sm:px-2 sm:grid-cols-[repeat(auto-fill,_minmax(140px,_1fr))] sm:gap-x-8'>
                {favoriteItems.map((item) => (
                  <div key={item.id + item.source} className='w-full'>
                    <VideoCard
                      query={item.search_title}
                      {...item}
                      from='favorite'
                      type={item.episodes > 1 ? 'tv' : ''}
                    />
                  </div>
                ))}
                {favoriteItems.length === 0 && (
                  // 空状态是一次引导，不是一句通知：告诉用户怎么往里加东西
                  <div className='col-span-full py-8 text-left text-gray-500 dark:text-gray-400'>
                    还没有收藏。在任意影片的播放页点一下 ♥，就会出现在这里。
                  </div>
                )}
              </div>
            </section>
          ) : (
            // 首页视图
            <>
              {/* 继续观看 - 组件内部已处理简洁模式 */}
              <ContinueWatching />

              {/* 简洁模式下只显示收藏夹，但在服务器端渲染时先不渲染 */}
              {isClient && !simpleMode && (
                <>
                  {RAILS.map((rail) => (
                    <HomeRail key={rail.title} {...rail} />
                  ))}
                </>
              )}
            </>
          )}
        </div>
      </div>
      {announcement && showAnnouncement && (
        <div
          className={`fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 backdrop-blur-sm dark:bg-black/70 p-4 transition-opacity duration-300 ${
            showAnnouncement ? '' : 'opacity-0 pointer-events-none'
          }`}
        >
          <div className='w-full max-w-md rounded-xl bg-white p-6 shadow-xl dark:bg-gray-900 transform transition-all duration-300 hover:shadow-2xl'>
            <div className='flex justify-between items-start mb-4'>
              <h3 className='text-2xl font-bold tracking-tight text-gray-800 dark:text-white border-b border-green-500 pb-1'>
                提示
              </h3>
              <button
                onClick={() => handleCloseAnnouncement(announcement)}
                className='text-gray-400 hover:text-gray-500 dark:text-gray-500 dark:hover:text-white transition-colors'
                aria-label='关闭'
              >
                <X className='w-5 h-5' />
              </button>
            </div>
            <div className='mb-6'>
              <div className='relative overflow-hidden rounded-lg mb-4 bg-green-50 dark:bg-green-900/20'>
                <div className='absolute inset-y-0 left-0 w-1.5 bg-green-500 dark:bg-green-400'></div>
                <p className='ml-4 text-gray-600 dark:text-gray-300 leading-relaxed'>
                  {announcement}
                </p>
              </div>
            </div>
            <button
              onClick={() => handleCloseAnnouncement(announcement)}
              className='w-full rounded-lg bg-gradient-to-r from-green-600 to-green-700 px-4 py-3 text-white font-medium shadow-md hover:shadow-lg hover:from-green-700 hover:to-green-800 dark:from-green-600 dark:to-green-700 dark:hover:from-green-700 dark:hover:to-green-800 transition-all duration-300 transform hover:-translate-y-0.5'
            >
              我知道了
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
