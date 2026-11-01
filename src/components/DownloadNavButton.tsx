'use client';

import { Download } from 'lucide-react';

import { useDownloadBadge } from '@/lib/hooks/useDownloads';

import { useI18n } from './LanguageProvider';

export const SHOW_DOWNLOADS_EVENT = 'showDownloadManager';

export function openDownloadManager() {
  window.dispatchEvent(new Event(SHOW_DOWNLOADS_EVENT));
}

/** 导航栏的下载按钮：未完成任务数角标 + 正在下载时的环形总进度 */
export function DownloadNavButton({
  compact = false,
}: {
  /** 移动端顶栏：更小、无边框 */
  compact?: boolean;
}) {
  const { t } = useI18n();
  const { count, progress } = useDownloadBadge();
  const maxBadge = compact ? 9 : 99;
  const downloading = progress >= 0;
  const label =
    count > 0 ? `${t.downloadManager} (${count})` : t.downloadManager;
  // r=19 的圆周长
  const circumference = 2 * Math.PI * 19;

  return (
    <button
      type='button'
      onClick={openDownloadManager}
      className={`relative flex flex-none items-center justify-center rounded-full transition-colors hover:bg-o-ink/[0.07] active:bg-o-ink/[0.14] ${
        compact ? 'h-9 w-9' : 'h-10 w-10 border border-o-divider'
      }`}
      title={label}
      aria-label={label}
    >
      {downloading && (
        <svg
          className='pointer-events-none absolute -inset-px -rotate-90'
          viewBox='0 0 40 40'
          aria-hidden='true'
        >
          <circle
            cx='20'
            cy='20'
            r='19'
            fill='none'
            stroke='currentColor'
            strokeWidth='2'
            strokeLinecap='round'
            className='text-o-accent transition-[stroke-dashoffset] duration-500'
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - Math.max(progress, 3) / 100)}
          />
        </svg>
      )}
      <Download
        className={`h-[18px] w-[18px] ${downloading ? 'text-o-accent' : ''}`}
        strokeWidth={2.75}
      />
      {count > 0 && (
        <span
          className={`absolute flex items-center justify-center rounded-full bg-o-accent px-1 font-bold text-o-on-accent ${
            compact
              ? '-right-0.5 -top-0.5 h-4 min-w-4 text-[10px]'
              : '-right-1 -top-1 h-5 min-w-5 text-[11px]'
          }`}
        >
          {count > maxBadge ? `${maxBadge}+` : count}
        </span>
      )}
    </button>
  );
}
