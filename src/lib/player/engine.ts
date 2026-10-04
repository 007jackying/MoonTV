/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * 播放引擎：在一个长期存在的 <video> 元素上挂载 / 卸载视频流。
 *
 * 之前切换剧集或换源时仍能听到上一路声音，根因是旧的 Hls 实例、旧的
 * <source> 或旧的播放器回调没有被可靠清理。这里的约定是：
 * - 整个播放页只有一个 <video>，任何时刻只有一路流挂在上面；
 * - 每次切换都先 teardown()（暂停 → 停止并销毁 Hls → 清空 src/source → load()），
 *   再 attach 新的流；
 * - 每次 attach 都带一个 generation，回调通过 isCurrent() 丢弃过期事件。
 */

export type HlsModule = typeof import('hls.js').default;
type HlsInstance = InstanceType<HlsModule>;

export interface AttachOptions {
  Hls: HlsModule | null;
  blockAd: boolean;
  /** 返回 false 表示这一路流已过期，回调应直接忽略 */
  isCurrent: () => boolean;
  onManifestLoaded?: () => void;
  onRecoverableError?: () => void;
  onFatalError?: (detail: string) => void;
  /** 预览缩略图用的轻量配置 */
  lightweight?: boolean;
}

export interface AttachedStream {
  hls: HlsInstance | null;
}

/** 去广告：去掉 #EXT-X-DISCONTINUITY 标记（与原实现一致） */
export function filterAdsFromM3U8(m3u8Content: string): string {
  if (!m3u8Content) return '';
  return m3u8Content
    .split('\n')
    .filter((line) => !line.includes('#EXT-X-DISCONTINUITY'))
    .join('\n');
}

export function isHlsUrl(url: string): boolean {
  return /\.m3u8($|[?#])/i.test(url) || /m3u8/i.test(url);
}

function createAdFilterLoader(Hls: HlsModule) {
  const Base = Hls.DefaultConfig.loader as any;
  return class AdFilterLoader extends Base {
    constructor(config: any) {
      super(config);
      const load = this.load.bind(this);
      this.load = (context: any, loaderConfig: any, callbacks: any) => {
        if (context.type === 'manifest' || context.type === 'level') {
          const onSuccess = callbacks.onSuccess;
          callbacks.onSuccess = (
            response: any,
            stats: any,
            ctx: any,
            networkDetails: any
          ) => {
            if (response.data && typeof response.data === 'string') {
              response.data = filterAdsFromM3U8(response.data);
            }
            return onSuccess(response, stats, ctx, networkDetails);
          };
        }
        load(context, loaderConfig, callbacks);
      };
    }
  };
}

/** 在 video 上挂载一路新的流。调用前必须已经 teardown 过上一路。 */
export function attachStream(
  video: HTMLVideoElement,
  url: string,
  opts: AttachOptions
): AttachedStream {
  const { Hls, isCurrent } = opts;

  // 始终允许远程播放（AirPlay / Cast）
  video.disableRemotePlayback = false;

  if (isHlsUrl(url) && Hls && Hls.isSupported()) {
    const hls: HlsInstance = new Hls({
      debug: false,
      enableWorker: true,
      lowLatencyMode: false,
      maxBufferLength: opts.lightweight ? 2 : 30,
      maxMaxBufferLength: opts.lightweight ? 4 : 600,
      backBufferLength: opts.lightweight ? 0 : 30,
      maxBufferSize: 60 * 1000 * 1000,
      startLevel: opts.lightweight ? 0 : undefined,
      loader: opts.blockAd
        ? (createAdFilterLoader(Hls) as any)
        : Hls.DefaultConfig.loader,
    });

    let networkRetries = 0;
    let mediaRetries = 0;

    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      if (!isCurrent()) return;
      opts.onManifestLoaded?.();
    });

    hls.on(Hls.Events.ERROR, (_event: any, data: any) => {
      if (!isCurrent() || !data?.fatal) return;
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR && networkRetries < 3) {
        networkRetries += 1;
        opts.onRecoverableError?.();
        hls.startLoad();
      } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRetries < 2) {
        mediaRetries += 1;
        opts.onRecoverableError?.();
        hls.recoverMediaError();
      } else {
        opts.onFatalError?.(String(data.details || data.type));
      }
    });

    hls.loadSource(url);
    hls.attachMedia(video);
    // 注意：hls.js 可用时不再追加 <source>，避免 Safari 同时走原生 HLS 出现两路解码
    return { hls };
  }

  // 原生播放（Safari 原生 HLS 或 mp4 等直链）
  const onMeta = () => {
    video.removeEventListener('loadedmetadata', onMeta);
    if (isCurrent()) opts.onManifestLoaded?.();
  };
  video.addEventListener('loadedmetadata', onMeta);
  video.src = url;
  video.load();
  return { hls: null };
}

/**
 * 彻底停止并卸载当前流：之后这个 video 不会再发出任何声音。
 * 顺序很重要：先暂停，再销毁 Hls（停止拉流并解除 MediaSource），最后清空 src 并 load()。
 */
export function teardownStream(
  video: HTMLVideoElement | null,
  stream: AttachedStream | null
) {
  if (video) {
    try {
      video.pause();
    } catch {
      // ignore
    }
  }
  if (stream?.hls) {
    const hls = stream.hls;
    try {
      hls.stopLoad();
    } catch {
      // ignore
    }
    try {
      hls.detachMedia();
    } catch {
      // ignore
    }
    try {
      hls.destroy();
    } catch {
      // ignore
    }
    stream.hls = null;
  }
  if (video) {
    video.removeAttribute('src');
    Array.from(video.getElementsByTagName('source')).forEach((s) => s.remove());
    try {
      video.load();
    } catch {
      // ignore
    }
  }
}

/** 把当前画面画到 canvas 上，用于切换时“冻结最后一帧”。成功返回 true */
export function captureFrame(
  video: HTMLVideoElement | null,
  canvas: HTMLCanvasElement | null
): boolean {
  if (!video || !canvas) return false;
  if (video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
    return false;
  }
  try {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return true;
  } catch {
    return false;
  }
}

/** 播放器时间显示：14:02 / 1:02:03（向下取整，避免出现 00:60） */
export function formatClock(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) totalSeconds = 0;
  const s = Math.floor(totalSeconds);
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}
