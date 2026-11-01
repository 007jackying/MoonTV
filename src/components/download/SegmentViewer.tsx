'use client';

import { List, RefreshCw } from 'lucide-react';
import { useMemo } from 'react';

import { getTaskDetail, resumeTask } from '@/lib/download-store';
import { formatTime } from '@/lib/formatTime';
import { useDownloadTasks } from '@/lib/hooks/useDownloads';

import { DownloadDialog } from './DownloadDialog';
import { useI18n } from '../LanguageProvider';

const TILE: Record<string, string> = {
  success: 'bg-o-sage-500',
  error: 'bg-red-500',
  downloading: 'bg-o-accent animate-pulse',
  '': 'bg-o-neutral-300',
};

/** 片段一览：每个片段一个色块，悬停显示序号和时间点 */
export default function SegmentViewer({
  taskId,
  onClose,
}: {
  taskId: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  // 订阅任务列表：进度变化时重渲染，读取最新的片段状态
  const view = useDownloadTasks().find((task) => task.id === taskId);
  const detail = getTaskDetail(taskId);

  const range = detail?.rangeDownload;
  const starts = useMemo(() => {
    if (!detail) return [];
    const out: number[] = [];
    let acc = 0;
    for (const d of detail.segmentDurations) {
      out.push(acc);
      acc += d;
    }
    return out;
  }, [detail]);

  if (!view) return null;

  const segments =
    detail && range
      ? detail.finishList
          .slice(range.startSegment - 1, range.endSegment)
          .map((s, i) => ({
            index: range.startSegment - 1 + i,
            status: s.status,
          }))
      : [];
  const counts = { success: 0, error: 0, downloading: 0, '': 0 };
  segments.forEach((s) => counts[s.status]++);
  const canRetry =
    view.status === 'incomplete' ||
    (view.status === 'error' && view.config.streamMode === 'disabled');

  const legend: Array<[keyof typeof counts, string]> = [
    ['success', t.dl.legendSuccess],
    ['error', t.dl.legendError],
    ['downloading', t.dl.legendDownloading],
    ['', t.dl.legendPending],
  ];

  return (
    <DownloadDialog
      onClose={onClose}
      title={t.dl.segmentsTitle}
      subtitle={view.title}
      icon={<List className='h-[18px] w-[18px]' strokeWidth={2.5} />}
      closeLabel={t.dl.close}
      size='lg'
      layer={2}
      toolbar={
        <div className='flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]'>
          {legend.map(([key, label]) => (
            <span
              key={key || 'pending'}
              className='inline-flex items-center gap-1.5'
            >
              <span
                className={`h-2.5 w-2.5 rounded-sm ${TILE[key].replace(
                  ' animate-pulse',
                  ''
                )}`}
              />
              {label}
              <span className='tabular-nums text-o-neutral-700'>
                {counts[key]}
              </span>
            </span>
          ))}
        </div>
      }
      footer={
        canRetry ? (
          <div className='flex justify-end'>
            <button
              type='button'
              className='o-btn o-btn-primary'
              onClick={() => {
                void resumeTask(taskId);
                onClose();
              }}
            >
              <RefreshCw className='h-4 w-4' strokeWidth={2.5} />
              {t.dl.retryFailed}
            </button>
          </div>
        ) : undefined
      }
    >
      {segments.length === 0 ? (
        <p className='py-8 text-center text-sm text-o-neutral-700'>
          {t.dl.noDetail}
        </p>
      ) : (
        <ul
          className='m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(14px,1fr))] gap-1 p-0'
          aria-label={t.dl.segmentsTitle}
        >
          {segments.map((s) => {
            const label = t.dl.segmentTip(
              s.index + 1,
              formatTime(starts[s.index] ?? 0)
            );
            return (
              <li
                key={s.index}
                title={label}
                aria-label={label}
                className={`aspect-square rounded-[3px] ${TILE[s.status]}`}
              />
            );
          })}
        </ul>
      )}
    </DownloadDialog>
  );
}
