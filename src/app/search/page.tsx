/* eslint-disable react-hooks/exhaustive-deps, @typescript-eslint/no-explicit-any */
'use client';

import { ChevronUp, Loader2, Search, SearchX, X } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';

import { withAdultFilterParam } from '@/lib/adult-filter.client';
import {
  addSearchHistory,
  clearSearchHistory,
  deleteSearchHistory,
  getSearchHistory,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { SearchResult } from '@/lib/types';
import { getRequestTimeout } from '@/lib/utils';

import FailedSourcesDisplay from '@/components/FailedSourcesDisplay';
import FilterOptions from '@/components/FilterOptions';
import { useI18n } from '@/components/LanguageProvider';
import PageLayout from '@/components/PageLayout';
import SearchSuggestions from '@/components/SearchSuggestions';
import SourceSelector from '@/components/SourceSelector';
import {
  EmptyState,
  PosterSkeleton,
  SectionHeader,
  staggerStyle,
} from '@/components/ui/Organic';
import VideoCard from '@/components/VideoCard';

function SearchPageClient() {
  const { t } = useI18n();
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [showBackToTop, setShowBackToTop] = useState(false);

  const searchParams = useSearchParams();
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [failedSources, setFailedSources] = useState<
    { name: string; key: string; error: string }[]
  >([]);
  const historyRef = useRef<HTMLDivElement>(null);
  const [hasResetOnEmptyParams, setHasResetOnEmptyParams] = useState(true);

  // 分页加载相关状态
  const [displayedExactCount, setDisplayedExactCount] = useState(20); // 初始显示20个精确匹配结果
  const [displayedOthersCount, setDisplayedOthersCount] = useState(20); // 初始显示20个其他结果
  const loadingMoreExactRef = useRef<HTMLDivElement>(null);
  const loadingMoreOthersRef = useRef<HTMLDivElement>(null);
  const observerExactRef = useRef<IntersectionObserver | null>(null);
  const observerOthersRef = useRef<IntersectionObserver | null>(null);

  // 筛选状态 - 从 URL 参数初始化，如果没有URL参数则从保存的源读取
  const [searchSources, setSearchSources] = useState<string[]>(() => {
    const sources = searchParams.get('sources');
    if (sources) {
      return sources.split(',');
    }

    // 如果没有URL参数，检查是否有保存的源
    if (typeof window !== 'undefined') {
      const savedSources = localStorage.getItem('savedSources');
      if (savedSources) {
        try {
          return JSON.parse(savedSources);
        } catch (error) {
          console.error('Failed to parse saved sources:', error);
        }
      }
    }

    return [];
  });
  const [selectedTitles, setSelectedTitles] = useState<string[]>(() => {
    const titles = searchParams.get('titles');
    return titles ? titles.split(',') : [];
  });
  const [selectedYears, setSelectedYears] = useState<string[]>(() => {
    const years = searchParams.get('years');
    return years ? years.split(',') : [];
  });

  // 搜索结果来源筛选状态 - 从 URL 参数初始化
  const [filterSources, setFilterSources] = useState<string[]>(() => {
    const sources = searchParams.get('filter_sources');
    return sources ? sources.split(',') : [];
  });
  // 新增状态：记录当前展开的筛选框
  const [openFilter, setOpenFilter] = useState<string | null>(null);
  // 排序状态：字段与顺序（默认：按源数量，倒序）
  const [sortField, setSortField] = useState<'sources' | 'year' | 'episodes'>(
    () => {
      const sf = searchParams.get('sort');
      return sf === 'sources' || sf === 'episodes' || sf === 'year'
        ? sf
        : 'sources';
    }
  );
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>(() => {
    const so = searchParams.get('order');
    return so === 'asc' ? 'asc' : 'desc';
  });

  const [viewMode, setViewMode] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const userSetting = localStorage.getItem('defaultAggregateSearch');
      return userSetting !== null ? userSetting === 'true' : true;
    }
    return true;
  });

  const [streamEnabled, setStreamEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const defaultSaved = localStorage.getItem('defaultStreamSearch');
      return defaultSaved !== null ? defaultSaved === 'true' : true;
    }
    return true;
  });

  // 已提交的查询（来自 URL），输入框里正在输入的内容不影响排序
  const activeQuery = (searchParams.get('q') ?? '').trim().toLowerCase();

  // 聚合后的结果
  const aggregatedResults = useMemo(() => {
    const map = new Map<string, SearchResult[]>();
    searchResults.forEach((item) => {
      // 使用标准化的标题（移除多余空格但保留单词间的单个空格）作为聚合键的一部分
      const normalizedTitle = item.title.trim().replace(/\s+/g, ' ');
      const key = `${normalizedTitle}-${item.year || 'unknown'}-${
        item.episodes.length === 1 ? 'movie' : 'tv'
      }`;
      const arr = map.get(key) || [];
      arr.push(item);
      map.set(key, arr);
    });
    return Array.from(map.entries()).sort((a, b) => {
      const aExactMatch = a[1][0].title
        .toLowerCase()
        .includes(activeQuery);
      const bExactMatch = b[1][0].title
        .toLowerCase()
        .includes(activeQuery);
      if (aExactMatch && !bExactMatch) return -1;
      if (!aExactMatch && bExactMatch) return 1;

      const aYear = a[1][0].year;
      const bYear = b[1][0].year;
      if (aYear === bYear) return a[1][0].title.localeCompare(b[1][0].title);
      if (aYear === 'unknown') return 1;
      if (bYear === 'unknown') return 1;
      return aYear > bYear ? -1 : 1;
    });
  }, [searchResults, activeQuery]);

  // 用于筛选后的聚合结果，保证类型安全
  const filteredAggregatedResults: [string, SearchResult[]][] = useMemo(() => {
    return aggregatedResults
      .filter(([, group]) => {
        // 来源筛选：如果没有选择任何来源（filterSources.length === 0），默认显示全部；如果选择了来源，只保留包含至少一个选中来源的影片组
        const sourceMatch =
          filterSources.length === 0 ||
          group.some((item) => filterSources.includes(item.source_name));
        // 标题筛选：如果选择了标题，只保留标题匹配的影片组
        const titleMatch =
          selectedTitles.length === 0 ||
          selectedTitles.includes(group[0].title);
        // 年份筛选：如果选择了年份，只保留年份匹配的影片组
        const yearMatch =
          selectedYears.length === 0 || selectedYears.includes(group[0].year);
        return sourceMatch && titleMatch && yearMatch;
      })
      .map(([key, group]) => {
        // 在组内也进行筛选，确保组内每个项目都符合筛选条件
        const filteredGroup = group.filter((item) => {
          const titleMatch =
            selectedTitles.length === 0 || selectedTitles.includes(item.title);
          const yearMatch =
            selectedYears.length === 0 || selectedYears.includes(item.year);
          return titleMatch && yearMatch;
        });
        return [key, filteredGroup] as [string, SearchResult[]];
      })
      .filter(([_, group]) => group.length > 0);
  }, [aggregatedResults, filterSources, selectedTitles, selectedYears]);

  // 返回两个数组：exact 和 others
  const sortedAggregatedResults: {
    exact: [string, SearchResult[]][];
    others: [string, SearchResult[]][];
  } = useMemo(() => {
    const aggregateMode = viewMode;
    const groups: [string, SearchResult[]][] = aggregateMode
      ? filteredAggregatedResults
      : searchResults.map((item) => [
          `${item.title}-${item.year}-${item.source_name}`,
          [item],
        ]);

    const query = (searchParams.get('q') ?? '').trim().toLowerCase();
    const isExact = (group: SearchResult[]) =>
      group[0].title.toLowerCase().includes(query);

    const getYearValue = (group: SearchResult[]) => {
      const y = group[0].year;
      if (!y || y === 'unknown') return null;
      const n = Number(y);
      return Number.isNaN(n) ? null : n;
    };

    const getSourcesCount = (group: SearchResult[]) => group.length;
    const getEpisodesCount = (group: SearchResult[]) => {
      let maxEpisodes = 0;
      for (const item of group) {
        const count = Array.isArray(item.episodes) ? item.episodes.length : 0;
        if (count > maxEpisodes) maxEpisodes = count;
      }
      return maxEpisodes;
    };

    const valueOf = (group: SearchResult[]) => {
      switch (sortField) {
        case 'sources':
          return getSourcesCount(group);
        case 'episodes':
          return getEpisodesCount(group);
        case 'year':
        default:
          return getYearValue(group);
      }
    };

    const compare = (
      a: [string, SearchResult[]],
      b: [string, SearchResult[]]
    ) => {
      const aVal = valueOf(a[1]);
      const bVal = valueOf(b[1]);
      const aIsNull = aVal === null || aVal === undefined;
      const bIsNull = bVal === null || bVal === undefined;
      if (aIsNull && !bIsNull) return 1;
      if (!aIsNull && bIsNull) return -1;
      if (aIsNull && bIsNull) return 0;

      if ((aVal as number) < (bVal as number))
        return sortOrder === 'asc' ? -1 : 1;
      if ((aVal as number) > (bVal as number))
        return sortOrder === 'asc' ? 1 : -1;

      return a[1][0].title.localeCompare(b[1][0].title);
    };

    const exact: [string, SearchResult[]][] = [];
    const others: [string, SearchResult[]][] = [];
    for (const item of groups) {
      (isExact(item[1]) ? exact : others).push(item);
    }
    exact.sort(compare);
    others.sort(compare);

    return { exact, others };
  }, [
    filteredAggregatedResults,
    searchResults,
    sortField,
    sortOrder,
    searchQuery,
    viewMode,
  ]);

  // 分页显示的结果
  const displayedExactResults = useMemo(() => {
    return sortedAggregatedResults.exact.slice(0, displayedExactCount);
  }, [sortedAggregatedResults.exact, displayedExactCount]);

  const displayedOthersResults = useMemo(() => {
    return sortedAggregatedResults.others.slice(0, displayedOthersCount);
  }, [sortedAggregatedResults.others, displayedOthersCount]);

  const hasMoreExact =
    sortedAggregatedResults.exact.length > displayedExactCount;
  const hasMoreOthers =
    sortedAggregatedResults.others.length > displayedOthersCount;

  const abortControllerRef = useRef<AbortController | null>(null);

  const fetchSearchResults = async (query: string) => {
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      setIsLoading(true);
      setSearchResults([]);
      setFailedSources([]);
      setShowResults(true);

      const params = new URLSearchParams({ q: query.trim() });
      params.set('stream', streamEnabled ? '1' : '0');

      // 添加选中的搜索源到请求参数
      if (searchSources.length > 0) {
        params.set('sources', searchSources.join(','));
      }

      // 添加超时时间参数
      const timeoutSeconds = getRequestTimeout();
      params.set('timeout', timeoutSeconds.toString());

      const response = await fetch(
        withAdultFilterParam(`/api/search?${params.toString()}`),
        {
          signal: controller.signal,
        }
      );

      if (!streamEnabled) {
        const json = await response.json();
        setSearchResults(json.results || []);
        setFailedSources(json.failedSources || []);
        setIsLoading(false);
      } else {
        if (!response.body) return;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let done = false;
        let buffer = '';
        let firstResult = true;

        while (!done) {
          const { value, done: readerDone } = await reader.read();
          done = readerDone;

          if (value) {
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const json = JSON.parse(line);
                if (json.pageResults?.length) {
                  setSearchResults((prev) => [...prev, ...json.pageResults]);
                  if (firstResult) {
                    setIsLoading(false);
                    firstResult = false;
                  }
                }
                if (json.failedSources) setFailedSources(json.failedSources);
              } catch {
                //
              }
            }
          }
        }

        if (buffer.trim()) {
          try {
            const json = JSON.parse(buffer);
            if (json.pageResults)
              setSearchResults((prev) => [...prev, ...json.pageResults]);
            if (json.failedSources) setFailedSources(json.failedSources);
          } catch {
            //
          }
        }

        setIsLoading(false);
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      console.error('搜索失败', err);
      setSearchResults([]);
    }
  };

  // 初始化：搜索历史、滚动监听
  useEffect(() => {
    getSearchHistory().then(setSearchHistory);
    const unsubscribe = subscribeToDataUpdates(
      'searchHistoryUpdated',
      setSearchHistory
    );
    const handleScroll = () => {
      setShowBackToTop((document.body.scrollTop || 0) > 300);
    };
    document.body.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      unsubscribe();
      document.body.removeEventListener('scroll', handleScroll);
    };
  }, []);

  // 设置滚动监听，实现分页加载 - 精确匹配结果
  useEffect(() => {
    if (!loadingMoreExactRef.current || isLoading || !hasMoreExact) {
      return;
    }

    // 清理旧的观察者
    if (observerExactRef.current) {
      observerExactRef.current.disconnect();
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMoreExact) {
          setDisplayedExactCount((prev) => prev + 20);
        }
      },
      {
        threshold: 0.1,
        rootMargin: '200px', // 提前200px开始加载，提供更流畅的体验
      }
    );

    observer.observe(loadingMoreExactRef.current);
    observerExactRef.current = observer;

    return () => {
      if (observerExactRef.current) {
        observerExactRef.current.disconnect();
      }
    };
  }, [hasMoreExact, isLoading]);

  // 设置滚动监听，实现分页加载 - 其他结果
  useEffect(() => {
    if (
      !loadingMoreOthersRef.current ||
      isLoading ||
      !hasMoreOthers ||
      hasMoreExact
    ) {
      // 如果还有精确匹配结果未加载完，不监听其他结果
      return;
    }

    // 清理旧的观察者
    if (observerOthersRef.current) {
      observerOthersRef.current.disconnect();
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMoreOthers && !hasMoreExact) {
          setDisplayedOthersCount((prev) => prev + 20);
        }
      },
      {
        threshold: 0.1,
        rootMargin: '200px', // 提前200px开始加载，提供更流畅的体验
      }
    );

    observer.observe(loadingMoreOthersRef.current);
    observerOthersRef.current = observer;

    return () => {
      if (observerOthersRef.current) {
        observerOthersRef.current.disconnect();
      }
    };
  }, [hasMoreExact, hasMoreOthers, isLoading]);

  // 提取当前的查询参数 q 和 sources
  const currentQuery = useMemo(() => searchParams.get('q'), [searchParams]);
  const currentSources = useMemo(
    () => searchParams.get('sources'),
    [searchParams]
  );

  // 监听查询变化时重置分页
  useEffect(() => {
    if (currentQuery) {
      setDisplayedExactCount(20);
      setDisplayedOthersCount(20);
    }
  }, [currentQuery]);

  // 同步搜索源配置（当 sources 参数变化时）
  useEffect(() => {
    if (currentSources) {
      setSearchSources(currentSources.split(','));
    }
  }, [currentSources]);

  // 监听查询参数 q 的变化并触发搜索（只在 q 变化时触发）
  useEffect(() => {
    if (currentQuery) {
      // 触发搜索
      setSearchQuery(currentQuery);
      setIsLoading(true);
      setShowResults(true);
      fetchSearchResults(currentQuery);
      addSearchHistory(currentQuery);
    } else {
      // 没有搜索参数时，聚焦输入框
      document.getElementById('searchInput')?.focus();
    }
  }, [currentQuery]); // 只依赖查询参数 q，仅在 q 变化时触发

  // 监听URL参数变化，当URL变为无参数时重新挂载组件（只执行一次）
  useEffect(() => {
    const urlQuery = searchParams.get('q');
    // 如果之前有搜索参数但现在没有了，说明URL变成了无参数状态，且尚未执行过重置
    if (!urlQuery && !hasResetOnEmptyParams) {
      // 重置状态，模拟组件重新挂载
      setShowResults(false);
      setHasResetOnEmptyParams(true);
    } else if (urlQuery) {
      // 当有搜索参数时，重置标志位，以便下次可以再次触发
      setHasResetOnEmptyParams(false);
    }
  }, [searchParams, hasResetOnEmptyParams]);

  // 更新筛选状态到 URL
  useEffect(() => {
    const params = new URLSearchParams(searchParams);

    if (searchSources.length > 0) {
      params.set('sources', searchSources.join(','));
    } else {
      params.delete('sources');
    }

    if (filterSources.length > 0) {
      params.set('filter_sources', filterSources.join(','));
    } else {
      params.delete('filter_sources');
    }

    if (selectedTitles.length > 0) {
      params.set('titles', selectedTitles.join(','));
    } else {
      params.delete('titles');
    }

    if (selectedYears.length > 0) {
      params.set('years', selectedYears.join(','));
    } else {
      params.delete('years');
    }

    // 排序字段与顺序
    if (sortField) {
      params.set('sort', sortField);
    } else {
      params.delete('sort');
    }
    if (sortOrder) {
      params.set('order', sortOrder);
    } else {
      params.delete('order');
    }

    // 只在有搜索查询时才更新 URL
    if (searchParams.get('q')) {
      window.history.replaceState({}, '', `/search?${params.toString()}`);
    }
  }, [
    filterSources,
    selectedTitles,
    selectedYears,
    sortField,
    sortOrder,
    searchParams,
  ]); // 移除 selectedSources 依赖，避免选择搜索源时触发重新搜索

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchQuery(value);
    setShowSuggestions(!!value.trim());
  };

  const handleInputFocus = () => {
    if (searchQuery.trim()) setShowSuggestions(true);
  };

  const handleSearch = (e?: React.FormEvent, query?: string) => {
    if (e) e.preventDefault(); // 如果是表单触发，阻止默认行为
    const trimmed = (query ?? searchQuery).trim().replace(/\s+/g, ' ');
    if (!trimmed) return;

    setShowSuggestions(false);
    // 更新URL，由useEffect监听触发搜索
    const urlParams = new URLSearchParams();
    urlParams.set('q', trimmed);
    if (searchSources.length > 0) {
      urlParams.set('sources', searchSources.join(','));
    }
    // 添加超时时间参数
    const timeoutSeconds = getRequestTimeout();
    urlParams.set('timeout', timeoutSeconds.toString());
    window.history.pushState({}, '', `/search?${urlParams.toString()}`);
  };

  const handleSuggestionSelect = (suggestion: string) => {
    setShowSuggestions(false);
    // 更新URL，由useEffect监听触发搜索
    const urlParams = new URLSearchParams();
    urlParams.set('q', suggestion);
    if (searchSources.length > 0) {
      urlParams.set('sources', searchSources.join(','));
    }
    // 添加超时时间参数
    const timeoutSeconds = getRequestTimeout();
    urlParams.set('timeout', timeoutSeconds.toString());
    window.history.pushState({}, '', `/search?${urlParams.toString()}`);
  };

  const scrollToTop = () => {
    try {
      document.body.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {
      document.body.scrollTop = 0;
    }
  };

  // 生成筛选选项
  const sourceOptions = Array.from(
    new Set(searchResults.map((r) => r.source_name))
  ).sort();
  const titleOptions = Array.from(
    new Set(searchResults.map((r) => r.title))
  ).sort();
  const yearOptions = Array.from(
    new Set(searchResults.map((r) => r.year))
  ).sort();

  // 处理排序字段变化的包装函数
  const handleSortFieldChange = (field: string) => {
    setSortField(field as 'sources' | 'year' | 'episodes');
  };

  const totalResults = searchResults.length;
  const sourceCount = new Set(searchResults.map((r) => r.source)).size;
  const currentQ = searchParams.get('q') || searchQuery;
  const gridClass =
    'grid grid-cols-3 gap-x-2.5 gap-y-[18px] sm:grid-cols-[repeat(auto-fill,minmax(150px,1fr))] sm:gap-x-5 sm:gap-y-7';

  const renderCard = (
    [mapKey, group]: [string, SearchResult[]],
    index: number,
    prefix: string
  ) => {
    const item = group[0];
    return (
      <div
        key={`${prefix}-${mapKey}-${index}`}
        className='animate-o-rise'
        style={staggerStyle(index % 20)}
      >
        {viewMode ? (
          <VideoCard
            from='search'
            items={group}
            query={searchQuery.trim() !== item.title ? searchQuery.trim() : ''}
          />
        ) : (
          <VideoCard
            id={item.id}
            title={item.title || ''}
            poster={item.poster}
            episodes={item.episodes ? item.episodes.length : 0}
            source={item.source}
            source_name={item.source_name}
            douban_id={item.douban_id}
            query={searchQuery.trim() !== item.title ? searchQuery.trim() : ''}
            year={item.year}
            from='search'
            type={item.episodes && item.episodes.length > 1 ? 'tv' : 'movie'}
          />
        )}
      </div>
    );
  };

  const loadMoreIndicator = (ref: React.RefObject<HTMLDivElement>) => (
    <div ref={ref} className='col-span-full flex justify-center py-8'>
      <div className='flex items-center gap-2 text-sm font-semibold text-o-neutral-700'>
        <Loader2 className='h-4 w-4 animate-spin' strokeWidth={2.75} />
        {t.loadingMore}
      </div>
    </div>
  );

  return (
    <PageLayout activePath='/search'>
      <div className='mx-auto flex w-full max-w-[1760px] flex-col gap-5 px-4 pb-12 pt-4 md:gap-6 md:px-10 md:pt-4'>
        {/* 移动端搜索框（桌面端使用导航栏里的搜索） */}
        <div className='md:hidden'>
          <div className='relative flex h-[50px] items-center gap-1.5 rounded-full border border-o-divider bg-o-surface px-1.5'>
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
                className='ml-1 h-4 w-4 flex-none text-o-neutral-700'
                strokeWidth={2.75}
              />
              <input
                id='searchInput'
                type='search'
                enterKeyHint='search'
                value={searchQuery}
                onChange={handleInputChange}
                onFocus={handleInputFocus}
                placeholder={t.searchPlaceholder}
                className='h-11 min-w-0 flex-1 border-0 bg-transparent px-2 text-[15px] text-o-ink placeholder:text-o-neutral-600 focus:outline-none focus:ring-0'
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
                onClick={() => {
                  setSearchQuery('');
                  document.getElementById('searchInput')?.focus();
                }}
                aria-label={t.clear}
                className='flex h-[38px] w-[38px] flex-none items-center justify-center rounded-full text-o-neutral-700'
              >
                <X className='h-4 w-4' strokeWidth={2.75} />
              </button>
            )}
          </div>
        </div>

        {showResults ? (
          <section className='flex flex-col gap-5 md:gap-6'>
            {/* 标题 + 开关 */}
            <div className='flex flex-wrap items-end gap-x-6 gap-y-4'>
              <div className='flex min-w-0 flex-col gap-1.5'>
                <h1 className='m-0 font-heading text-[25px] leading-[1.12] tracking-[-0.015em] md:text-[32px]'>
                  {t.results}
                </h1>
                <div className='flex flex-wrap items-center gap-2.5 text-sm text-o-neutral-700'>
                  {isLoading ? (
                    <span className='flex items-center gap-1.5'>
                      <Loader2
                        className='h-3.5 w-3.5 animate-spin'
                        strokeWidth={2.75}
                      />
                      {t.searching}
                    </span>
                  ) : (
                    <span className='hidden md:inline'>
                      {t.resultsSummary(currentQ, totalResults, sourceCount)}
                    </span>
                  )}
                  <FailedSourcesDisplay failedSources={failedSources} />
                </div>
              </div>
              <div className='flex items-center gap-4 text-sm font-semibold md:ml-auto md:gap-[18px]'>
                <ToggleSwitch
                  label={t.stream}
                  checked={streamEnabled}
                  onChange={() => setStreamEnabled(!streamEnabled)}
                />
                <ToggleSwitch
                  label={t.aggregate}
                  checked={viewMode}
                  onChange={() => setViewMode(!viewMode)}
                />
              </div>
            </div>

            {/* 筛选 */}
            {searchResults.length > 0 && (
              <FilterOptions
                openFilter={openFilter}
                setOpenFilter={setOpenFilter}
                sourceOptions={sourceOptions}
                filterSources={filterSources}
                setFilterSources={setFilterSources}
                titleOptions={titleOptions}
                selectedTitles={selectedTitles}
                setSelectedTitles={setSelectedTitles}
                yearOptions={yearOptions}
                selectedYears={selectedYears}
                setSelectedYears={setSelectedYears}
                sortField={sortField}
                onSortFieldChange={handleSortFieldChange}
                sortOrder={sortOrder}
                onSortOrderChange={setSortOrder}
                sortOptions={[
                  { value: 'sources', label: t.sortBySources },
                  { value: 'year', label: t.sortByYear },
                  { value: 'episodes', label: t.sortByEpisodes },
                ]}
              />
            )}

            {isLoading ? (
              <div className={gridClass}>
                {Array.from({ length: 14 }).map((_, i) => (
                  <PosterSkeleton key={i} />
                ))}
              </div>
            ) : sortedAggregatedResults.exact.length === 0 &&
              sortedAggregatedResults.others.length === 0 ? (
              <EmptyState
                icon={<SearchX className='h-6 w-6' strokeWidth={2.5} />}
                title={t.noResults}
                hint={t.noResultsHint}
              />
            ) : (
              <>
                {/* 精确匹配结果 */}
                <div key={`search-results-${viewMode}`} className={gridClass}>
                  {displayedExactResults.map((g, i) =>
                    renderCard(g, i, 'exact')
                  )}
                  {hasMoreExact && loadMoreIndicator(loadingMoreExactRef)}
                </div>

                {/* 更多结果 */}
                {sortedAggregatedResults.others.length > 0 && (
                  <>
                    <h2 className='m-0 mt-4 font-heading text-xl leading-tight md:text-[25px]'>
                      {t.moreResults}
                    </h2>
                    <div className={gridClass}>
                      {displayedOthersResults.map((g, i) =>
                        renderCard(g, i, 'others')
                      )}
                      {hasMoreOthers &&
                        !hasMoreExact &&
                        loadMoreIndicator(loadingMoreOthersRef)}
                    </div>
                  </>
                )}
              </>
            )}
          </section>
        ) : searchHistory.length > 0 ? (
          <section className='flex animate-o-rise flex-col gap-4'>
            <SectionHeader
              title={t.searchHistory}
              actionLabel={t.clearAll}
              onAction={() => clearSearchHistory()}
            />
            <div ref={historyRef} className='flex flex-wrap gap-2'>
              {searchHistory.map((item, index) => (
                <div
                  key={`history-${item}-${index}`}
                  className='group relative'
                >
                  <button
                    type='button'
                    onClick={() => {
                      setSearchQuery(item);
                      handleSearch(undefined, item);
                    }}
                    className='o-press rounded-full bg-o-surface py-2 pl-4 pr-9 text-sm font-semibold transition-colors hover:bg-o-accent-100'
                  >
                    {item}
                  </button>
                  <button
                    type='button'
                    aria-label={`${t.delete} ${item}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteSearchHistory(item);
                    }}
                    className='absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-o-neutral-700 transition-colors hover:bg-o-bg hover:text-o-accent-700'
                  >
                    <X className='h-3.5 w-3.5' strokeWidth={2.75} />
                  </button>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </div>

      <button
        onClick={scrollToTop}
        className={`fixed bottom-[calc(84px+env(safe-area-inset-bottom))] right-5 z-[500] flex h-12 w-12 items-center justify-center rounded-full bg-o-accent text-o-on-accent shadow-o-lg transition-all duration-300 hover:bg-o-accent-600 md:bottom-6 md:right-6 ${
          showBackToTop
            ? 'pointer-events-auto translate-y-0 opacity-100'
            : 'pointer-events-none translate-y-4 opacity-0'
        }`}
        aria-label={t.backToTop}
      >
        <ChevronUp className='h-6 w-6' strokeWidth={2.75} />
      </button>
    </PageLayout>
  );
}

function ToggleSwitch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type='button'
      role='switch'
      aria-checked={checked}
      onClick={onChange}
      className='flex items-center gap-2'
    >
      {label}
      <span
        className={`relative h-6 w-10 rounded-full transition-colors duration-200 ${
          checked ? 'bg-o-sage' : 'bg-o-neutral-400'
        }`}
      >
        <span
          className={`absolute top-[3px] h-[18px] w-[18px] rounded-full bg-o-bg shadow-o-sm transition-[left] duration-200 ${
            checked ? 'left-[19px]' : 'left-[3px]'
          }`}
        />
      </span>
    </button>
  );
}

export default function SearchPage() {
  return (
    <Suspense>
      <SearchPageClient />
    </Suspense>
  );
}
