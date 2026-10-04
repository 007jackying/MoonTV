'use client';

import { RefObject, useEffect, useRef } from 'react';

import { DanmakuItem, fetchDanmaku, lowerBound } from '@/lib/player/danmaku';

interface DanmakuLayerProps {
  videoRef: RefObject<HTMLVideoElement>;
  /** 弹幕地址；变化时重新加载，为空时清空 */
  url: string | null;
  visible: boolean;
  /** 换源 / 换集期间暂停发射 */
  active: boolean;
  compact?: boolean;
}

const SCROLL_SECONDS = 8;
const FIXED_SECONDS = 4;

/**
 * 弹幕层：按视频时间发射弹幕，使用 Web Animations 滚动，
 * 视频暂停时一起暂停。DOM 由本组件直接管理，避免每条弹幕触发 React 渲染。
 */
export default function DanmakuLayer({
  videoRef,
  url,
  visible,
  active,
  compact = false,
}: DanmakuLayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef<DanmakuItem[]>([]);
  const cursorRef = useRef(0);
  const lastTimeRef = useRef(0);
  const lanesRef = useRef<{
    scroll: number[];
    top: number[];
    bottom: number[];
  }>({ scroll: [], top: [], bottom: [] });
  const animationsRef = useRef<Set<Animation>>(new Set());

  const clearScreen = () => {
    animationsRef.current.forEach((a) => a.cancel());
    animationsRef.current.clear();
    if (containerRef.current) containerRef.current.innerHTML = '';
    lanesRef.current = { scroll: [], top: [], bottom: [] };
  };

  // 加载弹幕
  useEffect(() => {
    itemsRef.current = [];
    cursorRef.current = 0;
    clearScreen();
    if (!url) return;
    const controller = new AbortController();
    fetchDanmaku(url, controller.signal)
      .then((items) => {
        if (controller.signal.aborted) return;
        itemsRef.current = items;
        const t = videoRef.current?.currentTime || 0;
        cursorRef.current = lowerBound(items, t);
        lastTimeRef.current = t;
      })
      .catch((err) => {
        if ((err as Error)?.name !== 'AbortError') {
          // eslint-disable-next-line no-console
          console.warn('加载弹幕失败:', err);
        }
      });
    return () => controller.abort();
  }, [url, videoRef]);

  // 隐藏或停用时清屏
  useEffect(() => {
    if (!visible || !active) clearScreen();
  }, [visible, active]);

  // 发射循环（没有弹幕地址时不启动 rAF，避免空转）
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !url) return;

    const fontSize = compact ? 16 : 24;
    const lineHeight = Math.round(fontSize * 1.35);

    const emit = (item: DanmakuItem) => {
      const container = containerRef.current;
      if (!container) return;
      const width = container.clientWidth;
      const height = container.clientHeight;
      // 滚动弹幕只占上方 75%，避免挡住字幕
      const scrollRows = Math.max(
        1,
        Math.floor((height * 0.75 - 10) / lineHeight)
      );
      const fixedRows = Math.max(1, Math.floor((height * 0.4) / lineHeight));
      const now = performance.now();

      const el = document.createElement('div');
      el.textContent = item.text;
      el.style.cssText = `position:absolute;left:0;white-space:pre;font-size:${fontSize}px;line-height:${lineHeight}px;font-weight:700;color:${item.color};text-shadow:0 0 2px rgba(0,0,0,.9),0 1px 3px rgba(0,0,0,.6);will-change:transform;pointer-events:none;`;
      container.appendChild(el);
      const textWidth = el.offsetWidth;

      const lanes = lanesRef.current;
      let row = -1;
      if (item.mode === 0) {
        // 找一条前一条弹幕已经完全进入画面的轨道
        for (let i = 0; i < scrollRows; i++) {
          if ((lanes.scroll[i] || 0) <= now) {
            row = i;
            break;
          }
        }
        if (row < 0) {
          el.remove();
          return;
        }
        const speed = (width + textWidth) / (SCROLL_SECONDS * 1000);
        lanes.scroll[row] = now + (textWidth + 24) / speed;
        el.style.top = `${10 + row * lineHeight}px`;
        const anim = el.animate(
          [
            { transform: `translateX(${width}px)` },
            { transform: `translateX(${-textWidth}px)` },
          ],
          { duration: SCROLL_SECONDS * 1000, easing: 'linear' }
        );
        track(anim, el);
      } else {
        const key = item.mode === 1 ? 'top' : 'bottom';
        for (let i = 0; i < fixedRows; i++) {
          if ((lanes[key][i] || 0) <= now) {
            row = i;
            break;
          }
        }
        if (row < 0) {
          el.remove();
          return;
        }
        lanes[key][row] = now + FIXED_SECONDS * 1000;
        el.style.left = '50%';
        if (item.mode === 1) el.style.top = `${10 + row * lineHeight}px`;
        else el.style.bottom = `${10 + row * lineHeight}px`;
        const anim = el.animate(
          [
            { transform: 'translateX(-50%)', opacity: 1 },
            { transform: 'translateX(-50%)', opacity: 1 },
          ],
          { duration: FIXED_SECONDS * 1000 }
        );
        track(anim, el);
      }
    };

    const track = (anim: Animation, el: HTMLElement) => {
      animationsRef.current.add(anim);
      if (video.paused) anim.pause();
      anim.onfinish = () => {
        animationsRef.current.delete(anim);
        el.remove();
      };
      anim.oncancel = () => {
        animationsRef.current.delete(anim);
        el.remove();
      };
    };

    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (!visible || !active || video.paused) return;
      const items = itemsRef.current;
      if (!items.length) return;
      const t = video.currentTime;
      const last = lastTimeRef.current;
      // 发生跳转：重新定位，不补发跳过的弹幕
      if (t < last || t - last > 1.5) {
        cursorRef.current = lowerBound(items, t);
        lastTimeRef.current = t;
        return;
      }
      let i = cursorRef.current;
      let emitted = 0;
      while (i < items.length && items[i].time <= t) {
        if (items[i].time > last - 0.05 && emitted < 30) {
          emit(items[i]);
          emitted += 1;
        }
        i += 1;
      }
      cursorRef.current = i;
      lastTimeRef.current = t;
    };
    raf = requestAnimationFrame(tick);

    const pauseAll = () => animationsRef.current.forEach((a) => a.pause());
    const playAll = () => animationsRef.current.forEach((a) => a.play());
    const onSeeking = () => {
      clearScreen();
      cursorRef.current = lowerBound(itemsRef.current, video.currentTime);
      lastTimeRef.current = video.currentTime;
    };
    video.addEventListener('pause', pauseAll);
    video.addEventListener('waiting', pauseAll);
    video.addEventListener('playing', playAll);
    video.addEventListener('seeking', onSeeking);

    return () => {
      cancelAnimationFrame(raf);
      video.removeEventListener('pause', pauseAll);
      video.removeEventListener('waiting', pauseAll);
      video.removeEventListener('playing', playAll);
      video.removeEventListener('seeking', onSeeking);
    };
  }, [videoRef, url, visible, active, compact]);

  useEffect(() => clearScreen, []);

  return (
    <div
      ref={containerRef}
      aria-hidden='true'
      className={`pointer-events-none absolute inset-0 overflow-hidden ${
        visible ? '' : 'hidden'
      }`}
    />
  );
}
