'use client';

import { useSyncExternalStore } from 'react';

import {
  countUnfinished,
  DownloadTaskView,
  getServerTasks,
  getTasks,
  subscribe,
} from '../download-store';

/** 所有下载任务（进度更新已节流） */
export function useDownloadTasks(): DownloadTaskView[] {
  return useSyncExternalStore(subscribe, getTasks, getServerTasks);
}

const unfinished = () => countUnfinished(getTasks());

/** 正在下载的任务的总体进度（0-100），没有在下载的任务时为 -1 */
function overallProgress(): number {
  let done = 0;
  let total = 0;
  for (const t of getTasks()) {
    if (t.status !== 'downloading' && t.status !== 'merging') continue;
    done += t.status === 'merging' ? t.total : t.done;
    total += t.total;
  }
  return total > 0 ? Math.floor((done / total) * 100) : -1;
}

/**
 * 导航栏角标用：只订阅两个数字，进度刷新时不会让导航栏整体重渲染，
 * 除非数字本身变了。
 */
export function useDownloadBadge(): { count: number; progress: number } {
  const count = useSyncExternalStore(subscribe, unfinished, () => 0);
  const progress = useSyncExternalStore(subscribe, overallProgress, () => -1);
  return { count, progress };
}
