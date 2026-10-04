/* eslint-disable no-console, @next/next/no-img-element */
'use client';

import { History, Play, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import Swal from 'sweetalert2';

import type { PlayRecord } from '@/lib/db.client';
import {
  clearAllPlayRecords,
  deletePlayRecord,
  getAllPlayRecords,
  subscribeToDataUpdates,
} from '@/lib/db.client';
import { processImageUrl } from '@/lib/utils';

import { useI18n } from '@/components/LanguageProvider';
import { useNavigationLoading } from '@/components/NavigationLoadingProvider';
import ScrollableRow from '@/components/ScrollableRow';
import {
  ContinueCardSkeleton,
  EmptyState,
  PosterSkeleton,
  SectionHeader,
  staggerStyle,
} from '@/components/ui/Organic';
import VideoCard from '@/components/VideoCard';

interface ContinueWatchingProps {
  className?: string;
  showAll?: boolean; // 是否显示所有记录（网格布局）
  hideHeader?: boolean; // 是否隐藏标题栏
}

type RecordWithKey = PlayRecord & { key: string };

// 从 key 中解析 source 和 id（id 本身可能包含 “+”）
const parseKey = (key: string) => {
  const i = key.indexOf('+');
  return { source: key.slice(0, i), id: key.slice(i + 1) };
};

const getProgress = (record: PlayRecord) =>
  record.total_time ? (record.play_time / record.total_time) * 100 : 0;

const buildHref = (record: RecordWithKey) => {
  const { source, id } = parseKey(record.key);
  const params = new URLSearchParams({ source, id, title: record.title });
  if (record.year) params.set('year', record.year);
  if (record.search_title) params.set('stitle', record.search_title);
  // 与 VideoCard 一致：只有剧集才限定类型
  if (record.total_episodes > 1) params.set('stype', 'tv');
  return `/play?${params.toString()}`;
};

/** 横向“继续观看”卡片：海报 + 标题 + 进度 + 剩余时间 */
function ContinueCard({
  record,
  index,
  onRemove,
}: {
  record: RecordWithKey;
  index: number;
  onRemove: () => void;
}) {
  const { t } = useI18n();
  const { startLoading } = useNavigationLoading();
  const [loaded, setLoaded] = useState(false);
  const progress = getProgress(record);
  const minutesLeft = Math.max(
    1,
    Math.round((record.total_time - record.play_time) / 60)
  );
  const meta = [
    record.total_episodes > 1
      ? t.epOf(record.index, record.total_episodes)
      : t.movie,
    record.source_name,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div
      className='group relative w-[300px] flex-none animate-o-rise md:w-[340px]'
      style={staggerStyle(index)}
    >
      <Link
        href={buildHref(record)}
        onClick={startLoading}
        className='flex gap-3 rounded-[24px] bg-o-surface p-2.5 transition-[transform,box-shadow] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] hover:-translate-y-0.5 hover:shadow-o-md md:gap-3.5 md:rounded-[28px] md:p-3'
      >
        <span className='relative h-[108px] w-[72px] flex-none overflow-hidden rounded-[14px] bg-o-accent-300 md:h-[126px] md:w-[84px] md:rounded-2xl'>
          {!loaded && <span className='o-skeleton absolute inset-0' />}
          <img
            src={processImageUrl(record.cover)}
            alt=''
            referrerPolicy='no-referrer'
            loading='lazy'
            onLoad={() => setLoaded(true)}
            className={`o-washed h-full w-full object-cover transition-opacity duration-500 group-hover:scale-105 ${
              loaded ? 'opacity-100' : 'opacity-0'
            }`}
          />
        </span>
        <span className='flex min-w-0 flex-1 flex-col gap-[3px] py-0.5 pr-1 md:gap-1 md:py-1'>
          <span className='truncate font-heading text-base leading-[1.15] md:text-lg'>
            {record.title}
          </span>
          <span className='truncate text-xs text-o-neutral-700 md:text-[13px]'>
            {meta}
          </span>
          <span className='flex-1' />
          <span className='h-1.5 overflow-hidden rounded-full bg-o-neutral-300'>
            <span
              className='block h-full rounded-full bg-o-accent'
              style={{ width: `${Math.min(100, progress)}%` }}
            />
          </span>
          <span className='mt-1 flex items-center justify-between md:mt-1.5'>
            <span className='text-xs text-o-neutral-700'>
              {t.minutesLeft(minutesLeft)}
            </span>
            <span className='hidden h-[34px] w-[34px] items-center justify-center rounded-full bg-o-accent text-o-on-accent transition-transform duration-200 group-hover:scale-110 md:flex'>
              <Play size={14} className='ml-0.5 fill-current' strokeWidth={2.75} />
            </span>
          </span>
        </span>
      </Link>
      <button
        type='button'
        onClick={onRemove}
        title={t.removeRecord}
        aria-label={t.removeRecord}
        className='absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-o-bg text-o-neutral-700 opacity-0 shadow-o-sm transition-opacity duration-200 hover:text-o-accent-700 focus-visible:opacity-100 group-hover:opacity-100'
      >
        <X size={14} strokeWidth={2.75} />
      </button>
    </div>
  );
}

export default function ContinueWatching({
  className,
  showAll = false,
  hideHeader = false,
}: ContinueWatchingProps) {
  const { t } = useI18n();
  const [playRecords, setPlayRecords] = useState<RecordWithKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [simpleMode, setSimpleMode] = useState(false);

  // 检查是否启用简洁模式
  useEffect(() => {
    const savedSimpleMode = localStorage.getItem('simpleMode');
    if (savedSimpleMode !== null) setSimpleMode(JSON.parse(savedSimpleMode));
  }, []);

  // 按 save_time 由近到远排序
  const updatePlayRecords = (allRecords: Record<string, PlayRecord>) => {
    setPlayRecords(
      Object.entries(allRecords)
        .map(([key, record]) => ({ ...record, key }))
        .sort((a, b) => b.save_time - a.save_time)
    );
  };

  useEffect(() => {
    (async () => {
      try {
        updatePlayRecords(await getAllPlayRecords());
      } catch (error) {
        console.error('获取播放记录失败:', error);
        setPlayRecords([]);
      } finally {
        setLoading(false);
      }
    })();

    return subscribeToDataUpdates(
      'playRecordsUpdated',
      (newRecords: Record<string, PlayRecord>) => updatePlayRecords(newRecords)
    );
  }, []);

  const handleClear = async () => {
    const { isConfirmed } = await Swal.fire({
      title: t.confirmClear,
      text: t.confirmClearHistory,
      showCancelButton: true,
      confirmButtonText: t.confirmOk,
      cancelButtonText: t.cancel,
    });
    if (!isConfirmed) return;
    await clearAllPlayRecords();
    setPlayRecords([]);
    Swal.fire({
      toast: true,
      position: 'top-end',
      title: t.cleared,
      timer: 1600,
      showConfirmButton: false,
    });
  };

  const removeRecord = async (record: RecordWithKey) => {
    const { source, id } = parseKey(record.key);
    setPlayRecords((prev) => prev.filter((r) => r.key !== record.key));
    try {
      await deletePlayRecord(source, id);
    } catch (err) {
      console.error('删除播放记录失败', err);
    }
  };

  const gridMode = simpleMode || showAll;

  // 首页：没有记录就不显示这一块
  if (!loading && playRecords.length === 0) {
    if (!gridMode) return null;
    return (
      <EmptyState
        icon={<History className='h-6 w-6' strokeWidth={2.5} />}
        title={t.noHistory}
        hint={t.emptyHint}
      />
    );
  }

  return (
    <section className={`flex flex-col gap-3 md:gap-4 ${className || ''}`}>
      {!hideHeader && (
        <SectionHeader
          title={gridMode ? t.playHistory : t.continueWatching}
          actionLabel={!loading && playRecords.length > 0 ? t.clear : undefined}
          onAction={handleClear}
        />
      )}

      {gridMode ? (
        <div className='grid grid-cols-3 gap-x-2.5 gap-y-5 sm:grid-cols-[repeat(auto-fill,minmax(150px,1fr))] sm:gap-x-5 sm:gap-y-7'>
          {loading
            ? Array.from({ length: 7 }).map((_, i) => <PosterSkeleton key={i} />)
            : playRecords.map((record, i) => {
                const { source, id } = parseKey(record.key);
                return (
                  <div
                    key={record.key}
                    className='animate-o-rise'
                    style={staggerStyle(i)}
                  >
                    <VideoCard
                      id={id}
                      title={record.title}
                      poster={record.cover}
                      year={record.year}
                      source={source}
                      source_name={record.source_name}
                      progress={getProgress(record)}
                      episodes={record.total_episodes}
                      currentEpisode={record.index}
                      query={record.search_title}
                      from='playrecord'
                      onDelete={() =>
                        setPlayRecords((prev) =>
                          prev.filter((r) => r.key !== record.key)
                        )
                      }
                      type={record.total_episodes > 1 ? 'tv' : ''}
                    />
                  </div>
                );
              })}
        </div>
      ) : (
        <ScrollableRow gap='md'>
          {loading
            ? Array.from({ length: 4 }).map((_, i) => (
                <ContinueCardSkeleton key={i} />
              ))
            : playRecords.map((record, i) => (
                <ContinueCard
                  key={record.key}
                  record={record}
                  index={i}
                  onRemove={() => removeRecord(record)}
                />
              ))}
        </ScrollableRow>
      )}
    </section>
  );
}
