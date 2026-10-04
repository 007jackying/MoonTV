'use client';

import React from 'react';

import { PillGroup, SelectorRow } from '@/components/ui/Pills';

import { useI18n } from './LanguageProvider';
import MultiLevelSelector from './MultiLevelSelector';
import WeekdaySelector from './WeekdaySelector';

interface SelectorOption {
  label: string;
  value: string;
}

interface DoubanSelectorProps {
  type: 'movie' | 'tv' | 'show' | 'anime';
  primarySelection?: string;
  secondarySelection?: string;
  onPrimaryChange: (value: string) => void;
  onSecondaryChange: (value: string) => void;
  onMultiLevelChange?: (values: Record<string, string>) => void;
  onWeekdayChange: (weekday: string) => void;
}

// 电影
const moviePrimaryOptions: SelectorOption[] = [
  { label: '全部', value: '全部' },
  { label: '热门电影', value: '热门' },
  { label: '最新电影', value: '最新' },
  { label: '豆瓣高分', value: '豆瓣高分' },
  { label: '冷门佳片', value: '冷门佳片' },
];
const movieSecondaryOptions: SelectorOption[] = [
  { label: '全部', value: '全部' },
  { label: '华语', value: '华语' },
  { label: '欧美', value: '欧美' },
  { label: '韩国', value: '韩国' },
  { label: '日本', value: '日本' },
];

// 电视剧
const tvPrimaryOptions: SelectorOption[] = [
  { label: '全部', value: '全部' },
  { label: '最近热门', value: '最近热门' },
];
const tvSecondaryOptions: SelectorOption[] = [
  { label: '全部', value: 'tv' },
  { label: '国产', value: 'tv_domestic' },
  { label: '欧美', value: 'tv_american' },
  { label: '日本', value: 'tv_japanese' },
  { label: '韩国', value: 'tv_korean' },
  { label: '动漫', value: 'tv_animation' },
  { label: '纪录片', value: 'tv_documentary' },
];

// 综艺
const showPrimaryOptions: SelectorOption[] = [
  { label: '全部', value: '全部' },
  { label: '最近热门', value: '最近热门' },
];
const showSecondaryOptions: SelectorOption[] = [
  { label: '全部', value: 'show' },
  { label: '国内', value: 'show_domestic' },
  { label: '国外', value: 'show_foreign' },
];

// 动漫
const animePrimaryOptions: SelectorOption[] = [
  { label: '每日放送', value: '每日放送' },
  { label: '番剧', value: '番剧' },
  { label: '剧场版', value: '剧场版' },
];

const DoubanSelector: React.FC<DoubanSelectorProps> = ({
  type,
  primarySelection,
  secondarySelection,
  onPrimaryChange,
  onSecondaryChange,
  onMultiLevelChange,
  onWeekdayChange,
}) => {
  const { t } = useI18n();
  const handleMultiLevelChange = (values: Record<string, string>) => {
    onMultiLevelChange?.(values);
  };

  const filterRow = (
    contentType: 'movie' | 'tv' | 'show' | 'anime-tv' | 'anime-movie',
    key: string
  ) => (
    <SelectorRow label={t.filter}>
      <MultiLevelSelector
        key={key}
        onChange={handleMultiLevelChange}
        contentType={contentType}
      />
    </SelectorRow>
  );

  if (type === 'movie') {
    const primary = primarySelection || moviePrimaryOptions[0].value;
    return (
      <div className='flex flex-col gap-3 md:gap-3.5'>
        <SelectorRow label={t.category}>
          <PillGroup
            options={moviePrimaryOptions}
            value={primary}
            onChange={onPrimaryChange}
          />
        </SelectorRow>
        {primary !== '全部' ? (
          <SelectorRow label={t.region}>
            <PillGroup
              options={movieSecondaryOptions}
              value={secondarySelection || movieSecondaryOptions[0].value}
              onChange={onSecondaryChange}
            />
          </SelectorRow>
        ) : (
          filterRow('movie', `movie-${primarySelection}`)
        )}
      </div>
    );
  }

  if (type === 'tv' || type === 'show') {
    const primaryOptions =
      type === 'tv' ? tvPrimaryOptions : showPrimaryOptions;
    const secondaryOptions =
      type === 'tv' ? tvSecondaryOptions : showSecondaryOptions;
    const primary = primarySelection || primaryOptions[1].value;
    return (
      <div className='flex flex-col gap-3 md:gap-3.5'>
        <SelectorRow label={t.category}>
          <PillGroup
            options={primaryOptions}
            value={primary}
            onChange={onPrimaryChange}
          />
        </SelectorRow>
        {primary === '最近热门' ? (
          <SelectorRow label={t.genre}>
            <PillGroup
              options={secondaryOptions}
              value={secondarySelection || secondaryOptions[0].value}
              onChange={onSecondaryChange}
            />
          </SelectorRow>
        ) : primary === '全部' ? (
          filterRow(type, `${type}-${primarySelection}`)
        ) : null}
      </div>
    );
  }

  // 动漫
  const primary = primarySelection || animePrimaryOptions[0].value;
  return (
    <div className='flex flex-col gap-3 md:gap-3.5'>
      <SelectorRow label={t.category}>
        <PillGroup
          options={animePrimaryOptions}
          value={primary}
          onChange={onPrimaryChange}
        />
      </SelectorRow>
      {primary === '每日放送' ? (
        <SelectorRow label={t.weekday}>
          <WeekdaySelector onWeekdayChange={onWeekdayChange} />
        </SelectorRow>
      ) : primary === '番剧' ? (
        filterRow('anime-tv', `anime-tv-${primarySelection}`)
      ) : (
        filterRow('anime-movie', `anime-movie-${primarySelection}`)
      )}
    </div>
  );
};

export default DoubanSelector;
