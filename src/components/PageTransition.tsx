'use client';

import { usePathname } from 'next/navigation';
import { ReactNode } from 'react';

/** 路由切换时让页面内容淡入并轻微上移 */
export default function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div key={pathname} className='animate-o-page'>
      {children}
    </div>
  );
}
