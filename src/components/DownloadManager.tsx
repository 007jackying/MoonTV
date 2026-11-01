'use client';

import {
  AlertCircle,
  CheckCircle2,
  Download,
  Info,
  List,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Save,
  Trash2,
} from 'lucide-react';
import { memo, useState } from 'react';

import {
  clearAll,
  clearCompleted,
  DownloadTaskView,
  pauseAll,
  pauseTask,
  removeTask,
  resumeAll,
  resumeTask,
  saveNow,
} from '@/lib/download-store';
import { formatTime } from '@/lib/formatTime';
import { useDownloadTasks } from '@/lib/hooks/useDownloads';
import type { Messages } from '@/lib/i18n';

import AddDownloadModal from './AddDownloadModal';
import { confirmAction, toast } from './download/confirm';
import { DownloadDialog, formatBytes, Tag } from './download/DownloadDialog';
import SegmentViewer from './download/SegmentViewer';
import { useI18n } from './LanguageProvider';

type Status = DownloadTaskView['status'];

const BAR: Record<Status, string> = {
  queued: 'bg-o-neutral-400',
  preparing: 'bg-o-accent/60',
  downloading: 'bg-o-accent',
  paused: 'bg-o-neutral-500',
  merging: 'bg-o-accent',
  completed: 'bg-o-sage-500',
  incomplete: 'bg-red-500',
  error: 'bg-red-500',
};

const PILL: Record<Status, 'neutral' | 'accent' | 'sage' | 'danger'> = {
  queued: 'neutral',
  preparing: 'accent',
  downloading: 'accent',
  paused: 'neutral',
  merging: 'accent',
  completed: 'sage',
  incomplete: 'danger',
  error: 'danger',
};

/** 有数据会因删除而丢失的状态，删除前需要确认 */
const NEEDS_DELETE_CONFIRM: Status[] = [
  'queued',
  'preparing',
  'downloading',
  'paused',
  'merging',
  'incomplete',
];

function percentOf(task: DownloadTaskView): number {
  if (task.status === 'completed') return 100;
  if (task.status === 'merging') return task.mergePercent;
  return task.total > 0 ? Math.floor((task.done / task.total) * 100) : 0;
}

const ICON_BTN =
  'o-btn o-btn-secondary o-btn-icon !h-9 !w-9 flex-none disabled:opacity-40';

const TaskCard = memo(function TaskCard({
  task,
  t,
  onShowSegments,
}: {
  task: DownloadTaskView;
  t: Messages;
  onShowSegments: (id: string) => void;
}) {
  const { status } = task;
  const percent = percentOf(task);
  const running = status === 'downloading' || status === 'preparing';
  const memoryMode = task.config.streamMode === 'disabled';
  const canSaveNow = (running || status === 'paused') && task.done > 0;

  const handleDelete = async () => {
    if (
      NEEDS_DELETE_CONFIRM.includes(status) &&
      !(await confirmAction({
        title: t.dl.confirmDelete,
        text: t.dl.confirmDeleteText,
        confirmText: t.delete,
        cancelText: t.cancel,
      }))
    ) {
      return;
    }
    removeTask(task.id);
  };

  // 需要重新选择保存位置 / 允许访问文件夹时，这次点击里会弹出浏览器的窗口
  const resume = () =>
    void resumeTask(task.id).then((result) => {
      if (result && !result.ok) {
        void toast({
          icon: 'error',
          title: task.config.folder
            ? t.dl.folderDenied
            : result.reason === 'cancelled'
            ? t.dl.pickerCancelled
            : result.message,
        });
      }
    });

  const handleSaveNow = async () => {
    if (
      await confirmAction({
        title: t.dl.confirmSaveNow,
        text: t.dl.confirmSaveNowText,
        confirmText: t.dl.confirm,
        cancelText: t.cancel,
      })
    ) {
      void saveNow(task.id);
    }
  };

  // 主操作
  let primary: {
    label: string;
    icon: JSX.Element;
    onClick: () => void;
  } | null = null;
  if (running || status === 'queued') {
    primary = {
      label: t.dl.pause,
      icon: <Pause className='h-4 w-4' strokeWidth={2.5} />,
      onClick: () => pauseTask(task.id),
    };
  } else if (status === 'paused') {
    primary = {
      label: t.dl.resume,
      icon: <Play className='h-4 w-4' strokeWidth={2.5} />,
      // 需要重新选择保存位置时，保存框必须在这次点击里弹出
      onClick: resume,
    };
  } else if (status === 'incomplete') {
    primary = {
      label: t.dl.retryFailed,
      icon: <RefreshCw className='h-4 w-4' strokeWidth={2.5} />,
      onClick: resume,
    };
  } else if (status === 'error') {
    primary = {
      label: t.dl.retry,
      icon: <RefreshCw className='h-4 w-4' strokeWidth={2.5} />,
      onClick: resume,
    };
  }

  // 状态下方的说明
  const notes: Array<{ tone: 'info' | 'error' | 'ok'; text: string }> = [];
  if (status === 'error' && task.error) {
    const known = t.dl.errors[task.error.code as keyof typeof t.dl.errors];
    notes.push({
      tone: 'error',
      text:
        known && task.error.code !== 'unknown'
          ? task.error.code === 'http'
            ? `${known} (${task.error.message})`
            : known
          : task.error.message || t.dl.errors.unknown,
    });
  }
  if (status === 'incomplete')
    notes.push({ tone: 'error', text: t.dl.incompleteHint });
  if (task.needsGesture && status === 'paused')
    notes.push({
      tone: 'info',
      text: task.config.folder ? t.dl.needsFolderAccess : t.dl.needsGesture,
    });
  else if (task.restored && status !== 'completed')
    notes.push({ tone: 'info', text: t.dl.restoredNote });
  if (task.notice === 'sw-fallback')
    notes.push({ tone: 'info', text: t.dl.swFallback });
  if (task.notice === 'saved-as-ts')
    notes.push({ tone: 'info', text: t.dl.savedAsTs });
  if (status === 'completed') {
    notes.push({
      tone: 'ok',
      text:
        task.folderName && task.savedName
          ? t.dl.savedFolder(task.folderName, task.savedName)
          : task.config.streamMode === 'file-system'
          ? t.dl.savedDisk
          : t.dl.savedBrowser,
    });
  }

  const format = task.savedFormat ?? task.config.type;
  const meta: string[] = [];
  if (status === 'merging') {
    meta.push(`${task.mergePercent}%`);
  } else if (task.total > 0) {
    meta.push(t.dl.segmentsProgress(task.done, task.total));
  }
  if (task.bytes > 0) meta.push(formatBytes(task.bytes));
  if (task.failed > 0 && status !== 'completed')
    meta.push(t.dl.failedSegments(task.failed));
  if (status === 'completed' && task.skipped > 0)
    meta.push(t.dl.skipped(task.skipped));

  const rate: string[] = [];
  if (status === 'downloading') {
    if (task.speed > 0) rate.push(`${formatBytes(task.speed)}/s`);
    if (task.eta !== null)
      rate.push(t.dl.remaining(formatTime(Math.round(task.eta))));
  }

  const notesList =
    notes.length > 0 ? (
      <ul className='m-0 min-w-0 flex-1 list-none space-y-1 p-0'>
        {notes.map((n) => (
          <li
            key={n.text}
            className={`flex items-start gap-1.5 text-[12.5px] leading-snug ${
              n.tone === 'error'
                ? 'text-red-700 dark:text-red-300'
                : n.tone === 'ok'
                ? 'text-o-sage-700'
                : 'text-o-neutral-700'
            }`}
          >
            {n.tone === 'error' ? (
              <AlertCircle
                className='mt-px h-3.5 w-3.5 flex-none'
                strokeWidth={2.5}
              />
            ) : n.tone === 'ok' ? (
              <CheckCircle2
                className='mt-px h-3.5 w-3.5 flex-none'
                strokeWidth={2.5}
              />
            ) : (
              <Info className='mt-px h-3.5 w-3.5 flex-none' strokeWidth={2.5} />
            )}
            {n.text}
          </li>
        ))}
      </ul>
    ) : (
      <div className='flex-1' />
    );

  const iconButtons = (
    <div className='ml-auto flex flex-none items-center gap-1.5'>
      {canSaveNow && (
        <button
          type='button'
          className={ICON_BTN}
          onClick={handleSaveNow}
          title={t.dl.saveNow}
          aria-label={t.dl.saveNow}
        >
          <Save className='h-4 w-4' strokeWidth={2.5} />
        </button>
      )}
      <button
        type='button'
        className={ICON_BTN}
        onClick={() => onShowSegments(task.id)}
        title={t.dl.segments}
        aria-label={t.dl.segments}
      >
        <List className='h-4 w-4' strokeWidth={2.5} />
      </button>
      <button
        type='button'
        className={`${ICON_BTN} hover:!bg-red-500/10 hover:text-red-600`}
        onClick={handleDelete}
        title={t.delete}
        aria-label={t.delete}
      >
        <Trash2 className='h-4 w-4' strokeWidth={2.5} />
      </button>
    </div>
  );

  return (
    <li className='rounded-[20px] bg-o-surface p-4'>
      <div className='flex items-start gap-3'>
        <div className='min-w-0 flex-1'>
          <h3
            className='m-0 truncate text-[15px] font-semibold leading-snug'
            title={task.title}
          >
            {task.title}
          </h3>
          <div className='mt-1.5 flex flex-wrap items-center gap-1.5'>
            <Tag tone={PILL[status]}>
              {status === 'completed' && (
                <CheckCircle2 className='h-3 w-3' strokeWidth={2.75} />
              )}
              {t.dl.status[status]}
            </Tag>
            <Tag>{format}</Tag>
            <Tag>{t.dl.modes[task.config.streamMode]}</Tag>
            {task.timeRange && (
              <Tag>
                {formatTime(task.timeRange.from)} –{' '}
                {formatTime(task.timeRange.to)}
              </Tag>
            )}
            {task.adsRemoved && task.adsRemoved.segments > 0 && (
              <Tag tone='sage'>
                {t.dl.adsRemoved(Math.round(task.adsRemoved.seconds))}
              </Tag>
            )}
          </div>
        </div>
        <span className='flex-none pt-0.5 text-sm font-semibold tabular-nums text-o-neutral-700'>
          {status === 'queued' || (status === 'preparing' && task.done === 0)
            ? ''
            : `${percent}%`}
        </span>
      </div>

      <div
        className='mt-3 h-1.5 w-full overflow-hidden rounded-full bg-o-ink/10'
        role='progressbar'
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={task.title}
      >
        <div
          className={`h-full rounded-full transition-[width] duration-300 ${
            BAR[status]
          } ${status === 'preparing' ? 'animate-pulse' : ''}`}
          style={{
            width: `${
              status === 'preparing' && percent === 0
                ? 100
                : Math.max(percent, 1)
            }%`,
          }}
        />
      </div>

      <div className='mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[12.5px] tabular-nums text-o-neutral-700'>
        <span>{meta.join(' · ')}</span>
        {rate.length > 0 && <span>{rate.join(' · ')}</span>}
      </div>

      {primary || status === 'incomplete' ? (
        <>
          {notes.length > 0 && <div className='mt-2 flex'>{notesList}</div>}
          <div className='mt-3 flex items-center gap-2'>
            {primary && (
              <button
                type='button'
                className='o-btn o-btn-secondary whitespace-nowrap !py-1.5'
                onClick={primary.onClick}
              >
                {primary.icon}
                {primary.label}
              </button>
            )}
            {status === 'incomplete' && memoryMode && (
              <button
                type='button'
                className='o-btn o-btn-ghost !py-1.5'
                onClick={() => void saveNow(task.id)}
                title={t.dl.saveAnyway}
                aria-label={t.dl.saveAnyway}
              >
                <Save className='h-4 w-4' strokeWidth={2.5} />
                <span className='hidden sm:inline'>{t.dl.saveAnyway}</span>
              </button>
            )}
            {iconButtons}
          </div>
        </>
      ) : (
        // 没有主操作（已完成）时，说明和按钮放在同一行，卡片更紧凑
        <div className='mt-2 flex items-end gap-2'>
          {notesList}
          {iconButtons}
        </div>
      )}
    </li>
  );
});

export default function DownloadManager({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const tasks = useDownloadTasks();
  const [adding, setAdding] = useState(false);
  const [segmentsOf, setSegmentsOf] = useState<string | null>(null);

  const active = tasks.filter((x) =>
    ['queued', 'preparing', 'downloading', 'merging'].includes(x.status)
  ).length;
  const canPauseAll = tasks.some((x) =>
    ['queued', 'preparing', 'downloading'].includes(x.status)
  );
  const canStartAll = tasks.some((x) => ['paused', 'error'].includes(x.status));
  const hasCompleted = tasks.some((x) => x.status === 'completed');
  // 新加入的在最上面；同一批（多集）里按集数顺序
  const ordered = [...tasks].sort(
    (a, b) =>
      (b.addedAt ?? b.createdAt) - (a.addedAt ?? a.createdAt) ||
      a.createdAt - b.createdAt
  );

  const handleClearAll = async () => {
    const unfinished = tasks.some((x) => x.status !== 'completed');
    if (
      unfinished &&
      !(await confirmAction({
        title: t.dl.confirmClearAll,
        text: t.dl.confirmClearAllText,
        confirmText: t.dl.clearAll,
        cancelText: t.cancel,
      }))
    ) {
      return;
    }
    clearAll();
  };

  return (
    <>
      <DownloadDialog
        onClose={onClose}
        title={t.dl.title}
        subtitle={
          tasks.length > 0 ? t.dl.summary(active, tasks.length) : undefined
        }
        icon={<Download className='h-[18px] w-[18px]' strokeWidth={2.5} />}
        closeLabel={t.dl.close}
        size='lg'
        toolbar={
          <div className='flex flex-wrap items-center gap-2'>
            <button
              type='button'
              className='o-btn o-btn-primary'
              onClick={() => setAdding(true)}
            >
              <Plus className='h-4 w-4' strokeWidth={2.75} />
              {t.dl.newDownload}
            </button>
            {tasks.length > 0 && (
              <>
                <button
                  type='button'
                  className='o-btn o-btn-secondary'
                  onClick={resumeAll}
                  disabled={!canStartAll}
                  title={t.dl.startAll}
                  aria-label={t.dl.startAll}
                >
                  <Play className='h-4 w-4' strokeWidth={2.5} />
                  <span className='hidden sm:inline'>{t.dl.startAll}</span>
                </button>
                <button
                  type='button'
                  className='o-btn o-btn-secondary'
                  onClick={pauseAll}
                  disabled={!canPauseAll}
                  title={t.dl.pauseAll}
                  aria-label={t.dl.pauseAll}
                >
                  <Pause className='h-4 w-4' strokeWidth={2.5} />
                  <span className='hidden sm:inline'>{t.dl.pauseAll}</span>
                </button>
                <div className='ml-auto flex items-center gap-1'>
                  {hasCompleted && (
                    <button
                      type='button'
                      className='o-btn o-btn-ghost'
                      onClick={clearCompleted}
                    >
                      {t.dl.clearCompleted}
                    </button>
                  )}
                  <button
                    type='button'
                    className='o-btn o-btn-ghost !text-red-600 hover:!bg-red-500/10 dark:!text-red-400'
                    onClick={handleClearAll}
                  >
                    {t.dl.clearAll}
                  </button>
                </div>
              </>
            )}
          </div>
        }
      >
        {tasks.length === 0 ? (
          <div className='flex flex-col items-center px-6 py-12 text-center'>
            <span className='flex h-14 w-14 items-center justify-center rounded-full bg-o-surface text-o-neutral-700'>
              <Download className='h-6 w-6' strokeWidth={2.25} />
            </span>
            <p className='mb-1 mt-4 font-heading text-lg'>{t.dl.emptyTitle}</p>
            <p className='m-0 max-w-xs text-sm text-o-neutral-700'>
              {t.dl.emptyHint}
            </p>
          </div>
        ) : (
          <ul className='m-0 list-none space-y-3 p-0'>
            {ordered.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                t={t}
                onShowSegments={setSegmentsOf}
              />
            ))}
          </ul>
        )}
      </DownloadDialog>

      {adding && <AddDownloadModal isOpen onClose={() => setAdding(false)} />}
      {segmentsOf && (
        <SegmentViewer
          taskId={segmentsOf}
          onClose={() => setSegmentsOf(null)}
        />
      )}
    </>
  );
}
