/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps */
'use client';

import {
  Airplay,
  Check,
  Gauge,
  Loader2,
  Maximize,
  Minimize,
  Pause,
  PictureInPicture2,
  Play,
  Settings2,
  SkipBack,
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
  hasPrev: boolean;
  hasNext: boolean;
  nextLabel?: string;
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
      hasPrev,
      hasNext,
      nextLabel,
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
          case 'ArrowLeft':
            if (video.currentTime > 5) seek(video.currentTime - 10);
            e.preventDefault();
            break;
          case 'ArrowRight':
            if (video.currentTime < (video.duration || 0) - 5) {
              seek(video.currentTime + 10);
            }
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
      seek,
      applyVolume,
      togglePlay,
      toggleFullscreen,
      showNotice,
      revealControls,
      t,
    ]);

    // ---------------------------------------------------------------------
    // 画面上的点击 / 触摸：桌面单击暂停、双击全屏；触屏单击显隐控制栏、双击暂停、长按 3 倍速
    // ---------------------------------------------------------------------
    const lastTapRef = useRef(0);
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
        if (now - lastTapRef.current < 300) {
          togglePlay();
          lastTapRef.current = 0;
        } else {
          lastTapRef.current = now;
          if (controlsVisible && !paused) setControlsVisible(false);
          else revealControls();
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
          onDoubleClick={() => {
            // 触屏的双击已用于暂停 / 播放
            if (lastPointerTypeRef.current !== 'touch') toggleFullscreen();
          }}
        />

        {/* 缓冲中 */}
        {phase === 'ready' && waiting && !paused && (
          <div className='pointer-events-none absolute inset-0 flex items-center justify-center'>
            <span className='flex h-14 w-14 items-center justify-center rounded-full bg-o-video-ink/60'>
              <Loader2 className='h-7 w-7 animate-spin' strokeWidth={2.75} />
            </span>
          </div>
        )}

        {/* 自动播放被拦截时的大播放按钮 */}
        {phase === 'ready' && paused && autoplayBlocked && (
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

        {/* 底部控制栏 */}
        <div
          className={`absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-o-video-ink/[0.88] to-transparent transition-opacity duration-300 ${
            compact ? 'px-3 pb-2 pt-10' : 'px-6 pb-[18px] pt-[72px]'
          } ${showChrome ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
          onPointerEnter={() => {
            pointerOverControlsRef.current = true;
          }}
          onPointerLeave={() => {
            pointerOverControlsRef.current = false;
          }}
        >
          <div
            className={
              isLoading || phase === 'error'
                ? 'pointer-events-none opacity-40'
                : ''
            }
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
              <button
                type='button'
                className={`${iconBtn} disabled:opacity-40`}
                onClick={props.onPrev}
                disabled={!hasPrev}
                title={t.prevEpisode}
                aria-label={t.prevEpisode}
              >
                <SkipBack
                  size={iconSize}
                  className='fill-current'
                  strokeWidth={2.75}
                />
              </button>
              <button
                type='button'
                onClick={togglePlay}
                title={paused ? t.play : t.pause}
                aria-label={paused ? t.play : t.pause}
                className={`flex flex-none items-center justify-center rounded-full bg-o-accent text-o-video-paper transition-colors hover:bg-o-accent-600 ${
                  compact ? 'h-10 w-10' : 'h-12 w-12'
                }`}
              >
                {paused ? (
                  <Play
                    size={compact ? 17 : 20}
                    className='ml-0.5 fill-current'
                    strokeWidth={2.75}
                  />
                ) : (
                  <Pause
                    size={compact ? 17 : 20}
                    className='fill-current'
                    strokeWidth={2.75}
                  />
                )}
              </button>
              <div className='group/next relative'>
                <button
                  type='button'
                  className={`${iconBtn} disabled:opacity-40`}
                  onClick={props.onNext}
                  disabled={!hasNext}
                  aria-label={t.nextEpisode}
                >
                  <SkipForward
                    size={iconSize}
                    className='fill-current'
                    strokeWidth={2.75}
                  />
                </button>
                {!compact && hasNext && nextLabel && (
                  <span className='pointer-events-none absolute bottom-[50px] left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-o-video-paper px-3 py-[5px] text-xs font-semibold text-o-video-ink opacity-0 transition-opacity group-hover/next:opacity-100'>
                    {t.nextEpisodeLabel(nextLabel)}
                  </span>
                )}
              </div>

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
                  <PopoverMenu>
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
                  <PopoverMenu wide>
                    {settings.map((item) =>
                      item.kind === 'toggle' ? (
                        <MenuRow
                          key={item.id}
                          onClick={() => item.onChange(!item.checked)}
                          trailing={<Switch checked={item.checked} />}
                        >
                          {item.label}
                        </MenuRow>
                      ) : (
                        <MenuRow
                          key={item.id}
                          onClick={() => {
                            item.onSelect();
                          }}
                          trailing={
                            item.hint ? (
                              <span className='max-w-[9rem] truncate text-xs opacity-70'>
                                {item.hint}
                              </span>
                            ) : undefined
                          }
                        >
                          {item.label}
                        </MenuRow>
                      )
                    )}
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

function PopoverMenu({
  children,
  wide = false,
}: {
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      role='menu'
      className={`absolute bottom-full right-0 z-30 mb-3 origin-bottom-right animate-o-pop max-h-[min(60vh,360px)] overflow-y-auto rounded-[20px] bg-[rgb(46_43_37/0.95)] p-1.5 text-o-video-paper shadow-o-lg ${
        wide ? 'w-64' : 'w-28'
      }`}
      onPointerUp={(e) => e.stopPropagation()}
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
}: {
  children: ReactNode;
  onClick: () => void;
  active?: boolean;
  trailing?: ReactNode;
}) {
  return (
    <button
      type='button'
      role='menuitem'
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
