'use client';

import { Search } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { getCustomCategories } from '@/lib/config.client';

import { useNavigationLoading } from './NavigationLoadingProvider';
import TvDoubanSource from './TvDoubanSource';

/**
 * 电视端顶部导航。
 *
 * 之前用的是左侧抽屉，聚焦才展开。改成顶部一行有两个好处：
 *  - Netflix / Prime Video / Disney+ 都是顶部导航，遥控器用户对这个位置有预期；
 *  - 左边那 104dp 还给了内容区，一行能从 5 张海报变成 6 张（124dp × 6 + 20dp × 5 = 844dp，
 *    正好是指南的 12 栏网格）。
 *
 * 「收藏」「历史」原来是页面中间的胶囊切换，现在并进导航栏 —— 它们本来就是并列的目的地，
 * 放在内容区里会多出一个奇怪的焦点落点。
 */

const PRIMARY = [
  { label: '首页', href: '/' },
  { label: '电影', href: '/douban?type=movie' },
  { label: '剧集', href: '/douban?type=tv' },
  { label: '动漫', href: '/douban?type=anime' },
  { label: '综艺', href: '/douban?type=show' },
  { label: '收藏', href: '/?tab=favorites' },
  { label: '历史', href: '/?tab=history' },
];

export default function TvSidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { startLoading } = useNavigationLoading();
  const [items, setItems] = useState(PRIMARY);

  useEffect(() => {
    getCustomCategories().then((categories) => {
      if (categories.length > 0) {
        setItems((prev) => {
          if (prev.some((i) => i.href.includes('type=custom'))) return prev;
          return [...prev, { label: '自定义', href: '/douban?type=custom' }];
        });
      }
    });
  }, []);

  const currentType = searchParams.get('type');
  const currentTab = searchParams.get('tab');

  const isActive = (href: string) => {
    const [path, query] = href.split('?');
    if (path !== pathname) return false;
    if (!query) return !currentType && !currentTab; // 「首页」只在没有子标签时算选中
    if (query.startsWith('tab=')) return query === `tab=${currentTab}`;
    return query === `type=${currentType}`;
  };

  const link = (label: string, href: string, extra = '') => {
    const active = isActive(href);
    return (
      <Link
        key={href}
        href={href}
        data-tv-nav={active ? 'active' : undefined}
        onClick={() => startLoading()}
        className={`tv-nav-item ${extra}`}
      >
        {label}
      </Link>
    );
  };

  return (
    <nav className='tv-nav' aria-label='主导航'>
      <span className='tv-nav-brand'>DreamTV</span>

      <div className='tv-nav-items'>
        {items.map(({ label, href }) => link(label, href))}
      </div>

      {/* 搜索靠右，和内容目的地分开。
          这里不放通用「设置」：后台是一套密集的表单，遥控器根本填不了，
          而且在 localstorage 模式下打开就直接报「不支持本地存储进行管理员配置」，
          等于给电视用户留了一个死胡同。要改配置请用手机或电脑打开同一个地址。
          唯一的例外是豆瓣数据源 —— 选错了整个首页就是空的，电视上必须能自己改。 */}
      <div className='tv-nav-utils'>
        <Link
          href='/search'
          data-tv-nav={pathname === '/search' ? 'active' : undefined}
          onClick={() => startLoading()}
          className='tv-nav-item tv-nav-icon'
          aria-label='搜索'
        >
          <Search size={24} strokeWidth={2} />
        </Link>
        <TvDoubanSource />
      </div>
    </nav>
  );
}
