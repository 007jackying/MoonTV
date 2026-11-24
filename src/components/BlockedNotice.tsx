'use client';

import { useI18n } from './LanguageProvider';

export default function BlockedNotice() {
  const { t } = useI18n();
  return (
    <div className='flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6 text-center'>
      <h1 className='text-3xl font-bold'>{t.blockedTitle}</h1>
      <p className='max-w-md text-gray-500 dark:text-gray-400'>
        {t.blockedMessage}
      </p>
      {/* 用普通 <a> 整页刷新，而不是客户端路由：重新加载后拦截脚本重新开始检测 */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a
        href='/'
        className='rounded bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600'
      >
        {t.blockedBack}
      </a>
    </div>
  );
}
