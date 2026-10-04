/* eslint-disable @typescript-eslint/no-explicit-any,react-hooks/exhaustive-deps */

'use client';

import { Moon, Sun } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { twMerge } from 'tailwind-merge';

import { useI18n } from './LanguageProvider';

// 与 globals.css 中的 --o-theme-color 保持一致
const THEME_COLORS = { dark: '#1e1a16', light: '#f5ead8' };

export function ThemeToggle({ className = '' }: { className?: string }) {
  const { t } = useI18n();
  const [mounted, setMounted] = useState(false);
  const { setTheme, resolvedTheme } = useTheme();
  const pathname = usePathname();

  const setThemeColor = (theme?: string) => {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      const meta = document.createElement('meta');
      meta.name = 'theme-color';
      meta.content = theme === 'dark' ? THEME_COLORS.dark : THEME_COLORS.light;
      document.head.appendChild(meta);
    } else {
      meta.setAttribute(
        'content',
        theme === 'dark' ? THEME_COLORS.dark : THEME_COLORS.light
      );
    }
  };

  useEffect(() => {
    setMounted(true);
  }, []);

  // 监听主题变化和路由变化，确保主题色始终同步
  useEffect(() => {
    if (mounted) {
      setThemeColor(resolvedTheme);
    }
  }, [mounted, resolvedTheme, pathname]);

  if (!mounted) {
    // 渲染一个占位符以避免布局偏移
    return <div className={twMerge('h-10 w-10 flex-none', className)} />;
  }

  const toggleTheme = () => {
    // 检查浏览器是否支持 View Transitions API
    const targetTheme = resolvedTheme === 'dark' ? 'light' : 'dark';
    setThemeColor(targetTheme);
    if (!(document as any).startViewTransition) {
      setTheme(targetTheme);
      return;
    }

    (document as any).startViewTransition(() => {
      setTheme(targetTheme);
    });
  };

  return (
    <button
      onClick={toggleTheme}
      className={twMerge(
        'flex h-10 w-10 flex-none items-center justify-center rounded-full border border-o-divider text-o-ink transition-colors hover:bg-o-ink/[0.07] active:bg-o-ink/[0.14]',
        className
      )}
      aria-label={t.toggleTheme}
      title={t.toggleTheme}
    >
      {resolvedTheme === 'dark' ? (
        <Sun className='h-[18px] w-[18px]' strokeWidth={2.5} />
      ) : (
        <Moon className='h-[18px] w-[18px]' strokeWidth={2.5} />
      )}
    </button>
  );
}
