'use client';

import React from 'react';

import { useI18n } from './LanguageProvider';
import { PillGroup, SelectorRow } from './ui/Pills';

interface CustomCategory {
  name: string;
  type: 'movie' | 'tv';
  query: string;
}

interface DoubanCustomSelectorProps {
  customCategories: CustomCategory[];
  primarySelection?: string;
  secondarySelection?: string;
  onPrimaryChange: (value: string) => void;
  onSecondaryChange: (value: string) => void;
}

/** 自定义分类：一级为电影 / 剧集，二级为管理员配置的片单 */
const DoubanCustomSelector: React.FC<DoubanCustomSelectorProps> = ({
  customCategories,
  primarySelection,
  secondarySelection,
  onPrimaryChange,
  onSecondaryChange,
}) => {
  const { t } = useI18n();

  // 按 type 分组，电影优先
  const primaryOptions = React.useMemo(() => {
    const types = Array.from(new Set(customCategories.map((cat) => cat.type)));
    types.sort((a, b) => (a === 'movie' ? -1 : b === 'movie' ? 1 : 0));
    return types.map((type) => ({
      label: type === 'movie' ? t.browseMovie : t.browseTv,
      value: type,
    }));
  }, [customCategories, t]);

  const secondaryOptions = React.useMemo(() => {
    if (!primarySelection) return [];
    return customCategories
      .filter((cat) => cat.type === primarySelection)
      .map((cat) => ({ label: cat.name || cat.query, value: cat.query }));
  }, [customCategories, primarySelection]);

  if (!customCategories || customCategories.length === 0) return null;

  return (
    <div className='flex flex-col gap-3 md:gap-3.5'>
      <SelectorRow label={t.genre}>
        <PillGroup
          options={primaryOptions}
          value={primarySelection || primaryOptions[0]?.value}
          onChange={onPrimaryChange}
        />
      </SelectorRow>
      {secondaryOptions.length > 0 && (
        <SelectorRow label={t.customList}>
          <PillGroup
            options={secondaryOptions}
            value={secondarySelection || secondaryOptions[0]?.value}
            onChange={onSecondaryChange}
          />
        </SelectorRow>
      )}
    </div>
  );
};

export default DoubanCustomSelector;
