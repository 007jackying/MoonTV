'use client';

import dynamic from 'next/dynamic';
import { memo, useEffect, useState } from 'react';

import { init } from '@/lib/download-store';

import { SHOW_DOWNLOADS_EVENT } from './DownloadNavButton';

// 下载管理器界面（以及它用到的解析 / 下载引擎）不进入首屏代码，空闲时再预取
const loadManager = () => import('./DownloadManager');
const DownloadManager = dynamic(loadManager, { ssr: false });

/**
 * 全局下载管理器：在根布局中渲染一次。
 * 下载任务本身由 download-store 管理，关闭界面不影响下载；
 * 这里负责恢复刷新前的任务，并响应导航栏的打开事件。
 */
const GlobalDownloadManager = () => {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    init();
    const show = () => setOpen(true);
    window.addEventListener(SHOW_DOWNLOADS_EVENT, show);
    // 首屏加载完、浏览器空闲时预取，第一次打开就不用等
    const prefetch = () => void loadManager().catch(() => undefined);
    const idle = window.requestIdleCallback
      ? window.requestIdleCallback(prefetch, { timeout: 8000 })
      : window.setTimeout(prefetch, 4000);
    return () => {
      window.removeEventListener(SHOW_DOWNLOADS_EVENT, show);
      if (window.cancelIdleCallback) window.cancelIdleCallback(idle);
      else window.clearTimeout(idle);
    };
  }, []);

  return open ? <DownloadManager onClose={() => setOpen(false)} /> : null;
};

export default memo(GlobalDownloadManager);
