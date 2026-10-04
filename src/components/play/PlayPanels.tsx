'use client';

import { ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { SearchResult } from '@/lib/types';

import {
  AutoPickButton,
  EpisodeGrid,
  EpisodeHeader,
  EpisodeRanges,
  QualityTag,
  SourceDot,
  SourceRow,
  SourceStats,
  useEpisodeOrder,
  WrongMatchButton,
} from './PlayPanelParts';
import { sourceKeyOf, VideoInfo } from './useSourceSpeedTest';
import { useI18n } from '../LanguageProvider';

export interface PlayPanelProps {
  detail: SearchResult | null;
  episodeIndex: number;
  onEpisodeChange: (index: number) => void;
  availableSources: SearchResult[];
  sourceSearchLoading: boolean;
  sourceSearchError: string | null;
  infoMap: Map<string, VideoInfo>;
  isMeasuring: (s: SearchResult) => boolean;
  /** 正在切换到的源（显示“切换中…”） */
  pendingSourceKey: string | null;
  sourcesExpanded: boolean;
  onSourcesExpandedChange: (expanded: boolean) => void;
  onSourceSelect: (source: SearchResult) => void;
  autoPicking: boolean;
  onAutoPick: () => void;
  onCancelAutoPick: () => void;
  onWrongMatch: () => void;
}

function useOtherSources(props: PlayPanelProps) {
  const { detail, availableSources } = props;
  const currentKey = detail ? sourceKeyOf(detail) : '';
  return availableSources.filter((s) => sourceKeyOf(s) !== currentKey);
}

function SourceListStatus({ props }: { props: PlayPanelProps }) {
  const { t } = useI18n();
  if (props.sourceSearchLoading) {
    return (
      <div className='flex items-center gap-2 px-1 py-3 text-[13px] font-semibold text-o-neutral-700'>
        <Loader2 className='h-4 w-4 animate-spin' strokeWidth={2.75} />
        {t.searchingSources}
      </div>
    );
  }
  if (props.sourceSearchError) {
    return (
      <div className='px-1 py-3 text-[13px] font-semibold text-o-accent-700'>
        {props.sourceSearchError}
      </div>
    );
  }
  return (
    <div className='px-1 py-3 text-[13px] text-o-neutral-700'>
      {t.noSources}
    </div>
  );
}

function OtherSourceRows({
  props,
  others,
  tone,
}: {
  props: PlayPanelProps;
  others: SearchResult[];
  tone: 'bg' | 'surface';
}) {
  if (others.length === 0) return <SourceListStatus props={props} />;
  return (
    <>
      {others.map((s) => {
        const key = sourceKeyOf(s);
        return (
          <SourceRow
            key={key}
            source={s}
            info={props.infoMap.get(key)}
            measuring={props.isMeasuring(s)}
            pending={props.pendingSourceKey === key}
            currentTitle={props.detail?.title || ''}
            disabled={!!props.pendingSourceKey}
            onSelect={() => props.onSourceSelect(s)}
            tone={tone}
          />
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// 桌面：与播放器等高的侧栏，播放源与选集同屏，无标签页
// ---------------------------------------------------------------------------
export function PlaySidePanel(props: PlayPanelProps) {
  const { t } = useI18n();
  const { detail, episodeIndex, sourcesExpanded, onSourcesExpandedChange } =
    props;
  const others = useOtherSources(props);
  const total = detail?.episodes?.length || 0;
  const isSeries = total > 1;
  // 电影没有选集，源列表常驻
  const expanded = sourcesExpanded || !isSeries;
  const switching = !!props.pendingSourceKey;
  const currentInfo = detail
    ? props.infoMap.get(sourceKeyOf(detail))
    : undefined;
  const order = useEpisodeOrder(total, episodeIndex);

  return (
    <div className='flex h-full flex-col gap-5 overflow-hidden rounded-[28px] bg-o-surface p-5'>
      {/* 播放源 */}
      <div
        className={`flex flex-col gap-2.5 ${
          expanded ? 'min-h-0 flex-1' : 'flex-none'
        }`}
      >
        <div className='flex flex-none items-center justify-between'>
          <span className='o-eyebrow'>{t.source}</span>
          <AutoPickButton
            picking={props.autoPicking}
            disabled={props.availableSources.length < 2 || switching}
            onPick={props.onAutoPick}
            onCancel={props.onCancelAutoPick}
          />
        </div>

        {detail && (
          <div
            className={`flex flex-none flex-col gap-3 rounded-[20px] bg-o-bg p-3.5 transition-opacity ${
              switching ? 'opacity-60' : ''
            }`}
          >
            <div className='flex min-w-0 items-center gap-2.5'>
              <SourceDot dim={switching} />
              <span className='truncate font-heading text-lg leading-tight'>
                {detail.source_name}
              </span>
              <QualityTag info={currentInfo} />
            </div>
            <SourceStats
              info={currentInfo}
              measuring={props.isMeasuring(detail)}
              episodes={total}
              withIcons
            />
            {isSeries && (
              <button
                type='button'
                onClick={() => onSourcesExpandedChange(!sourcesExpanded)}
                aria-expanded={sourcesExpanded}
                className='o-btn o-btn-secondary w-full px-3 py-[7px] text-[13px]'
              >
                {sourcesExpanded
                  ? t.collapse
                  : props.sourceSearchLoading && others.length === 0
                  ? t.searchingSources
                  : others.length > 0
                  ? t.moreSources(others.length)
                  : t.noSources}
                {sourcesExpanded ? (
                  <ChevronUp className='h-3.5 w-3.5' strokeWidth={2.75} />
                ) : (
                  <ChevronDown className='h-3.5 w-3.5' strokeWidth={2.75} />
                )}
              </button>
            )}
          </div>
        )}

        {expanded && (
          <>
            <div className='flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto'>
              <OtherSourceRows props={props} others={others} tone='bg' />
            </div>
            <WrongMatchButton onClick={props.onWrongMatch} />
          </>
        )}
      </div>

      {/* 选集 */}
      {isSeries && !sourcesExpanded && (
        <div className='flex min-h-0 flex-1 flex-col gap-3'>
          <EpisodeHeader
            total={total}
            descending={order.descending}
            onToggleOrder={order.toggleOrder}
          />
          <EpisodeRanges
            ranges={order.ranges}
            page={order.page}
            onSelect={order.setPage}
          />
          <EpisodeGrid
            indices={order.indices}
            titles={detail?.episodes_titles || []}
            currentIndex={episodeIndex}
            onSelect={props.onEpisodeChange}
            size='desktop'
            scrollable
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 移动端：播放器下方依次是源卡片、选集
// ---------------------------------------------------------------------------
const MOBILE_COLLAPSED_COUNT = 18;

export function PlayMobileSourceCard(props: PlayPanelProps) {
  const { t } = useI18n();
  const { detail, sourcesExpanded, onSourcesExpandedChange } = props;
  const others = useOtherSources(props);
  const switching = !!props.pendingSourceKey;
  const currentInfo = detail
    ? props.infoMap.get(sourceKeyOf(detail))
    : undefined;
  if (!detail) return null;

  return (
    <div className='flex flex-col gap-2.5 rounded-[24px] bg-o-surface p-3.5'>
      <div className='flex items-center justify-between'>
        <span className='o-eyebrow'>{t.source}</span>
        <AutoPickButton
          picking={props.autoPicking}
          disabled={props.availableSources.length < 2 || switching}
          onPick={props.onAutoPick}
          onCancel={props.onCancelAutoPick}
        />
      </div>
      <div
        className={`flex min-w-0 items-center gap-2.5 transition-opacity ${
          switching ? 'opacity-60' : ''
        }`}
      >
        <SourceDot dim={switching} />
        <span className='truncate font-heading text-[17px] leading-tight'>
          {detail.source_name}
        </span>
        <QualityTag info={currentInfo} />
      </div>
      <SourceStats
        info={currentInfo}
        measuring={props.isMeasuring(detail)}
        episodes={detail.episodes?.length || 0}
        trailing={
          <button
            type='button'
            onClick={() => onSourcesExpandedChange(!sourcesExpanded)}
            aria-expanded={sourcesExpanded}
            className='-my-2 ml-auto flex min-h-[44px] items-center gap-1 whitespace-nowrap text-o-accent-700'
          >
            {sourcesExpanded ? t.collapse : t.changeShort}
            {sourcesExpanded ? (
              <ChevronUp className='h-3.5 w-3.5' strokeWidth={2.75} />
            ) : (
              <ChevronDown className='h-3.5 w-3.5' strokeWidth={2.75} />
            )}
          </button>
        }
      />
      {sourcesExpanded && (
        <div className='flex flex-col gap-1.5 pt-1'>
          <OtherSourceRows props={props} others={others} tone='bg' />
          <WrongMatchButton onClick={props.onWrongMatch} />
        </div>
      )}
    </div>
  );
}

export function PlayMobileEpisodes(props: PlayPanelProps) {
  const { t } = useI18n();
  const { detail, episodeIndex } = props;
  const total = detail?.episodes?.length || 0;
  const order = useEpisodeOrder(total, episodeIndex);
  const [showAll, setShowAll] = useState(false);

  // 当前集不在前 18 个里时默认展开，保证能看到它
  useEffect(() => {
    const pos = order.indices.indexOf(episodeIndex);
    if (pos >= MOBILE_COLLAPSED_COUNT) setShowAll(true);
  }, [episodeIndex, order.indices]);

  if (total <= 1) return null;
  const visible = showAll
    ? order.indices
    : order.indices.slice(0, MOBILE_COLLAPSED_COUNT);
  const canCollapse = order.indices.length > MOBILE_COLLAPSED_COUNT;

  return (
    <div className='flex flex-col gap-3'>
      <EpisodeHeader
        total={total}
        descending={order.descending}
        onToggleOrder={order.toggleOrder}
        large
      />
      <EpisodeRanges
        ranges={order.ranges}
        page={order.page}
        onSelect={order.setPage}
      />
      <EpisodeGrid
        indices={visible}
        titles={detail?.episodes_titles || []}
        currentIndex={episodeIndex}
        onSelect={props.onEpisodeChange}
        size='mobile'
      />
      {canCollapse && (
        <button
          type='button'
          onClick={() => setShowAll((v) => !v)}
          aria-expanded={showAll}
          className='o-btn o-btn-secondary min-h-[44px] text-[13px]'
        >
          {showAll ? t.collapseEps : t.showAllEps(order.indices.length)}
          {showAll ? (
            <ChevronUp className='h-3.5 w-3.5' strokeWidth={2.75} />
          ) : (
            <ChevronDown className='h-3.5 w-3.5' strokeWidth={2.75} />
          )}
        </button>
      )}
    </div>
  );
}
