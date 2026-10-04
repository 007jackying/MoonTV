'use client';

import React from 'react';

import { optionLabel } from '@/lib/i18n';

import { useI18n } from '../LanguageProvider';

interface SelectorOption {
  label: string;
  value: string;
}

/** 一行筛选：左侧标签，右侧胶囊（移动端标签在上、胶囊横向滚动） */
export function SelectorRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className='flex flex-col gap-2 md:flex-row md:items-center md:gap-4'>
      <span className='flex-none text-xs font-bold text-o-neutral-700 md:w-16 md:text-[13px]'>
        {label}
      </span>
      <div className='scrollbar-hide -mr-3.5 min-w-0 overflow-x-auto pr-3.5 md:mr-0 md:overflow-visible md:pr-0'>
        {children}
      </div>
    </div>
  );
}

/** 单选胶囊组 */
export function PillGroup({
  options,
  value,
  onChange,
}: {
  options: SelectorOption[];
  value: string | undefined;
  onChange: (value: string) => void;
}) {
  const { lang } = useI18n();
  return (
    <div role='radiogroup' className='flex gap-1.5 md:flex-wrap'>
      {options.map((option) => {
        const active = value === option.value;
        return (
          <button
            key={option.value}
            type='button'
            role='radio'
            aria-checked={active}
            onClick={() => !active && onChange(option.value)}
            className={`o-press flex-none whitespace-nowrap rounded-full px-3.5 py-[9px] text-[13px] font-semibold transition-colors duration-200 md:px-4 md:py-[7px] md:text-sm ${
              active
                ? 'bg-o-accent text-o-on-accent'
                : 'text-o-ink hover:bg-o-ink/[0.07]'
            }`}
          >
            {optionLabel(lang, option.label)}
          </button>
        );
      })}
    </div>
  );
}
