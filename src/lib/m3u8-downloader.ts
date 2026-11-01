/**
 * M3U8 视频下载引擎
 *
 * - 解析主播放列表 / 媒体播放列表（多码率、AES-128、fMP4、去广告）
 * - 多线程下载切片：空闲超时、指数退避重试、暂停 / 继续 / 取消 / 立即保存
 * - 两种保存方式：
 *   · 内存模式：切片以 Blob 形式暂存（浏览器可以把大 Blob 放到磁盘上，不占 JS 堆），
 *     全部完成后拼接 / 转封装并触发下载，随后立即释放；
 *   · 边下边存：按顺序写入调用方给出的 WritableStream。为了不让一个卡住的切片拖着
 *     后面的切片在内存里无限堆积，下载进度最多领先写入进度 lookahead 个切片。
 *
 * 不依赖 React，便于单独测试。
 */

import { buildFilename } from './download-filename';
import { removeAdsFromM3U8 } from './player/adFilter';

export { buildFilename, sanitizeFilename } from './download-filename';

export type StreamSaverMode = 'disabled' | 'service-worker' | 'file-system';
export type OutputFormat = 'TS' | 'MP4';
export type SegmentStatus = '' | 'downloading' | 'success' | 'error';

export type DownloadErrorCode =
  | 'aborted'
  | 'http'
  | 'network'
  | 'timeout'
  | 'invalid-playlist'
  | 'empty-playlist'
  | 'unsupported'
  | 'key'
  | 'write'
  | 'no-data';

export class DownloadError extends Error {
  constructor(public readonly code: DownloadErrorCode, message: string) {
    super(message);
    this.name = 'DownloadError';
  }
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DownloadError && error.code === 'aborted') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

const abortError = () => new DownloadError('aborted', '下载已取消');

/** 暂停时中止了正在进行的请求：该切片放回队列，继续后重新下载 */
class SegmentPaused extends Error {}

/**
 * 暂停 / 继续：暂停时工作线程停在下一个检查点，已发出的请求照常完成。
 */
export class PauseResumeController {
  private resumeResolve: (() => void) | null = null;
  private pausePromise: Promise<void> | null = null;

  pause() {
    if (this.pausePromise) return;
    this.pausePromise = new Promise<void>((resolve) => {
      this.resumeResolve = resolve;
    });
  }

  resume() {
    const resolve = this.resumeResolve;
    this.resumeResolve = null;
    this.pausePromise = null;
    resolve?.();
  }

  get paused(): boolean {
    return this.pausePromise !== null;
  }

  waitIfPaused(): Promise<void> {
    return this.pausePromise ?? Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// 播放列表解析
// ---------------------------------------------------------------------------

export interface PlaylistVariant {
  url: string;
  bandwidth?: number;
  resolution?: string;
}

interface SegmentKey {
  uri: string;
  /** 播放列表里显式给出的 IV；没有时按切片序号生成 */
  iv: Uint8Array | null;
  key?: Uint8Array;
}

export interface M3U8Task {
  /** 媒体播放列表地址（主播放列表已解析到具体码率） */
  url: string;
  title: string;
  type: OutputFormat;
  tsUrlList: string[];
  finishList: Array<{ status: SegmentStatus; retryCount?: number }>;
  segmentDurations: number[];
  /** 每个切片的媒体序号（AES-128 没有 IV 时用它生成 IV） */
  segmentSequence: number[];
  /** 每个切片使用的密钥下标，-1 表示未加密 */
  segmentKeyIndex: number[];
  /** 切片前是否有 #EXT-X-DISCONTINUITY */
  segmentDiscontinuity: boolean[];
  keys: SegmentKey[];
  durationSecond: number;
  /** fMP4 切片的初始化段（#EXT-X-MAP）；存在时直接输出 MP4，无需转封装 */
  initSegmentUrl?: string;
  /** 所选码率（bit/s），用于估算文件大小 */
  bandwidth?: number;
  variants?: PlaylistVariant[];
  adsRemoved?: { segments: number; seconds: number };
  /** 下载范围，1 起始，包含两端 */
  rangeDownload: { startSegment: number; endSegment: number };
  /** 内存模式下已下载的切片 */
  downloadedSegments?: Map<number, Blob>;
  initSegment?: Blob;
}

export function resolveUrl(target: string, base: string): string {
  try {
    return new URL(target, base).href;
  } catch {
    return target;
  }
}

function parseAttributes(line: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const body = line.slice(line.indexOf(':') + 1);
  const re = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    attrs[m[1]] = m[2].replace(/^"|"$/g, '');
  }
  return attrs;
}

function splitLines(text: string): string[] {
  return text.split(/\r?\n/).map((l) => l.trim());
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/^0x/i, '').padStart(32, '0').slice(-32);
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function isMasterPlaylist(text: string): boolean {
  return text.includes('#EXT-X-STREAM-INF');
}

/** 主播放列表里的各个码率，按带宽从高到低排列 */
export function parseMasterPlaylist(
  text: string,
  baseUrl: string
): PlaylistVariant[] {
  const lines = splitLines(text);
  const variants: PlaylistVariant[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('#EXT-X-STREAM-INF')) continue;
    const attrs = parseAttributes(lines[i]);
    const next = lines.slice(i + 1).find((l) => l && !l.startsWith('#'));
    if (!next) continue;
    const bandwidth = parseInt(
      attrs.BANDWIDTH || attrs['AVERAGE-BANDWIDTH'],
      10
    );
    variants.push({
      url: resolveUrl(next, baseUrl),
      bandwidth: Number.isFinite(bandwidth) ? bandwidth : undefined,
      resolution: attrs.RESOLUTION || undefined,
    });
  }
  const seen = new Set<string>();
  return variants
    .filter((v) => !seen.has(v.url) && seen.add(v.url))
    .sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0));
}

interface ParsedSegment {
  url: string;
  duration: number;
  sequence: number;
  keyIndex: number;
  /** 前面有 #EXT-X-DISCONTINUITY：源时间戳从这里重新开始 */
  discontinuity: boolean;
}

/** 解析媒体播放列表（不请求密钥） */
export function parseMediaPlaylist(
  text: string,
  url: string
): { segments: ParsedSegment[]; keys: SegmentKey[]; initSegmentUrl?: string } {
  const segments: ParsedSegment[] = [];
  const keys: SegmentKey[] = [];
  let initSegmentUrl: string | undefined;
  let sequence = 0;
  let keyIndex = -1;
  let duration = 0;
  let discontinuity = false;

  for (const line of splitLines(text)) {
    if (!line) continue;
    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
      sequence = parseInt(line.split(':')[1], 10) || 0;
    } else if (line.startsWith('#EXT-X-KEY:')) {
      const attrs = parseAttributes(line);
      const method = (attrs.METHOD || 'NONE').toUpperCase();
      if (method === 'NONE') {
        keyIndex = -1;
      } else if (method === 'AES-128') {
        if (!attrs.URI) {
          throw new DownloadError('key', '加密的播放列表缺少密钥地址');
        }
        const uri = resolveUrl(attrs.URI, url);
        const iv = attrs.IV ? hexToBytes(attrs.IV) : null;
        const existing = keys.findIndex(
          (k) => k.uri === uri && String(k.iv) === String(iv)
        );
        keyIndex = existing >= 0 ? existing : keys.push({ uri, iv }) - 1;
      } else {
        throw new DownloadError('unsupported', `暂不支持 ${method} 加密`);
      }
    } else if (line.startsWith('#EXT-X-MAP:')) {
      const attrs = parseAttributes(line);
      if (attrs.BYTERANGE) {
        throw new DownloadError('unsupported', '暂不支持按字节范围的切片');
      }
      if (attrs.URI && !initSegmentUrl)
        initSegmentUrl = resolveUrl(attrs.URI, url);
    } else if (line.startsWith('#EXT-X-BYTERANGE')) {
      throw new DownloadError('unsupported', '暂不支持按字节范围的切片');
    } else if (line.startsWith('#EXT-X-DISCONTINUITY')) {
      discontinuity = segments.length > 0;
    } else if (line.startsWith('#EXTINF:')) {
      duration = parseFloat(line.slice(8)) || 0;
    } else if (!line.startsWith('#')) {
      segments.push({
        url: resolveUrl(line, url),
        duration,
        sequence,
        keyIndex,
        discontinuity,
      });
      sequence++;
      duration = 0;
      discontinuity = false;
    }
  }
  return { segments, keys, initSegmentUrl };
}

const PLAYLIST_TIMEOUT_MS = 20000;

async function fetchText(url: string, signal?: AbortSignal): Promise<string> {
  const bytes = await fetchBytes(url, {
    signal,
    timeoutMs: PLAYLIST_TIMEOUT_MS,
  });
  return new TextDecoder().decode(bytes);
}

function defaultTitle(url: string): string {
  try {
    const title = new URL(url).searchParams.get('title');
    if (title) return title;
  } catch {
    // ignore
  }
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `video_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(
    d.getHours()
  )}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export interface ParseOptions {
  /** 去掉插播广告切片（规则与播放器的去广告一致） */
  removeAds?: boolean;
  signal?: AbortSignal;
}

/**
 * 解析 M3U8。主播放列表默认选择最高码率，所有码率放在 variants 里，
 * 需要其他码率时用该码率的地址再解析一次。
 */
export async function parseM3U8(
  url: string,
  options: ParseOptions = {},
  depth = 0
): Promise<M3U8Task> {
  if (depth > 5) {
    throw new DownloadError('invalid-playlist', '播放列表嵌套过深');
  }
  const text = (await fetchText(url, options.signal)).replace(/^\uFEFF/, '');
  if (!text.trimStart().toUpperCase().startsWith('#EXTM3U')) {
    throw new DownloadError('invalid-playlist', '不是有效的 M3U8 播放列表');
  }

  if (isMasterPlaylist(text)) {
    const variants = parseMasterPlaylist(text, url);
    if (!variants.length) {
      throw new DownloadError('invalid-playlist', '主播放列表里没有可用的码率');
    }
    const task = await parseM3U8(variants[0].url, options, depth + 1);
    task.variants = variants;
    task.bandwidth = variants[0].bandwidth;
    return task;
  }

  const original = parseMediaPlaylist(text, url);
  let { segments } = original;
  let adsRemoved: M3U8Task['adsRemoved'];

  if (options.removeAds) {
    const result = removeAdsFromM3U8(text, url);
    if (result.removed.length) {
      // 去广告后的播放列表丢了原始序号，按地址找回（AES-128 的默认 IV 依赖它）
      const byUrl = new Map(original.segments.map((s) => [s.url, s]));
      segments = parseMediaPlaylist(result.playlist, url).segments.map((s) => ({
        ...s,
        sequence: byUrl.get(s.url)?.sequence ?? s.sequence,
      }));
      adsRemoved = {
        segments: original.segments.length - segments.length,
        seconds: result.removed.reduce((sum, r) => sum + r.seconds, 0),
      };
    }
  }

  if (!segments.length) {
    throw new DownloadError('empty-playlist', '播放列表里没有视频切片');
  }

  const keys = original.keys;
  await Promise.all(
    keys.map(async (k) => {
      const bytes = await fetchBytes(k.uri, {
        signal: options.signal,
        timeoutMs: PLAYLIST_TIMEOUT_MS,
      }).catch((e) => {
        if (isAbortError(e)) throw e;
        throw new DownloadError('key', `获取解密密钥失败：${e.message}`);
      });
      if (bytes.byteLength !== 16) {
        throw new DownloadError('key', '解密密钥格式不正确');
      }
      k.key = bytes;
    })
  );

  return {
    url,
    title: defaultTitle(url),
    type: 'TS',
    tsUrlList: segments.map((s) => s.url),
    finishList: segments.map(() => ({ status: '' as SegmentStatus })),
    segmentDurations: segments.map((s) => s.duration),
    segmentSequence: segments.map((s) => s.sequence),
    segmentKeyIndex: segments.map((s) => s.keyIndex),
    segmentDiscontinuity: segments.map((s) => s.discontinuity),
    keys,
    durationSecond: segments.reduce((sum, s) => sum + s.duration, 0),
    initSegmentUrl: original.initSegmentUrl,
    adsRemoved,
    rangeDownload: { startSegment: 1, endSegment: segments.length },
  };
}

// ---------------------------------------------------------------------------
// 范围与估算
// ---------------------------------------------------------------------------

/** 第 start~end 个切片（1 起始，含两端）的总时长 */
export function rangeDuration(
  task: M3U8Task,
  start: number,
  end: number
): number {
  let sum = 0;
  for (
    let i = Math.max(0, start - 1);
    i < Math.min(end, task.segmentDurations.length);
    i++
  ) {
    sum += task.segmentDurations[i];
  }
  return sum;
}

/** 第 n 个切片（1 起始）开始的时间点 */
export function segmentStartTime(task: M3U8Task, n: number): number {
  return rangeDuration(task, 1, n - 1);
}

/** 根据码率估算字节数；不知道码率时返回 null */
export function estimateBytes(
  task: M3U8Task,
  start: number,
  end: number
): number | null {
  if (!task.bandwidth) return null;
  return Math.round((task.bandwidth / 8) * rangeDuration(task, start, end));
}

/**
 * 按播放页的跳过片头 / 片尾设置算出下载范围。宁可多留几秒也不丢正片：
 * 起点取片头结束时刻所在的切片，终点取片尾开始时刻所在的切片。
 * outroTime 为负数，表示距结尾多少秒。
 */
export function rangeFromSkipConfig(
  task: M3U8Task,
  introTime: number,
  outroTime: number
): { start: number; end: number } {
  const durations = task.segmentDurations;
  const count = durations.length;
  let start = 1;
  if (introTime > 0) {
    let acc = 0;
    for (let i = 0; i < count; i++) {
      acc += durations[i];
      if (acc > introTime) {
        start = i + 1;
        break;
      }
    }
  }
  let end = count;
  if (outroTime < 0) {
    const endTime = task.durationSecond + outroTime;
    let acc = 0;
    for (let i = 0; i < count; i++) {
      acc += durations[i];
      if (acc >= endTime) {
        end = i + 1;
        break;
      }
    }
  }
  if (end < start) return { start: 1, end: count };
  return { start, end };
}

// ---------------------------------------------------------------------------
// 网络与解密
// ---------------------------------------------------------------------------

interface FetchBytesOptions {
  signal?: AbortSignal;
  /** 空闲超时：这么长时间收不到任何数据就放弃 */
  timeoutMs?: number;
  onBytes?: (n: number) => void;
}

export async function fetchBytes(
  url: string,
  { signal, timeoutMs = 30000, onBytes }: FetchBytesOptions = {}
): Promise<Uint8Array> {
  if (signal?.aborted) throw abortError();
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
  };

  try {
    arm();
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new DownloadError('http', `HTTP ${res.status}`);
    if (!res.body) {
      const bytes = new Uint8Array(await res.arrayBuffer());
      onBytes?.(bytes.byteLength);
      return bytes;
    }
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      arm();
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.byteLength;
      onBytes?.(value.byteLength);
    }
    if (chunks.length === 1) return chunks[0];
    const out = new Uint8Array(size);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.byteLength;
    }
    return out;
  } catch (e) {
    if (e instanceof DownloadError) throw e;
    if (timedOut) throw new DownloadError('timeout', '请求超时');
    if (signal?.aborted) throw abortError();
    throw new DownloadError(
      'network',
      e instanceof Error ? e.message : String(e)
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

const cryptoKeys = new WeakMap<Uint8Array, Promise<CryptoKey>>();

async function decryptWithCryptoJs(
  data: Uint8Array,
  key: Uint8Array,
  iv: Uint8Array
): Promise<Uint8Array> {
  const CryptoJS = (await import('crypto-js')).default;
  const toWords = (bytes: Uint8Array) =>
    // crypto-js 的 lib-typedarrays 让 WordArray.create 直接接受 TypedArray
    CryptoJS.lib.WordArray.create(bytes as unknown as number[]);
  const decrypted = CryptoJS.AES.decrypt(
    CryptoJS.lib.CipherParams.create({ ciphertext: toWords(data) }),
    toWords(key),
    { iv: toWords(iv), mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 }
  );
  const out = new Uint8Array(Math.max(0, decrypted.sigBytes));
  const words = decrypted.words;
  for (let i = 0; i < out.length; i++) {
    out[i] = (words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
  }
  return out;
}

/** AES-128-CBC 解密：优先用浏览器原生的 WebCrypto（异步、不阻塞界面），不可用时退回 crypto-js */
export async function aes128Decrypt(
  data: Uint8Array,
  key: Uint8Array,
  iv: Uint8Array
): Promise<Uint8Array> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    try {
      let cryptoKey = cryptoKeys.get(key);
      if (!cryptoKey) {
        cryptoKey = subtle.importKey('raw', key, { name: 'AES-CBC' }, false, [
          'decrypt',
        ]);
        cryptoKeys.set(key, cryptoKey);
      }
      return new Uint8Array(
        await subtle.decrypt({ name: 'AES-CBC', iv }, await cryptoKey, data)
      );
    } catch {
      // 填充不规范等情况 WebCrypto 会直接报错，交给 crypto-js 尽量解出来
    }
  }
  return decryptWithCryptoJs(data, key, iv);
}

function sequenceIv(sequence: number): Uint8Array {
  const iv = new Uint8Array(16);
  new DataView(iv.buffer).setUint32(12, sequence >>> 0);
  // 序号超过 32 位时补上高位
  new DataView(iv.buffer).setUint32(8, Math.floor(sequence / 2 ** 32));
  return iv;
}

async function decryptSegment(task: M3U8Task, index: number, data: Uint8Array) {
  const keyIndex = task.segmentKeyIndex[index] ?? -1;
  if (keyIndex < 0) return data;
  const key = task.keys[keyIndex];
  if (!key?.key) throw new DownloadError('key', '缺少解密密钥');
  return aes128Decrypt(
    data,
    key.key,
    key.iv ?? sequenceIv(task.segmentSequence[index] ?? index)
  );
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(abortError());
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });

// ---------------------------------------------------------------------------
// 保存
// ---------------------------------------------------------------------------

/** 触发浏览器下载。对象 URL 保留一段时间再释放，避免部分浏览器还没开始读取就被回收 */
export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 40000);
}

export interface SaveProgress {
  /** 0-100 */
  percent: number;
}

/**
 * 转封装时每个切片的时间信息：在输出文件里的起始时间，以及与上一个写入的切片之间
 * 源时间戳是否断开（中间跳过的切片带着 discontinuity 时也算）。
 */
function mp4Timeline(task: M3U8Task) {
  const first = task.rangeDownload.startSegment - 1;
  const starts: number[] = [];
  let acc = 0;
  for (const d of task.segmentDurations) {
    starts.push(acc);
    acc += d;
  }
  let lastWritten = -1;
  return (index: number) => {
    let discontinuity = false;
    if (lastWritten >= 0) {
      for (let i = lastWritten + 1; i <= index; i++) {
        if (task.segmentDiscontinuity?.[i]) discontinuity = true;
      }
    }
    lastWritten = index;
    return {
      startTime: (starts[index] ?? 0) - (starts[first] ?? 0),
      discontinuity,
    };
  };
}

export interface SaveResult {
  /** 写入文件的切片数 */
  segments: number;
  /** 实际保存的格式：TS 无法转成 MP4 时会退回 TS */
  format: OutputFormat;
}

/**
 * 把内存里已下载的切片（下载范围内、按顺序，缺的跳过）合成文件并触发下载，
 * 完成后释放这些切片。
 */
export async function saveDownloadedSegments(
  task: M3U8Task,
  onProgress?: (p: SaveProgress) => void
): Promise<SaveResult> {
  const { startSegment, endSegment } = task.rangeDownload;
  const blobs: Blob[] = [];
  const indices: number[] = [];
  for (let i = startSegment - 1; i < endSegment; i++) {
    const b = task.downloadedSegments?.get(i);
    if (b) {
      blobs.push(b);
      indices.push(i);
    }
  }
  if (!blobs.length) {
    throw new DownloadError('no-data', '还没有下载到任何切片');
  }

  const isFmp4 = !!task.initSegmentUrl;
  let format: OutputFormat = isFmp4 ? 'MP4' : task.type;
  let output: Blob | null = null;

  if (format === 'MP4' && !isFmp4) {
    const { TsToMp4Fragmenter } = await import('./mp4-transmuxer');
    const fragmenter = new TsToMp4Fragmenter(
      rangeDuration(task, startSegment, endSegment)
    );
    const parts: Blob[] = [];
    const timeline = mp4Timeline(task);
    try {
      for (let i = 0; i < blobs.length; i++) {
        const bytes = new Uint8Array(await blobs[i].arrayBuffer());
        const out = fragmenter.push(bytes, timeline(indices[i]));
        if (out.length) parts.push(new Blob(out));
        onProgress?.({ percent: Math.round(((i + 1) / blobs.length) * 100) });
      }
      if (fragmenter.hasOutput) {
        output = new Blob(parts, { type: 'video/mp4' });
      }
    } catch {
      // 转封装失败时退回 TS，至少把下载好的内容保存下来
    } finally {
      fragmenter.dispose();
    }
    if (!output) format = 'TS';
  }

  if (!output) {
    const head = isFmp4 && task.initSegment ? [task.initSegment] : [];
    output = new Blob([...head, ...blobs], {
      type: format === 'MP4' ? 'video/mp4' : 'video/mp2t',
    });
    onProgress?.({ percent: 100 });
  }

  triggerDownload(output, buildFilename(task.title, format));
  // 文件已交给浏览器，释放切片占用的内存
  task.downloadedSegments = undefined;
  task.initSegment = undefined;
  return { segments: blobs.length, format };
}

// ---------------------------------------------------------------------------
// 下载任务
// ---------------------------------------------------------------------------

export interface DownloadProgress {
  /** 下载范围内已成功的切片数 */
  done: number;
  failed: number;
  total: number;
  phase: 'downloading' | 'merging';
  /** phase 为 merging 时的合并进度 0-100 */
  mergePercent?: number;
}

export interface DownloadOptions {
  concurrency?: number;
  maxRetries?: number;
  /** 边下边存的目标流；不传则为内存模式。任务结束时由引擎关闭 / 中止 */
  sink?: WritableStream<Uint8Array> | null;
  /** 单个请求的空闲超时 */
  segmentTimeoutMs?: number;
  /** 首次重试前的等待时间，之后每次翻倍（最多 8 秒） */
  retryDelayMs?: number;
  onProgress?: (p: DownloadProgress) => void;
  /** 每收到一块数据调用一次，用于计算速度 */
  onBytes?: (n: number) => void;
}

export interface DownloadResult {
  /** 文件是否已经保存（内存模式下有失败切片时为 false，切片保留以便重试） */
  saved: boolean;
  /** 失败的切片数 */
  failed: number;
  /** 立即保存时未下载完的切片数 */
  missing: number;
  /** 实际保存的格式 */
  format?: OutputFormat;
}

export class DownloadJob {
  private controller = new AbortController();
  /** 暂停时用来中止正在进行的请求（不影响整个任务） */
  private requestController = new AbortController();
  private pauser = new PauseResumeController();
  private finishing = false;
  private cancelled = false;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;

  constructor(private task: M3U8Task, private options: DownloadOptions = {}) {}

  get paused() {
    return this.pauser.paused;
  }

  /** 暂停：立即中止正在进行的请求（释放带宽），这些切片继续后重新下载 */
  pause() {
    if (this.controller.signal.aborted) return;
    this.pauser.pause();
    this.requestController.abort();
  }

  resume() {
    if (this.requestController.signal.aborted) {
      this.requestController = new AbortController();
    }
    this.pauser.resume();
  }

  /** 取消任务：边下边存时中止写入流，内存模式保留已下载的切片 */
  cancel() {
    this.cancelled = true;
    this.controller.abort();
    this.pauser.resume();
    // 写入可能正卡在背压上，直接中止写入流让它尽快返回
    this.writer?.abort(abortError()).catch(() => undefined);
  }

  /** 停止下载并立即用已下载的切片保存文件 */
  finishNow() {
    this.finishing = true;
    this.controller.abort();
    this.pauser.resume();
  }

  async run(): Promise<DownloadResult> {
    const { task, options } = this;
    const signal = this.controller.signal;
    const concurrency = Math.max(1, Math.min(32, options.concurrency ?? 6));
    const maxRetries = Math.max(0, options.maxRetries ?? 3);
    const timeoutMs = options.segmentTimeoutMs ?? 30000;
    const first = task.rangeDownload.startSegment - 1;
    const last = task.rangeDownload.endSegment - 1;
    const total = last - first + 1;
    if (total <= 0) throw new DownloadError('no-data', '下载范围无效');

    const writer = options.sink ? options.sink.getWriter() : null;
    this.writer = writer;
    const streaming = !!writer;
    if (!streaming && !task.downloadedSegments)
      task.downloadedSegments = new Map();

    // 待下载队列：内存模式跳过已经下载好的切片（继续 / 重试失败切片），边下边存从头写一个新文件
    const queue: number[] = [];
    let done = 0;
    let failed = 0;
    for (let i = first; i <= last; i++) {
      const st = task.finishList[i];
      if (
        !streaming &&
        st.status === 'success' &&
        task.downloadedSegments?.has(i)
      ) {
        done++;
        continue;
      }
      st.status = '';
      st.retryCount = 0;
      queue.push(i);
    }

    const report = () =>
      options.onProgress?.({ done, failed, total, phase: 'downloading' });
    report();

    const abortWriter = async () => {
      if (writer) await writer.abort(abortError()).catch(() => undefined);
    };

    // ---- 边下边存：按顺序写入 ----
    let fragmenter: import('./mp4-transmuxer').TsToMp4Fragmenter | null = null;
    const pending = new Map<number, Uint8Array | null>();
    let nextWrite = first;
    let writeChain: Promise<void> = Promise.resolve();
    let writeError: unknown = null;
    const windowWaiters = new Set<() => void>();
    const wakeWindow = () => {
      windowWaiters.forEach((fn) => fn());
      windowWaiters.clear();
    };
    const lookahead = Math.max(concurrency * 3, 8);
    signal.addEventListener('abort', wakeWindow);

    const timeline = mp4Timeline(task);
    const writeBytes = async (index: number, bytes: Uint8Array) => {
      if (!writer) return;
      if (fragmenter) {
        for (const part of fragmenter.push(bytes, timeline(index))) {
          await writer.write(part);
        }
      } else {
        await writer.write(bytes);
      }
    };
    const drain = async (skipGaps: boolean) => {
      while (nextWrite <= last) {
        if (pending.has(nextWrite)) {
          const data = pending.get(nextWrite);
          pending.delete(nextWrite);
          if (data) await writeBytes(nextWrite, data);
        } else if (!skipGaps) {
          break;
        }
        nextWrite++;
        wakeWindow();
      }
    };
    const scheduleDrain = (skipGaps = false) => {
      writeChain = writeChain.then(async () => {
        if (writeError) return;
        try {
          await drain(skipGaps);
        } catch (e) {
          writeError = e;
          this.controller.abort();
          wakeWindow();
        }
      });
      return writeChain;
    };
    const waitForWindow = async (index: number) => {
      while (streaming && index - nextWrite >= lookahead && !signal.aborted) {
        await new Promise<void>((resolve) => windowWaiters.add(resolve));
      }
    };

    try {
      if (task.initSegmentUrl) {
        let init: Uint8Array | null = null;
        while (!init) {
          await this.pauser.waitIfPaused();
          init = await this.fetchWithRetry(
            task.initSegmentUrl,
            -1,
            maxRetries,
            timeoutMs
          ).catch((e) => {
            if (e instanceof SegmentPaused) return null;
            throw e;
          });
        }
        if (writer) await writer.write(init);
        else task.initSegment = new Blob([init]);
      } else if (writer && task.type === 'MP4') {
        const { TsToMp4Fragmenter } = await import('./mp4-transmuxer');
        fragmenter = new TsToMp4Fragmenter(
          rangeDuration(
            task,
            task.rangeDownload.startSegment,
            task.rangeDownload.endSegment
          )
        );
      }
    } catch (e) {
      await abortWriter();
      if (this.cancelled || this.finishing) throw abortError();
      throw e;
    }

    const worker = async () => {
      while (queue.length && !signal.aborted) {
        await this.pauser.waitIfPaused();
        if (signal.aborted) break;
        const index = queue.shift();
        if (index === undefined) break;
        await waitForWindow(index);
        if (signal.aborted) {
          queue.unshift(index);
          break;
        }
        const st = task.finishList[index];
        st.status = 'downloading';
        try {
          const bytes = await this.fetchWithRetry(
            task.tsUrlList[index],
            index,
            maxRetries,
            timeoutMs
          );
          if (streaming) {
            pending.set(index, bytes);
            await scheduleDrain();
          } else {
            task.downloadedSegments?.set(index, new Blob([bytes]));
          }
          st.status = 'success';
          done++;
        } catch (e) {
          if (signal.aborted) {
            st.status = '';
            break;
          }
          if (e instanceof SegmentPaused) {
            // 保持队列升序：边下边存的写入窗口依赖“总是先取最小的序号”
            st.status = '';
            queue.push(index);
            queue.sort((a, b) => a - b);
            continue;
          }
          st.status = 'error';
          failed++;
          if (streaming) {
            // 边下边存无法回头补写，失败的切片直接跳过
            pending.set(index, null);
            await scheduleDrain();
          }
        }
        report();
      }
    };

    await Promise.all(
      Array.from(
        { length: Math.min(concurrency, Math.max(1, queue.length)) },
        worker
      )
    );
    signal.removeEventListener('abort', wakeWindow);
    const missing = total - done - failed;

    if (this.cancelled) {
      await abortWriter();
      await writeChain;
      fragmenter?.dispose();
      throw abortError();
    }
    if (writeError) {
      await abortWriter();
      fragmenter?.dispose();
      const message =
        writeError instanceof Error ? writeError.message : String(writeError);
      throw new DownloadError('write', `写入文件失败：${message}`);
    }

    if (streaming && writer) {
      await scheduleDrain(true);
      fragmenter?.dispose();
      if (writeError) {
        await abortWriter();
        throw new DownloadError('write', '写入文件失败');
      }
      if (done === 0) {
        await abortWriter();
        throw new DownloadError('no-data', '没有成功下载任何切片');
      }
      await writer.close().catch((e) => {
        throw new DownloadError('write', `保存文件失败：${e?.message || e}`);
      });
      return { saved: true, failed, missing, format: task.type };
    }

    // ---- 内存模式 ----
    if (failed > 0 && !this.finishing) {
      return { saved: false, failed, missing };
    }
    options.onProgress?.({
      done,
      failed,
      total,
      phase: 'merging',
      mergePercent: 0,
    });
    const saved = await saveDownloadedSegments(task, ({ percent }) =>
      options.onProgress?.({
        done,
        failed,
        total,
        phase: 'merging',
        mergePercent: percent,
      })
    );
    return { saved: true, failed, missing, format: saved.format };
  }

  private async fetchWithRetry(
    url: string,
    index: number,
    maxRetries: number,
    timeoutMs: number
  ): Promise<Uint8Array> {
    const signal = this.controller.signal;
    const st = index >= 0 ? this.task.finishList[index] : null;
    for (let attempt = 0; ; attempt++) {
      if (st) st.retryCount = attempt;
      const paused = this.requestController.signal;
      if (paused.aborted) throw new SegmentPaused();
      // 任务取消或暂停都会中止这次请求
      const request = new AbortController();
      const relay = () => request.abort();
      signal.addEventListener('abort', relay, { once: true });
      paused.addEventListener('abort', relay, { once: true });
      try {
        const raw = await fetchBytes(url, {
          signal: request.signal,
          timeoutMs,
          onBytes: this.options.onBytes,
        });
        return index >= 0 ? await decryptSegment(this.task, index, raw) : raw;
      } catch (e) {
        if (signal.aborted) throw abortError();
        if (paused.aborted) throw new SegmentPaused();
        if (
          attempt >= maxRetries ||
          (e instanceof DownloadError && e.code === 'key')
        ) {
          throw e;
        }
        await sleep(
          Math.min((this.options.retryDelayMs ?? 1000) * 2 ** attempt, 8000),
          signal
        );
        await this.pauser.waitIfPaused();
      } finally {
        signal.removeEventListener('abort', relay);
        paused.removeEventListener('abort', relay);
      }
    }
  }
}
