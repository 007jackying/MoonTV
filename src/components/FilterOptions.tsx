'use client';

import { ArrowDown, ArrowUp, ArrowUpDown, Check, ChevronDown, X } from 'lucide-react';
import React, { useEffect, useRef } from 'react';

import { useI18n } from './LanguageProvider';

interface FilterOptionsProps {
  openFilter: string | null;
  setOpenFilter: React.Dispatch<React.SetStateAction<string | null>>;

  // 来源
  sourceOptions: string[];
  filterSources: string[];
  setFilterSources: (opts: string[]) => void;

  // 标题
  titleOptions: string[];
  selectedTitles: string[];
  setSelectedTitles: (opts: string[]) => void;

  // 年份
  yearOptions: string[];
  selectedYears: string[];
  setSelectedYears: (opts: string[]) => void;

  // 排序
  sortField: 'year' | 'sources' | 'episodes';
  onSortFieldChange: (field: 'year' | 'title' | 'source' | 'episodes') => void;
  sortOrder: 'asc' | 'desc';
  onSortOrderChange: (order: 'asc' | 'desc') => void;
  sortOptions: { value: string; label: string }[];
}

type FilterKey = 'source' | 'title' | 'year' | 'sort';

/**
 * 搜索结果筛选：一排胶囊下拉（来源 / 标题 / 年份，可多选）+ 排序。
 * 有选中项的胶囊高亮并显示数量。
 */
const FilterOptions: React.FC<FilterOptionsProps> = (props) => {
  const { t } = useI18n();
  const { openFilter, setOpenFilter } = props;
  const rootRef = useRef<HTMLDivElement>(null);

  // 点击外部 / Esc 关闭
  useEffect(() => {
    if (!openFilter) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpenFilter(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenFilter(null);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [openFilter, setOpenFilter]);

  const groups: {
    key: Exclude<FilterKey, 'sort'>;
    label: string;
    options: string[];
    selected: string[];
    set: (v: string[]) => void;
  }[] = [
    {
      key: 'source',
      label: t.filterSource,
      options: props.sourceOptions,
      selected: props.filterSources,
      set: props.setFilterSources,
    },
    {
      key: 'title',
      label: t.filterTitle,
      options: props.titleOptions,
      selected: props.selectedTitles,
      set: props.setSelectedTitles,
    },
    {
      key: 'year',
      label: t.filterYear,
      options: props.yearOptions,
      selected: props.selectedYears,
      set: props.setSelectedYears,
    },
  ];

  const anySelected = groups.some((g) => g.selected.length > 0);
  const sortLabel =
    props.sortOptions.find((o) => o.value === props.sortField)?.label || '';
  const toggle = (key: FilterKey) =>
    setOpenFilter(openFilter === key ? null : key);

  const pill = (active: boolean) =>
    `o-btn o-press min-h-10 text-[13px] ${
      active
        ? 'border border-o-accent-300 bg-o-accent-100 text-o-accent-800'
        : 'o-btn-secondary'
    }`;

  return (
    <div
      ref={rootRef}
      className='scrollbar-hide -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:overflow-visible md:px-0'
    >
      {groups.map((g) => (
        <div key={g.key} className='relative flex-none'>
          <button
            type='button'
            onClick={() => toggle(g.key)}
            aria-expanded={openFilter === g.key}
            className={pill(g.selected.length > 0)}
          >
            {g.label}
            {g.selected.length > 0 && (
              <span className='rounded-full bg-o-accent px-1.5 text-[11px] font-bold leading-[18px] text-o-on-accent'>
                {g.selected.length}
              </span>
            )}
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${
                openFilter === g.key ? 'rotate-180' : ''
              }`}
              strokeWidth={2.75}
            />
          </button>
          {openFilter === g.key && (
            <div className='fixed inset-x-4 z-50 mt-2 max-h-[50vh] animate-o-pop overflow-y-auto rounded-[24px] bg-o-surface p-2 shadow-o-lg md:absolute md:inset-x-auto md:left-0 md:w-[min(420px,90vw)]'>
              <div className='flex flex-wrap gap-1.5'>
                {g.options.map((opt) => {
                  const on = g.selected.includes(opt);
                  return (
                    <button
                      key={opt}
                      type='button'
                      aria-pressed={on}
                      onClick={() =>
                        g.set(
                          on
                            ? g.selected.filter((o) => o !== opt)
                            : [...g.selected, opt]
                        )
                      }
                      className={`flex max-w-full items-center gap-1 truncate rounded-full px-3 py-1.5 text-[13px] font-semibold transition-colors ${
                        on
                          ? 'bg-o-accent text-o-on-accent'
                          : 'bg-o-bg hover:bg-o-accent-100'
                      }`}
                    >
                      {on && <Check className='h-3 w-3 flex-none' strokeWidth={3} />}
                      <span className='truncate'>
                        {opt === 'unknown' ? t.unknownYear : opt}
                      </span>
                    </button>
                  );
                })}
              </div>
              {g.selected.length > 0 && (
                <button
                  type='button'
                  onClick={() => g.set([])}
                  className='o-btn o-btn-ghost mt-2 text-[13px]'
                >
                  {t.clear}
                </button>
              )}
            </div>
          )}
        </div>
      ))}

      {/* 排序 */}
      <div className='relative flex-none'>
        <button
          type='button'
          onClick={() => toggle('sort')}
          aria-expanded={openFilter === 'sort'}
          className={pill(true)}
        >
          <ArrowUpDown className='h-3.5 w-3.5' strokeWidth={2.75} />
          {sortLabel}
          {props.sortOrder === 'asc' ? (
            <ArrowUp className='h-3 w-3' strokeWidth={3} />
          ) : (
            <ArrowDown className='h-3 w-3' strokeWidth={3} />
          )}
        </button>
        {openFilter === 'sort' && (
          <div className='fixed inset-x-4 z-50 mt-2 animate-o-pop rounded-[24px] bg-o-surface p-1.5 shadow-o-lg md:absolute md:inset-x-auto md:left-0 md:w-56'>
            {props.sortOptions.map((opt) => (
              <button
                key={opt.value}
                type='button'
                onClick={() =>
                  props.onSortFieldChange(
                    opt.value as 'year' | 'title' | 'source' | 'episodes'
                  )
                }
                className={`flex w-full items-center gap-2 rounded-[16px] px-3 py-2 text-left text-sm font-semibold transition-colors ${
                  props.sortField === opt.value
                    ? 'bg-o-accent-100 text-o-accent-800'
                    : 'hover:bg-o-bg'
                }`}
              >
                <span className='flex-1'>{opt.label}</span>
                {props.sortField === opt.value && (
                  <Check className='h-4 w-4' strokeWidth={3} />
                )}
              </button>
            ))}
            <div className='my-1 h-px bg-o-divider' />
            <div className='flex gap-1 p-1'>
              {(['desc', 'asc'] as const).map((o) => (
                <button
                  key={o}
                  type='button'
                  onClick={() => props.onSortOrderChange(o)}
                  className={`flex flex-1 items-center justify-center gap-1 rounded-full px-3 py-1.5 text-[13px] font-semibold transition-colors ${
                    props.sortOrder === o
                      ? 'bg-o-accent text-o-on-accent'
                      : 'bg-o-bg hover:bg-o-accent-100'
                  }`}
                >
                  {o === 'desc' ? (
                    <ArrowDown className='h-3 w-3' strokeWidth={3} />
                  ) : (
                    <ArrowUp className='h-3 w-3' strokeWidth={3} />
                  )}
                  {o === 'desc' ? t.descending : t.ascending}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {anySelected && (
        <button
          type='button'
          onClick={() => groups.forEach((g) => g.set([]))}
          className='o-btn o-btn-ghost min-h-10 flex-none text-[13px]'
        >
          <X className='h-3.5 w-3.5' strokeWidth={2.75} />
          {t.clearFilters}
        </button>
      )}
    </div>
  );
};

export default FilterOptions;
