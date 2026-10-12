/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps */
'use client';

import {
  Airplay,
  Check,
  ChevronLeft,
  ChevronRight,
  FastForward,
  Gauge,
  Loader2,
  Maximize,
  Minimize,
  Pause,
  PictureInPicture2,
  Play,
  Rewind,
  RotateCcw,
  RotateCw,
  Settings2,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  forwardRef,
  ReactNode,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { useMediaQuery } from '@/lib/hooks/useMediaQuery';
import {
  AttachedStream,
  attachStream,
  captureFrame,
  formatClock,
  HlsModule,
  isHlsUrl,
  teardownStream,
} from '@/lib/player/engine';

import DanmakuLayer from './DanmakuLayer';
import PlayerTimeline from './PlayerTimeline';
import { useThumbnailPreview } from './useThumbnailPreview';
import { useI18n } from '../LanguageProvider';

export type PlayerSettingItem =
  | {
      kind: 'toggle';
      id: string;
      label: string;
      checked: boolean;
      onChange: (checked: boolean) => void;
    }
  | {
      kind: 'action';
      id: string;
      label: string;
      hint?: string;
      onSelect: () => void;
    }
  | {
      /** 二级菜单：一级只显示一行（带当前状态摘要），点进去才展开 items */
      kind: 'group';
      id: string;
      label: string;
      hint?: string;
      items: PlayerSettingItem[];
    };

export interface VideoPlayerHandle {
  getCurrentTime: () => number;
  getDuration: () => number;
  isPaused: () => boolean;
  isReady: () => boolean;
  seek: (time: number) => void;
  play: () => void;
  pause: () => void;
  showNotice: (text: string) => void;
}

export type SwitchKind = 'initial' | 'episode' | 'source';

interface VideoPlayerProps {
  src: string;
  /** 唯一标识一路播放（源|ID|集数|去广告）；变化即视为一次切换 */
  sessionKey: string;
  Hls: HlsModule | null;
  blockAd: boolean;
  poster?: string;
  /** 左上角标题，如 “庆余年 第二季 · 第 6 集” */
  title?: string;
  /** 右上角标签，如 “量子资源 · 1080p” */
  badge?: string;
  switchKind: SwitchKind;
  /** 切换卡片上的副标题，如 “第 6 集 · 红牛资源 · 1080p” */
  loadingSubtitle?: string;
  /** 每路播放开始时调用一次，返回需要恢复到的秒数（0 表示从头） */
  takeResumeTime: () => number;
  /** 换集：播放器内只有 Alt + ← / → 和全屏时的「下一集」按钮会用到 */
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onEnded?: () => void;
  onTimeUpdate?: (time: number, duration: number) => void;
  onPause?: () => void;
  onReady?: () => void;
  /**
   * 当前这一路无法播放（首次加载失败，或播放中放弃恢复）。
   * 播放页据此自动切换到下一个可用的源。
   */
  onError?: () => void;
  errorAction?: { label: string; onClick: () => void };
  /** 失败卡片上的补充说明（如"正在自动换源…"） */
  errorDetail?: string;
  /** 失败后正在自动处理：显示转圈 */
  errorBusy?: boolean;
  settings: PlayerSettingItem[];
  danmakuUrl: string | null;
  danmakuVisible: boolean;
  /** 叠加在画面上的额外内容（弹幕选择器、提示等） */
  children?: ReactNode;
}

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
const VOLUME_KEY = 'moontv_volume';
const HIDE_CONTROLS_MS = 2600;
/** 快退 / 快进按钮与触屏双击的步长（秒） */
const SEEK_STEP = 10;
/** 双击后在此时间内继续点击同侧，会继续累加快进 / 快退 */
const SEEK_CHAIN_MS = 700;
/** 触屏两次点击的间隔小于此值算作双击 */
const DOUBLE_TAP_MS = 300;

function isTypingTarget(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT' ||
    el.isContentEditable
  );
}

const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(
  function VideoPlayer(props, ref) {
    const {
      src,
      sessionKey,
      Hls,
      blockAd,
      poster,
      title,
      badge,
      switchKind,
      loadingSubtitle,
      errorAction,
      errorDetail,
      errorBusy = false,
      settings,
      danmakuUrl,
      danmakuVisible,
      children,
    } = props;
    const { t } = useI18n();
    const compact = useMediaQuery('(max-width: 767px)');
    // 触屏（手机、平板，含横屏）：快退 / 播放 / 快进放到画面中央（同 YouTube 移动端），
    // 按输入方式而不是屏宽判断，因此宽屏平板也生效；鼠标设备仍放在底部控制栏
    const touchLayout = useMediaQuery('(hover: none) and (pointer: coarse)');

    const containerRef = useRef<HTMLDivElement>(null);
    const videoRef = useRef<HTMLVideoElement>(null);
    const frameCanvasRef = useRef<HTMLCanvasElement>(null);
    const genRef = useRef(0);
    const phaseRef = useRef<'idle' | 'loading' | 'ready' | 'error'>('idle');

    // 回调放进 ref，事件监听只绑定一次也能拿到最新的回调
    const propsRef = useRef(props);
    propsRef.current = props;

    const [phase, setPhaseState] = useState<
      'idle' | 'loading' | 'ready' | 'error'
    >('idle');
    const setPhase = (p: typeof phase) => {
      phaseRef.current = p;
      setPhaseState(p);
    };
    const [manifestLoaded, setManifestLoaded] = useState(false);
    const [resumeAt, setResumeAt] = useState(0);
    const [hasFrozenFrame, setHasFrozenFrame] = useState(false);

    const [paused, setPaused] = useState(true);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [bufferedEnd, setBufferedEnd] = useState(0);
    const [volume, setVolume] = useState(0.7);
    const [muted, setMuted] = useState(false);
    const [rate, setRate] = useState(1);
    const [waiting, setWaiting] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [pipSupported, setPipSupported] = useState(false);
    const [airplayAvailable, setAirplayAvailable] = useState(false);
    const [autoplayBlocked, setAutoplayBlocked] = useState(false);

    const [controlsVisible, setControlsVisible] = useState(true);
    const [menu, setMenu] = useState<null | 'speed' | 'settings'>(null);
    // 设置菜单当前所在的二级页（group id），null 为一级
    const [settingsPage, setSettingsPage] = useState<string | null>(null);
    const [scrubbing, setScrubbing] = useState(false);
    const [notice, setNotice] = useState<string | null>(null);
    const noticeTimerRef = useRef<number | null>(null);
    const hideTimerRef = useRef<number | null>(null);
    const pointerOverControlsRef = useRef(false);

    const preview = useThumbnailPreview(src, Hls, blockAd, !compact);

    // ---------------------------------------------------------------------
    // 提示 / 控制栏显隐
    // ---------------------------------------------------------------------
    const showNotice = useCallback((text: string) => {
      setNotice(text);
      if (noticeTimerRef.current) window.clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = window.setTimeout(() => setNotice(null), 1600);
    }, []);

    const scheduleHide = useCallback(() => {
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = window.setTimeout(() => {
        const video = videoRef.current;
        if (!video || video.paused || pointerOverControlsRef.current) return;
        setControlsVisible(false);
        setMenu(null);
      }, HIDE_CONTROLS_MS);
    }, []);

    const revealControls = useCallback(() => {
      setControlsVisible(true);
      scheduleHide();
    }, [scheduleHide]);

    // 每次打开设置都从一级开始
    useEffect(() => {
      if (menu !== 'settings') setSettingsPage(null);
    }, [menu]);

    useEffect(() => {
      if (paused || menu || scrubbing) {
        setControlsVisible(true);
        if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
      } else {
        scheduleHide();
      }
    }, [paused, menu, scrubbing, scheduleHide]);

    // ---------------------------------------------------------------------
    // 播放控制
    // ---------------------------------------------------------------------
    const play = useCallback(() => {
      const video = videoRef.current;
      if (!video || phaseRef.current !== 'ready') return;
      video
        .play()
        .then(() => setAutoplayBlocked(false))
        .catch(() => undefined);
    }, []);

    const pause = useCallback(() => {
      videoRef.current?.pause();
    }, []);

    const togglePlay = useCallback(() => {
      const video = videoRef.current;
      if (!video) return;
      if (video.paused) play();
      else pause();
    }, [play, pause]);

    const seek = useCallback((time: number) => {
      const video = videoRef.current;
      if (!video || phaseRef.current !== 'ready') return;
      const d = video.duration || 0;
      video.currentTime = Math.max(0, d ? Math.min(time, d - 0.1) : time);
      setCurrentTime(video.currentTime);
    }, []);

    const seekBy = useCallback(
      (delta: number) => {
        const video = videoRef.current;
        if (video) seek(video.currentTime + delta);
      },
      [seek]
    );

    const applyVolume = useCallback((v: number, mute?: boolean) => {
      const video = videoRef.current;
      if (!video) return;
      const next = Math.max(0, Math.min(1, v));
      video.volume = next;
      video.muted = mute ?? next === 0;
      try {
        localStorage.setItem(VOLUME_KEY, String(next));
      } catch {
        // ignore
      }
    }, []);

    const applyRate = useCallback((r: number) => {
      const video = videoRef.current;
      if (!video) return;
      video.playbackRate = r;
      // load() 会把 playbackRate 重置为 defaultPlaybackRate，这样换集后倍速得以保留
      video.defaultPlaybackRate = r;
    }, []);

    const toggleFullscreen = useCallback(async () => {
      const container = containerRef.current as any;
      const video = videoRef.current as any;
      const doc = document as any;
      const fsElement = doc.fullscreenElement || doc.webkitFullscreenElement;
      try {
        if (fsElement) {
          if (doc.exitFullscreen) await doc.exitFullscreen();
          else if (doc.webkitExitFullscreen) doc.webkitExitFullscreen();
          return;
        }
        if (container?.requestFullscreen) {
          await container.requestFullscreen({ navigationUI: 'hide' });
        } else if (container?.webkitRequestFullscreen) {
          container.webkitRequestFullscreen();
        } else if (video?.webkitEnterFullscreen) {
          // iPhone 只支持 video 元素原生全屏
          video.webkitEnterFullscreen();
          return;
        }
        if (compact) {
          try {
            await (screen.orientation as any)?.lock?.('landscape');
          } catch {
            // 部分浏览器不支持锁定方向
          }
        }
      } catch {
        // ignore
      }
    }, [compact]);

    const togglePip = useCallback(async () => {
      const video = videoRef.current as any;
      const doc = document as any;
      if (!video) return;
      try {
        if (doc.pictureInPictureElement) await doc.exitPictureInPicture();
        else await video.requestPictureInPicture();
      } catch {
        // ignore
      }
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        getCurrentTime: () => videoRef.current?.currentTime || 0,
        getDuration: () => videoRef.current?.duration || 0,
        isPaused: () => videoRef.current?.paused ?? true,
        isReady: () => phaseRef.current === 'ready',
        seek,
        play,
        pause,
        showNotice,
      }),
      [seek, play, pause, showNotice]
    );

    // ---------------------------------------------------------------------
    // 一路播放的生命周期：attach → 恢复进度 → ready；切换时冻结画面并 teardown
    // ---------------------------------------------------------------------
    useEffect(() => {
      const video = videoRef.current;
      if (!video || !src) return;
      const nativeHls =
        video.canPlayType('application/vnd.apple.mpegurl') !== '';
      if (isHlsUrl(src) && !Hls && !nativeHls) return; // 等 hls.js 加载完成

      const gen = ++genRef.current;
      const isCurrent = () => gen === genRef.current;
      const resume = Math.max(0, propsRef.current.takeResumeTime() || 0);

      setPhase('loading');
      setManifestLoaded(false);
      setResumeAt(resume);
      setWaiting(false);
      setAutoplayBlocked(false);

      let resumeApplied = resume <= 0;

      const stream: AttachedStream = attachStream(video, src, {
        Hls,
        blockAd,
        isCurrent,
        // 首次加载失败直接报错；播放过程中的网络抖动才尝试恢复
        canRecover: () => phaseRef.current === 'ready',
        onManifestLoaded: () => setManifestLoaded(true),
        onRecoverableError: () => showNotice(t.playbackError),
        onFatalError: () => {
          setPhase('error');
          propsRef.current.onError?.();
        },
      });

      const tryBecomeReady = () => {
        if (!isCurrent() || phaseRef.current !== 'loading') return;
        if (!resumeApplied || video.seeking || video.readyState < 3) return;
        setPhase('ready');
        setHasFrozenFrame(false);
        setCurrentTime(video.currentTime);
        setDuration(video.duration || 0);
        video
          .play()
          .then(() => {
            if (isCurrent()) setAutoplayBlocked(false);
          })
          .catch(() => {
            if (isCurrent()) setAutoplayBlocked(true);
          });
        propsRef.current.onReady?.();
      };

      const onLoadedMetadata = () => {
        if (!isCurrent()) return;
        setDuration(video.duration || 0);
        if (!resumeApplied) {
          const d = video.duration || 0;
          let target = resume;
          if (d && target >= d - 2) target = Math.max(0, d - 5);
          resumeApplied = true;
          if (target > 0) {
            video.currentTime = target;
            return;
          }
        }
        tryBecomeReady();
      };

      const onNativeError = () => {
        // hls.js 模式下的错误由 hls 自己处理
        if (!isCurrent() || stream.hls) return;
        if (video.error) {
          setPhase('error');
          propsRef.current.onError?.();
        }
      };

      video.addEventListener('loadedmetadata', onLoadedMetadata);
      video.addEventListener('canplay', tryBecomeReady);
      video.addEventListener('seeked', tryBecomeReady);
      video.addEventListener('error', onNativeError);

      return () => {
        // 先标记为加载中，之后 teardown 触发的 pause 等事件都会被忽略
        phaseRef.current = 'loading';
        setHasFrozenFrame(captureFrame(video, frameCanvasRef.current));
        genRef.current += 1;
        video.removeEventListener('loadedmetadata', onLoadedMetadata);
        video.removeEventListener('canplay', tryBecomeReady);
        video.removeEventListener('seeked', tryBecomeReady);
        video.removeEventListener('error', onNativeError);
        teardownStream(video, stream);
      };
    }, [src, sessionKey, Hls, blockAd]);

    // ---------------------------------------------------------------------
    // 与具体某一路无关的 video 事件，只绑定一次
    // ---------------------------------------------------------------------
    useEffect(() => {
      const video = videoRef.current;
      if (!video) return;

      try {
        const saved = localStorage.getItem(VOLUME_KEY);
        const v = saved !== null ? Number(saved) : 0.7;
        video.volume = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0.7;
      } catch {
        video.volume = 0.7;
      }
      setVolume(video.volume);
      setPipSupported(
        !!(document as any).pictureInPictureEnabled &&
          !(video as any).disablePictureInPicture
      );

      let wakeLock: any = null;
      const requestWakeLock = async () => {
        try {
          if (document.hidden || wakeLock) return;
          if ('wakeLock' in navigator) {
            wakeLock = await (navigator as any).wakeLock.request('screen');
            wakeLock.addEventListener?.('release', () => {
              wakeLock = null;
            });
          }
        } catch {
          // ignore
        }
      };
      const releaseWakeLock = () => {
        try {
          wakeLock?.release();
        } catch {
          // ignore
        }
        wakeLock = null;
      };

      const ready = () => phaseRef.current === 'ready';
      const onTime = () => {
        if (!ready()) return;
        setCurrentTime(video.currentTime);
        propsRef.current.onTimeUpdate?.(video.currentTime, video.duration || 0);
      };
      const onProgress = () => {
        const b = video.buffered;
        const t0 = video.currentTime;
        let end = 0;
        for (let i = 0; i < b.length; i++) {
          if (b.start(i) <= t0 + 0.5) end = Math.max(end, b.end(i));
        }
        setBufferedEnd(end);
      };
      const onDuration = () => {
        if (ready()) setDuration(video.duration || 0);
      };
      const onPlay = () => {
        setPaused(false);
        requestWakeLock();
      };
      const onPause = () => {
        setPaused(true);
        releaseWakeLock();
        if (ready()) propsRef.current.onPause?.();
      };
      const onEnded = () => {
        setPaused(true);
        releaseWakeLock();
        if (ready()) propsRef.current.onEnded?.();
      };
      const onVolume = () => {
        setVolume(video.volume);
        setMuted(video.muted);
      };
      const onRate = () => setRate(video.playbackRate);
      const onWaiting = () => setWaiting(true);
      const onPlaying = () => setWaiting(false);
      const onVisibility = () => {
        if (!document.hidden && !video.paused) requestWakeLock();
      };
      const onAirplay = (e: any) =>
        setAirplayAvailable(e.availability === 'available');

      video.addEventListener('timeupdate', onTime);
      video.addEventListener('progress', onProgress);
      video.addEventListener('timeupdate', onProgress);
      video.addEventListener('durationchange', onDuration);
      video.addEventListener('play', onPlay);
      video.addEventListener('pause', onPause);
      video.addEventListener('ended', onEnded);
      video.addEventListener('volumechange', onVolume);
      video.addEventListener('ratechange', onRate);
      video.addEventListener('waiting', onWaiting);
      video.addEventListener('playing', onPlaying);
      video.addEventListener(
        'webkitplaybacktargetavailabilitychanged',
        onAirplay as EventListener
      );
      document.addEventListener('visibilitychange', onVisibility);

      return () => {
        video.removeEventListener('timeupdate', onTime);
        video.removeEventListener('progress', onProgress);
        video.removeEventListener('timeupdate', onProgress);
        video.removeEventListener('durationchange', onDuration);
        video.removeEventListener('play', onPlay);
        video.removeEventListener('pause', onPause);
        video.removeEventListener('ended', onEnded);
        video.removeEventListener('volumechange', onVolume);
        video.removeEventListener('ratechange', onRate);
        video.removeEventListener('waiting', onWaiting);
        video.removeEventListener('playing', onPlaying);
        video.removeEventListener(
          'webkitplaybacktargetavailabilitychanged',
          onAirplay as EventListener
        );
        document.removeEventListener('visibilitychange', onVisibility);
        releaseWakeLock();
      };
    }, []);

    // 全屏状态
    useEffect(() => {
      const onChange = () => {
        const doc = document as any;
        const el = doc.fullscreenElement || doc.webkitFullscreenElement;
        const active = !!el && el === containerRef.current;
        setIsFullscreen(active);
        if (!active) {
          try {
            (screen.orientation as any)?.unlock?.();
          } catch {
            // ignore
          }
        }
      };
      document.addEventListener('fullscreenchange', onChange);
      document.addEventListener('webkitfullscreenchange', onChange);
      return () => {
        document.removeEventListener('fullscreenchange', onChange);
        document.removeEventListener('webkitfullscreenchange', onChange);
      };
    }, []);

    // 键盘快捷键（与原 ArtPlayer 版本一致）
    useEffect(() => {
      const onKey = (e: KeyboardEvent) => {
        if (e.defaultPrevented || isTypingTarget(e.target)) return;
        const video = videoRef.current;
        if (!video) return;
        const p = propsRef.current;
        if (e.altKey && e.key === 'ArrowLeft') {
          if (p.hasPrev) {
            p.onPrev();
            e.preventDefault();
          }
          return;
        }
        if (e.altKey && e.key === 'ArrowRight') {
          if (p.hasNext) {
            p.onNext();
            e.preventDefault();
          }
          return;
        }
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        switch (e.key) {
          // 与快退 / 快进按钮一致：每次 10 秒，在开头 / 结尾夹紧
          case 'ArrowLeft':
            seekBy(-SEEK_STEP);
            e.preventDefault();
            break;
          case 'ArrowRight':
            seekBy(SEEK_STEP);
            e.preventDefault();
            break;
          case 'ArrowUp': {
            const v = Math.round(Math.min(1, video.volume + 0.1) * 10) / 10;
            applyVolume(v, false);
            showNotice(t.noticeVolume(Math.round(v * 100)));
            e.preventDefault();
            break;
          }
          case 'ArrowDown': {
            const v = Math.round(Math.max(0, video.volume - 0.1) * 10) / 10;
            applyVolume(v);
            showNotice(t.noticeVolume(Math.round(v * 100)));
            e.preventDefault();
            break;
          }
          case ' ':
            if ((e.target as HTMLElement)?.tagName === 'BUTTON') return;
            togglePlay();
            e.preventDefault();
            break;
          case 'f':
          case 'F':
            toggleFullscreen();
            e.preventDefault();
            break;
        }
        revealControls();
      };
      document.addEventListener('keydown', onKey);
      return () => document.removeEventListener('keydown', onKey);
    }, [
      seekBy,
      applyVolume,
      togglePlay,
      toggleFullscreen,
      showNotice,
      revealControls,
      t,
    ]);

    // ---------------------------------------------------------------------
    // 画面上的点击 / 触摸：桌面单击暂停、双击全屏；
    // 触屏单击显隐控制栏，双击左 / 右侧快退 / 快进 10 秒（同 YouTube），双击中间暂停，长按 3 倍速
    // ---------------------------------------------------------------------
    const lastTapRef = useRef(0);
    const [seekRipple, setSeekRipple] = useState<{
      dir: -1 | 1;
      total: number;
      key: number;
    } | null>(null);
    const seekRippleRef = useRef<{ dir: -1 | 1; total: number; at: number }>();
    const seekRippleTimerRef = useRef<number | null>(null);

    const tapSeek = (dir: -1 | 1) => {
      const video = videoRef.current;
      if (!video || phaseRef.current !== 'ready') return;
      const before = video.currentTime;
      seekBy(dir * SEEK_STEP);
      // 提示显示实际跳过的秒数：在开头 / 结尾被夹紧时不足 10 秒（如 0:03 处后退只显示 3 秒）
      const moved = Math.abs(video.currentTime - before);
      // 同 YouTube：播放中双击快进 / 快退后控制栏保持收起。双击的第一下会唤出控制栏，
      // 不收回的话提示消失后中央按钮和底栏会立刻盖到画面上（暂停时控制栏本就常驻）
      if (!video.paused) {
        if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
        setControlsVisible(false);
      }
      const now = Date.now();
      const prev = seekRippleRef.current;
      const total =
        prev && prev.dir === dir && now - prev.at < SEEK_CHAIN_MS
          ? prev.total + moved
          : moved;
      seekRippleRef.current = { dir, total, at: now };
      setSeekRipple({ dir, total, key: now });
      if (seekRippleTimerRef.current) {
        window.clearTimeout(seekRippleTimerRef.current);
      }
      seekRippleTimerRef.current = window.setTimeout(() => {
        seekRippleRef.current = undefined;
        setSeekRipple(null);
      }, SEEK_CHAIN_MS);
    };

    useEffect(
      () => () => {
        if (seekRippleTimerRef.current) {
          window.clearTimeout(seekRippleTimerRef.current);
        }
      },
      []
    );
    // 单击唤出控制栏后的 DOUBLE_TAP_MS 内，刚出现的按钮 / 进度条不接收点击：
    // 否则双击的第二下会落在它们上面（跳到手指所在的进度、打开设置、按到中央按钮），
    // 而不是交给画面按双击处理。超过这个时间人才来得及看清再点，不影响正常操作
    const [tapGuard, setTapGuard] = useState(false);
    const tapGuardTimerRef = useRef<number | null>(null);
    const guardRevealedControls = () => {
      setTapGuard(true);
      if (tapGuardTimerRef.current) {
        window.clearTimeout(tapGuardTimerRef.current);
      }
      tapGuardTimerRef.current = window.setTimeout(
        () => setTapGuard(false),
        DOUBLE_TAP_MS
      );
    };
    useEffect(
      () => () => {
        if (tapGuardTimerRef.current) {
          window.clearTimeout(tapGuardTimerRef.current);
        }
      },
      []
    );

    const lastPointerTypeRef = useRef('mouse');
    const longPressTimerRef = useRef<number | null>(null);
    const longPressRateRef = useRef<number | null>(null);

    const handleSurfacePointerDown = (e: React.PointerEvent) => {
      lastPointerTypeRef.current = e.pointerType;
      if (e.pointerType !== 'touch' || phaseRef.current !== 'ready') return;
      longPressTimerRef.current = window.setTimeout(() => {
        const video = videoRef.current;
        if (!video || video.paused) return;
        longPressRateRef.current = video.playbackRate;
        video.playbackRate = 3;
        setNotice(t.noticeFastForward);
      }, 500);
    };

    const endLongPress = () => {
      if (longPressTimerRef.current) {
        window.clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
      if (longPressRateRef.current !== null && videoRef.current) {
        videoRef.current.playbackRate = longPressRateRef.current;
        longPressRateRef.current = null;
        setNotice(null);
        return true;
      }
      return false;
    };

    const handleSurfacePointerUp = (e: React.PointerEvent) => {
      const wasLongPress = endLongPress();
      if (wasLongPress) return;
      if (menu) {
        setMenu(null);
        return;
      }
      if (e.pointerType === 'touch') {
        const now = Date.now();
        const rect = e.currentTarget.getBoundingClientRect();
        const x = (e.clientX - rect.left) / (rect.width || 1);
        const zone: -1 | 0 | 1 = x < 1 / 3 ? -1 : x > 2 / 3 ? 1 : 0;
        const chaining =
          !!seekRippleRef.current &&
          now - seekRippleRef.current.at < SEEK_CHAIN_MS;
        if (zone !== 0 && chaining) {
          // 已在快进 / 快退中：继续点击侧边每次再跳 10 秒
          tapSeek(zone);
          lastTapRef.current = 0;
        } else if (now - lastTapRef.current < DOUBLE_TAP_MS) {
          if (zone === 0) togglePlay();
          else tapSeek(zone);
          lastTapRef.current = 0;
        } else {
          lastTapRef.current = now;
          if (controlsVisible && !paused) {
            setControlsVisible(false);
          } else {
            if (!controlsVisible) guardRevealedControls();
            revealControls();
          }
        }
      } else if (e.button === 0) {
        togglePlay();
      }
    };

    // ---------------------------------------------------------------------
    // 渲染
    // ---------------------------------------------------------------------
    const isLoading = phase === 'loading' || (phase === 'idle' && !!src);
    const showChrome = controlsVisible || isLoading || phase === 'error';
    // 中央按钮在倍速 / 设置菜单打开时收起（矮画面里会盖住菜单），
    // 双击快进 / 快退提示显示期间也收起（暂停时控制栏常驻，会和提示叠在一起）
    const centreVisible = showChrome && !menu && !seekRipple;
    // 控制栏可见但暂不接收点击：刚被单击唤出（见 guardRevealedControls），或双击快进 /
    // 快退提示显示期间（暂停时控制栏常驻，连点同侧的后几下不能被底栏截走）
    const chromeLocked = tapGuard || !!seekRipple;
    const VolumeIcon =
      muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
    const loadingTitle =
      switchKind === 'source'
        ? t.switchingSource
        : switchKind === 'episode'
        ? t.switchingEpisode
        : t.loadingVideo;

    const iconBtn = compact
      ? 'flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-o-video-paper/[0.14]'
      : 'flex h-10 w-10 items-center justify-center rounded-full transition-colors hover:bg-o-video-paper/[0.14]';
    const iconSize = compact ? 16 : 18;

    // 设置菜单：一级放常用开关和分类入口，分类点进去是二级页（带返回）。
    // 从二级页返回时，焦点回到刚才进入的那一行（见 PopoverMenu 的 pageKey）
    const settingsReturnRef = useRef<string | null>(null);
    const renderSettingRow = (item: PlayerSettingItem) => {
      if (item.kind === 'toggle') {
        return (
          <MenuRow
            key={item.id}
            role='menuitemcheckbox'
            checked={item.checked}
            onClick={() => item.onChange(!item.checked)}
            trailing={<Switch checked={item.checked} />}
          >
            {item.label}
          </MenuRow>
        );
      }
      const hint = item.hint ? (
        <span className='max-w-[9rem] truncate text-xs opacity-70'>
          {item.hint}
        </span>
      ) : null;
      if (item.kind === 'group') {
        return (
          <MenuRow
            key={item.id}
            hasPopup
            autoFocus={item.id === settingsReturnRef.current}
            onClick={() => setSettingsPage(item.id)}
            trailing={
              <>
                {hint}
                <ChevronRight
                  size={16}
                  className='-mr-1 flex-none opacity-70'
                  strokeWidth={2.75}
                />
              </>
            }
          >
            {item.label}
          </MenuRow>
        );
      }
      return (
        <MenuRow key={item.id} onClick={item.onSelect} trailing={hint}>
          {item.label}
        </MenuRow>
      );
    };

    const renderSettings = () => {
      const group = settings.find(
        (item): item is Extract<PlayerSettingItem, { kind: 'group' }> =>
          item.kind === 'group' && item.id === settingsPage
      );
      if (!group) return settings.map(renderSettingRow);
      return (
        <>
          <button
            type='button'
            role='menuitem'
            data-autofocus
            onClick={() => {
              settingsReturnRef.current = group.id;
              setSettingsPage(null);
            }}
            aria-label={`${t.back} · ${group.label}`}
            className='mb-1 flex w-full items-center gap-1.5 rounded-[14px] border-b border-o-video-paper/[0.12] px-2 pb-2.5 pt-2 text-left text-sm font-bold transition-colors hover:bg-o-video-paper/[0.12]'
          >
            <ChevronLeft size={18} strokeWidth={2.75} />
            <span className='truncate'>{group.label}</span>
          </button>
          {group.items.map(renderSettingRow)}
        </>
      );
    };

    // 中央播放键占着画面正中：暂停时（控制栏常驻）双击中间，两下都会落在它上面，
    // 播放又立刻暂停。DOUBLE_TAP_MS 内的第二下按“双击中间 = 切换一次”处理，忽略掉
    const lastCentrePlayRef = useRef(0);
    const centreTogglePlay = () => {
      const now = Date.now();
      if (now - lastCentrePlayRef.current < DOUBLE_TAP_MS) return;
      lastCentrePlayRef.current = now;
      togglePlay();
    };

    // 快退 10 秒 / 播放暂停 / 快进 10 秒：鼠标设备在底部控制栏，触屏在画面中央
    const renderTransport = (place: 'bar' | 'center') => {
      const center = place === 'center';
      const sideBtn = center
        ? `flex items-center justify-center rounded-full bg-o-video-ink/40 transition-colors active:bg-o-video-paper/25 ${
            compact ? 'h-12 w-12' : 'h-16 w-16'
          }`
        : iconBtn;
      const seekIconSize = center ? (compact ? 28 : 34) : compact ? 22 : 24;
      const playSize = center
        ? compact
          ? 'h-[60px] w-[60px]'
          : 'h-[76px] w-[76px]'
        : compact
        ? 'h-10 w-10'
        : 'h-12 w-12';
      const playIconSize = center ? (compact ? 26 : 32) : compact ? 17 : 20;
      return (
        <>
          <button
            type='button'
            className={sideBtn}
            onClick={() => seekBy(-SEEK_STEP)}
            title={t.seekBackward(SEEK_STEP)}
            aria-label={t.seekBackward(SEEK_STEP)}
          >
            <SeekIcon dir={-1} size={seekIconSize} />
          </button>
          <button
            type='button'
            onClick={center ? centreTogglePlay : togglePlay}
            title={paused ? t.play : t.pause}
            aria-label={paused ? t.play : t.pause}
            className={`flex flex-none items-center justify-center rounded-full bg-o-accent text-o-video-paper transition-colors hover:bg-o-accent-600 ${playSize}`}
          >
            {center && waiting && !paused ? (
              // 触屏布局下缓冲指示放在播放键里，不再另叠一个转圈
              <Loader2
                size={playIconSize}
                className='animate-spin'
                strokeWidth={2.75}
              />
            ) : paused ? (
              <Play
                size={playIconSize}
                className='ml-0.5 fill-current'
                strokeWidth={2.75}
              />
            ) : (
              <Pause
                size={playIconSize}
                className='fill-current'
                strokeWidth={2.75}
              />
            )}
          </button>
          <button
            type='button'
            className={sideBtn}
            onClick={() => seekBy(SEEK_STEP)}
            title={t.seekForward(SEEK_STEP)}
            aria-label={t.seekForward(SEEK_STEP)}
          >
            <SeekIcon dir={1} size={seekIconSize} />
          </button>
        </>
      );
    };

    return (
      <div
        ref={containerRef}
        className={`group/player relative h-full w-full select-none overflow-hidden bg-[rgb(46_43_37)] text-o-video-paper ${
          !showChrome ? 'cursor-none' : ''
        } ${isFullscreen ? 'bg-black' : ''}`}
        onMouseMove={revealControls}
        // 键盘用户 Tab 到控件时也显示控制栏
        onFocusCapture={revealControls}
        onMouseLeave={() => {
          if (!videoRef.current?.paused) setControlsVisible(false);
        }}
      >
        {/* 视频 */}
        <video
          ref={videoRef}
          className='absolute inset-0 h-full w-full bg-black object-contain'
          playsInline
          crossOrigin='anonymous'
          preload='auto'
          poster={poster || undefined}
          x-webkit-airplay='allow'
        />

        {/* 冻结的最后一帧 / 海报，在切换期间显示 */}
        <canvas
          ref={frameCanvasRef}
          className={`absolute inset-0 h-full w-full object-contain ${
            hasFrozenFrame && phase !== 'ready' ? '' : 'hidden'
          }`}
        />
        {isLoading && !hasFrozenFrame && poster && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={poster}
            alt=''
            className='absolute inset-0 h-full w-full object-cover opacity-60 blur-sm'
          />
        )}

        {/* 弹幕 */}
        <DanmakuLayer
          videoRef={videoRef}
          url={danmakuUrl}
          visible={danmakuVisible}
          active={phase === 'ready'}
          compact={compact}
        />

        {/* 点击层 */}
        <div
          className='absolute inset-0'
          onPointerDown={handleSurfacePointerDown}
          onPointerUp={handleSurfacePointerUp}
          onPointerCancel={endLongPress}
          onPointerLeave={endLongPress}
          // 触屏的点击全部由 pointer 事件处理。取消浏览器随后补发的 click：
          // 否则单击唤出控制栏后，这个 click 会落在刚出现的中央播放键或底栏按钮上
          // （隐藏的按钮被“点穿”），双击时也会触发 iOS 的双击缩放
          onTouchEnd={(e) => {
            if (e.cancelable) e.preventDefault();
          }}
          onDoubleClick={() => {
            // 触屏的双击已用于快进 / 快退（两侧）和暂停 / 播放（中间）
            if (lastPointerTypeRef.current !== 'touch') toggleFullscreen();
          }}
        />

        {/* 触屏双击快进 / 快退提示 */}
        {seekRipple && (
          <div
            className={`pointer-events-none absolute inset-y-0 flex w-[38%] items-center justify-center bg-o-video-ink/40 ${
              seekRipple.dir < 0
                ? 'left-0 rounded-r-[50%]'
                : 'right-0 rounded-l-[50%]'
            }`}
          >
            <div
              key={seekRipple.key}
              className='flex animate-o-pop flex-col items-center gap-1 text-[13px] font-semibold drop-shadow-[0_1px_2px_rgb(0_0_0/0.6)]'
            >
              {seekRipple.dir < 0 ? (
                <Rewind size={22} className='fill-current' strokeWidth={2.75} />
              ) : (
                <FastForward
                  size={22}
                  className='fill-current'
                  strokeWidth={2.75}
                />
              )}
              {t.seekSeconds(Math.round(seekRipple.total))}
            </div>
          </div>
        )}

        {/* 缓冲中 */}
        {phase === 'ready' &&
          waiting &&
          !paused &&
          !(touchLayout && centreVisible) && (
            <div className='pointer-events-none absolute inset-0 flex items-center justify-center'>
              <span className='flex h-14 w-14 items-center justify-center rounded-full bg-o-video-ink/60'>
                <Loader2 className='h-7 w-7 animate-spin' strokeWidth={2.75} />
              </span>
            </div>
          )}

        {/* 自动播放被拦截时的大播放按钮 */}
        {/* 触屏布局的中央已有播放键，暂停时也一直显示 */}
        {phase === 'ready' && paused && autoplayBlocked && !touchLayout && (
          <button
            type='button'
            onClick={play}
            aria-label={t.play}
            className='absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-o-accent text-o-video-paper shadow-o-lg transition-transform hover:scale-105'
          >
            <Play className='ml-1 h-7 w-7 fill-current' strokeWidth={2.75} />
          </button>
        )}

        {/* 提示 */}
        {notice && (
          <div className='pointer-events-none absolute left-4 top-4 z-20 rounded-full bg-o-video-ink/85 px-3.5 py-1.5 text-[13px] font-semibold md:left-6 md:top-16'>
            {notice}
          </div>
        )}

        {/* 顶部标题（桌面） */}
        {!compact && (title || badge) && (
          <div
            className={`pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-o-video-ink/55 to-transparent px-6 pb-11 pt-5 transition-opacity duration-300 ${
              showChrome ? 'opacity-100' : 'opacity-0'
            }`}
          >
            <span className='truncate pr-4 text-[15px] font-semibold'>
              {title}
            </span>
            {badge && (
              <span className='o-tag flex-none bg-o-video-paper/[0.16] font-semibold'>
                {badge}
              </span>
            )}
          </div>
        )}

        {/* 切换 / 加载状态：冻结画面 + 步骤卡片 */}
        {(isLoading || phase === 'error') && (
          <div className='absolute inset-0 z-10 flex items-center justify-center bg-o-video-ink/[0.68] backdrop-blur-[3px]'>
            {phase === 'error' ? (
              <div className='mx-4 flex w-[400px] max-w-[calc(100%-32px)] flex-col gap-4 rounded-[32px] bg-[rgb(46_43_37/0.92)] p-5 text-o-video-paper shadow-o-lg md:p-7'>
                <div className='font-heading text-lg leading-tight md:text-[22px]'>
                  {t.playbackFailed}
                </div>
                {errorDetail && (
                  <div
                    role='status'
                    aria-live='polite'
                    className='flex items-center gap-2 text-[13px] font-semibold text-o-video-paper/80'
                  >
                    {errorBusy && (
                      <Loader2
                        className='h-4 w-4 shrink-0 animate-spin'
                        strokeWidth={2.75}
                      />
                    )}
                    {errorDetail}
                  </div>
                )}
                {errorAction && (
                  <button
                    type='button'
                    onClick={errorAction.onClick}
                    className='o-btn o-btn-primary self-start'
                  >
                    {errorAction.label}
                  </button>
                )}
              </div>
            ) : (
              <SwitchingCard
                compact={compact}
                title={loadingTitle}
                subtitle={loadingSubtitle}
                showStopStep={switchKind !== 'initial'}
                manifestLoaded={manifestLoaded}
                resumeLabel={
                  resumeAt > 0 ? t.resumeAt(formatClock(resumeAt)) : ''
                }
              />
            )}
          </div>
        )}

        {/* 触屏：画面中央的快退 / 播放 / 快进，随控制栏显隐，菜单打开时收起；
            层级高于底部控制栏，矮画面上两者的透明内边距重叠时按钮仍可点 */}
        {touchLayout && phase === 'ready' && (
          <div
            className={`pointer-events-none absolute inset-0 z-[25] flex items-center justify-center bg-o-video-ink/30 transition-opacity duration-300 ${
              centreVisible ? 'opacity-100' : 'opacity-0'
            }`}
          >
            <div
              className={`flex items-center ${compact ? 'gap-8' : 'gap-12'} ${
                centreVisible && !chromeLocked
                  ? 'pointer-events-auto'
                  : 'pointer-events-none'
              }`}
            >
              {renderTransport('center')}
            </div>
          </div>
        )}

        {/* 底部控制栏 */}
        <div
          // 渐变背景和上方留白只是装饰，不接收点击（交给画面：单击 / 双击照常），
          // 只有里面的进度条和按钮可点
          className={`pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-o-video-ink/[0.88] to-transparent transition-opacity duration-300 ${
            compact ? 'px-3 pb-2 pt-10' : 'px-6 pb-[18px] pt-[72px]'
          } ${showChrome ? 'opacity-100' : 'opacity-0'}`}
        >
          <div
            className={
              isLoading || phase === 'error'
                ? 'pointer-events-none opacity-40'
                : showChrome && !chromeLocked
                ? 'pointer-events-auto'
                : ''
            }
            onPointerEnter={() => {
              pointerOverControlsRef.current = true;
            }}
            onPointerLeave={() => {
              pointerOverControlsRef.current = false;
            }}
          >
            <PlayerTimeline
              currentTime={currentTime}
              duration={duration}
              bufferedEnd={bufferedEnd}
              compact={compact}
              disabled={phase !== 'ready'}
              onSeek={seek}
              onScrubChange={setScrubbing}
              preview={compact ? undefined : preview}
              label={t.seekBar}
            />

            <div
              className={`flex items-center ${
                compact ? 'mt-1.5 gap-0.5' : 'mt-3 gap-1.5'
              }`}
            >
              {!touchLayout && renderTransport('bar')}

              {!compact && (
                <VolumeControl
                  icon={<VolumeIcon size={18} strokeWidth={2.75} />}
                  volume={muted ? 0 : volume}
                  muteLabel={muted ? t.unmute : t.mute}
                  sliderLabel={t.volume}
                  onToggleMute={() => {
                    const video = videoRef.current;
                    if (!video) return;
                    if (video.muted || video.volume === 0) {
                      applyVolume(video.volume || 0.7, false);
                    } else {
                      video.muted = true;
                    }
                  }}
                  onChange={(v) => applyVolume(v, v === 0)}
                />
              )}

              <span
                className={`font-semibold tabular-nums ${
                  compact ? 'ml-1.5 text-xs' : 'ml-3.5 text-sm'
                }`}
              >
                {formatClock(currentTime)}{' '}
                <span className='opacity-60'>/ {formatClock(duration)}</span>
              </span>

              <span className='flex-1' />

              {/* 下一集：只在全屏时出现。平时换集用页面上的选集列表 / 「下一集」卡片，
                  全屏后它们都看不到，触屏又没有 Alt + → */}
              {isFullscreen && props.hasNext && (
                <button
                  type='button'
                  className={iconBtn}
                  onClick={props.onNext}
                  title={t.nextEpisode}
                  aria-label={t.nextEpisode}
                >
                  <SkipForward
                    size={iconSize}
                    className='fill-current'
                    strokeWidth={2.75}
                  />
                </button>
              )}

              {/* 倍速 */}
              <div className='relative'>
                <button
                  type='button'
                  onClick={() => setMenu(menu === 'speed' ? null : 'speed')}
                  title={t.playbackSpeed}
                  aria-label={t.playbackSpeed}
                  aria-expanded={menu === 'speed'}
                  className={`flex items-center gap-1.5 rounded-full border border-o-video-paper/35 font-bold transition-colors hover:bg-o-video-paper/[0.14] ${
                    compact
                      ? 'h-7 px-2.5 text-xs'
                      : 'h-[34px] px-3.5 text-[13px]'
                  }`}
                >
                  {!compact && <Gauge size={15} strokeWidth={2.75} />}
                  {rate}×
                </button>
                {menu === 'speed' && (
                  <PopoverMenu boundsRef={containerRef}>
                    {PLAYBACK_RATES.map((r) => (
                      <MenuRow
                        key={r}
                        onClick={() => {
                          applyRate(r);
                          setMenu(null);
                        }}
                        active={r === rate}
                      >
                        {r}×
                      </MenuRow>
                    ))}
                  </PopoverMenu>
                )}
              </div>

              {!compact && airplayAvailable && (
                <button
                  type='button'
                  className={iconBtn}
                  title={t.airplay}
                  aria-label={t.airplay}
                  onClick={() =>
                    (
                      videoRef.current as any
                    )?.webkitShowPlaybackTargetPicker?.()
                  }
                >
                  <Airplay size={18} strokeWidth={2.75} />
                </button>
              )}

              {!compact && pipSupported && (
                <button
                  type='button'
                  className={iconBtn}
                  title={t.pip}
                  aria-label={t.pip}
                  onClick={togglePip}
                >
                  <PictureInPicture2 size={18} strokeWidth={2.75} />
                </button>
              )}

              {/* 设置 */}
              <div className='relative'>
                <button
                  type='button'
                  className={iconBtn}
                  title={t.settings}
                  aria-label={t.settings}
                  aria-expanded={menu === 'settings'}
                  onClick={() =>
                    setMenu(menu === 'settings' ? null : 'settings')
                  }
                >
                  <Settings2 size={iconSize} strokeWidth={2.75} />
                </button>
                {menu === 'settings' && (
                  <PopoverMenu
                    wide
                    boundsRef={containerRef}
                    pageKey={settingsPage}
                  >
                    {renderSettings()}
                  </PopoverMenu>
                )}
              </div>

              <button
                type='button'
                className={iconBtn}
                title={isFullscreen ? t.exitFullscreen : t.fullscreen}
                aria-label={isFullscreen ? t.exitFullscreen : t.fullscreen}
                onClick={toggleFullscreen}
              >
                {isFullscreen ? (
                  <Minimize size={iconSize} strokeWidth={2.75} />
                ) : (
                  <Maximize size={iconSize} strokeWidth={2.75} />
                )}
              </button>
            </div>
          </div>
        </div>

        {children}
      </div>
    );
  }
);

export default VideoPlayer;

// -------------------------------------------------------------------------
// 子组件
// -------------------------------------------------------------------------

function SwitchingCard({
  compact,
  title,
  subtitle,
  showStopStep,
  manifestLoaded,
  resumeLabel,
}: {
  compact: boolean;
  title: string;
  subtitle?: string;
  showStopStep: boolean;
  manifestLoaded: boolean;
  resumeLabel: string;
}) {
  const { t } = useI18n();
  return (
    <div
      role='status'
      aria-live='polite'
      className={`pointer-events-none mx-4 flex max-w-[calc(100%-32px)] animate-o-pop flex-col rounded-[32px] bg-[rgb(46_43_37/0.92)] text-o-video-paper shadow-o-lg ${
        compact ? 'w-[320px] gap-3 p-4' : 'w-[400px] gap-4 p-7'
      }`}
    >
      <div className='flex items-center gap-3.5'>
        <span
          className={`flex flex-none items-center justify-center rounded-full bg-o-accent text-o-video-paper ${
            compact ? 'h-10 w-10' : 'h-12 w-12'
          }`}
        >
          <Loader2
            size={compact ? 18 : 22}
            className='animate-spin'
            strokeWidth={2.75}
          />
        </span>
        <div className='min-w-0'>
          <div
            className={`font-heading leading-[1.15] ${
              compact ? 'text-lg' : 'text-[22px]'
            }`}
          >
            {title}
          </div>
          {subtitle && (
            <div className='truncate text-sm opacity-75'>{subtitle}</div>
          )}
        </div>
      </div>
      {!compact && (
        <div className='flex flex-col gap-2.5 text-sm'>
          {showStopStep && <Step state='done'>{t.stepStop}</Step>}
          <Step state={manifestLoaded ? 'done' : 'active'}>
            {manifestLoaded ? t.stepFetch : t.stepFetching}
          </Step>
          <Step
            state={manifestLoaded ? 'active' : 'pending'}
            trailing={resumeLabel}
          >
            {t.stepBuffer}
          </Step>
        </div>
      )}
    </div>
  );
}

function Step({
  state,
  children,
  trailing,
}: {
  state: 'done' | 'active' | 'pending';
  children: ReactNode;
  trailing?: string;
}) {
  return (
    <div className='flex items-center gap-2.5'>
      {state === 'done' ? (
        <span className='flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full bg-[rgb(122_138_94)]'>
          <Check size={13} strokeWidth={3} />
        </span>
      ) : state === 'active' ? (
        <span className='flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full border-2 border-[rgb(246_160_107)] text-[rgb(246_160_107)]'>
          <Loader2 size={12} className='animate-spin' strokeWidth={3} />
        </span>
      ) : (
        <span className='h-[22px] w-[22px] flex-none rounded-full border-2 border-o-video-paper/30' />
      )}
      <span className={state === 'pending' ? 'opacity-60' : ''}>
        {children}
      </span>
      {trailing && (
        <span className='ml-auto tabular-nums opacity-70'>{trailing}</span>
      )}
    </div>
  );
}

function VolumeControl({
  icon,
  volume,
  muteLabel,
  sliderLabel,
  onToggleMute,
  onChange,
}: {
  icon: ReactNode;
  volume: number;
  muteLabel: string;
  sliderLabel: string;
  onToggleMute: () => void;
  onChange: (v: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const valueAt = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || !rect.width) return volume;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  };
  return (
    <span className='ml-1.5 flex items-center gap-2'>
      <button
        type='button'
        onClick={onToggleMute}
        title={muteLabel}
        aria-label={muteLabel}
        className='flex h-8 w-8 items-center justify-center rounded-full transition-colors hover:bg-o-video-paper/[0.14]'
      >
        {icon}
      </button>
      <span
        className='flex h-5 w-[84px] cursor-pointer touch-none items-center'
        role='slider'
        tabIndex={0}
        aria-label={sliderLabel}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(volume * 100)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
            onChange(Math.min(1, volume + 0.1));
          } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
            onChange(Math.max(0, volume - 0.1));
          } else return;
          e.preventDefault();
          e.stopPropagation();
        }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          draggingRef.current = true;
          onChange(valueAt(e.clientX));
        }}
        onPointerMove={(e) => {
          if (draggingRef.current) onChange(valueAt(e.clientX));
        }}
        onPointerUp={() => {
          draggingRef.current = false;
        }}
      >
        <span
          ref={trackRef}
          className='relative h-1.5 w-full rounded-full bg-o-video-paper/[0.22]'
        >
          <span
            className='absolute inset-y-0 left-0 rounded-full bg-o-video-paper'
            style={{ width: `${volume * 100}%` }}
          />
        </span>
      </span>
    </span>
  );
}

/** 菜单与播放器顶部至少留出的距离（px） */
const MENU_TOP_GAP = 8;
const MENU_MAX_HEIGHT = 360;

function PopoverMenu({
  children,
  wide = false,
  boundsRef,
  pageKey,
}: {
  children: ReactNode;
  wide?: boolean;
  /**
   * 多级菜单的当前页。换页时同一个滚动容器换了内容：回到顶部（否则二级页沿用一级的
   * 滚动位置，顶部的返回行可能看不到），并把焦点移到新页的 data-autofocus 元素
   * （点击的行已被卸载，键盘用户的焦点会掉到 body 上）
   */
  pageKey?: string | null;
  /**
   * 播放器容器。它是 overflow-hidden 的，手机竖屏时只有两百多像素高：
   * 菜单按播放器内实际可用高度限高，超出部分在菜单内滚动，而不是被播放器裁掉
   */
  boundsRef: React.RefObject<HTMLElement>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [maxHeight, setMaxHeight] = useState<number>();

  const measure = useCallback(() => {
    const menu = ref.current;
    const bounds = boundsRef.current;
    if (!menu || !bounds) return;
    const available =
      menu.getBoundingClientRect().bottom -
      bounds.getBoundingClientRect().top -
      MENU_TOP_GAP;
    setMaxHeight(Math.max(96, Math.min(MENU_MAX_HEIGHT, available)));
  }, [boundsRef]);

  useLayoutEffect(() => {
    const bounds = boundsRef.current;
    if (!bounds) return;
    measure();
    // 旋转屏幕、进出全屏时播放器尺寸会变
    const ro = new ResizeObserver(measure);
    ro.observe(bounds);
    return () => ro.disconnect();
  }, [boundsRef, measure]);

  const firstPage = useRef(true);
  useLayoutEffect(() => {
    if (firstPage.current) {
      firstPage.current = false;
      return;
    }
    const menu = ref.current;
    if (!menu) return;
    menu.scrollTop = 0;
    const target =
      menu.querySelector<HTMLElement>('[data-autofocus]') ||
      menu.querySelector<HTMLElement>('button');
    target?.focus({ preventScroll: true });
  }, [pageKey]);

  return (
    <div
      ref={ref}
      role='menu'
      style={{ maxHeight: maxHeight ?? MENU_MAX_HEIGHT }}
      className={`absolute bottom-full right-0 z-30 mb-3 origin-bottom-right animate-o-pop touch-pan-y overflow-y-auto overscroll-contain rounded-[20px] bg-[rgb(46_43_37/0.95)] p-1.5 text-o-video-paper shadow-o-lg ${
        wide ? 'w-64' : 'w-28'
      }`}
      onPointerUp={(e) => e.stopPropagation()}
      // 弹出动画的起始帧带 translateY，首次测量的底边偏低几像素：动画结束后再量一次
      onAnimationEnd={measure}
    >
      {children}
    </div>
  );
}

function MenuRow({
  children,
  onClick,
  active = false,
  trailing,
  role = 'menuitem',
  checked,
  hasPopup = false,
  autoFocus = false,
}: {
  children: ReactNode;
  onClick: () => void;
  active?: boolean;
  trailing?: ReactNode;
  role?: 'menuitem' | 'menuitemcheckbox';
  checked?: boolean;
  /** 点开进入二级菜单 */
  hasPopup?: boolean;
  /** 菜单换页后获得焦点（见 PopoverMenu 的 pageKey） */
  autoFocus?: boolean;
}) {
  return (
    <button
      type='button'
      role={role}
      aria-checked={role === 'menuitemcheckbox' ? checked : undefined}
      aria-haspopup={hasPopup ? 'menu' : undefined}
      data-autofocus={autoFocus || undefined}
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-[14px] px-3 py-2 text-left text-sm font-semibold transition-colors ${
        active
          ? 'bg-o-accent text-o-video-paper'
          : 'hover:bg-o-video-paper/[0.12]'
      }`}
    >
      <span className='flex-1 truncate'>{children}</span>
      {trailing}
    </button>
  );
}

function Switch({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden='true'
      className={`relative h-5 w-9 flex-none rounded-full transition-colors ${
        checked ? 'bg-[rgb(122_138_94)]' : 'bg-o-video-paper/25'
      }`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-o-video-paper transition-[left] ${
          checked ? 'left-[18px]' : 'left-0.5'
        }`}
      />
    </span>
  );
}

/** YouTube 风格的“10 秒”快退 / 快进图标：环形箭头中间写上秒数 */
function SeekIcon({ dir, size }: { dir: -1 | 1; size: number }) {
  const Icon = dir < 0 ? RotateCcw : RotateCw;
  return (
    <span className='relative flex items-center justify-center'>
      <Icon size={size} strokeWidth={2.25} />
      <span
        className='absolute pt-px font-bold leading-none'
        style={{ fontSize: Math.round(size * 0.36) }}
      >
        {SEEK_STEP}
      </span>
    </span>
  );
}
