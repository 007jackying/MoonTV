'use client';

import { RefObject, useRef, useState } from 'react';

import { formatClock } from '@/lib/player/engine';

interface PlayerTimelineProps {
  currentTime: number;
  duration: number;
  bufferedEnd: number;
  compact?: boolean;
  disabled?: boolean;
  onSeek: (time: number) => void;
  onScrubChange?: (scrubbing: boolean) => void;
  /** 悬停预览（桌面端） */
  preview?: {
    canvasRef: RefObject<HTMLCanvasElement>;
    hasFrame: boolean;
    requestFrame: (time: number) => void;
  };
  label: string;
}

/**
 * 可拖动的时间轴：已播放（主色）、已缓冲、悬停位置三层，
 * 悬停时在上方显示时间与画面预览。
 */
export default function PlayerTimeline({
  currentTime,
  duration,
  bufferedEnd,
  compact = false,
  disabled = false,
  onSeek,
  onScrubChange,
  preview,
  label,
}: PlayerTimelineProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [hoverRatio, setHoverRatio] = useState<number | null>(null);
  const [scrubRatio, setScrubRatio] = useState<number | null>(null);

  const hasDuration = duration > 0 && Number.isFinite(duration);
  const ratioAt = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  };

  const playedRatio =
    scrubRatio ?? (hasDuration ? Math.min(1, currentTime / duration) : 0);
  const bufferedRatio = hasDuration ? Math.min(1, bufferedEnd / duration) : 0;
  const previewRatio = scrubRatio ?? hoverRatio;
  const showPreview = previewRatio !== null;
  // 预览卡片不超出播放器左右边缘
  const edge = compact || !preview?.hasFrame ? 28 : 86;
  const pct = (r: number) => `${(r * 100).toFixed(3)}%`;

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || !hasDuration) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const r = ratioAt(e.clientX);
    setScrubRatio(r);
    onScrubChange?.(true);
    preview?.requestFrame(r * duration);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!hasDuration) return;
    const r = ratioAt(e.clientX);
    if (scrubRatio !== null) {
      setScrubRatio(r);
    } else if (e.pointerType === 'mouse') {
      setHoverRatio(r);
    }
    preview?.requestFrame(r * duration);
  };

  const finishScrub = (
    e: React.PointerEvent<HTMLDivElement>,
    commit: boolean
  ) => {
    if (scrubRatio === null) return;
    const r = ratioAt(e.clientX);
    setScrubRatio(null);
    onScrubChange?.(false);
    if (commit) onSeek(r * duration);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!hasDuration || disabled) return;
    const step = e.shiftKey ? 30 : 5;
    if (e.key === 'ArrowRight') onSeek(Math.min(duration, currentTime + step));
    else if (e.key === 'ArrowLeft') onSeek(Math.max(0, currentTime - step));
    else if (e.key === 'Home') onSeek(0);
    else if (e.key === 'End') onSeek(duration);
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const trackHeight = compact ? 'h-1.5' : 'h-2';
  const thumbSize = compact
    ? 'h-3.5 w-3.5 shadow-[0_0_0_3px_rgb(var(--o-accent))]'
    : 'h-[18px] w-[18px] shadow-[0_0_0_4px_rgb(var(--o-accent))]';

  return (
    <div
      className={`relative flex items-center ${compact ? 'h-4' : 'h-[22px]'} ${
        disabled ? 'pointer-events-none' : 'cursor-pointer'
      } touch-none select-none`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={(e) => finishScrub(e, true)}
      onPointerCancel={(e) => finishScrub(e, false)}
      onPointerLeave={() => setHoverRatio(null)}
      onKeyDown={handleKeyDown}
      role='slider'
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.floor(duration || 0)}
      aria-valuenow={Math.floor(currentTime || 0)}
      aria-valuetext={`${formatClock(currentTime)} / ${formatClock(duration)}`}
    >
      {/* 悬停预览：画面 + 时间（保持挂载，避免丢失已绘制的画面） */}
      {hasDuration && (
        <div
          className={`pointer-events-none absolute flex -translate-x-1/2 flex-col items-center gap-1.5 ${
            showPreview ? 'visible' : 'invisible'
          }`}
          style={{
            left: `clamp(${edge}px, ${pct(
              previewRatio ?? 0
            )}, calc(100% - ${edge}px))`,
            bottom: compact ? 20 : 28,
          }}
        >
          {preview && !compact && (
            <div
              className={`h-[94px] w-[168px] overflow-hidden rounded-[14px] border-2 border-o-video-paper bg-o-neutral-700 shadow-o-lg ${
                preview.hasFrame ? '' : 'hidden'
              }`}
            >
              <canvas
                ref={preview.canvasRef}
                className='h-full w-full object-cover'
              />
            </div>
          )}
          <span className='rounded-full bg-o-video-paper px-2.5 py-[3px] text-[13px] font-bold tabular-nums text-o-video-ink'>
            {formatClock((previewRatio ?? 0) * duration)}
          </span>
        </div>
      )}

      <div
        ref={trackRef}
        className={`relative w-full ${trackHeight} rounded-full bg-o-video-paper/[0.22]`}
      >
        {previewRatio !== null && (
          <div
            className='absolute inset-y-0 left-0 rounded-full bg-o-video-paper/20'
            style={{ width: pct(previewRatio) }}
          />
        )}
        <div
          className='absolute inset-y-0 left-0 rounded-full bg-o-video-paper/30'
          style={{ width: pct(bufferedRatio) }}
        />
        <div
          className='absolute inset-y-0 left-0 rounded-full bg-o-accent'
          style={{ width: pct(playedRatio) }}
        />
        <div
          className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-o-video-paper ${thumbSize}`}
          style={{ left: pct(playedRatio) }}
        />
        {hoverRatio !== null && scrubRatio === null && (
          <div
            className='absolute -bottom-1 -top-1 w-0.5 rounded-sm bg-o-video-paper'
            style={{ left: pct(hoverRatio) }}
          />
        )}
      </div>
    </div>
  );
}
