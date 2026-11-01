'use client';

import {
  AlertCircle,
  ChevronDown,
  Download,
  Loader2,
  Lock,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { addTask, DownloadConfig } from '@/lib/download-store';
import { formatTime } from '@/lib/formatTime';
import type {
  M3U8Task,
  OutputFormat,
  PlaylistVariant,
  StreamSaverMode,
} from '@/lib/m3u8-downloader';
import {
  estimateBytes,
  parseM3U8,
  rangeDuration,
  rangeFromSkipConfig,
  segmentStartTime,
} from '@/lib/m3u8-downloader';
import { supportsFileSystemAccess } from '@/lib/stream-saver-fallback';

import { toast } from './download/confirm';
import { DownloadDialog, formatBytes } from './download/DownloadDialog';
import { openDownloadManager } from './DownloadNavButton';
import { useI18n } from './LanguageProvider';

interface AddDownloadModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialUrl?: string;
  initialTitle?: string;
  skipConfig?: { enable: boolean; intro_time: number; outro_time: number };
  /** 加入后弹出提示（从播放页添加时用，用户看不到下载列表） */
  notifyOnAdd?: boolean;
}

interface Settings {
  type: OutputFormat;
  streamMode: StreamSaverMode;
  concurrency: number;
  maxRetries: number;
}

const SETTINGS_KEY = 'moontv_download_settings';
/** 普通下载超过这个大小时提示改用边下边存 */
const LARGE_FILE_BYTES = 1024 * 1024 * 1024;

const DEFAULT_SETTINGS: Settings = {
  type: 'MP4',
  streamMode: 'disabled',
  concurrency: 6,
  maxRetries: 3,
};

function loadSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
    if (saved && typeof saved === 'object')
      return { ...DEFAULT_SETTINGS, ...saved };
    // 兼容旧版本分散保存的设置
    const legacy: Partial<Settings> = {};
    const type = localStorage.getItem('downloadType');
    if (type === 'TS' || type === 'MP4') legacy.type = type;
    const mode = localStorage.getItem('streamMode');
    if (
      mode === 'disabled' ||
      mode === 'file-system' ||
      mode === 'service-worker'
    ) {
      legacy.streamMode = mode;
    }
    const c = parseInt(localStorage.getItem('concurrency') || '', 10);
    if (c >= 1 && c <= 16) legacy.concurrency = c;
    const r = parseInt(localStorage.getItem('maxRetries') || '', 10);
    if (r >= 0 && r <= 10) legacy.maxRetries = r;
    return { ...DEFAULT_SETTINGS, ...legacy };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(s: Settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    // ignore
  }
}

/** 播放页的去广告开关（默认开） */
function playerBlocksAds(): boolean {
  try {
    return localStorage.getItem('enable_blockad') !== 'false';
  } catch {
    return true;
  }
}

type ParseState =
  | { status: 'idle' }
  /** previous：切换清晰度 / 去广告重新解析时，先继续显示上一次的结果，避免整个表单跳动 */
  | { status: 'loading'; previous?: M3U8Task }
  | { status: 'ready'; task: M3U8Task }
  | { status: 'error'; message: string; code?: string };

function variantLabel(v: PlaylistVariant): string {
  const height = v.resolution?.split('x')[1];
  const parts = [height ? `${height}p` : v.resolution];
  if (v.bandwidth) parts.push(`${(v.bandwidth / 1e6).toFixed(1)} Mbps`);
  return parts.filter(Boolean).join(' · ') || v.url;
}

const FIELD =
  'w-full rounded-2xl border border-o-divider bg-o-surface px-3.5 py-2.5 text-[15px] text-o-ink outline-none transition-colors placeholder:text-o-neutral-500 focus:border-o-accent focus:ring-2 focus:ring-o-accent/25';
/** @tailwindcss/forms 的勾选框 / 单选框默认是蓝色（这里被映射成了绿色），改用主题色 */
const CHECK =
  'h-4 w-4 flex-none rounded border-o-neutral-500 bg-transparent text-o-accent focus:ring-o-accent/40 focus:ring-offset-0';
const RADIO =
  'h-4 w-4 flex-none border-o-neutral-500 bg-transparent text-o-accent focus:ring-o-accent/40 focus:ring-offset-0';
const LABEL = 'mb-1.5 block text-[13px] font-semibold text-o-neutral-800';

export default function AddDownloadModal(props: AddDownloadModalProps) {
  if (!props.isOpen) return null;
  return <AddDownloadForm {...props} />;
}

function AddDownloadForm({
  onClose,
  initialUrl = '',
  initialTitle = '',
  skipConfig,
  notifyOnAdd = false,
}: AddDownloadModalProps) {
  const { t } = useI18n();
  const [url, setUrl] = useState(initialUrl);
  const [title, setTitle] = useState(initialTitle);
  const [parse, setParse] = useState<ParseState>({ status: 'idle' });
  const [variants, setVariants] = useState<PlaylistVariant[]>([]);
  // 只在打开时挂载（服务端不渲染），可以直接读取本地设置，避免先显示默认值再跳变
  const [settings, setSettings] = useState<Settings>(() => {
    const saved = loadSettings();
    if (saved.streamMode === 'file-system' && !supportsFileSystemAccess()) {
      saved.streamMode = 'disabled';
    }
    return saved;
  });
  const [removeAds, setRemoveAds] = useState(playerBlocksAds);
  const [support, setSupport] = useState(() => ({
    fileSystem: supportsFileSystemAccess(),
    serviceWorker: false,
  }));
  const [rangeOn, setRangeOn] = useState(false);
  const [useSkip, setUseSkip] = useState(false);
  const [start, setStart] = useState(1);
  const [end, setEnd] = useState(1);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const variantsRef = useRef<PlaylistVariant[]>([]);

  const hasSkip =
    !!skipConfig && (skipConfig.intro_time > 0 || skipConfig.outro_time < 0);

  // 读取设置与浏览器能力
  useEffect(() => {
    let cancelled = false;
    import('@/lib/stream-saver').then(({ isStreamSaverSupported }) => {
      if (cancelled) return;
      const serviceWorker = isStreamSaverSupported();
      setSupport((prev) => ({ ...prev, serviceWorker }));
      // 保存的方式在这个浏览器上不可用时退回普通下载
      if (!serviceWorker) {
        setSettings((prev) =>
          prev.streamMode === 'service-worker'
            ? { ...prev, streamMode: 'disabled' }
            : prev
        );
      }
    });
    return () => {
      cancelled = true;
      requestRef.current?.abort();
    };
  }, []);

  const updateSettings = (patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  };

  const load = useCallback(
    async (target: string, opts: { keepVariants?: boolean; ads: boolean }) => {
      const trimmed = target.trim();
      if (!trimmed) return;
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      setParse((prev) => ({
        status: 'loading',
        previous: opts.keepVariants
          ? prev.status === 'ready'
            ? prev.task
            : prev.status === 'loading'
            ? prev.previous
            : undefined
          : undefined,
      }));
      setSubmitError(null);
      try {
        const task = await parseM3U8(trimmed, {
          removeAds: opts.ads,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (task.variants?.length) {
          variantsRef.current = task.variants;
          setVariants(task.variants);
        } else if (opts.keepVariants) {
          // 直接解析某个码率时没有主播放列表，从之前的码率列表里取带宽，用于估算大小
          const variant = variantsRef.current.find((v) => v.url === task.url);
          task.bandwidth = variant?.bandwidth;
        } else {
          variantsRef.current = [];
          setVariants([]);
        }
        setParse({ status: 'ready', task });
      } catch (e) {
        if (controller.signal.aborted) return;
        const code =
          e && typeof e === 'object' && 'code' in e
            ? String(e.code)
            : undefined;
        setParse({
          status: 'error',
          code,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    },
    []
  );

  // 打开时有地址就直接解析；打开期间播放页换了集，也跟着换
  useEffect(() => {
    setUrl(initialUrl);
    if (initialUrl) void load(initialUrl, { ads: playerBlocksAds() });
  }, [initialUrl, load]);
  useEffect(() => setTitle(initialTitle), [initialTitle]);

  const task =
    parse.status === 'ready'
      ? parse.task
      : parse.status === 'loading'
      ? parse.previous ?? null
      : null;
  const reloading = parse.status === 'loading' && !!task;
  const count = task?.tsUrlList.length ?? 0;
  const isFmp4 = !!task?.initSegmentUrl;

  // 解析完成（含切换清晰度、去广告重新解析）后初始化下载范围
  const useSkipRef = useRef(useSkip);
  useSkipRef.current = useSkip;
  useEffect(() => {
    if (!task) return;
    if (useSkipRef.current && skipConfig) {
      const r = rangeFromSkipConfig(
        task,
        skipConfig.intro_time,
        skipConfig.outro_time
      );
      setStart(r.start);
      setEnd(r.end);
    } else {
      setStart((s) => Math.min(Math.max(1, s), task.tsUrlList.length));
      setEnd(task.tsUrlList.length);
    }
    // skipConfig 只在勾选「按片头片尾设置」时读取
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task]);

  const rangeStart = rangeOn ? start : 1;
  const rangeEnd = rangeOn ? end : count;
  const rangeValid = !rangeOn || (start >= 1 && end <= count && start <= end);
  const duration = task ? rangeDuration(task, rangeStart, rangeEnd) : 0;
  const estimate = task ? estimateBytes(task, rangeStart, rangeEnd) : null;
  const largeInMemory =
    settings.streamMode === 'disabled' &&
    estimate !== null &&
    estimate > LARGE_FILE_BYTES;
  const selectedVariant = task && variants.find((v) => v.url === task.url);

  const errorText = (() => {
    if (parse.status !== 'error') return null;
    const known = parse.code
      ? t.dl.errors[parse.code as keyof typeof t.dl.errors]
      : undefined;
    if (!known || parse.code === 'unknown') return parse.message;
    return parse.code === 'http' ? `${known} (${parse.message})` : known;
  })();

  const handleAdd = () => {
    if (!task || reloading || !rangeValid || submitting) return;
    const config: DownloadConfig = {
      type: isFmp4 ? 'MP4' : settings.type,
      concurrency: settings.concurrency,
      maxRetries: settings.maxRetries,
      streamMode: settings.streamMode,
      removeAds,
      range: rangeOn ? { start, end } : null,
    };
    setSubmitting(true);
    setSubmitError(null);
    // 直写磁盘时 addTask 会立刻弹出保存框，必须在这次点击里同步调用
    void addTask({
      url: task.url,
      title: title.trim() || task.title,
      config,
      parsedTask: task,
    }).then((result) => {
      setSubmitting(false);
      if (!result.ok) {
        setSubmitError(
          result.reason === 'cancelled' ? t.dl.pickerCancelled : result.message
        );
        return;
      }
      onClose();
      if (notifyOnAdd) {
        void toast({ title: t.dl.added, actionText: t.dl.view }).then(
          (view) => {
            if (view) openDownloadManager();
          }
        );
      }
    });
  };

  const modes: Array<{
    value: StreamSaverMode;
    label: string;
    hint: string;
    supported: boolean;
  }> = [
    {
      value: 'disabled',
      label: t.dl.modeMemory,
      hint: t.dl.modeMemoryHint,
      supported: true,
    },
    {
      value: 'file-system',
      label: t.dl.modeDisk,
      hint: t.dl.modeDiskHint,
      supported: support.fileSystem,
    },
    {
      value: 'service-worker',
      label: t.dl.modeStream,
      hint: t.dl.modeStreamHint,
      supported: support.serviceWorker,
    },
  ];
  const recommendedMode: StreamSaverMode | null = largeInMemory
    ? support.fileSystem
      ? 'file-system'
      : support.serviceWorker
      ? 'service-worker'
      : null
    : null;

  return (
    <DownloadDialog
      onClose={onClose}
      title={t.dl.addTitle}
      icon={<Download className='h-[18px] w-[18px]' strokeWidth={2.5} />}
      closeLabel={t.dl.close}
      layer={2}
      footer={
        <div className='space-y-2'>
          {submitError && (
            <p className='m-0 flex items-start gap-1.5 text-[13px] text-red-700 dark:text-red-300'>
              <AlertCircle
                className='mt-px h-4 w-4 flex-none'
                strokeWidth={2.5}
              />
              {submitError}
            </p>
          )}
          <div className='flex items-center gap-3'>
            {settings.streamMode === 'file-system' && task && (
              <span className='hidden text-[12.5px] text-o-neutral-700 sm:block'>
                {t.dl.pickLocationNext}
              </span>
            )}
            <button
              type='button'
              className='o-btn o-btn-secondary ml-auto'
              onClick={onClose}
            >
              {t.cancel}
            </button>
            <button
              type='button'
              className='o-btn o-btn-primary'
              onClick={handleAdd}
              disabled={!task || reloading || !rangeValid || submitting}
            >
              {submitting ? (
                <Loader2 className='h-4 w-4 animate-spin' />
              ) : (
                <Download className='h-4 w-4' strokeWidth={2.5} />
              )}
              {t.dl.add}
            </button>
          </div>
        </div>
      }
    >
      <form
        className='space-y-5'
        onSubmit={(e) => {
          e.preventDefault();
          void load(url, { ads: removeAds });
        }}
      >
        {/* 链接 */}
        <div>
          <label htmlFor='dl-url' className={LABEL}>
            {t.dl.url}
          </label>
          <div className='flex gap-2'>
            <input
              id='dl-url'
              type='url'
              inputMode='url'
              autoComplete='off'
              spellCheck={false}
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                // 地址变了，之前的解析结果作废
                if (parse.status !== 'idle') {
                  requestRef.current?.abort();
                  setParse({ status: 'idle' });
                  setVariants([]);
                  variantsRef.current = [];
                }
              }}
              onPaste={(e) => {
                const pasted = e.clipboardData.getData('text').trim();
                if (/^https?:\/\//i.test(pasted)) {
                  e.preventDefault();
                  setUrl(pasted);
                  void load(pasted, { ads: removeAds });
                }
              }}
              className={`${FIELD} min-w-0 flex-1`}
              placeholder={t.dl.urlPlaceholder}
              autoFocus={!initialUrl}
            />
            <button
              type='submit'
              className='o-btn o-btn-secondary flex-none'
              disabled={!url.trim() || parse.status === 'loading'}
            >
              {parse.status === 'loading' ? (
                <Loader2 className='h-4 w-4 animate-spin' />
              ) : (
                t.dl.load
              )}
            </button>
          </div>
        </div>

        {parse.status === 'loading' && !task && (
          <div className='flex items-center gap-2 rounded-2xl bg-o-surface px-4 py-3 text-sm text-o-neutral-700'>
            <Loader2 className='h-4 w-4 animate-spin text-o-accent' />
            {t.dl.loading}
          </div>
        )}

        {parse.status === 'error' && (
          <div className='flex items-start gap-2 rounded-2xl bg-red-500/10 px-4 py-3 text-sm text-red-800 dark:text-red-200'>
            <AlertCircle
              className='mt-0.5 h-4 w-4 flex-none'
              strokeWidth={2.5}
            />
            <div className='min-w-0 flex-1'>
              <div className='font-semibold'>{t.dl.loadFailed}</div>
              <div className='break-words'>{errorText}</div>
            </div>
            <button
              type='button'
              className='o-btn o-btn-ghost -my-1 flex-none !text-red-800 dark:!text-red-200'
              onClick={() => void load(url, { ads: removeAds })}
            >
              <RefreshCw className='h-3.5 w-3.5' strokeWidth={2.5} />
              {t.dl.retry}
            </button>
          </div>
        )}

        {task && (
          <div
            className={`space-y-5 transition-opacity ${
              reloading ? 'pointer-events-none opacity-60' : ''
            }`}
            aria-busy={reloading}
          >
            {/* 概要 */}
            <dl className='m-0 grid grid-cols-3 gap-2 rounded-2xl bg-o-surface p-3 text-center'>
              <div>
                <dt className='text-[11.5px] text-o-neutral-700'>
                  {t.dl.duration}
                </dt>
                <dd className='m-0 mt-0.5 font-semibold tabular-nums'>
                  {formatTime(task.durationSecond)}
                </dd>
              </div>
              <div>
                <dt className='text-[11.5px] text-o-neutral-700'>
                  {t.dl.segmentCount}
                </dt>
                <dd className='m-0 mt-0.5 font-semibold tabular-nums'>
                  {count}
                </dd>
              </div>
              <div>
                <dt className='text-[11.5px] text-o-neutral-700'>
                  {t.dl.estSize}
                </dt>
                <dd className='m-0 mt-0.5 font-semibold tabular-nums'>
                  {estimate !== null ? `≈ ${formatBytes(estimate)}` : '—'}
                </dd>
              </div>
            </dl>
            {(task.keys.length > 0 || isFmp4 || task.adsRemoved) && (
              <div className='-mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-o-neutral-700'>
                {task.keys.length > 0 && (
                  <span className='inline-flex items-center gap-1'>
                    <Lock className='h-3.5 w-3.5' strokeWidth={2.5} />
                    {t.dl.encrypted} (AES-128)
                  </span>
                )}
                {isFmp4 && <span>{t.dl.fmp4}</span>}
                {task.adsRemoved && (
                  <span className='inline-flex items-center gap-1 text-o-sage-700'>
                    <Sparkles className='h-3.5 w-3.5' strokeWidth={2.5} />
                    {t.dl.adsFound(
                      task.adsRemoved.segments,
                      Math.round(task.adsRemoved.seconds)
                    )}
                  </span>
                )}
              </div>
            )}

            {/* 文件名 */}
            <div>
              <label htmlFor='dl-title' className={LABEL}>
                {t.dl.fileName}
              </label>
              <div className='flex items-center gap-2'>
                <input
                  id='dl-title'
                  type='text'
                  value={title}
                  placeholder={task.title}
                  onChange={(e) => setTitle(e.target.value)}
                  className={`${FIELD} min-w-0 flex-1`}
                />
                <span className='flex-none text-sm text-o-neutral-700'>
                  .{(isFmp4 ? 'MP4' : settings.type).toLowerCase()}
                </span>
              </div>
            </div>

            {/* 清晰度 */}
            {variants.length > 1 && (
              <div>
                <label htmlFor='dl-quality' className={LABEL}>
                  {t.dl.quality}
                </label>
                <select
                  id='dl-quality'
                  className={FIELD}
                  value={selectedVariant?.url ?? ''}
                  onChange={(e) =>
                    void load(e.target.value, {
                      keepVariants: true,
                      ads: removeAds,
                    })
                  }
                >
                  {variants.map((v) => (
                    <option key={v.url} value={v.url}>
                      {variantLabel(v)}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* 格式 */}
            {!isFmp4 && (
              <fieldset className='m-0 border-0 p-0'>
                <legend className={LABEL}>{t.dl.format}</legend>
                <div className='grid grid-cols-2 gap-2'>
                  {(['MP4', 'TS'] as const).map((type) => (
                    <label
                      key={type}
                      className={`cursor-pointer rounded-2xl border px-3.5 py-2.5 transition-colors ${
                        settings.type === type
                          ? 'border-o-accent bg-o-accent/10'
                          : 'border-o-divider hover:bg-o-ink/[0.04]'
                      }`}
                    >
                      <input
                        type='radio'
                        name='dl-format'
                        className='sr-only'
                        checked={settings.type === type}
                        onChange={() => updateSettings({ type })}
                      />
                      <span className='block font-semibold'>{type}</span>
                      <span className='block text-[12.5px] leading-snug text-o-neutral-700'>
                        {type === 'MP4' ? t.dl.formatMp4 : t.dl.formatTs}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}

            {/* 保存方式 */}
            <fieldset className='m-0 border-0 p-0'>
              <legend className={LABEL}>{t.dl.saveMethod}</legend>
              <div className='space-y-2'>
                {modes.map((m) => (
                  <label
                    key={m.value}
                    className={`flex items-start gap-3 rounded-2xl border px-3.5 py-2.5 transition-colors ${
                      !m.supported
                        ? 'cursor-not-allowed border-o-divider opacity-50'
                        : settings.streamMode === m.value
                        ? 'cursor-pointer border-o-accent bg-o-accent/10'
                        : 'cursor-pointer border-o-divider hover:bg-o-ink/[0.04]'
                    }`}
                  >
                    <input
                      type='radio'
                      name='dl-mode'
                      className={`mt-1 ${RADIO}`}
                      checked={settings.streamMode === m.value}
                      disabled={!m.supported}
                      onChange={() => updateSettings({ streamMode: m.value })}
                    />
                    <span className='min-w-0'>
                      <span className='flex items-center gap-2 font-semibold'>
                        {m.label}
                        {recommendedMode === m.value && (
                          <span className='rounded-full bg-o-sage-100 px-2 py-px text-[11px] font-medium text-o-sage-800'>
                            {t.dl.recommended}
                          </span>
                        )}
                      </span>
                      <span className='block text-[12.5px] leading-snug text-o-neutral-700'>
                        {m.supported ? m.hint : t.dl.unsupportedHere}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              {largeInMemory && estimate !== null && (
                <p className='m-0 mt-2 flex items-start gap-1.5 text-[12.5px] text-o-accent-800 dark:text-o-accent-300'>
                  <AlertCircle
                    className='mt-px h-3.5 w-3.5 flex-none'
                    strokeWidth={2.5}
                  />
                  {t.dl.largeFile(formatBytes(estimate))}
                </p>
              )}
            </fieldset>

            {/* 下载范围 */}
            <div className='rounded-2xl border border-o-divider px-3.5 py-3'>
              <label className='flex cursor-pointer items-center justify-between gap-3'>
                <span className='font-semibold'>{t.dl.partial}</span>
                <input
                  type='checkbox'
                  className={CHECK}
                  checked={rangeOn}
                  onChange={(e) => setRangeOn(e.target.checked)}
                />
              </label>
              {rangeOn && (
                <div className='mt-3 space-y-3'>
                  {hasSkip && (
                    <label className='flex cursor-pointer items-center gap-2 text-[13px]'>
                      <input
                        type='checkbox'
                        className={CHECK}
                        checked={useSkip}
                        onChange={(e) => {
                          setUseSkip(e.target.checked);
                          if (e.target.checked && skipConfig) {
                            const r = rangeFromSkipConfig(
                              task,
                              skipConfig.intro_time,
                              skipConfig.outro_time
                            );
                            setStart(r.start);
                            setEnd(r.end);
                          }
                        }}
                      />
                      {t.dl.useSkip}
                    </label>
                  )}
                  {(
                    [
                      ['from', start, setStart, segmentStartTime(task, start)],
                      ['to', end, setEnd, segmentStartTime(task, end + 1)],
                    ] as const
                  ).map(([key, value, set, time]) => (
                    <div key={key}>
                      <div className='mb-1 flex items-center justify-between text-[13px]'>
                        <label
                          htmlFor={`dl-range-${key}`}
                          className='text-o-neutral-800'
                        >
                          {key === 'from' ? t.dl.from : t.dl.to}
                        </label>
                        <span className='tabular-nums text-o-neutral-700'>
                          {t.dl.segmentN(value)} · {formatTime(time)}
                        </span>
                      </div>
                      <input
                        id={`dl-range-${key}`}
                        type='range'
                        min={1}
                        max={count}
                        value={value}
                        onChange={(e) => {
                          setUseSkip(false);
                          set(parseInt(e.target.value, 10));
                        }}
                        className='w-full accent-[rgb(var(--o-accent))]'
                      />
                    </div>
                  ))}
                  <p
                    className={`m-0 text-[12.5px] ${
                      rangeValid
                        ? 'text-o-neutral-700'
                        : 'text-red-700 dark:text-red-300'
                    }`}
                    role={rangeValid ? undefined : 'alert'}
                  >
                    {rangeValid
                      ? t.dl.rangeSummary(end - start + 1, formatTime(duration))
                      : t.dl.rangeInvalid}
                  </p>
                </div>
              )}
            </div>

            {/* 高级设置 */}
            <div>
              <button
                type='button'
                className='flex w-full items-center justify-between text-[13px] font-semibold text-o-neutral-800'
                aria-expanded={advancedOpen}
                onClick={() => setAdvancedOpen((v) => !v)}
              >
                {t.dl.advanced}
                <ChevronDown
                  className={`h-4 w-4 transition-transform ${
                    advancedOpen ? 'rotate-180' : ''
                  }`}
                  strokeWidth={2.5}
                />
              </button>
              {advancedOpen && (
                <div className='mt-3 space-y-4'>
                  <label className='flex cursor-pointer items-start justify-between gap-3'>
                    <span>
                      <span className='block text-[14px]'>
                        {t.dl.removeAds}
                      </span>
                      <span className='block text-[12.5px] text-o-neutral-700'>
                        {t.dl.removeAdsHint}
                      </span>
                    </span>
                    <input
                      type='checkbox'
                      className={`mt-1 ${CHECK}`}
                      checked={removeAds}
                      onChange={(e) => {
                        setRemoveAds(e.target.checked);
                        // 去广告会改变片段列表，需要重新解析
                        void load(task.url, {
                          keepVariants: true,
                          ads: e.target.checked,
                        });
                      }}
                    />
                  </label>
                  {(
                    [
                      ['concurrency', t.dl.threads, 1, 16],
                      ['maxRetries', t.dl.retries, 0, 10],
                    ] as const
                  ).map(([key, label, min, max]) => (
                    <div key={key}>
                      <div className='mb-1 flex items-center justify-between text-[14px]'>
                        <label htmlFor={`dl-${key}`}>{label}</label>
                        <span className='font-semibold tabular-nums'>
                          {settings[key]}
                        </span>
                      </div>
                      <input
                        id={`dl-${key}`}
                        type='range'
                        min={min}
                        max={max}
                        value={settings[key]}
                        onChange={(e) =>
                          updateSettings({
                            [key]: parseInt(e.target.value, 10),
                          })
                        }
                        className='w-full accent-[rgb(var(--o-accent))]'
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </form>
    </DownloadDialog>
  );
}
