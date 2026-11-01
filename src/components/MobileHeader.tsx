'use client';

import { Play } from 'lucide-react';
import Link from 'next/link';
import { memo } from 'react';

import { BackButton } from './BackButton';
import { DownloadNavButton } from './DownloadNavButton';
import { LanguageToggle } from './LanguageToggle';
import { useSite } from './SiteProvider';
import { ThemeToggle } from './ThemeToggle';
import { UserMenu } from './UserMenu';

interface MobileHeaderProps {
  showBackButton?: boolean;
}

const MobileHeader = ({ showBackButton = false }: MobileHeaderProps) => {
  const { siteName } = useSite();

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
        <DownloadNavButton compact />
        <ThemeToggle className='h-9 w-9 border-0' />
        <UserMenu />
      </div>
    </header>
  );
};

// 使用 React.memo 优化，避免父组件更新时导致不必要的重新渲染
export default memo(MobileHeader);
