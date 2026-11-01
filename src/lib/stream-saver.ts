/**
 * 边下边存：Service Worker 方案（思路来自 https://github.com/jimmywarting/StreamSaver.js）
 *
 * 页面把数据写进一个 WritableStream，Service Worker 把对应的 ReadableStream 作为一个
 * 带 Content-Disposition 的响应交给浏览器，浏览器就会像普通下载一样边收边写入磁盘，
 * 整个文件不经过内存。
 *
 * 用的是独立的 /stream-saver/sw.js（作用域 /stream-saver/），与 next-pwa 生成的
 * 站点 Service Worker 互不干扰：下载地址都在 /stream-saver/ 之下，由更具体的作用域接管。
 *
 * 本模块只在浏览器里按需动态导入，模块顶层不访问 window。
 */

const MITM_URL = '/stream-saver/mitm.html';
const READY_TIMEOUT_MS = 15000;
/** 下载用的 iframe 在流结束后保留多久再移除（给浏览器接管下载留出时间） */
const FRAME_CLEANUP_DELAY_MS = 30000;

let mitmPromise: Promise<HTMLIFrameElement> | null = null;

/** 当前环境能否使用 Service Worker 边下边存 */
export function isStreamSaverSupported(): boolean {
  if (typeof window === 'undefined') return false;
  if (!window.isSecureContext || !('serviceWorker' in navigator)) return false;
  if (
    typeof ReadableStream === 'undefined' ||
    typeof MessageChannel === 'undefined'
  ) {
    return false;
  }
  // Safari 不支持把 Service Worker 生成的响应当作附件下载
  const ua = navigator.userAgent;
  const isSafari =
    /Safari\//.test(ua) && !/Chrome\/|Chromium\/|CriOS\/|Edg\//.test(ua);
  return !isSafari;
}

function supportsTransferableStreams(): boolean {
  try {
    const { readable } = new TransformStream();
    const mc = new MessageChannel();
    mc.port1.postMessage(readable, [readable as unknown as Transferable]);
    mc.port1.close();
    mc.port2.close();
    return true;
  } catch {
    return false;
  }
}

function loadMitm(): Promise<HTMLIFrameElement> {
  if (mitmPromise) return mitmPromise;
  mitmPromise = new Promise<HTMLIFrameElement>((resolve, reject) => {
    const iframe = document.createElement('iframe');
    iframe.hidden = true;
    iframe.setAttribute('aria-hidden', 'true');
    iframe.src = MITM_URL;

    const cleanup = () => {
      window.removeEventListener('message', onMessage);
      window.clearTimeout(timer);
    };
    const fail = (reason: string) => {
      cleanup();
      iframe.remove();
      mitmPromise = null;
      reject(new Error(reason));
    };
    const onMessage = (event: MessageEvent) => {
      if (
        event.source !== iframe.contentWindow ||
        event.origin !== location.origin
      ) {
        return;
      }
      if (event.data === 'stream-saver-ready') {
        cleanup();
        resolve(iframe);
      } else if (event.data?.streamSaverError) {
        fail(String(event.data.streamSaverError));
      }
    };
    const timer = window.setTimeout(
      () => fail('Service Worker 启动超时'),
      READY_TIMEOUT_MS
    );
    window.addEventListener('message', onMessage);
    document.body.appendChild(iframe);
  });
  return mitmPromise;
}

/**
 * 创建一个写入即下载的流。返回时浏览器已经开始下载（文件出现在浏览器的下载列表里）。
 * 用户在浏览器里取消下载时，后续写入会失败。
 */
export async function createServiceWorkerStream(
  filename: string
): Promise<WritableStream<Uint8Array>> {
  const mitm = await loadMitm();
  const channel = new MessageChannel();
  const port = channel.port1;
  const transferable = supportsTransferableStreams();
  const transform = transferable
    ? new TransformStream<Uint8Array, Uint8Array>()
    : null;

  const encoded = encodeURIComponent(filename.replace(/\//g, ':'))
    .replace(/['()]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
    .replace(/\*/g, '%2A');

  if (transform) {
    port.postMessage({ readableStream: transform.readable }, [
      transform.readable as unknown as Transferable,
    ]);
  }

  let downloadFrame: HTMLIFrameElement | null = null;
  let cancelledByBrowser = false;
  const removeFrameLater = () => {
    const frame = downloadFrame;
    downloadFrame = null;
    if (frame) window.setTimeout(() => frame.remove(), FRAME_CLEANUP_DELAY_MS);
  };
  const closePort = () => {
    port.onmessage = null;
    port.close();
  };

  const downloadUrl = await new Promise<string>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      closePort();
      reject(new Error('Service Worker 未响应'));
    }, READY_TIMEOUT_MS);
    port.onmessage = (evt) => {
      if (evt.data?.download) {
        window.clearTimeout(timer);
        resolve(evt.data.download as string);
      }
    };
    mitm.contentWindow?.postMessage(
      {
        transferringReadable: !!transform,
        pathname: `${Math.random().toString().slice(-8)}/${encoded}`,
        headers: {
          'Content-Type': 'application/octet-stream; charset=utf-8',
          'Content-Disposition': `attachment; filename*=UTF-8''${encoded}`,
        },
      },
      location.origin,
      [channel.port2]
    );
  });

  // 浏览器端取消下载时，Service Worker 会通知我们
  port.onmessage = (evt) => {
    if (evt.data?.abort) cancelledByBrowser = true;
  };

  downloadFrame = document.createElement('iframe');
  downloadFrame.hidden = true;
  downloadFrame.setAttribute('aria-hidden', 'true');
  downloadFrame.src = downloadUrl;
  document.body.appendChild(downloadFrame);

  if (transform) {
    const writer = transform.writable.getWriter();
    return new WritableStream<Uint8Array>({
      async write(chunk) {
        await writer.write(chunk);
      },
      async close() {
        try {
          await writer.close();
        } finally {
          closePort();
          removeFrameLater();
        }
      },
      async abort(reason) {
        try {
          await writer.abort(reason);
        } finally {
          closePort();
          removeFrameLater();
        }
      },
    });
  }

  // 不支持可转移流时，逐块通过 MessagePort 发给 Service Worker
  return new WritableStream<Uint8Array>({
    write(chunk) {
      if (cancelledByBrowser) throw new Error('下载已在浏览器中取消');
      port.postMessage(chunk);
    },
    close() {
      port.postMessage('end');
      closePort();
      removeFrameLater();
    },
    abort() {
      port.postMessage('abort');
      closePort();
      removeFrameLater();
    },
  });
}
