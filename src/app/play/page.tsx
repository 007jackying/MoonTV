/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps, no-console */

'use client';

import {
  ArrowLeft,
  Film,
  MoreHorizontal,
  RotateCcw,
  Search,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { withAdultFilterParam } from '@/lib/adult-filter.client';
import {
  AnimeOption,
  extractEpisodeNumber,
  extractSeasonFromTitle,
  getDanmakuBySelectedAnime,
  matchAnime,
} from '@/lib/danmaku.client';
import {
  deleteFavorite,
  deletePlayRecord,
  deleteSkipConfig,
  generateStorageKey,
  getAllPlayRecords,
  getSkipConfig,
  isFavorited,
  saveFavorite,
  savePlayRecord,
  saveSkipConfig,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { useMediaQuery } from '@/lib/hooks/useMediaQuery';
import { formatEpisodeLabel } from '@/lib/i18n';
import { formatClock, HlsModule } from '@/lib/player/engine';
import {
  boundsFor,
  decideSuggestion,
  mapWithConcurrency,
  measureSource,
  scoreMetrics,
  SourceMetrics,
} from '@/lib/source-metrics';
import { SearchResult } from '@/lib/types';
import { getRequestTimeout } from '@/lib/utils';

import AddDownloadModal from '@/components/AddDownloadModal';
import DanmakuSelector from '@/components/DanmakuSelector';
import { triggerGlobalError } from '@/components/GlobalErrorIndicator';
import { useI18n } from '@/components/LanguageProvider';
import PageLayout from '@/components/PageLayout';
import {
  MoreMenu,
  PlayDescriptionMobile,
  PlayDetailsDesktop,
  PlayDetailsMobileHead,
  PlayDetailsProps,
} from '@/components/play/PlayDetails';
import {
  PlayMobileEpisodes,
  PlayMobileSourceCard,
  PlayPanelProps,
  PlaySidePanel,
} from '@/components/play/PlayPanels';
import {
  episodeUrlOf,
  PrecomputedVideoInfo,
  sourceKeyOf,
  useSourceSpeedTest,
  VideoInfo,
} from '@/components/play/useSourceSpeedTest';
import VideoPlayer, {
  PlayerSettingItem,
  SwitchKind,
  VideoPlayerHandle,
} from '@/components/player/VideoPlayer';

type SkipConfig = { enable: boolean; intro_time: number; outro_time: number };

function PlayPageClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = useI18n();
  // 只渲染当前断点需要的布局（侧栏 / 移动端卡片），避免列表重复渲染两份
  const isDesktop = useMediaQuery('(min-width: 1024px)', true);
  // 异步流程里使用最新的文案
  const tRef = useRef(t);
  tRef.current = t;

  // -----------------------------------------------------------------------------
  // 状态变量（State）
  // -----------------------------------------------------------------------------
  const [loading, setLoading] = useState(true);
  const [loadingStage, setLoadingStage] = useState<
    'searching' | 'fetching' | 'ready'
  >('searching');
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<SearchResult | null>(null);

  // 收藏状态
  const [favorited, setFavorited] = useState(false);

  // 添加下载弹窗状态
  const [showAddDownload, setShowAddDownload] = useState(false);

  // 跳过片头片尾配置
  const [skipConfig, setSkipConfig] = useState<SkipConfig>({
    enable: false,
    intro_time: 0,
    outro_time: 0,
  });
  const skipConfigRef = useRef(skipConfig);
  useEffect(() => {
    skipConfigRef.current = skipConfig;
  }, [skipConfig]);

  // 跳过检查的时间间隔控制
  const lastSkipCheckRef = useRef(0);

  // 去广告开关（从 localStorage 继承，默认 true）
  const [blockAdEnabled, setBlockAdEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const v = localStorage.getItem('enable_blockad');
      if (v !== null) return v === 'true';
    }
    return true;
  });

  // 弹幕
  const [selectedDanmakuAnime, setSelectedDanmakuAnime] =
    useState<AnimeOption | null>(null);
  const [selectedDanmakuEpisode, setSelectedDanmakuEpisode] = useState<
    number | undefined
  >(undefined);
  const [showDanmakuSelector, setShowDanmakuSelector] = useState(false);
  const [isDanmakuLoading, setIsDanmakuLoading] = useState(false);
  const [danmakuUrl, setDanmakuUrl] = useState<string | null>(null);
  const [danmakuLabel, setDanmakuLabel] = useState('');
  const [danmakuVisible, setDanmakuVisible] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return localStorage.getItem('danmakuVisible') !== 'false';
  });
  const [selectedState, setSelectedState] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  // 自动匹配结果对应的集数，避免换集后短暂沿用上一集的匹配
  const autoMatchEpisodeRef = useRef<number | null>(null);

  // 视频基本信息
  const [videoTitle, setVideoTitle] = useState(searchParams.get('title') || '');
  const [videoYear, setVideoYear] = useState(searchParams.get('year') || '');
  const [videoCover, setVideoCover] = useState('');
  const [videoDoubanId, setVideoDoubanId] = useState(0);
  // 当前源和ID
  const [currentSource, setCurrentSource] = useState(
    searchParams.get('source') || ''
  );
  const [currentId, setCurrentId] = useState(searchParams.get('id') || '');

  // 搜索所需信息
  const [searchTitle] = useState(searchParams.get('stitle') || '');
  const [searchType] = useState(searchParams.get('stype') || '');

  // 集数相关
  const [currentEpisodeIndex, setCurrentEpisodeIndex] = useState(0);

  // 自动匹配弹幕设置
  const [autoDanmakuEnabled, setAutoDanmakuEnabled] = useState(false);
  const [preferredDanmakuPlatform, setPreferredDanmakuPlatform] =
    useState('bilibili1');

  useEffect(() => {
    const savedAuto = localStorage.getItem('autoDanmakuEnabled');
    if (savedAuto !== null) setAutoDanmakuEnabled(JSON.parse(savedAuto));
    const savedPlatform = localStorage.getItem('preferredDanmakuPlatform');
    if (savedPlatform) setPreferredDanmakuPlatform(savedPlatform);
  }, []);

  const currentSourceRef = useRef(currentSource);
  const currentIdRef = useRef(currentId);
  const videoTitleRef = useRef(videoTitle);
  const videoYearRef = useRef(videoYear);
  const detailRef = useRef<SearchResult | null>(detail);
  const currentEpisodeIndexRef = useRef(currentEpisodeIndex);

  // 同步最新值到 refs
  useEffect(() => {
    currentSourceRef.current = currentSource;
    currentIdRef.current = currentId;
    detailRef.current = detail;
    currentEpisodeIndexRef.current = currentEpisodeIndex;
    videoTitleRef.current = videoTitle;
    videoYearRef.current = videoYear;
  }, [
    currentSource,
    currentId,
    detail,
    currentEpisodeIndex,
    videoTitle,
    videoYear,
  ]);

  // 视频播放地址：直接由当前源与集数推导，不再经过额外的一次渲染
  const totalEpisodes = detail?.episodes?.length || 0;
  const videoUrl =
    detail?.episodes && currentEpisodeIndex < detail.episodes.length
      ? detail.episodes[currentEpisodeIndex] || ''
      : '';

  // 用于记录是否需要在播放器 ready 后跳转到指定进度
  const resumeTimeRef = useRef<number | null>(null);

  // 换源相关状态
  const [availableSources, setAvailableSources] = useState<SearchResult[]>([]);
  const [sourceSearchLoading, setSourceSearchLoading] = useState(false);
  const [sourceSearchError, setSourceSearchError] = useState<string | null>(
    null
  );
  const [precomputedVideoInfo, setPrecomputedVideoInfo] =
    useState<PrecomputedVideoInfo | null>(null);

  // 播放器
  const playerRef = useRef<VideoPlayerHandle>(null);
  const [Hls, setHls] = useState<HlsModule | null>(null);
  const [switchKind, setSwitchKind] = useState<SwitchKind>('initial');
  // 换源过程中：面板继续展示原来的源，被选中的源显示“切换中…”
  const [switchFromDetail, setSwitchFromDetail] = useState<SearchResult | null>(
    null
  );
  const [pendingSourceKey, setPendingSourceKey] = useState<string | null>(null);
  const [sourcesExpanded, setSourcesExpanded] = useState(false);
  const [playerFailed, setPlayerFailed] = useState(false);
  const [autoPicking, setAutoPicking] = useState(false);
  const cancelAutoPickRef = useRef(false);

  // 后台测速发现明显更好的源时给出的非侵入式建议（不自动切，避免打断播放）
  const [betterSource, setBetterSource] = useState<{
    detail: SearchResult;
    metrics: SourceMetrics;
  } | null>(null);

  // 播放进度保存相关
  const lastSaveTimeRef = useRef<number>(0);

  // 测速（当前源始终测；展开源列表后测其余源）
  const { infoMap, isMeasuring } = useSourceSpeedTest({
    sources: availableSources,
    current: detail,
    testAll: sourcesExpanded || totalEpisodes <= 1,
    precomputed: precomputedVideoInfo,
    episodeIndex: currentEpisodeIndex,
  });

  // -----------------------------------------------------------------------------
  // 工具函数（Utils）
  // -----------------------------------------------------------------------------

  // 播放源优选函数
  const preferBestSource = async (
    sources: SearchResult[],
    isCancelled?: () => boolean
  ): Promise<SearchResult> => {
    if (sources.length === 1) return sources[0];

    if (isCancelled?.()) throw new Error('优选已取消');

    // 测速：全部并发（上限 MEASURE_CONCURRENCY），当前集优先入队。
    // 旧实现分两批串行，最坏情况要等 2 × 4s。
    const episodeIndex = currentEpisodeIndexRef.current;
    // 只测当前集确实有地址的源；没有地址的源保持原位排到最后。
    const ordered = orderByCurrentEpisodeFirst(sources, episodeIndex);
    const measurable = ordered.filter(
      (s) => episodeUrlOf(s, episodeIndex) !== ''
    );
    const metrics = await mapWithConcurrency(
      measurable,
      MEASURE_CONCURRENCY,
      (source) => measureSource(episodeUrlOf(source, episodeIndex))
    );

    if (isCancelled?.()) throw new Error('优选已取消');

    // 保存所有测速结果，供面板展示
    const newVideoInfoMap = new Map<string, VideoInfo>();
    metrics.forEach((m, i) => {
      newVideoInfoMap.set(sourceKeyOf(measurable[i]), m);
    });
    setPrecomputedVideoInfo({ episodeIndex, info: newVideoInfoMap });

    const scored = measurable
      .map((source, i) => ({ source, metrics: metrics[i] }))
      .filter((x) => !x.metrics.hasError);
    if (scored.length === 0) {
      console.warn('所有播放源测速都失败，使用第一个播放源');
      setAvailableSources(sources);
      return sources[0];
    }

    const { maxSpeed, minPing, maxPing } = boundsFor(
      scored.map((x) => x.metrics)
    );
    const resultsWithScore = scored
      .map((x) => ({
        ...x,
        score: scoreMetrics(x.metrics, maxSpeed, minPing, maxPing),
      }))
      .sort((a, b) => b.score - a.score);

    // 为所有源（包括测速失败的）排序，失败源评分设为 -1，评分相同保持原顺序
    const scoreMap = new Map<string, number>();
    resultsWithScore.forEach((r) =>
      scoreMap.set(sourceKeyOf(r.source), r.score)
    );
    const sortedSources = sources
      .map((source, index) => ({
        source,
        score: scoreMap.get(sourceKeyOf(source)) ?? -1,
        index,
      }))
      .sort((a, b) =>
        a.score !== b.score ? b.score - a.score : a.index - b.index
      )
      .map((item) => item.source);

    if (isCancelled?.()) throw new Error('优选已取消');
    setAvailableSources(sortedSources);

    return resultsWithScore[0].source;
  };

  // -----------------------------------------------------------------------------
  // 初始化：流式搜索全部源，确定要播放的源
  // -----------------------------------------------------------------------------
  useEffect(() => {
    const fetchSourcesData = async (
      query: string,
      onResult?: (results: SearchResult[]) => void
    ): Promise<SearchResult[]> => {
      setSourceSearchLoading(true);
      setSourceSearchError('');

      const aggregatedResults: SearchResult[] = [];

      try {
        const timeoutSeconds = getRequestTimeout();
        const response = await fetch(
          withAdultFilterParam(
            `/api/search?q=${encodeURIComponent(
              query.trim()
            )}&timeout=${timeoutSeconds}&stream=1`
          )
        );
        if (!response.ok) throw new Error('搜索失败');

        const reader: ReadableStreamDefaultReader<Uint8Array> | undefined =
          response.body?.getReader();
        if (!reader) throw new Error('无法读取搜索流');

        const decoder = new TextDecoder();
        let buffer = '';
        let done = false;

        while (!done) {
          const { value, done: readerDone } = await reader.read();
          done = readerDone;
          if (!value) continue;

          buffer += decoder.decode(value, { stream: true });
          const lines: string[] = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const data = JSON.parse(line) as { pageResults?: SearchResult[] };
              if (!data.pageResults) continue;
              const filteredResults = data.pageResults.filter(
                (r: SearchResult) => {
                  const titleMatch =
                    r.title.trim().replace(/\s+/g, ' ').toLowerCase() ===
                    videoTitleRef.current
                      .trim()
                      .replace(/\s+/g, ' ')
                      .toLowerCase();
                  const yearMatch = videoYearRef.current
                    ? r.year.toLowerCase() ===
                      videoYearRef.current.toLowerCase()
                    : true;
                  const typeMatch = searchType
                    ? (searchType === 'tv' && r.episodes.length > 1) ||
                      (searchType === 'movie' && r.episodes.length === 1)
                    : true;
                  return titleMatch && yearMatch && typeMatch;
                }
              );

              const newOnes = filteredResults.filter(
                (r) =>
                  !aggregatedResults.some(
                    (item) => item.source === r.source && item.id === r.id
                  )
              );
              if (newOnes.length > 0) {
                aggregatedResults.push(...newOnes);
                setAvailableSources([...aggregatedResults]);
                // 不在这里关 loading：搜索还在继续，面板要在已有结果下方
                // 继续显示骨架行，而不是在第一批到达后就显示"暂无可用的播放源"。
                onResult?.(newOnes);
              }
            } catch (err) {
              console.warn('解析行 JSON 失败:', err);
            }
          }
        }
        setSourceSearchLoading(false);
        return aggregatedResults;
      } catch (err) {
        setSourceSearchLoading(false);
        setSourceSearchError(err instanceof Error ? err.message : '搜索失败');
        setAvailableSources([]);
        return [];
      }
    };

    function initDetail(detailData: SearchResult) {
      setCurrentSource(detailData.source);
      setCurrentId(detailData.id);
      setVideoYear(detailData.year);
      setVideoTitle(detailData.title || videoTitleRef.current);
      setVideoCover(detailData.poster);
      setVideoDoubanId(detailData.douban_id || 0);
      setDetail(detailData);
      // 同步写 ref，不等 effect：播放记录可能在同一轮里读完，
      // 它要靠这个 ref 拿到集数来夹紧续播下标。
      detailRef.current = detailData;

      if (currentEpisodeIndexRef.current >= detailData.episodes.length) {
        setCurrentEpisodeIndex(0);
      }

      // 规范 URL 参数
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set('source', detailData.source);
      newUrl.searchParams.set('id', detailData.id);
      newUrl.searchParams.set('year', detailData.year);
      newUrl.searchParams.set('title', detailData.title);
      newUrl.searchParams.delete('prefer');
      window.history.replaceState({}, '', newUrl.toString());

      setLoadingStage('ready');
      setTimeout(() => setLoading(false), 300);
    }

    const initAll = async () => {
      if (!currentSource && !currentId && !videoTitle && !searchTitle) {
        setError(tRef.current.errMissingParams);
        setLoading(false);
        return;
      }

      setLoading(true);
      setLoadingStage(currentSource && currentId ? 'fetching' : 'searching');

      // 从 localStorage 读取是否启用优选播放源（避免状态延迟）
      const enablePreferBestSourceFromStorage = (() => {
        const saved = localStorage.getItem('enablePreferBestSource');
        if (saved === null) return false;
        try {
          return JSON.parse(saved);
        } catch {
          return false;
        }
      })();

      let detailData: SearchResult | null = null;
      let allResults: SearchResult[] = [];
      let hasInitialized = false;

      // 从 URL 直接取当前源的详情，避开一次多源搜索。
      const adopt = (d: SearchResult) => {
        if (detailData) return;
        detailData = d;
        initDetail(d);
        hasInitialized = true;
      };

      // ── 关键路径：单个源的详情请求 ────────────────────────────────────────
      // 用户从搜索结果点进来时 URL 里已经有 source+id，那个源我们刚验证过
      // 存在，所以只需要问它要一次详情。旧实现要等整个多源搜索扇出跑完。
      if (currentSource && currentId) {
        const fetched = await fetchDirectDetail(currentSource, currentId);
        if (fetched) adopt(fetched);
      }

      // ── 后台：多源搜索，只为填充侧栏 ──────────────────────────────────────
      // 不 await：找到结果就往面板里追加，不阻塞播放。
      const searchPromise = fetchSourcesData(videoTitle, (newResults) => {
        allResults = [...allResults, ...newResults];
        if (detailData || newResults.length === 0) return;
        if (currentSource && currentId) {
          // 直接取详情失败了：等 URL 指定的那个源出现在搜索结果里再开播，
          // 不要随手换成别的源。实在搜不到时由下面的兜底处理。
          const match = newResults.find(
            (item) => item.source === currentSource && item.id === currentId
          );
          if (match) adopt(match);
          return;
        }
        // URL 里没带 source/id（从豆瓣卡片进来）时，第一个可用源直接开播，
        // 不再等整个搜索流结束。
        adopt(newResults[0]);
      });

      await searchPromise;

      // 目标源没找到时退回第一个结果
      if (!detailData && allResults.length > 0) {
        detailData = allResults[0];
      }

      if (!detailData) {
        setError(tRef.current.errNotFound);
        setLoading(false);
        return;
      }

      if (!hasInitialized) initDetail(detailData);

      // 优选不再阻塞首帧：搜索结束后在后台跑，只在确实明显更好时才提示换源。
      if (allResults.length > 1) {
        if (enablePreferBestSourceFromStorage) {
          // 兼容旧开关：仍然自动换到最优源，但发生在首帧之后。
          void (async () => {
            try {
              const best = await preferBestSource(allResults);
              if (
                best &&
                (best.source !== detailRef.current?.source ||
                  best.id !== detailRef.current?.id)
              ) {
                handleSourceChange(best);
              }
            } catch (err) {
              console.error('优选播放源失败:', err);
            }
          })();
        } else {
          // 默认路径：只提示，不自动切，避免打断正在看的画面
          void suggestBetterSource(allResults);
        }
      }
    };

    initAll();
  }, []);

  // 动态加载 hls.js（仅客户端）
  useEffect(() => {
    let mounted = true;
    import('hls.js')
      .then(({ default: HlsLib }) => {
        // 注意：Hls 是一个类，必须用函数形式写入 state
        if (mounted) setHls(() => HlsLib);
      })
      .catch((err) => console.error('加载 hls.js 失败:', err));
    return () => {
      mounted = false;
    };
  }, []);

  // 选集索引越界时提示
  useEffect(() => {
    if (!detail || loading) return;
    if (currentEpisodeIndex < 0 || currentEpisodeIndex >= totalEpisodes) {
      setError(tRef.current.errInvalidEpisode(totalEpisodes));
    }
  }, [detail, currentEpisodeIndex, loading]);

  // 播放记录：仅在初次挂载时检查
  useEffect(() => {
    const initFromHistory = async () => {
      if (!currentSource || !currentId) return;
      try {
        const allRecords = await getAllPlayRecords();
        const record = allRecords[generateStorageKey(currentSource, currentId)];
        if (record) {
          // 详情现在走关键路径，可能比播放记录先到（远端存储时尤其如此），
          // 那样 initDetail 的越界修正已经跑过了，这里必须自己夹紧，否则越界
          // 下标会触发 errInvalidEpisode，整页被错误页替换。详情还没到时
          // 先原样写入，由 initDetail 负责夹紧——这里不能把它当成 0 集。
          const targetIndex = Math.max(0, record.index - 1);
          const total = detailRef.current?.episodes?.length ?? 0;
          const safeIndex =
            total > 0 ? Math.min(targetIndex, total - 1) : targetIndex;
          if (safeIndex !== currentEpisodeIndexRef.current) {
            setCurrentEpisodeIndex(safeIndex);
            // 同样同步写 ref：若 initDetail 紧接着在提交前运行，
            // 它的越界检查要看到的是这个下标，而不是旧值。
            currentEpisodeIndexRef.current = safeIndex;
          }
          // 保存待恢复的播放进度，待播放器就绪后跳转；被夹紧时那个进度
          // 属于另一集，不要拿来续播。
          resumeTimeRef.current =
            safeIndex === record.index - 1 ? record.play_time : 0;
        }
      } catch (err) {
        console.error('读取播放记录失败:', err);
      }
    };
    initFromHistory();
  }, []);

  // 跳过片头片尾配置：仅在初次挂载时读取
  useEffect(() => {
    const initSkipConfig = async () => {
      if (!currentSource || !currentId) return;
      try {
        const config = await getSkipConfig(currentSource, currentId);
        if (config) setSkipConfig(config);
      } catch (err) {
        console.error('读取跳过片头片尾配置失败:', err);
      }
    };
    initSkipConfig();
  }, []);

  // ---------------------------------------------------------------------------
  // 弹幕
  // ---------------------------------------------------------------------------

  // 换集或换源时清空上一集的弹幕
  useEffect(() => {
    setDanmakuUrl(null);
    setDanmakuLabel('');
  }, [currentEpisodeIndex, currentSource, currentId]);

  // 根据选中的弹幕番剧计算当前集的弹幕地址
  useEffect(() => {
    if (!selectedDanmakuAnime || !detail) return;
    const currentEpisodeTitle = detail?.episodes_titles?.[currentEpisodeIndex];
    if (!currentEpisodeTitle) return;

    let matchedEpisode: any = null;
    if (selectedDanmakuEpisode !== undefined && selectedState) {
      // ① 用户手动选择某一集（优先级最高）
      matchedEpisode =
        selectedDanmakuAnime.episodes[selectedDanmakuEpisode - 1];
      setSelectedState(false);
    } else if (
      autoDanmakuEnabled &&
      autoMatchEpisodeRef.current === currentEpisodeIndex
    ) {
      // ② 自动匹配模式：匹配结果只包含当前集
      matchedEpisode = selectedDanmakuAnime.episodes[0];
    }
    if (!matchedEpisode) return;

    const episodeNumber =
      selectedDanmakuAnime.episodes.indexOf(matchedEpisode) + 1;
    (async () => {
      try {
        const url = await getDanmakuBySelectedAnime(
          selectedDanmakuAnime,
          episodeNumber,
          'xml'
        );
        setDanmakuUrl(url);
        setDanmakuLabel(matchedEpisode.episodeTitle);
      } catch (e) {
        console.error('获取弹幕 URL 失败:', e);
      }
    })();
  }, [currentEpisodeIndex, selectedDanmakuAnime, selectedDanmakuEpisode]);

  // 自动匹配弹幕
  useEffect(() => {
    if (!autoDanmakuEnabled || !detail) return;

    abortControllerRef.current?.abort();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    let retryCount = 3;
    try {
      const saved = localStorage.getItem('danmakuRetryCount');
      if (saved !== null) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed)) retryCount = parsed;
      }
    } catch {
      // ignore
    }

    let attempt = 0;
    let success = false;

    const fetchDanmaku = async () => {
      setIsDanmakuLoading(true);
      while (!success && (retryCount === -1 || attempt <= retryCount)) {
        attempt++;
        try {
          const title = videoTitleRef.current;
          const currentEpisodeTitle =
            detailRef.current?.episodes_titles?.[currentEpisodeIndex];
          if (!currentEpisodeTitle) {
            throw new Error('无法获取当前集数标题（episodes_titles 无效）');
          }
          const epNum =
            extractEpisodeNumber(currentEpisodeTitle) ||
            currentEpisodeIndex + 1;
          const platform = preferredDanmakuPlatform;
          const season = extractSeasonFromTitle(title);
          const fileName = `${title} S${season}E${epNum} @${platform}`;
          const matches = await matchAnime(fileName, abortController.signal);
          if (abortController.signal.aborted) return;
          if (matches.length > 0) {
            const m = matches[0];
            autoMatchEpisodeRef.current = currentEpisodeIndex;
            setSelectedDanmakuAnime({
              animeId: m.animeId,
              animeTitle: m.animeTitle,
              type: m.type,
              typeDescription: m.typeDescription,
              episodeCount: 1,
              episodes: [
                { episodeId: m.episodeId, episodeTitle: m.episodeTitle },
              ],
            });
            success = true;
            break;
          }
          await new Promise((res) => setTimeout(res, 1500));
        } catch (err) {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          console.error(`自动弹幕匹配第${attempt}次失败:`, err);
          await new Promise((res) => setTimeout(res, 1500));
        }
      }
      if (!success && !abortController.signal.aborted) {
        triggerGlobalError(tRef.current.autoDanmakuFailed);
      }
      if (!abortController.signal.aborted) setIsDanmakuLoading(false);
    };
    fetchDanmaku();

    return () => {
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      setIsDanmakuLoading(false);
    };
  }, [
    currentEpisodeIndex,
    autoDanmakuEnabled,
    preferredDanmakuPlatform,
    detail?.source,
    detail?.id,
  ]);

  // ---------------------------------------------------------------------------
  // 播放记录
  // ---------------------------------------------------------------------------
  const saveCurrentPlayProgress = async () => {
    const player = playerRef.current;
    if (
      !player ||
      !player.isReady() ||
      !currentSourceRef.current ||
      !currentIdRef.current ||
      !videoTitleRef.current ||
      !detailRef.current?.source_name
    ) {
      return;
    }

    const currentTime = player.getCurrentTime();
    const duration = player.getDuration();
    if (currentTime < 1 || !duration) return;

    try {
      await savePlayRecord(currentSourceRef.current, currentIdRef.current, {
        title: videoTitleRef.current,
        source_name: detailRef.current?.source_name || '',
        year: detailRef.current?.year,
        cover: detailRef.current?.poster || '',
        index: currentEpisodeIndexRef.current + 1, // 转换为1基索引
        total_episodes: detailRef.current?.episodes.length || 1,
        play_time: Math.floor(currentTime),
        total_time: Math.floor(duration),
        save_time: Date.now(),
        search_title: searchTitle,
      });
      lastSaveTimeRef.current = Date.now();
    } catch (err) {
      console.error('保存播放进度失败:', err);
    }
  };

  // 页面卸载 / 切到后台时保存进度
  useEffect(() => {
    const handleBeforeUnload = () => saveCurrentPlayProgress();
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') saveCurrentPlayProgress();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // ---------------------------------------------------------------------------
  // 换集 / 换源：先保存进度，再改变 sessionKey，播放器负责停止旧流
  // ---------------------------------------------------------------------------
  const handleEpisodeChange = async (episodeIndex: number) => {
    const d = detailRef.current;
    if (!d || episodeIndex === currentEpisodeIndexRef.current) return;
    if (episodeIndex < 0 || episodeIndex >= d.episodes.length) return;

    await saveCurrentPlayProgress();

    // 有该集的历史记录时从记录处继续
    try {
      const allRecords = await getAllPlayRecords();
      const record =
        allRecords[
          generateStorageKey(currentSourceRef.current, currentIdRef.current)
        ];
      resumeTimeRef.current =
        record && record.index - 1 === episodeIndex && record.play_time > 0
          ? record.play_time
          : 0;
    } catch {
      resumeTimeRef.current = 0;
    }
    // 建议是针对上一集测出来的，换集后不再成立
    setBetterSource(null);
    setSwitchKind('episode');
    setCurrentEpisodeIndex(episodeIndex);
  };

  const handlePreviousEpisode = () =>
    handleEpisodeChange(currentEpisodeIndexRef.current - 1);
  const handleNextEpisode = () =>
    handleEpisodeChange(currentEpisodeIndexRef.current + 1);

  /**
   * 切换播放源。
   *
   * 接收 SearchResult 对象而不是 (source, id)：早先的实现从 `availableSources`
   * 闭包里查目标源，而后台自动优选是在 useEffect([]) 的闭包里触发的——那份
   * 闭包捕获的是首帧渲染的 `availableSources`（空数组），于是查不到就
   * setError(errNotFound)，把正在播放的页面整个打成错误页。直接传对象同时
   * 避开了这个问题和 setState 尚未提交导致的时序竞争。
   */
  const handleSourceChange = async (newDetail: SearchResult) => {
    const newSource = newDetail.source;
    const newId = newDetail.id;

    // 没有可用地址就别切，保留当前播放状态。
    if (!newDetail.episodes?.length) {
      setPendingSourceKey(null);
      setSwitchFromDetail(null);
      return;
    }

    // 无论是接受建议还是手动换源，旧建议都已过时
    setBetterSource(null);

    try {
      const currentPlayTime = playerRef.current?.getCurrentTime() || 0;
      setSwitchFromDetail(detailRef.current);
      setPendingSourceKey(sourceKeyOf(newDetail));
      setSourcesExpanded(true);

      // 清除前一个历史记录，并把跳过配置迁移到新源
      if (currentSourceRef.current && currentIdRef.current) {
        try {
          await deletePlayRecord(
            currentSourceRef.current,
            currentIdRef.current
          );
        } catch (err) {
          console.error('清除播放记录失败:', err);
        }
        try {
          await deleteSkipConfig(
            currentSourceRef.current,
            currentIdRef.current
          );
          await saveSkipConfig(newSource, newId, skipConfigRef.current);
        } catch (err) {
          console.error('清除跳过片头片尾配置失败:', err);
        }
      }

      // 尽量停留在当前集；新源集数不够时回到第一集
      let targetIndex = currentEpisodeIndexRef.current;
      if (!newDetail.episodes || targetIndex >= newDetail.episodes.length) {
        targetIndex = 0;
      }

      // 同一集时在新源上恢复到原来的进度
      resumeTimeRef.current =
        targetIndex === currentEpisodeIndexRef.current && currentPlayTime > 1
          ? currentPlayTime
          : 0;

      // 更新URL参数（不刷新页面）
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set('source', newSource);
      newUrl.searchParams.set('id', newId);
      newUrl.searchParams.set('year', newDetail.year);
      window.history.replaceState({}, '', newUrl.toString());

      setSwitchKind('source');
      setVideoTitle(newDetail.title);
      setVideoYear(newDetail.year);
      setVideoCover(newDetail.poster);
      setVideoDoubanId(newDetail.douban_id || 0);
      setCurrentSource(newSource);
      setCurrentId(newId);
      setDetail(newDetail);
      setCurrentEpisodeIndex(targetIndex);
    } catch (err) {
      setPendingSourceKey(null);
      setSwitchFromDetail(null);
      setError(
        err instanceof Error ? err.message : tRef.current.errSourceChange
      );
    }
  };

  const handleAutoPick = () => {
    if (autoPicking || availableSources.length < 2) return;
    cancelAutoPickRef.current = false;
    setAutoPicking(true);
    setSourcesExpanded(true);
    preferBestSource(availableSources, () => cancelAutoPickRef.current)
      .then((best) => {
        if (cancelAutoPickRef.current || !best) return;
        if (best.source !== currentSource || best.id !== currentId) {
          handleSourceChange(best);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        setAutoPicking(false);
        cancelAutoPickRef.current = false;
      });
  };

  const goToSearch = () => {
    const q = searchTitle || videoTitle;
    if (q) router.push(`/search?q=${encodeURIComponent(q)}`);
  };

  /**
   * 后台测速：只在明显更优时才给建议，绝不自动换源。
   * 自动切换会丢进度、重置续播、打断弹幕，所以默认路径是"提示"而不是"替换"。
   */
  const suggestBetterSource = async (sources: SearchResult[]) => {
    if (sources.length < 2) return;
    const episodeIndex = currentEpisodeIndexRef.current;
    const currentKey = sourceKeyOf({
      source: currentSourceRef.current,
      id: currentIdRef.current,
    });

    const measurable = orderByCurrentEpisodeFirst(sources, episodeIndex).filter(
      (s) => episodeUrlOf(s, episodeIndex) !== ''
    );
    if (measurable.length < 2) return;
    const metrics = await mapWithConcurrency(
      measurable,
      MEASURE_CONCURRENCY,
      (s) => measureSource(episodeUrlOf(s, episodeIndex))
    );

    const usable = measurable
      .map((source, i) => ({ source, metrics: metrics[i] }))
      .filter((x) => !x.metrics.hasError);
    if (usable.length < 2) return;

    const { maxSpeed, minPing, maxPing } = boundsFor(
      usable.map((x) => x.metrics)
    );
    const scored = usable
      .map((x) => ({
        ...x,
        score: scoreMetrics(x.metrics, maxSpeed, minPing, maxPing),
      }))
      .sort((a, b) => b.score - a.score);

    // 测速期间用户可能已经换集或换源：那这份结果就不再适用
    if (
      episodeIndex !== currentEpisodeIndexRef.current ||
      currentKey !==
        sourceKeyOf({
          source: currentSourceRef.current,
          id: currentIdRef.current,
        })
    ) {
      return;
    }

    const best = scored[0];
    if (!best) return;
    if (sourceKeyOf(best.source) === currentKey) return;

    // 门槛由 decideSuggestion 统一裁决：分辨率升档直接建议，纯速度领先则
    // 要求分差达到 MIN_SUGGEST_GAP 才打扰用户。
    const current = scored.find((x) => sourceKeyOf(x.source) === currentKey);
    const decision = decideSuggestion(
      best.metrics,
      current?.metrics ?? best.metrics,
      false,
      best.score,
      current?.score ?? best.score
    );
    if (!decision.suggest) return;

    setBetterSource({ detail: best.source, metrics: best.metrics });
  };

  const acceptBetterSource = () => {
    const b = betterSource;
    setBetterSource(null);
    if (b) void handleSourceChange(b.detail);
  };

  // ---------------------------------------------------------------------------
  // 播放器回调
  // ---------------------------------------------------------------------------
  const takeResumeTime = useCallback(() => {
    const v = resumeTimeRef.current || 0;
    resumeTimeRef.current = null;
    return v;
  }, []);

  const handleTimeUpdate = (currentTime: number, duration: number) => {
    const player = playerRef.current;
    if (!player) return;
    const now = Date.now();

    // 跳过片头片尾（限制为 1.5 秒检查一次）
    const cfg = skipConfigRef.current;
    if (cfg.enable && now - lastSkipCheckRef.current >= 1500) {
      lastSkipCheckRef.current = now;
      if (cfg.intro_time > 0 && currentTime < cfg.intro_time) {
        player.seek(cfg.intro_time);
        player.showNotice(
          tRef.current.noticeSkippedIntro(formatClock(cfg.intro_time))
        );
      } else if (
        cfg.outro_time < 0 &&
        duration > 0 &&
        currentTime > duration + cfg.outro_time
      ) {
        player.showNotice(
          tRef.current.noticeSkippedOutro(formatClock(-cfg.outro_time))
        );
        const d = detailRef.current;
        if (d && currentEpisodeIndexRef.current < d.episodes.length - 1) {
          handleNextEpisode();
        } else {
          player.pause();
        }
      }
    }

    // 定期保存进度
    const interval =
      process.env.NEXT_PUBLIC_STORAGE_TYPE === 'upstash' ? 20000 : 5000;
    if (now - lastSaveTimeRef.current > interval) {
      lastSaveTimeRef.current = now;
      saveCurrentPlayProgress();
    }
  };

  const handleEnded = () => {
    const d = detailRef.current;
    const endedIndex = currentEpisodeIndexRef.current;
    if (d && endedIndex < d.episodes.length - 1) {
      // 1 秒内用户手动换了集或源就不再自动跳
      const endedSource = currentSourceRef.current;
      setTimeout(() => {
        if (
          currentEpisodeIndexRef.current === endedIndex &&
          currentSourceRef.current === endedSource
        ) {
          handleEpisodeChange(endedIndex + 1);
        }
      }, 1000);
    }
  };

  const handlePlayerReady = () => {
    setPlayerFailed(false);
    if (pendingSourceKey) setSourcesExpanded(false);
    setPendingSourceKey(null);
    setSwitchFromDetail(null);
  };

  const handlePlayerError = () => {
    setPlayerFailed(true);
    setPendingSourceKey(null);
    setSwitchFromDetail(null);
  };

  // ---------------------------------------------------------------------------
  // 跳过片头片尾配置
  // ---------------------------------------------------------------------------
  const handleSkipConfigChange = async (newConfig: SkipConfig) => {
    if (!currentSourceRef.current || !currentIdRef.current) return;
    setSkipConfig(newConfig);
    try {
      if (!newConfig.enable && !newConfig.intro_time && !newConfig.outro_time) {
        await deleteSkipConfig(currentSourceRef.current, currentIdRef.current);
      } else {
        await saveSkipConfig(
          currentSourceRef.current,
          currentIdRef.current,
          newConfig
        );
      }
    } catch (err) {
      console.error('保存跳过片头片尾配置失败:', err);
    }
  };

  const playerSettings: PlayerSettingItem[] = [
    {
      kind: 'toggle',
      id: 'blockad',
      label: t.blockAd,
      checked: blockAdEnabled,
      onChange: (v) => {
        try {
          localStorage.setItem('enable_blockad', String(v));
        } catch {
          // ignore
        }
        // 用新的过滤设置重新加载当前位置
        resumeTimeRef.current = playerRef.current?.getCurrentTime() || 0;
        setSwitchKind('initial');
        setBlockAdEnabled(v);
      },
    },
    {
      kind: 'toggle',
      id: 'skip',
      label: t.skipIntroOutro,
      checked: skipConfig.enable,
      onChange: (v) => handleSkipConfigChange({ ...skipConfig, enable: v }),
    },
    {
      kind: 'action',
      id: 'intro',
      label: t.setIntro,
      hint:
        skipConfig.intro_time > 0
          ? formatClock(skipConfig.intro_time)
          : t.setAtCurrent,
      onSelect: () => {
        const cur = playerRef.current?.getCurrentTime() || 0;
        if (cur <= 0) return;
        handleSkipConfigChange({ ...skipConfig, intro_time: cur });
        playerRef.current?.showNotice(t.noticeIntroSet(formatClock(cur)));
      },
    },
    {
      kind: 'action',
      id: 'outro',
      label: t.setOutro,
      hint:
        skipConfig.outro_time < 0
          ? `-${formatClock(-skipConfig.outro_time)}`
          : t.setAtCurrent,
      onSelect: () => {
        const p = playerRef.current;
        if (!p) return;
        const outro = -(p.getDuration() - p.getCurrentTime());
        if (!(outro < 0)) return;
        handleSkipConfigChange({ ...skipConfig, outro_time: outro });
        p.showNotice(t.noticeOutroSet(formatClock(-outro)));
      },
    },
    ...(skipConfig.enable || skipConfig.intro_time || skipConfig.outro_time
      ? [
          {
            kind: 'action' as const,
            id: 'clear-skip',
            label: t.clearSkip,
            onSelect: () =>
              handleSkipConfigChange({
                enable: false,
                intro_time: 0,
                outro_time: 0,
              }),
          },
        ]
      : []),
    {
      kind: 'toggle',
      id: 'danmaku',
      label: t.danmaku,
      checked: danmakuVisible,
      onChange: (v) => {
        setDanmakuVisible(v);
        try {
          localStorage.setItem('danmakuVisible', String(v));
        } catch {
          // ignore
        }
      },
    },
    {
      kind: 'action',
      id: 'danmaku-source',
      label: t.danmakuSource,
      hint: danmakuLabel || t.notSelected,
      onSelect: () => setShowDanmakuSelector(true),
    },
  ];

  // ---------------------------------------------------------------------------
  // 收藏
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!currentSource || !currentId) return;
    (async () => {
      try {
        setFavorited(await isFavorited(currentSource, currentId));
      } catch (err) {
        console.error('检查收藏状态失败:', err);
      }
    })();
  }, [currentSource, currentId]);

  useEffect(() => {
    if (!currentSource || !currentId) return;
    return subscribeToDataUpdates(
      'favoritesUpdated',
      (favorites: Record<string, any>) => {
        setFavorited(!!favorites[generateStorageKey(currentSource, currentId)]);
      }
    );
  }, [currentSource, currentId]);

  const handleToggleFavorite = async () => {
    if (
      !videoTitleRef.current ||
      !detailRef.current ||
      !currentSourceRef.current ||
      !currentIdRef.current
    )
      return;
    try {
      if (favorited) {
        await deleteFavorite(currentSourceRef.current, currentIdRef.current);
        setFavorited(false);
      } else {
        await saveFavorite(currentSourceRef.current, currentIdRef.current, {
          title: videoTitleRef.current,
          source_name: detailRef.current?.source_name || '',
          year: detailRef.current?.year,
          cover: detailRef.current?.poster || '',
          total_episodes: detailRef.current?.episodes.length || 1,
          save_time: Date.now(),
          search_title: searchTitle,
        });
        setFavorited(true);
      }
    } catch (err) {
      console.error('切换收藏失败:', err);
    }
  };

  // ---------------------------------------------------------------------------
  // 派生的显示数据
  // ---------------------------------------------------------------------------
  const isSeries = totalEpisodes > 1;
  const episodeLabel = isSeries
    ? formatEpisodeLabel(
        t,
        detail?.episodes_titles?.[currentEpisodeIndex],
        currentEpisodeIndex
      )
    : '';
  const hasPrev = isSeries && currentEpisodeIndex > 0;
  const hasNext = isSeries && currentEpisodeIndex < totalEpisodes - 1;
  const nextEpisodeLabel = hasNext
    ? formatEpisodeLabel(
        t,
        detail?.episodes_titles?.[currentEpisodeIndex + 1],
        currentEpisodeIndex + 1
      )
    : null;
  const currentQuality = (() => {
    const info = detail ? infoMap.get(sourceKeyOf(detail)) : undefined;
    return info && !info.hasError && info.quality !== '未知'
      ? info.quality
      : '';
  })();
  const sessionKey = `${currentSource}|${currentId}|${currentEpisodeIndex}|${
    blockAdEnabled ? 1 : 0
  }`;
  const loadingSubtitle = [
    episodeLabel || null,
    detail?.source_name,
    currentQuality || null,
  ]
    .filter(Boolean)
    .join(' · ');

  const panelProps: PlayPanelProps = {
    detail: switchFromDetail || detail,
    episodeIndex: currentEpisodeIndex,
    onEpisodeChange: handleEpisodeChange,
    availableSources,
    sourceSearchLoading,
    sourceSearchError,
    infoMap,
    isMeasuring,
    pendingSourceKey,
    currentFailed: playerFailed && !pendingSourceKey,
    sourcesExpanded,
    onSourcesExpandedChange: setSourcesExpanded,
    onSourceSelect: (s) => {
      if (pendingSourceKey) return;
      handleSourceChange(s);
    },
    autoPicking,
    onAutoPick: handleAutoPick,
    onCancelAutoPick: () => {
      cancelAutoPickRef.current = true;
      setAutoPicking(false);
    },
    onWrongMatch: goToSearch,
  };

  const detailsProps: PlayDetailsProps = {
    detail,
    title: videoTitle,
    year: videoYear,
    episodeLabel,
    nextEpisodeLabel,
    poster: videoCover,
    doubanId: videoDoubanId,
    canDownload: !!videoUrl,
    favorited,
    onDownload: () => setShowAddDownload(true),
    onToggleFavorite: handleToggleFavorite,
    onNext: handleNextEpisode,
    onOpenDanmaku: () => setShowDanmakuSelector(true),
    onWrongMatch: goToSearch,
  };

  const playerTitle = useMemo(
    () => [videoTitle, episodeLabel].filter(Boolean).join(' · '),
    [videoTitle, episodeLabel]
  );

  // ---------------------------------------------------------------------------
  // 渲染
  // ---------------------------------------------------------------------------
  // 关键路径只覆盖"第一个可播放地址到手"这一小段。
  // 那之后页面必须立刻可见：海报、标题、选集、侧栏骨架都先渲染出来，
  // <video> 用自己的 poster + 切换卡表示加载中。旧实现在这里挡了整页，
  // 用户只能看到一个转圈。
  //
  // 只有连一个地址都没拿到时才退回整页骨架（URL 里什么参数都没有的情况）。
  const showBlockingSkeleton = loading && !detail;

  if (showBlockingSkeleton) {
    const stages = ['searching', 'fetching', 'ready'] as const;
    const stageIndex = stages.indexOf(loadingStage as any);
    const StageIcon =
      loadingStage === 'ready'
        ? Sparkles
        : loadingStage === 'fetching'
        ? Film
        : Search;
    const message =
      loadingStage === 'ready'
        ? t.loadReady
        : loadingStage === 'fetching'
        ? t.loadFetching
        : t.loadSearching;
    return (
      <PageLayout activePath='/play'>
        <div className='flex min-h-[70vh] items-center justify-center px-6'>
          <div
            role='status'
            aria-live='polite'
            className='flex w-full max-w-sm flex-col items-center gap-6 text-center'
          >
            <div className='relative flex h-24 w-24 items-center justify-center'>
              <span className='absolute inset-0 animate-spin rounded-full border-4 border-o-accent-200 border-t-o-accent' />
              <span className='flex h-16 w-16 items-center justify-center rounded-full bg-o-accent text-o-on-accent'>
                <StageIcon className='h-7 w-7' strokeWidth={2.75} />
              </span>
            </div>
            <div className='flex gap-2'>
              {stages.map((s, i) => (
                <span
                  key={s}
                  className={`h-2.5 rounded-full transition-all duration-500 ${
                    i <= stageIndex
                      ? 'w-8 bg-o-accent'
                      : 'w-2.5 bg-o-neutral-300'
                  }`}
                />
              ))}
            </div>
            <p className='m-0 font-heading text-xl'>{message}</p>
          </div>
        </div>
      </PageLayout>
    );
  }

  if (error) {
    return (
      <PageLayout activePath='/play'>
        <div className='flex min-h-[70vh] items-center justify-center px-6'>
          <div className='flex w-full max-w-md flex-col gap-4 rounded-[32px] bg-o-surface p-7'>
            <h2 className='m-0 font-heading text-[32px] leading-tight tracking-[-0.015em]'>
              {t.errorTitle}
            </h2>
            <p className='m-0 rounded-[20px] bg-o-accent-100 px-4 py-3 font-semibold text-o-accent-800'>
              {error}
            </p>
            <p className='m-0 text-sm text-o-neutral-700'>{t.errorHint}</p>
            <div className='flex flex-wrap gap-2'>
              <button
                type='button'
                onClick={() =>
                  videoTitle
                    ? router.push(`/search?q=${encodeURIComponent(videoTitle)}`)
                    : router.back()
                }
                className='o-btn o-btn-primary'
              >
                {videoTitle ? (
                  <Search className='h-4 w-4' strokeWidth={2.75} />
                ) : (
                  <ArrowLeft className='h-4 w-4' strokeWidth={2.75} />
                )}
                {videoTitle ? t.backToSearch : t.goBack}
              </button>
              <button
                type='button'
                onClick={() => window.location.reload()}
                className='o-btn o-btn-secondary'
              >
                <RotateCcw className='h-4 w-4' strokeWidth={2.75} />
                {t.retry}
              </button>
            </div>
          </div>
        </div>
      </PageLayout>
    );
  }

  return (
    <PageLayout activePath='/play'>
      {/* 移动端标题栏 */}
      <div className='flex h-14 items-center gap-2 px-3 md:hidden'>
        <button
          type='button'
          onClick={() =>
            window.history.length > 1 ? router.back() : router.push('/')
          }
          aria-label={t.back}
          className='o-btn o-btn-icon'
        >
          <ArrowLeft className='h-5 w-5' strokeWidth={2.75} />
        </button>
        <span className='min-w-0 flex-1 truncate text-[15px] font-bold'>
          {videoTitle}
        </span>
        <MoreMenu
          align='right'
          favorited={favorited}
          onToggleFavorite={handleToggleFavorite}
          onOpenDanmaku={() => setShowDanmakuSelector(true)}
          onWrongMatch={goToSearch}
          trigger={(p) => (
            <button
              type='button'
              {...p}
              aria-label={t.more}
              className='o-btn o-btn-icon'
            >
              <MoreHorizontal className='h-5 w-5' strokeWidth={2.75} />
            </button>
          )}
        />
      </div>

      <div className='mx-auto max-w-[1760px] md:px-6 md:pt-2 lg:px-10 lg:pb-12'>
        <div className='grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]'>
          {/* 播放器 */}
          <div className='relative aspect-video w-full overflow-hidden md:rounded-[28px]'>
            {betterSource && (
              <div className='absolute right-3 top-3 z-30 flex max-w-[calc(100%-1.5rem)] items-center gap-2 rounded-full bg-o-video-ink/85 px-3 py-2 text-[13px] font-semibold text-o-video-paper shadow-lg backdrop-blur'>
                <Zap
                  className='h-4 w-4 shrink-0 text-o-accent-300'
                  strokeWidth={2.75}
                />
                <span className='truncate'>
                  {t.betterSourceFound}{' '}
                  {betterSource.metrics.quality !== '未知'
                    ? `${betterSource.metrics.quality} · ${betterSource.metrics.loadSpeed}`
                    : betterSource.metrics.loadSpeed}
                </span>
                <button
                  type='button'
                  onClick={acceptBetterSource}
                  className='shrink-0 rounded-full bg-o-accent px-3 py-1 text-[12px] font-bold text-o-on-accent transition-transform hover:scale-105'
                >
                  {t.changeShort}
                </button>
                <button
                  type='button'
                  aria-label={t.dismiss}
                  onClick={() => setBetterSource(null)}
                  className='shrink-0 opacity-70 transition-opacity hover:opacity-100'
                >
                  <X className='h-4 w-4' strokeWidth={2.75} />
                </button>
              </div>
            )}
            <VideoPlayer
              ref={playerRef}
              src={videoUrl}
              sessionKey={sessionKey}
              Hls={Hls}
              blockAd={blockAdEnabled}
              poster={videoCover}
              title={playerTitle}
              badge={[detail?.source_name, currentQuality]
                .filter(Boolean)
                .join(' · ')}
              switchKind={switchKind}
              loadingSubtitle={loadingSubtitle}
              takeResumeTime={takeResumeTime}
              hasPrev={hasPrev}
              hasNext={hasNext}
              nextLabel={nextEpisodeLabel || undefined}
              onPrev={handlePreviousEpisode}
              onNext={handleNextEpisode}
              onEnded={handleEnded}
              onTimeUpdate={handleTimeUpdate}
              onPause={saveCurrentPlayProgress}
              onReady={handlePlayerReady}
              onError={handlePlayerError}
              errorAction={
                availableSources.length > 1
                  ? {
                      label: t.changeShort,
                      onClick: () => setSourcesExpanded(true),
                    }
                  : undefined
              }
              settings={playerSettings}
              danmakuUrl={danmakuUrl}
              danmakuVisible={danmakuVisible}
            >
              {isDanmakuLoading && (
                <div className='pointer-events-none absolute inset-x-4 top-4 z-30 flex justify-center'>
                  <div className='rounded-full bg-o-video-ink/85 px-4 py-2 text-[13px] font-semibold text-o-video-paper'>
                    {t.autoDanmakuLoading}
                  </div>
                </div>
              )}
              {showDanmakuSelector && (
                <DanmakuSelector
                  videoTitle={videoTitle}
                  isVisible={showDanmakuSelector}
                  currentEpisode={currentEpisodeIndex + 1}
                  currentEpisodeTitle={
                    detail?.episodes_titles?.[currentEpisodeIndex]
                  }
                  onSelect={async (
                    anime: AnimeOption,
                    episodeNumber?: number
                  ) => {
                    setShowDanmakuSelector(false);
                    setSelectedDanmakuAnime(anime);
                    setSelectedDanmakuEpisode(episodeNumber);
                    setSelectedState(true);
                  }}
                  onClose={() => setShowDanmakuSelector(false)}
                />
              )}
            </VideoPlayer>
          </div>

          {/* 桌面侧栏：与播放器等高 */}
          {isDesktop && (
            <div className='relative hidden lg:block'>
              <div className='absolute inset-0'>
                <PlaySidePanel {...panelProps} />
              </div>
            </div>
          )}
        </div>

        {isDesktop ? (
          /* 桌面详情 */
          <div className='mt-8 hidden lg:block'>
            <PlayDetailsDesktop {...detailsProps} />
          </div>
        ) : (
          /* 移动端 / 平板：播放器下方依次排列 */
          <div className='flex flex-col gap-[18px] px-4 pb-6 pt-[18px] md:px-0 lg:hidden'>
            <PlayDetailsMobileHead {...detailsProps} />
            <PlayMobileSourceCard {...panelProps} />
            <PlayMobileEpisodes {...panelProps} />
            <PlayDescriptionMobile desc={detail?.desc} />
          </div>
        )}
      </div>

      {/* 添加下载弹窗 */}
      <AddDownloadModal
        isOpen={showAddDownload}
        onClose={() => setShowAddDownload(false)}
        onAddTask={(config) => {
          // 触发自定义事件，通知导航栏的下载管理器
          window.dispatchEvent(
            new CustomEvent('addDownloadTask', { detail: config })
          );
          setShowAddDownload(false);
        }}
        initialUrl={videoUrl || ''}
        initialTitle={`${videoTitle}${
          isSeries
            ? `_${
                detail?.episodes_titles?.[currentEpisodeIndex] ||
                `第${currentEpisodeIndex + 1}集`
              }`
            : ''
        }`}
        skipConfig={skipConfig}
      />
    </PageLayout>
  );
}

/** 测速并发上限。超过这个数的源排队，避免一次性打爆连接数。 */
const MEASURE_CONCURRENCY = 6;

/** 把当前集有地址的源排到前面，让"当前源"的结果最先落地。 */
function orderByCurrentEpisodeFirst(
  sources: SearchResult[],
  index: number
): SearchResult[] {
  const playable = sources.filter((s) => episodeUrlOf(s, index) !== '');
  const rest = sources.filter((s) => episodeUrlOf(s, index) === '');
  return [...playable, ...rest];
}

/**
 * 只问一个源要详情，作为首帧的关键路径。
 * URL 里带 source+id 时说明用户刚从搜索结果点进来，这个源我们刚验证过存在。
 */
async function fetchDirectDetail(
  source: string,
  id: string
): Promise<SearchResult | null> {
  const ctrl = new AbortController();
  // 超时覆盖到读完响应体为止：发完响应头就卡住的上游不能让首帧一直等
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(
      withAdultFilterParam(
        `/api/detail?source=${encodeURIComponent(
          source
        )}&id=${encodeURIComponent(id)}`
      ),
      { signal: ctrl.signal }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as SearchResult;
    if (!data?.episodes?.length) return null;
    return data;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export default function PlayPage() {
  return (
    <Suspense fallback={null}>
      <PlayPageClient />
    </Suspense>
  );
}
