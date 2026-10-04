'use client';

import { Download, Play } from 'lucide-react';
import Link from 'next/link';
import { memo, useEffect, useState } from 'react';

import { BackButton } from './BackButton';
import { useI18n } from './LanguageProvider';
import { LanguageToggle } from './LanguageToggle';
import { useSite } from './SiteProvider';
import { ThemeToggle } from './ThemeToggle';
import { UserMenu } from './UserMenu';

interface MobileHeaderProps {
  showBackButton?: boolean;
}

const MobileHeader = ({ showBackButton = false }: MobileHeaderProps) => {
  const { siteName } = useSite();
  const { t } = useI18n();

  // 下载任务数量统计
  const [downloadTaskCount, setDownloadTaskCount] = useState(0);

  // 监听下载任务变化，更新角标
  useEffect(() => {
    const updateTaskCount = () => {
      if (typeof window !== 'undefined') {
        const saved = localStorage.getItem('downloadTasks');
        if (saved) {
          try {
            const tasks = JSON.parse(saved);
            // 统计未完成的任务数量（下载中、暂停、等待、错误）
            const activeCount = tasks.filter(
              (t: { status: string }) =>
                t.status === 'downloading' ||
                t.status === 'paused' ||
                t.status === 'waiting' ||
                t.status === 'error'
            ).length;
            setDownloadTaskCount(activeCount);
          } catch {
            setDownloadTaskCount(0);
          }
        } else {
          setDownloadTaskCount(0);
        }
      }
    };

    // 初始加载
    updateTaskCount();

    // 监听 localStorage 变化
    const handleStorageChange = () => {
      updateTaskCount();
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('storage', handleStorageChange);
      // 自定义事件：当任务列表更新时
      window.addEventListener(
        'downloadTasksUpdated',
        handleStorageChange as EventListener
      );
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('storage', handleStorageChange);
        window.removeEventListener(
          'downloadTasksUpdated',
          handleStorageChange as EventListener
        );
      }
    };
  }, []);

  return (
    <header className='relative w-full bg-o-bg md:hidden'>
      <div className='flex h-[60px] items-center gap-2 px-4'>
        {showBackButton && <BackButton />}
        <Link
          href='/'
          className='mr-auto flex min-w-0 items-center gap-2 transition-opacity hover:opacity-80'
        >
          <span className='flex h-[30px] w-[30px] flex-none items-center justify-center rounded-full bg-o-accent text-o-on-accent'>
            <Play
              className='h-[13px] w-[13px] fill-current'
              strokeWidth={2.75}
            />
          </span>
          <span className='truncate font-heading text-[21px]'>{siteName}</span>
        </Link>

        <LanguageToggle size='sm' />
        <button
          onClick={() => {
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new Event('showDownloadManager'));
            }
          }}
          className='relative flex h-9 w-9 flex-none items-center justify-center rounded-full transition-colors hover:bg-o-ink/[0.07]'
          title={t.downloadManager}
          aria-label={t.downloadManager}
        >
          <Download className='h-[18px] w-[18px]' strokeWidth={2.75} />
          {downloadTaskCount > 0 && (
            <span className='absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-o-accent px-1 text-[10px] font-bold text-o-on-accent'>
              {downloadTaskCount > 9 ? '9+' : downloadTaskCount}
            </span>
          )}
        </button>
        <ThemeToggle className='h-9 w-9 border-0' />
        <UserMenu />
      </div>
    </header>
  );
};

// 使用 React.memo 优化，避免父组件更新时导致不必要的重新渲染
export default memo(MobileHeader);
