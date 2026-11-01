/**
 * 下载任务中心（与 React 无关的单例）
 *
 * - 任务状态放在这里而不是组件 state：下载管理器关掉、切换页面都不影响下载，
 *   导航栏的角标直接订阅这里，不再反复解析 localStorage；
 * - 进度更新合并后再通知（PROGRESS_THROTTLE_MS），持久化做防抖，
 *   下载一部几千个切片的剧集也不会让页面频繁重渲染、频繁写存储；
 * - 同时最多 MAX_ACTIVE 个任务在下载，其余排队，避免同一个 CDN 被几十个连接挤爆；
 * - 任务列表存在 sessionStorage：下载数据只存在于当前标签页，刷新后能恢复列表并自动重新开始，
 *   而不会被别的标签页读到后重复下载；
 * - 引擎（解析 / 下载 / 转封装）按需动态加载，不进入首屏代码。
 */

import { buildFilename } from './download-filename';
import type {
  DownloadErrorCode,
  DownloadJob,
  M3U8Task,
  OutputFormat,
  StreamSaverMode,
} from './m3u8-downloader';
import {
  createFileSystemWriteStream,
  FilePickerError,
} from './stream-saver-fallback';

export type TaskStatus =
  | 'queued'
  | 'preparing'
  | 'downloading'
  | 'paused'
  | 'merging'
  | 'completed'
  /** 内存模式下有切片失败：已下载的数据保留，可以重试或直接保存 */
  | 'incomplete'
  | 'error';

export interface DownloadConfig {
  type: OutputFormat;
  concurrency: number;
  maxRetries: number;
  streamMode: StreamSaverMode;
  removeAds: boolean;
  /** 下载范围（1 起始，含两端）；null 表示完整下载 */
  range: { start: number; end: number } | null;
}

export type TaskNotice =
  /** Service Worker 边下边存不可用，已改用内存模式 */
  | 'sw-fallback'
  /** 无法转封装为 MP4，已保存为 TS */
  | 'saved-as-ts';

export interface DownloadTaskView {
  id: string;
  url: string;
  title: string;
  createdAt: number;
  config: DownloadConfig;
  status: TaskStatus;
  /** 下载范围内已成功 / 失败的切片数，以及范围内的切片总数 */
  done: number;
  failed: number;
  total: number;
  /** 已接收的字节数 */
  bytes: number;
  /** 字节 / 秒 */
  speed: number;
  /** 预计剩余秒数，无法估计时为 null */
  eta: number | null;
  mergePercent: number;
  /** 下载范围的时长（秒） */
  duration: number;
  /** 下载范围的起止时间（秒），完整下载时为 null */
  timeRange: { from: number; to: number } | null;
  adsRemoved?: { segments: number; seconds: number };
  /** 完成时没有写进文件的切片数（失败跳过或立即保存时未下载） */
  skipped: number;
  /** 实际保存的格式 */
  savedFormat?: OutputFormat;
  error?: { code: DownloadErrorCode | 'picker' | 'unknown'; message: string };
  notice?: TaskNotice;
  /** 刷新页面后恢复的任务：下载会从头开始 */
  restored?: boolean;
  /** 需要点击「继续」重新选择保存位置（文件系统直写模式在刷新后无法自动恢复） */
  needsGesture?: boolean;
}

export interface AddTaskInput {
  url: string;
  title: string;
  config: DownloadConfig;
  /** 已解析好的播放列表，省去再次解析 */
  parsedTask?: M3U8Task;
}

export type AddTaskResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'cancelled' | 'denied'; message: string };

interface Runtime {
  task?: M3U8Task;
  job?: DownloadJob;
  /** 文件系统直写：在用户点击时就打开的写入流 */
  sink?: WritableStream<Uint8Array>;
  /** 本次运行的字节数、完成数（用于估算剩余时间） */
  runBytes: number;
  runDoneStart: number;
  bytesTotal: number;
  samples: Array<{ t: number; bytes: number }>;
  /** 正在启动或运行中，防止重复启动 */
  running: boolean;
}

export const MAX_ACTIVE = 2;
const PROGRESS_THROTTLE_MS = 200;
const PERSIST_DEBOUNCE_MS = 1000;
const SPEED_WINDOW_MS = 5000;
const STORAGE_KEY = 'moontv_downloads';
const LEGACY_STORAGE_KEY = 'downloadTasks';

const ACTIVE: TaskStatus[] = ['queued', 'preparing', 'downloading', 'merging'];
/** 占用下载名额的状态 */
const RUNNING: TaskStatus[] = ['preparing', 'downloading', 'merging'];

const EMPTY: DownloadTaskView[] = [];

let tasks: DownloadTaskView[] = EMPTY;
const runtimes = new Map<string, Runtime>();
const listeners = new Set<() => void>();
let emitTimer: ReturnType<typeof setTimeout> | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let ticker: ReturnType<typeof setInterval> | null = null;
let initialized = false;

const engine = () => import('./m3u8-downloader');

// ---------------------------------------------------------------------------
// 订阅
// ---------------------------------------------------------------------------

function notify() {
  if (emitTimer) {
    clearTimeout(emitTimer);
    emitTimer = null;
  }
  listeners.forEach((fn) => fn());
}

function emit(immediate: boolean) {
  schedulePersist();
  if (immediate) {
    notify();
  } else if (!emitTimer) {
    emitTimer = setTimeout(notify, PROGRESS_THROTTLE_MS);
  }
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getTasks(): DownloadTaskView[] {
  return tasks;
}

export function getServerTasks(): DownloadTaskView[] {
  return EMPTY;
}

/** 片段查看器用：任务对应的已解析播放列表（含每个切片的状态） */
export function getTaskDetail(id: string): M3U8Task | undefined {
  return runtimes.get(id)?.task;
}

/** 角标数字：还没有完成的任务 */
export function countUnfinished(list: DownloadTaskView[]): number {
  return list.filter((t) => t.status !== 'completed').length;
}

function find(id: string) {
  return tasks.find((t) => t.id === id);
}

function update(
  id: string,
  patch: Partial<DownloadTaskView>,
  immediate = true
) {
  let changed = false;
  tasks = tasks.map((t) => {
    if (t.id !== id) return t;
    changed = true;
    return { ...t, ...patch };
  });
  if (changed) emit(immediate);
}

function runtime(id: string): Runtime {
  let rt = runtimes.get(id);
  if (!rt) {
    rt = {
      runBytes: 0,
      runDoneStart: 0,
      bytesTotal: 0,
      samples: [],
      running: false,
    };
    runtimes.set(id, rt);
  }
  return rt;
}

// ---------------------------------------------------------------------------
// 持久化
// ---------------------------------------------------------------------------

type PersistedTask = Omit<DownloadTaskView, 'speed' | 'eta' | 'mergePercent'>;

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

function persistNow() {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  const s = storage();
  if (!s) return;
  try {
    const data: PersistedTask[] = tasks.map(
      ({ speed: _s, eta: _e, mergePercent: _m, ...rest }) => rest
    );
    s.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // 存储满了或被禁用时只是无法在刷新后恢复列表
  }
}

function schedulePersist() {
  if (!initialized || persistTimer) return;
  persistTimer = setTimeout(persistNow, PERSIST_DEBOUNCE_MS);
}

function restore(saved: PersistedTask[]): DownloadTaskView[] {
  return saved
    .filter(
      (t) =>
        t && typeof t.id === 'string' && typeof t.url === 'string' && !!t.config
    )
    .map((t) => {
      const base: DownloadTaskView = {
        ...t,
        speed: 0,
        eta: null,
        mergePercent: 0,
      };
      if (t.status === 'completed' || t.status === 'error') return base;
      // 下载数据不会跨页面保留：未完成的任务都要从头开始
      const reset = {
        ...base,
        done: 0,
        failed: 0,
        bytes: 0,
        error: undefined,
        restored: true,
      };
      const wasActive = ACTIVE.includes(t.status);
      if (t.config.streamMode === 'file-system') {
        // 需要用户点击才能重新选择保存位置
        return { ...reset, status: 'paused' as const, needsGesture: true };
      }
      return {
        ...reset,
        status: wasActive ? ('queued' as const) : ('paused' as const),
      };
    });
}

// ---------------------------------------------------------------------------
// 速度与剩余时间
// ---------------------------------------------------------------------------

function tick() {
  const now = Date.now();
  let anyRunning = false;
  tasks.forEach((t) => {
    const rt = runtimes.get(t.id);
    if (!rt || t.status !== 'downloading') {
      if (t.speed !== 0 || t.eta !== null)
        update(t.id, { speed: 0, eta: null }, false);
      return;
    }
    anyRunning = true;
    rt.samples.push({ t: now, bytes: rt.bytesTotal });
    while (rt.samples.length > 2 && now - rt.samples[0].t > SPEED_WINDOW_MS) {
      rt.samples.shift();
    }
    const first = rt.samples[0];
    const span = (now - first.t) / 1000;
    const speed = span > 0 ? (rt.bytesTotal - first.bytes) / span : 0;
    const doneThisRun = t.done - rt.runDoneStart;
    const remaining = t.total - t.done - t.failed;
    let eta: number | null = null;
    if (speed > 0 && doneThisRun >= 3 && remaining > 0) {
      eta = ((rt.runBytes / doneThisRun) * remaining) / speed;
    }
    update(t.id, { speed, eta, bytes: rt.bytesTotal }, false);
  });
  if (!anyRunning && ticker) {
    clearInterval(ticker);
    ticker = null;
  }
}

function ensureTicker() {
  if (!ticker) ticker = setInterval(tick, 1000);
}

// ---------------------------------------------------------------------------
// 调度
// ---------------------------------------------------------------------------

function pump() {
  let running = tasks.filter((t) => RUNNING.includes(t.status)).length;
  const queued = tasks
    .filter((t) => t.status === 'queued')
    .sort((a, b) => a.createdAt - b.createdAt);
  for (const t of queued) {
    if (running >= MAX_ACTIVE) break;
    const rt = runtime(t.id);
    if (rt.job && rt.running) {
      // 暂停中的任务：直接继续
      rt.job.resume();
      update(t.id, { status: 'downloading' });
      ensureTicker();
    } else if (!rt.running) {
      void startTask(t.id);
    } else {
      continue;
    }
    running++;
  }
}

function errorOf(e: unknown): DownloadTaskView['error'] {
  const message = e instanceof Error ? e.message : String(e);
  const code =
    e && typeof e === 'object' && 'code' in e
      ? ((e as { code: DownloadErrorCode }).code as DownloadErrorCode)
      : 'unknown';
  return { code, message };
}

async function prepare(view: DownloadTaskView, rt: Runtime): Promise<M3U8Task> {
  const { parseM3U8 } = await engine();
  const task =
    rt.task ??
    (await parseM3U8(view.url, { removeAds: view.config.removeAds }));
  rt.task = task;
  const count = task.tsUrlList.length;
  const range = view.config.range;
  const start = range ? Math.min(Math.max(1, range.start), count) : 1;
  const end = range ? Math.min(Math.max(start, range.end), count) : count;
  task.rangeDownload = { startSegment: start, endSegment: end };
  task.title = view.title;
  task.type = task.initSegmentUrl ? 'MP4' : view.config.type;
  return task;
}

async function startTask(id: string) {
  const view = find(id);
  if (!view) return;
  const rt = runtime(id);
  if (rt.running) return;
  rt.running = true;
  update(id, {
    status: 'preparing',
    error: undefined,
    notice: view.notice === 'sw-fallback' ? view.notice : undefined,
    speed: 0,
    eta: null,
  });

  const alive = () => runtimes.get(id) === rt && !!find(id);
  try {
    const mod = await engine();
    const task = await prepare(view, rt);
    if (!alive()) return;
    const { startSegment, endSegment } = task.rangeDownload;
    update(id, {
      total: endSegment - startSegment + 1,
      duration: mod.rangeDuration(task, startSegment, endSegment),
      timeRange: view.config.range
        ? {
            from: mod.segmentStartTime(task, startSegment),
            to: mod.segmentStartTime(task, endSegment + 1),
          }
        : null,
      adsRemoved: task.adsRemoved,
    });

    // 打开写入流
    let sink: WritableStream<Uint8Array> | null = null;
    let notice: TaskNotice | undefined;
    if (view.config.streamMode === 'file-system') {
      sink = rt.sink ?? null;
      rt.sink = undefined;
      if (!sink) {
        rt.running = false;
        update(id, { status: 'paused', needsGesture: true });
        pump();
        return;
      }
    } else if (view.config.streamMode === 'service-worker') {
      try {
        const { createServiceWorkerStream } = await import('./stream-saver');
        sink = await createServiceWorkerStream(
          mod.buildFilename(task.title, task.type)
        );
      } catch {
        notice = 'sw-fallback';
      }
    }
    if (!alive()) {
      sink?.abort().catch(() => undefined);
      return;
    }

    const job = new mod.DownloadJob(task, {
      concurrency: view.config.concurrency,
      maxRetries: view.config.maxRetries,
      sink,
      onBytes: (n) => {
        rt.bytesTotal += n;
        rt.runBytes += n;
      },
      onProgress: (p) => {
        const current = find(id);
        if (!current) return;
        if (p.phase === 'merging') {
          update(
            id,
            {
              status: 'merging',
              mergePercent: p.mergePercent ?? 0,
              speed: 0,
              eta: null,
            },
            current.status !== 'merging'
          );
        } else {
          update(id, { done: p.done, failed: p.failed, total: p.total }, false);
        }
      },
    });
    rt.job = job;
    rt.runBytes = 0;
    rt.samples = [];
    // 暂停发生在准备阶段时，带着暂停状态进入下载
    const latest = find(id);
    if (latest?.status === 'paused') job.pause();
    else update(id, { status: 'downloading', notice, needsGesture: false });
    rt.runDoneStart = find(id)?.done ?? 0;
    ensureTicker();

    const result = await job.run();
    if (!alive()) return;
    rt.job = undefined;
    rt.running = false;
    const done = find(id)?.done ?? 0;
    if (result.saved) {
      update(id, {
        status: 'completed',
        skipped: result.failed + result.missing,
        savedFormat: result.format,
        notice:
          result.format === 'TS' && task.type === 'MP4'
            ? 'saved-as-ts'
            : notice,
        speed: 0,
        eta: null,
        mergePercent: 100,
        done,
        bytes: rt.bytesTotal,
      });
      // 文件已保存，只保留切片地址等元数据（片段查看器用），不再持有任何视频数据
      task.downloadedSegments = undefined;
    } else {
      update(id, {
        status: 'incomplete',
        failed: result.failed,
        speed: 0,
        eta: null,
        bytes: rt.bytesTotal,
      });
    }
  } catch (e) {
    rt.job = undefined;
    rt.running = false;
    if (!alive()) return;
    const { isAbortError } = await engine();
    if (isAbortError(e)) {
      // 被暂停 / 停止：状态已由操作本身设置
      if (find(id)?.status !== 'paused') update(id, { status: 'paused' });
    } else {
      update(id, { status: 'error', error: errorOf(e), speed: 0, eta: null });
    }
  } finally {
    pump();
  }
}

// ---------------------------------------------------------------------------
// 操作
// ---------------------------------------------------------------------------

function newId(): string {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID)
      return crypto.randomUUID();
  } catch {
    // 非安全上下文没有 randomUUID
  }
  return `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

/** 文件系统直写需要在用户点击的同一次操作里弹出保存框，所以必须在点击处理函数里直接调用 */
function openFileSink(
  title: string,
  config: DownloadConfig,
  parsed?: M3U8Task
) {
  const type = parsed?.initSegmentUrl ? 'MP4' : config.type;
  return createFileSystemWriteStream(buildFilename(title, type));
}

export async function addTask(input: AddTaskInput): Promise<AddTaskResult> {
  init();
  let sink: WritableStream<Uint8Array> | undefined;
  if (input.config.streamMode === 'file-system') {
    try {
      sink = await openFileSink(input.title, input.config, input.parsedTask);
    } catch (e) {
      const reason = e instanceof FilePickerError ? e.reason : 'denied';
      return {
        ok: false,
        reason,
        message: e instanceof Error ? e.message : String(e),
      };
    }
  }

  const id = newId();
  const parsed = input.parsedTask;
  const count = parsed?.tsUrlList.length ?? 0;
  const range = input.config.range;
  const view: DownloadTaskView = {
    id,
    url: parsed?.url ?? input.url,
    title: input.title,
    createdAt: Date.now(),
    config: input.config,
    status: 'queued',
    done: 0,
    failed: 0,
    total: range ? range.end - range.start + 1 : count,
    bytes: 0,
    speed: 0,
    eta: null,
    mergePercent: 0,
    duration: 0,
    timeRange: null,
    adsRemoved: parsed?.adsRemoved,
    skipped: 0,
  };
  const rt = runtime(id);
  // 同一个解析结果被多次添加时各自独立（每个任务有自己的切片状态）
  rt.task = parsed ? cloneTask(parsed) : undefined;
  rt.sink = sink;
  tasks = [...tasks, view];
  emit(true);
  pump();
  return { ok: true, id };
}

function cloneTask(task: M3U8Task): M3U8Task {
  return {
    ...task,
    finishList: task.finishList.map(() => ({ status: '' as const })),
    rangeDownload: { ...task.rangeDownload },
    downloadedSegments: undefined,
    initSegment: undefined,
  };
}

export function pauseTask(id: string) {
  const t = find(id);
  if (!t) return;
  const rt = runtimes.get(id);
  if (t.status === 'downloading' || t.status === 'preparing') {
    rt?.job?.pause();
    update(id, { status: 'paused', speed: 0, eta: null });
    pump();
  } else if (t.status === 'queued') {
    update(id, { status: 'paused' });
  }
}

/** 开始 / 继续 / 重试。需要重新选择保存位置时必须由用户点击直接触发 */
export async function resumeTask(id: string): Promise<AddTaskResult | void> {
  const t = find(id);
  if (!t) return;
  if (!['paused', 'error', 'incomplete'].includes(t.status)) return;
  const rt = runtime(id);
  const hasLiveJob = !!rt.job && rt.running;

  if (!hasLiveJob && t.config.streamMode === 'file-system' && !rt.sink) {
    try {
      rt.sink = await openFileSink(t.title, t.config, rt.task);
    } catch (e) {
      const reason = e instanceof FilePickerError ? e.reason : 'denied';
      return {
        ok: false,
        reason,
        message: e instanceof Error ? e.message : String(e),
      };
    }
  }
  if (!hasLiveJob && t.config.streamMode !== 'disabled') {
    // 边下边存只能从头写一个新文件；内存模式会跳过已下载的切片，字节数照常累计
    rt.bytesTotal = 0;
  }
  update(id, {
    status: 'queued',
    error: undefined,
    needsGesture: false,
    restored: hasLiveJob ? t.restored : false,
  });
  pump();
}

/** 停止下载并保存已下载的部分（内存模式下也用于“跳过失败切片直接保存”） */
export async function saveNow(id: string) {
  const t = find(id);
  if (!t) return;
  const rt = runtimes.get(id);
  if (rt?.job) {
    rt.job.finishNow();
    return;
  }
  if (t.status === 'incomplete' && rt?.task?.downloadedSegments?.size) {
    const { saveDownloadedSegments } = await engine();
    update(id, { status: 'merging', mergePercent: 0 });
    try {
      const result = await saveDownloadedSegments(rt.task, ({ percent }) =>
        update(id, { mergePercent: percent }, false)
      );
      const total = t.total;
      update(id, {
        status: 'completed',
        skipped: total - result.segments,
        savedFormat: result.format,
        notice:
          result.format === 'TS' && t.config.type === 'MP4'
            ? 'saved-as-ts'
            : undefined,
        mergePercent: 100,
      });
    } catch (e) {
      update(id, { status: 'error', error: errorOf(e) });
    }
  }
}

/** 删除任务并释放它占用的所有资源 */
export function removeTask(id: string) {
  const rt = runtimes.get(id);
  runtimes.delete(id);
  rt?.job?.cancel();
  rt?.sink?.abort().catch(() => undefined);
  if (rt?.task) rt.task.downloadedSegments = undefined;
  const before = tasks.length;
  tasks = tasks.filter((t) => t.id !== id);
  if (tasks.length !== before) emit(true);
  pump();
}

export function pauseAll() {
  tasks
    .filter((t) => ['downloading', 'preparing', 'queued'].includes(t.status))
    .forEach((t) => pauseTask(t.id));
}

/** 继续所有暂停 / 失败的任务（需要重新选择保存位置的除外） */
export function resumeAll() {
  tasks
    .filter(
      (t) =>
        ['paused', 'error'].includes(t.status) &&
        !(t.config.streamMode === 'file-system' && !runtimes.get(t.id)?.job)
    )
    .forEach((t) => void resumeTask(t.id));
}

export function clearCompleted() {
  tasks
    .filter((t) => t.status === 'completed')
    .forEach((t) => removeTask(t.id));
}

export function clearAll() {
  [...tasks].forEach((t) => removeTask(t.id));
}

export function hasActiveDownloads(): boolean {
  return tasks.some((t) => ACTIVE.includes(t.status));
}

// ---------------------------------------------------------------------------
// 初始化
// ---------------------------------------------------------------------------

/** 读取刷新前的任务并自动继续。可重复调用 */
export function init() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;

  try {
    // 旧版本把整个播放列表（甚至密钥对象）写进 localStorage，既占空间又无法恢复，直接清掉
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // ignore
  }

  try {
    const raw = storage()?.getItem(STORAGE_KEY);
    if (raw) {
      const restoredTasks = restore(JSON.parse(raw));
      if (restoredTasks.length) {
        tasks = restoredTasks;
        emit(true);
      }
    }
  } catch {
    // 数据损坏时忽略
  }

  window.addEventListener('beforeunload', (e) => {
    if (!hasActiveDownloads()) return;
    // 离开页面会中断浏览器内的下载
    e.preventDefault();
    e.returnValue = '';
  });
  window.addEventListener('pagehide', persistNow);
  pump();
}

/** 仅供测试：重置所有状态 */
export function __resetForTests() {
  runtimes.forEach((rt) => rt.job?.cancel());
  runtimes.clear();
  tasks = EMPTY;
  listeners.clear();
  if (emitTimer) clearTimeout(emitTimer);
  if (persistTimer) clearTimeout(persistTimer);
  if (ticker) clearInterval(ticker);
  emitTimer = persistTimer = ticker = null;
  initialized = false;
}
