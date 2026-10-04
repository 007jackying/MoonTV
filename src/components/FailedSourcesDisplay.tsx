'use client';

import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { useI18n } from './LanguageProvider';

interface FailedSource {
  name: string;
  key: string;
  error: string;
}

interface FailedSourcesDisplayProps {
  failedSources: FailedSource[];
}

/** 搜索失败的源：一个可点击的标签，展开后列出每个源和原因 */
export default function FailedSourcesDisplay({
  failedSources,
}: FailedSourcesDisplayProps) {
  const { t } = useI18n();
  const [showDetails, setShowDetails] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showDetails) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setShowDetails(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showDetails]);

  if (failedSources.length === 0) return null;

  return (
    <div className='relative' ref={containerRef}>
      <button
        type='button'
        className='o-tag o-tag-accent gap-1 font-semibold transition-colors hover:bg-o-accent-200'
        aria-expanded={showDetails}
        onClick={() => setShowDetails(!showDetails)}
      >
        <X className='h-[11px] w-[11px]' strokeWidth={3} />
        {t.sourcesFailed(failedSources.length)}
      </button>

      {showDetails && (
        <div className='absolute left-0 top-full z-30 mt-2 w-72 animate-o-pop rounded-[24px] bg-o-surface p-2 shadow-o-lg'>
          <h3 className='o-eyebrow m-0 px-2 pb-1.5 pt-1'>{t.failedDetails}</h3>
          <div className='flex max-h-60 flex-col gap-1 overflow-y-auto'>
            {failedSources.map((source, index) => (
              <div
                key={`${source.key}-${index}`}
                className='rounded-[16px] bg-o-bg px-3 py-2'
              >
                <div className='flex items-center gap-2'>
                  <span className='truncate text-sm font-bold'>
                    {source.name}
                  </span>
                  <span className='o-tag o-tag-neutral ml-auto flex-none'>
                    {source.key}
                  </span>
                </div>
                <p className='m-0 break-words text-xs text-o-accent-700'>
                  {source.error}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
