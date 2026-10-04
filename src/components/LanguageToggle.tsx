'use client';

import { Lang } from '@/lib/i18n';

import { useI18n } from './LanguageProvider';

const OPTIONS: { value: Lang; label: string }[] = [
  { value: 'zh', label: '中' },
  { value: 'en', label: 'EN' },
];

/** 中 / EN 分段切换，桌面导航与移动端头部共用 */
export function LanguageToggle({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const { lang, setLang, t } = useI18n();
  const pad =
    size === 'sm' ? 'px-2.5 py-1.5 text-xs' : 'px-3 py-[7px] text-[13px]';

  return (
    <div
      role='radiogroup'
      aria-label={t.language}
      className='flex flex-none overflow-hidden rounded-full border border-o-divider font-semibold'
    >
      {OPTIONS.map((opt) => {
        const active = lang === opt.value;
        return (
          <button
            key={opt.value}
            type='button'
            role='radio'
            aria-checked={active}
            onClick={() => setLang(opt.value)}
            className={`${pad} leading-none transition-colors ${
              active
                ? 'bg-o-accent text-o-on-accent'
                : 'text-o-ink hover:bg-o-ink/[0.07]'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
