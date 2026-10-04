/* eslint-disable @next/next/no-img-element */
'use client';

import {
  Download,
  ExternalLink,
  Heart,
  MessageSquareText,
  MoreHorizontal,
  Search,
  SkipForward,
} from 'lucide-react';
import { ReactNode, useEffect, useRef, useState } from 'react';

import { SearchResult } from '@/lib/types';
import { processImageUrl } from '@/lib/utils';

import { useI18n } from '../LanguageProvider';

export interface PlayDetailsProps {
  detail: SearchResult | null;
  title: string;
  year: string;
  /** 当前集的显示名（电影为空） */
  episodeLabel: string;
  nextEpisodeLabel: string | null;
  poster: string;
  doubanId: number;
  canDownload: boolean;
  favorited: boolean;
  onDownload: () => void;
  onToggleFavorite: () => void;
  onNext: () => void;
  onOpenDanmaku: () => void;
  onWrongMatch: () => void;
}

function splitClasses(cls?: string) {
  if (!cls) return [];
  return cls
    .split(/[,，/、\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 4);
}

function DetailTags({
  detail,
  year,
  withSource,
}: {
  detail: SearchResult | null;
  year: string;
  withSource: boolean;
}) {
  const classes = splitClasses(detail?.class);
  const y = detail?.year || year;
  return (
    <div className='flex flex-wrap gap-1.5 md:gap-2'>
      {classes.map((c) => (
        <span key={c} className='o-tag o-tag-sage font-semibold'>
          {c}
        </span>
      ))}
      {y && y !== 'unknown' && <span className='o-tag o-tag-neutral'>{y}</span>}
      {detail?.type_name && (
        <span className='o-tag o-tag-neutral'>{detail.type_name}</span>
      )}
      {withSource && detail?.source_name && (
        <span className='o-tag o-tag-outline'>{detail.source_name}</span>
      )}
    </div>
  );
}

function DoubanLink({
  doubanId,
  className,
  iconSize,
}: {
  doubanId: number;
  className: string;
  iconSize: number;
}) {
  const { t } = useI18n();
  if (!doubanId) return null;
  return (
    <a
      href={`https://movie.douban.com/subject/${doubanId}`}
      target='_blank'
      rel='noopener noreferrer'
      className={className}
    >
      <ExternalLink size={iconSize} strokeWidth={2.75} />
      {t.douban}
    </a>
  );
}

/** “更多”菜单：收藏、弹幕源、去搜索 */
export function MoreMenu({
  favorited,
  onToggleFavorite,
  onOpenDanmaku,
  onWrongMatch,
  trigger,
  align = 'left',
}: {
  favorited: boolean;
  onToggleFavorite: () => void;
  onOpenDanmaku: () => void;
  onWrongMatch: () => void;
  trigger: (props: {
    onClick: () => void;
    'aria-expanded': boolean;
  }) => ReactNode;
  align?: 'left' | 'right';
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const item = (icon: ReactNode, label: string, onClick: () => void) => (
    <button
      type='button'
      role='menuitem'
      onClick={() => {
        setOpen(false);
        onClick();
      }}
      className='flex w-full items-center gap-2.5 rounded-[14px] px-3 py-2.5 text-left text-sm font-semibold transition-colors hover:bg-o-bg'
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div ref={rootRef} className='relative'>
      {trigger({ onClick: () => setOpen((v) => !v), 'aria-expanded': open })}
      {open && (
        <div
          role='menu'
          className={`absolute top-full z-40 mt-2 w-60 animate-o-pop rounded-[20px] bg-o-surface p-1.5 shadow-o-lg ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {item(
            <Heart
              className={`h-4 w-4 ${
                favorited ? 'fill-o-accent text-o-accent' : ''
              }`}
              strokeWidth={2.75}
            />,
            favorited ? t.unfavorite : t.favorite,
            onToggleFavorite
          )}
          {item(
            <MessageSquareText className='h-4 w-4' strokeWidth={2.75} />,
            t.danmakuSource,
            onOpenDanmaku
          )}
          {item(
            <Search className='h-4 w-4' strokeWidth={2.75} />,
            t.wrongMatch,
            onWrongMatch
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 桌面：标题、标签、操作、简介 + 右侧“下一集”卡片
// ---------------------------------------------------------------------------
export function PlayDetailsDesktop(props: PlayDetailsProps) {
  const { t } = useI18n();
  const { detail } = props;

  return (
    <div className='grid grid-cols-[minmax(0,1fr)_380px] items-start gap-5'>
      <div className='flex max-w-[780px] flex-col gap-3.5'>
        <div className='flex flex-wrap items-baseline gap-x-4 gap-y-1'>
          <h1 className='m-0 font-heading text-[42px] leading-[1.12] tracking-[-0.015em]'>
            {props.title || t.untitled}
          </h1>
          {props.episodeLabel && (
            <span className='text-xl text-o-neutral-700'>
              {props.episodeLabel}
            </span>
          )}
        </div>
        <DetailTags detail={detail} year={props.year} withSource />
        <div className='flex gap-2'>
          {props.canDownload && (
            <button
              type='button'
              onClick={props.onDownload}
              className='o-btn o-btn-secondary'
            >
              <Download size={16} strokeWidth={2.75} />
              {t.download}
            </button>
          )}
          <DoubanLink
            doubanId={props.doubanId}
            className='o-btn o-btn-secondary'
            iconSize={16}
          />
          <MoreMenu
            favorited={props.favorited}
            onToggleFavorite={props.onToggleFavorite}
            onOpenDanmaku={props.onOpenDanmaku}
            onWrongMatch={props.onWrongMatch}
            trigger={(p) => (
              <button
                type='button'
                {...p}
                title={t.more}
                aria-label={t.more}
                className='o-btn o-btn-secondary o-btn-icon relative'
              >
                <MoreHorizontal size={16} strokeWidth={2.75} />
                {props.favorited && (
                  <span className='absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-o-accent' />
                )}
              </button>
            )}
          />
        </div>
        {detail?.desc && (
          <p className='m-0 mt-1.5 max-w-[68ch] whitespace-pre-line text-base leading-[1.7] text-o-neutral-800'>
            {detail.desc}
          </p>
        )}
      </div>

      {props.nextEpisodeLabel && (
        <button
          type='button'
          onClick={props.onNext}
          className='group flex items-center gap-3.5 rounded-[28px] bg-o-sage-100 p-4 text-left transition-colors hover:bg-o-sage-200'
        >
          <span className='relative h-[54px] w-24 flex-none overflow-hidden rounded-[14px] bg-o-sage-300'>
            {props.poster && (
              <img
                src={processImageUrl(props.poster)}
                alt=''
                className='h-full w-full object-cover opacity-80 [filter:saturate(0.6)_contrast(0.85)_brightness(1.1)]'
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            )}
          </span>
          <span className='min-w-0 flex-1'>
            <span className='block text-xs font-bold uppercase tracking-[0.08em] text-o-sage-800'>
              {t.upNext}
            </span>
            <span className='block truncate font-heading text-lg'>
              {props.nextEpisodeLabel}
            </span>
          </span>
          <span className='flex h-10 w-10 flex-none items-center justify-center rounded-full bg-o-sage-700 text-o-sage-100 transition-transform group-hover:scale-105'>
            <SkipForward
              size={16}
              className='fill-current'
              strokeWidth={2.75}
            />
          </span>
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 移动端：标题 + 标签 + 下载 / 豆瓣
// ---------------------------------------------------------------------------
export function PlayDetailsMobileHead(props: PlayDetailsProps) {
  const { t } = useI18n();
  return (
    <div className='flex flex-col gap-2.5'>
      <div className='flex flex-wrap items-baseline gap-x-2.5 gap-y-1'>
        <h3 className='m-0 font-heading text-[25px] leading-[1.12] tracking-[-0.015em]'>
          {props.title || t.untitled}
        </h3>
        {props.episodeLabel && (
          <span className='text-[15px] text-o-neutral-700'>
            {props.episodeLabel}
          </span>
        )}
      </div>
      <DetailTags detail={props.detail} year={props.year} withSource={false} />
      <div className='flex gap-2'>
        {props.canDownload && (
          <button
            type='button'
            onClick={props.onDownload}
            className='o-btn o-btn-secondary min-h-[44px] text-[13px]'
          >
            <Download size={15} strokeWidth={2.75} />
            {t.download}
          </button>
        )}
        <DoubanLink
          doubanId={props.doubanId}
          className='o-btn o-btn-secondary min-h-[44px] text-[13px]'
          iconSize={15}
        />
      </div>
    </div>
  );
}

export function PlayDescriptionMobile({ desc }: { desc?: string }) {
  if (!desc) return null;
  return (
    <p className='m-0 whitespace-pre-line text-sm leading-[1.65] text-o-neutral-800'>
      {desc}
    </p>
  );
}
