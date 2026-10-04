'use client';

import { useEffect, useState } from 'react';

import { useNavigationLoading } from './NavigationLoadingProvider';

/**
 * 页面跳转时顶部的细进度条：开始后快速推进到 ~80%，
 * 新页面就绪后补满并淡出。不遮挡页面，也不拦截点击。
 */
export function NavigationLoadingIndicator() {
  const { isLoading } = useNavigationLoading();
  const [phase, setPhase] = useState<'idle' | 'loading' | 'done'>('idle');

  useEffect(() => {
    if (isLoading) {
      setPhase('loading');
      return;
    }
    setPhase((p) => (p === 'loading' ? 'done' : p));
    const timer = setTimeout(() => setPhase('idle'), 400);
    return () => clearTimeout(timer);
  }, [isLoading]);

  if (phase === 'idle') return null;

  return (
    <div
      role='progressbar'
      aria-busy={phase === 'loading'}
      className='pointer-events-none fixed inset-x-0 top-0 z-[2000] h-[3px]'
    >
      <div
        className='h-full rounded-r-full bg-o-accent shadow-[0_0_10px_rgb(var(--o-accent)/0.6)]'
        style={
          phase === 'loading'
            ? {
                width: '80%',
                animation:
                  'o-nav-progress 2.5s cubic-bezier(0.1, 0.7, 0.2, 1) both',
              }
            : {
                width: '100%',
                opacity: 0,
                transition: 'width 0.2s ease, opacity 0.3s ease 0.15s',
              }
        }
      />
    </div>
  );
}
