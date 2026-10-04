/* eslint-disable @typescript-eslint/no-explicit-any */

'use client';

import {
  Cat,
  Clover,
  Download,
  Film,
  History,
  Home,
  Play,
  Search,
  Star,
  Trash2,
  Tv,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { memo, useEffect, useRef, useState } from 'react';

import { getCustomCategories } from '@/lib/config.client';
import {
  addSearchHistory,
  clearSearchHistory,
  deleteSearchHistory,
  getSearchHistory,
  subscribeToDataUpdates,
} from '@/lib/db.client';

import { useI18n } from './LanguageProvider';
import { LanguageToggle } from './LanguageToggle';
import { useNavigationLoading } from './NavigationLoadingProvider';
import SearchSuggestions from './SearchSuggestions';
import { useSite } from './SiteProvider';
import SourceSelector from './SourceSelector';
import { ThemeToggle } from './ThemeToggle';
import { UserMenu } from './UserMenu';

interface TopNavProps {
  activePath?: string;
}

const TopNav = ({ activePath }: TopNavProps) => {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { siteName } = useSite();
  const { startLoading } = useNavigationLoading();
  const { t } = useI18n();

  const [active, setActive] = useState(activePath || '/');
  const [searchQuery, setSearchQuery] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // 搜索源选择器状态
  const [searchSources, setSearchSources] = useState<string[]>([]);
  const [openFilter, setOpenFilter] = useState<string | null>(null);

  // 历史记录状态
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const historyButtonRef = useRef<HTMLButtonElement>(null);
  const historyPopupRef = useRef<HTMLDivElement>(null);

  const searchBarRef = useRef<HTMLDivElement>(null);

  // 下载任务数量统计
  const [downloadTaskCount, setDownloadTaskCount] = useState(0);

  // 监听下载任务变化，更新角标
  useEffect(() => {
    const updateTaskCount = () => {
      if (typeof window !== 'undefined') {
        const saved = localStorage.getItem('downloadTasks');
        if (saved) {
          try {
            const tasks = JSON.parse(saved);
            // 统计未完成的任务数量（下载中、暂停、等待、错误）
            const activeCount = tasks.filter(
              (t: { status: string }) =>
                t.status === 'downloading' ||
                t.status === 'paused' ||
                t.status === 'waiting' ||
                t.status === 'error'
            ).length;
            setDownloadTaskCount(activeCount);
          } catch {
            setDownloadTaskCount(0);
          }
        } else {
          setDownloadTaskCount(0);
        }
      }
    };

    // 初始加载
    updateTaskCount();

    // 监听 localStorage 变化
    const handleStorageChange = () => {
      updateTaskCount();
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('storage', handleStorageChange);
      // 自定义事件：当任务列表更新时
      window.addEventListener(
        'downloadTasksUpdated',
        handleStorageChange as EventListener
      );
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('storage', handleStorageChange);
        window.removeEventListener(
          'downloadTasksUpdated',
          handleStorageChange as EventListener
        );
      }
    };
  }, []);

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

    // 加载搜索历史
    getSearchHistory().then(setSearchHistory);
    const unsubscribe = subscribeToDataUpdates(
      'searchHistoryUpdated',
      setSearchHistory
    );

    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (activePath) {
      setActive(activePath);
    } else if (pathname === '/play') {
      // 播放页按影片类型高亮“电影 / 剧集”
      const stype = searchParams.get('stype');
      setActive(stype ? `/douban?type=${stype}` : pathname);
    } else {
      const queryString = searchParams.toString();
      const fullPath = queryString ? `${pathname}?${queryString}` : pathname;
      setActive(fullPath);
    }
  }, [activePath, pathname, searchParams]);

  // 同步 URL 中的搜索查询和搜索源到搜索框
  useEffect(() => {
    if (pathname === '/search') {
      const query = searchParams.get('q');
      if (query) {
        setSearchQuery(decodeURIComponent(query));
      } else {
        setSearchQuery('');
      }

      const sources = searchParams.get('sources');
      if (sources) {
        setSearchSources(sources.split(','));
      }
    }
  }, [pathname, searchParams]);

  const [menuItems, setMenuItems] = useState<
    { icon: typeof Film; labelKey: NavLabelKey; href: string }[]
  >([
    { icon: Film, labelKey: 'navMovie', href: '/douban?type=movie' },
    { icon: Tv, labelKey: 'navTv', href: '/douban?type=tv' },
    { icon: Cat, labelKey: 'navAnime', href: '/douban?type=anime' },
    { icon: Clover, labelKey: 'navShow', href: '/douban?type=show' },
  ]);

  useEffect(() => {
    getCustomCategories().then((categories) => {
      if (categories.length > 0) {
        setMenuItems((prevItems) => [
          ...prevItems,
          { icon: Star, labelKey: 'navCustom', href: '/douban?type=custom' },
        ]);
      }
    });
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedQuery = searchQuery.trim();
    if (trimmedQuery) {
      // 添加到搜索历史
      addSearchHistory(trimmedQuery);

      // 如果不在搜索页面，触发加载动画
      if (pathname !== '/search') {
        startLoading();
      }

      const params = new URLSearchParams();
      params.set('q', trimmedQuery);
      if (searchSources.length > 0) {
        params.set('sources', searchSources.join(','));
      }
      router.push(`/search?${params.toString()}`);
      setShowSuggestions(false);
      setShowHistory(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchQuery(value);
    setShowSuggestions(value.trim().length > 0);
    setShowHistory(false); // 输入时关闭历史记录
  };

  const handleSuggestionSelect = (suggestion: string) => {
    setSearchQuery(suggestion);
    setShowSuggestions(false);
    setShowHistory(false); // 选择建议时关闭历史记录

    // 添加到搜索历史
    addSearchHistory(suggestion);

    // 如果不在搜索页面，触发加载动画
    if (pathname !== '/search') {
      startLoading();
    }

    const params = new URLSearchParams();
    params.set('q', suggestion);
    if (searchSources.length > 0) {
      params.set('sources', searchSources.join(','));
    }
    router.push(`/search?${params.toString()}`);
  };

  const handleInputFocus = () => {
    if (searchQuery.trim().length > 0) {
      setShowSuggestions(true);
    }
    setShowHistory(false); // 聚焦输入框时关闭历史记录
  };

  const clearSearch = () => {
    setSearchQuery('');
    setShowSuggestions(false);
    searchInputRef.current?.focus();
  };

  const handleHistoryClick = (item: string) => {
    setSearchQuery(item);
    setShowHistory(false);

    // 添加到搜索历史（更新时间戳）
    addSearchHistory(item);

    // 如果不在搜索页面，触发加载动画
    if (pathname !== '/search') {
      startLoading();
    }

    const params = new URLSearchParams();
    params.set('q', item);
    if (searchSources.length > 0) {
      params.set('sources', searchSources.join(','));
    }
    router.push(`/search?${params.toString()}`);
  };

  const handleDeleteHistory = async (item: string, e: React.MouseEvent) => {
    e.stopPropagation();
    await deleteSearchHistory(item);
  };

  const handleClearAllHistory = async () => {
    await clearSearchHistory();
    setShowHistory(false);
  };

  // 点击搜索栏外部时收起源选择与历史弹窗
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        searchBarRef.current &&
        !searchBarRef.current.contains(event.target as Node)
      ) {
        if (openFilter) setOpenFilter(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [openFilter]);

  // 点击外部关闭历史弹窗
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        showHistory &&
        historyPopupRef.current &&
        historyButtonRef.current &&
        !historyPopupRef.current.contains(event.target as Node) &&
        !historyButtonRef.current.contains(event.target as Node)
      ) {
        setShowHistory(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showHistory]);

  const isMenuItemActive = (href: string) => {
    const typeMatch = href.match(/type=([^&]+)/)?.[1];
    const decodedActive = decodeURIComponent(active);
    return (
      decodedActive === decodeURIComponent(href) ||
      (decodedActive.startsWith('/douban') &&
        decodedActive.includes(`type=${typeMatch}`))
    );
  };

  const navItemClass =
    'flex items-center gap-2 rounded-full px-4 py-[9px] text-sm font-semibold transition-colors text-o-ink hover:bg-o-ink/[0.07] data-[active=true]:bg-o-accent-200 data-[active=true]:text-o-accent-800';

  return (
    <header className='sticky top-0 z-50 hidden w-full bg-o-bg/90 backdrop-blur-xl md:block'>
      <div className='flex h-[76px] items-center gap-4 px-6 lg:gap-[26px] lg:px-10'>
        {/* Logo */}
        <Link
          href='/'
          className='flex flex-none select-none items-center gap-2.5 transition-opacity hover:opacity-80'
          onClick={() => {
            if (active !== '/') startLoading();
          }}
        >
          <span className='flex h-[34px] w-[34px] items-center justify-center rounded-full bg-o-accent text-o-on-accent'>
            <Play
              className='h-[15px] w-[15px] fill-current'
              strokeWidth={2.75}
            />
          </span>
          <span className='font-heading text-2xl tracking-[-0.015em]'>
            {siteName}
          </span>
        </Link>

        {/* 导航菜单 */}
        {isClient && !simpleMode && (
          <nav className='flex flex-none items-center gap-1'>
            <Link
              href='/'
              onClick={() => {
                if (active !== '/') startLoading();
                setActive('/');
              }}
              data-active={active === '/'}
              title={t.navHome}
              className={navItemClass}
            >
              <Home className='h-4 w-4' strokeWidth={2.75} />
              {/* 窄屏只留图标，否则右侧按钮组会被挤出视口 */}
              <span className='hidden xl:inline'>{t.navHome}</span>
            </Link>
            {menuItems.map((item) => {
              const isActive = isMenuItemActive(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => {
                    if (!isActive) startLoading();
                    setActive(item.href);
                  }}
                  data-active={isActive}
                  title={t[item.labelKey]}
                  className={navItemClass}
                >
                  <Icon className='h-4 w-4' strokeWidth={2.75} />
                  <span className='hidden xl:inline'>{t[item.labelKey]}</span>
                </Link>
              );
            })}
          </nav>
        )}

        {/* 搜索栏 */}
        <div
          ref={searchBarRef}
          className='relative ml-auto flex h-11 min-w-[220px] max-w-[480px] flex-1 items-center gap-1.5 rounded-full border border-o-divider bg-o-surface px-1.5'
        >
          <SourceSelector
            selectedSources={searchSources}
            onChange={setSearchSources}
            openFilter={openFilter}
            setOpenFilter={setOpenFilter}
            size='pill'
          />
          <form
            onSubmit={handleSearch}
            className='relative flex min-w-0 flex-1 items-center'
          >
            <Search
              className='ml-1.5 h-4 w-4 flex-none text-o-neutral-700'
              strokeWidth={2.75}
            />
            <input
              ref={searchInputRef}
              type='text'
              value={searchQuery}
              onChange={handleInputChange}
              onFocus={handleInputFocus}
              placeholder={t.searchPlaceholder}
              className='h-10 min-w-0 flex-1 border-0 bg-transparent px-2.5 text-sm text-o-ink placeholder:text-o-neutral-600 focus:outline-none focus:ring-0'
            />
            <SearchSuggestions
              query={searchQuery}
              isVisible={showSuggestions}
              onSelect={handleSuggestionSelect}
              onClose={() => setShowSuggestions(false)}
            />
          </form>
          {searchQuery && (
            <button
              type='button'
              onClick={clearSearch}
              title={t.clear}
              aria-label={t.clear}
              className='flex h-8 w-8 flex-none items-center justify-center rounded-full text-o-neutral-700 transition-colors hover:bg-o-ink/[0.07]'
            >
              <X className='h-4 w-4' strokeWidth={2.75} />
            </button>
          )}
          <button
            ref={historyButtonRef}
            type='button'
            onClick={() => setShowHistory(!showHistory)}
            className='relative flex h-8 w-8 flex-none items-center justify-center rounded-full text-o-neutral-700 transition-colors hover:bg-o-ink/[0.07]'
            title={t.searchHistory}
            aria-label={t.searchHistory}
          >
            <History className='h-4 w-4' strokeWidth={2.75} />
            {searchHistory.length > 0 && (
              <span className='absolute right-1 top-1 h-2 w-2 rounded-full bg-o-accent'></span>
            )}
          </button>

          {/* 历史记录弹窗 */}
          {showHistory && searchHistory.length > 0 && (
            <div
              ref={historyPopupRef}
              className='absolute right-0 top-full z-50 mt-2 max-h-96 w-80 overflow-y-auto rounded-[28px] bg-o-surface p-2 shadow-o-lg'
            >
              <div className='flex items-center justify-between px-3 py-2'>
                <h3 className='o-eyebrow'>{t.searchHistory}</h3>
                <button
                  onClick={handleClearAllHistory}
                  className='o-btn o-btn-ghost text-[13px]'
                >
                  {t.clearAll}
                </button>
              </div>
              {searchHistory.map((item, index) => (
                <div
                  key={`history-${item}-${index}`}
                  className='group flex cursor-pointer items-center justify-between rounded-2xl px-3 py-2 transition-colors hover:bg-o-bg'
                  onClick={() => handleHistoryClick(item)}
                >
                  <span className='flex-1 truncate text-sm'>{item}</span>
                  <button
                    onClick={(e) => handleDeleteHistory(item, e)}
                    className='ml-2 text-o-neutral-600 transition-colors hover:text-o-accent'
                    title={t.delete}
                    aria-label={t.delete}
                  >
                    <Trash2 className='h-3.5 w-3.5' />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 右侧按钮组 */}
        <div className='flex flex-none items-center gap-2'>
          <LanguageToggle />
          <button
            onClick={() => {
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new Event('showDownloadManager'));
              }
            }}
            className='relative flex h-10 w-10 items-center justify-center rounded-full border border-o-divider transition-colors hover:bg-o-ink/[0.07] active:bg-o-ink/[0.14]'
            title={t.downloadManager}
            aria-label={t.downloadManager}
          >
            <Download className='h-[18px] w-[18px]' strokeWidth={2.75} />
            {downloadTaskCount > 0 && (
              <span className='absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-o-accent px-1 text-[11px] font-bold text-o-on-accent'>
                {downloadTaskCount > 99 ? '99+' : downloadTaskCount}
              </span>
            )}
          </button>
          <ThemeToggle />
          <UserMenu />
        </div>
      </div>
    </header>
  );
};

type NavLabelKey = 'navMovie' | 'navTv' | 'navAnime' | 'navShow' | 'navCustom';

// 使用 React.memo 优化，避免父组件更新时导致不必要的重新渲染
// 由于 TopNav 主要依赖内部 hooks 和全局状态，不需要 props 比较函数
export default memo(TopNav);
