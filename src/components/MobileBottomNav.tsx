/* eslint-disable @typescript-eslint/no-explicit-any */

'use client';

import { Cat, Clover, Film, Home, Search, Star, Tv } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { memo, useEffect, useState } from 'react';

import { getCustomCategories } from '@/lib/config.client';

import { useI18n } from './LanguageProvider';
import { useNavigationLoading } from './NavigationLoadingProvider';

interface MobileBottomNavProps {
  /**
   * 主动指定当前激活的路径。当未提供时，自动使用 usePathname() 获取的路径。
   */
  activePath?: string;
}

const MobileBottomNav = ({ activePath }: MobileBottomNavProps) => {
  const pathname = usePathname();
  const { startLoading } = useNavigationLoading();
  const { t } = useI18n();

  const searchParams = useSearchParams();

  // 当前激活路径：优先使用传入的 activePath，否则使用带查询参数的地址；
  // 播放页按影片类型高亮“电影 / 剧集”
  const stype = searchParams.get('stype');
  const currentActive =
    activePath ??
    (pathname === '/play' && stype
      ? `/douban?type=${stype}`
      : pathname === '/douban'
      ? `${pathname}?${searchParams.toString()}`
      : pathname);

  const [navItems, setNavItems] = useState<
    { icon: typeof Home; labelKey: TabLabelKey; href: string }[]
  >([
    { icon: Home, labelKey: 'navHome', href: '/' },
    { icon: Search, labelKey: 'navSearch', href: '/search' },
    { icon: Film, labelKey: 'navMovie', href: '/douban?type=movie' },
    { icon: Tv, labelKey: 'navTv', href: '/douban?type=tv' },
    { icon: Cat, labelKey: 'navAnime', href: '/douban?type=anime' },
    { icon: Clover, labelKey: 'navShow', href: '/douban?type=show' },
  ]);

  // 检查是否启用简洁模式 - 使用状态管理
  const [simpleMode, setSimpleMode] = useState(false);
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
    if (typeof window !== 'undefined') {
      const savedSimpleMode = localStorage.getItem('simpleMode');
      if (savedSimpleMode !== null) {
        setSimpleMode(JSON.parse(savedSimpleMode));
      }
    }
  }, []);

  useEffect(() => {
    getCustomCategories().then((categories) => {
      if (categories.length > 0) {
        setNavItems((prevItems) => [
          ...prevItems,
          { icon: Star, labelKey: 'navCustom', href: '/douban?type=custom' },
        ]);
      }
    });
  }, []);

  const isActive = (href: string) => {
    const typeMatch = href.match(/type=([^&]+)/)?.[1];

    // 解码URL以进行正确的比较
    const decodedActive = decodeURIComponent(currentActive);
    const decodedItemHref = decodeURIComponent(href);

    return (
      decodedActive === decodedItemHref ||
      (decodedActive.startsWith('/douban') &&
        decodedActive.includes(`type=${typeMatch}`))
    );
  };

  return (
    <nav
      className='fixed left-0 right-0 z-[600] rounded-t-[28px] bg-o-surface shadow-o-lg md:hidden'
      style={{
        /* 紧贴视口底部，同时在内部留出安全区高度 */
        bottom: 0,
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <ul className='flex h-[68px] items-stretch px-2 pb-2.5 pt-1.5'>
        {navItems.map((item) => {
          // 服务器端渲染时不显示任何内容，避免闪烁
          if (!isClient) return null;
          // 简洁模式下只显示首页和搜索
          if (simpleMode && !['/', '/search'].includes(item.href)) {
            return null;
          }

          const active = isActive(item.href);
          const label = t[item.labelKey];
          return (
            // 均分宽度：多于 5 个入口时也不会溢出
            <li key={item.href} className='min-w-0 flex-1'>
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`flex h-full w-full flex-col items-center justify-center gap-1 text-[11px] font-semibold ${
                  active ? 'text-o-accent-800' : 'text-o-neutral-700'
                }`}
                onClick={() => {
                  if (!active) startLoading();
                }}
              >
                <span
                  className={`flex h-7 w-11 items-center justify-center rounded-full transition-colors ${
                    active ? 'bg-o-accent-200' : ''
                  }`}
                >
                  <item.icon className='h-[18px] w-[18px]' strokeWidth={2.75} />
                </span>
                <span className='max-w-full truncate px-0.5'>{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};

type TabLabelKey =
  | 'navHome'
  | 'navSearch'
  | 'navMovie'
  | 'navTv'
  | 'navAnime'
  | 'navShow'
  | 'navCustom';

// 使用 React.memo 优化，避免父组件更新时导致不必要的重新渲染
export default memo(MobileBottomNav);
