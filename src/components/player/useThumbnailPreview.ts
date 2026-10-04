'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  AttachedStream,
  attachStream,
  HlsModule,
  teardownStream,
} from '@/lib/player/engine';

/**
 * 时间轴悬停缩略图：第一次悬停时才在一个静音、永不播放的隐藏 video 上
 * 加载同一路流（低码率、极小缓冲），定位到悬停时间后把画面画到 canvas。
 * 源变化或组件卸载时彻底销毁，不会产生声音也不会残留下载。
 */
export function useThumbnailPreview(
  src: string,
  Hls: HlsModule | null,
  blockAd: boolean,
  enabled: boolean
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<AttachedStream | null>(null);
  const genRef = useRef(0);
  const pendingRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const [hasFrame, setHasFrame] = useState(false);

  const destroy = useCallback(() => {
    genRef.current += 1;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    pendingRef.current = null;
    if (videoRef.current) {
      teardownStream(videoRef.current, streamRef.current);
      videoRef.current = null;
    }
    streamRef.current = null;
    setHasFrame(false);
  }, []);

  // 换源 / 换集时丢弃旧的预览流
  useEffect(() => destroy, [src, blockAd, destroy]);

  const draw = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = 320;
    canvas.height = Math.round((320 * video.videoHeight) / video.videoWidth);
    try {
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      setHasFrame(true);
    } catch {
      // ignore
    }
  }, []);

  const ensureVideo = useCallback(() => {
    if (videoRef.current || !src) return videoRef.current;
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'auto';
    video.playsInline = true;
    video.crossOrigin = 'anonymous';
    const gen = ++genRef.current;
    streamRef.current = attachStream(video, src, {
      Hls,
      blockAd,
      lightweight: true,
      isCurrent: () => gen === genRef.current,
    });
    video.addEventListener('seeked', () => {
      if (gen !== genRef.current) return;
      draw();
      const next = pendingRef.current;
      pendingRef.current = null;
      if (next !== null && Math.abs(next - video.currentTime) > 1) {
        video.currentTime = next;
      }
    });
    video.addEventListener('loadedmetadata', () => {
      if (gen !== genRef.current) return;
      const next = pendingRef.current;
      pendingRef.current = null;
      if (next !== null) video.currentTime = next;
    });
    videoRef.current = video;
    return video;
  }, [src, Hls, blockAd, draw]);

  /** 悬停到某个时间点时调用（内部做了节流） */
  const requestFrame = useCallback(
    (time: number) => {
      if (!enabled || !src) return;
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        const video = ensureVideo();
        if (!video) return;
        if (video.readyState < 1 || video.seeking) {
          pendingRef.current = time;
          return;
        }
        video.currentTime = time;
      }, 120);
    },
    [enabled, src, ensureVideo]
  );

  return { canvasRef, hasFrame, requestFrame };
}
