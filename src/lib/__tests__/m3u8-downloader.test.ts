/**
 * @jest-environment node
 */
import { Blob as NodeBlob } from 'buffer';
import { createCipheriv, webcrypto } from 'crypto';
import {
  ReadableStream as NodeReadableStream,
  WritableStream as NodeWritableStream,
} from 'stream/web';

import {
  DownloadJob,
  M3U8Task,
  parseM3U8,
  parseMediaPlaylist,
  rangeFromSkipConfig,
  sanitizeFilename,
} from '../m3u8-downloader';

// ---------------------------------------------------------------------------
// 测试工具：假的网络与下载
// ---------------------------------------------------------------------------

type Handler = (
  url: string,
  init?: RequestInit
) => Promise<Response> | Response;
let routes: Record<string, Handler> = {};
const fetchLog: string[] = [];

function bytes(...values: number[]) {
  return new Uint8Array(values);
}

// Jest 27 的 node 环境没有这些 Web API，从 Node 自带的实现里补上
Object.assign(globalThis, {
  Blob: NodeBlob,
  ReadableStream: NodeReadableStream,
  WritableStream: NodeWritableStream,
  crypto: webcrypto,
});

function respond(body: Uint8Array | string, status = 200): Response {
  const data = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  return {
    ok: status >= 200 && status < 300,
    status,
    body: new NodeReadableStream({
      start(controller) {
        // 分两块发送，覆盖逐块读取的路径
        const mid = Math.floor(data.byteLength / 2);
        if (mid > 0) controller.enqueue(data.slice(0, mid));
        controller.enqueue(data.slice(mid));
        controller.close();
      },
    }),
  } as unknown as Response;
}

/** 返回一个在 signal 中止时拒绝的 Promise，模拟卡住的请求 */
function hang(init?: RequestInit): Promise<Response> {
  return new Promise((_, reject) => {
    init?.signal?.addEventListener('abort', () =>
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    );
  });
}

const saved: Array<{ name: string; blob: Blob }> = [];

beforeAll(() => {
  global.fetch = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    fetchLog.push(url);
    const handler = routes[url];
    if (!handler) return Promise.resolve(respond('not found', 404));
    return Promise.resolve(handler(url, init));
  }) as unknown as typeof fetch;

  let lastBlob: Blob | null = null;
  URL.createObjectURL = (blob: Blob) => {
    lastBlob = blob;
    return 'blob:test';
  };
  URL.revokeObjectURL = () => undefined;
  (global as unknown as { document: unknown }).document = {
    createElement: () => {
      const a = {
        style: {},
        download: '',
        href: '',
        click: () => saved.push({ name: a.download, blob: lastBlob as Blob }),
        remove: () => undefined,
      };
      return a;
    },
    body: { appendChild: () => undefined },
  };
});

beforeEach(() => {
  routes = {};
  fetchLog.length = 0;
  saved.length = 0;
});

const BASE = 'https://cdn.test/video/index.m3u8';

function playlist(count: number, extra = '') {
  let text = '#EXTM3U\n#EXT-X-TARGETDURATION:4\n' + extra;
  for (let i = 0; i < count; i++) text += `#EXTINF:4.0,\nseg${i}.ts\n`;
  return text + '#EXT-X-ENDLIST\n';
}

function serveSegments(count: number) {
  for (let i = 0; i < count; i++) {
    routes[`https://cdn.test/video/seg${i}.ts`] = () => respond(bytes(i, i, i));
  }
}

async function blobBytes(blob: Blob) {
  return Array.from(new Uint8Array(await blob.arrayBuffer()));
}

function collectingSink() {
  const chunks: number[] = [];
  let closed = false;
  let aborted = false;
  const sink = new WritableStream<Uint8Array>({
    write(chunk) {
      chunks.push(...Array.from(chunk));
    },
    close() {
      closed = true;
    },
    abort() {
      aborted = true;
    },
  });
  return {
    sink,
    chunks,
    get closed() {
      return closed;
    },
    get aborted() {
      return aborted;
    },
  };
}

// ---------------------------------------------------------------------------
// 解析
// ---------------------------------------------------------------------------

describe('parseMediaPlaylist', () => {
  it('resolves relative and absolute URIs, handles CRLF, tracks sequence and keys', () => {
    const text = [
      '#EXTM3U',
      '#EXT-X-MEDIA-SEQUENCE:7',
      '#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x0000000000000000000000000000000A',
      '#EXTINF:4,',
      'a.ts?token=1',
      '#EXT-X-KEY:METHOD=NONE',
      '#EXTINF:3.5,',
      '/abs/b.ts',
      '#EXTINF:2,',
      '//other.test/c.ts',
    ].join('\r\n');
    const { segments, keys } = parseMediaPlaylist(
      text,
      'https://cdn.test/v/index.m3u8?x=1/2'
    );
    expect(segments.map((s) => s.url)).toEqual([
      'https://cdn.test/v/a.ts?token=1',
      'https://cdn.test/abs/b.ts',
      'https://other.test/c.ts',
    ]);
    expect(segments.map((s) => s.duration)).toEqual([4, 3.5, 2]);
    expect(segments.map((s) => s.sequence)).toEqual([7, 8, 9]);
    expect(segments.map((s) => s.keyIndex)).toEqual([0, -1, -1]);
    expect(keys[0].uri).toBe('https://cdn.test/v/key.bin');
    expect(keys[0].iv?.[15]).toBe(10);
  });

  it('marks segments that follow #EXT-X-DISCONTINUITY', () => {
    const { segments } = parseMediaPlaylist(
      '#EXTM3U\n#EXT-X-DISCONTINUITY\n#EXTINF:2,\na.ts\n#EXTINF:2,\nb.ts\n' +
        '#EXT-X-DISCONTINUITY\n#EXTINF:2,\nc.ts\n#EXT-X-ENDLIST\n',
      BASE
    );
    // 第一个切片前的标记没有意义（前面没有可以断开的内容）
    expect(segments.map((s) => s.discontinuity)).toEqual([false, false, true]);
  });

  it('rejects SAMPLE-AES', () => {
    expect(() =>
      parseMediaPlaylist(
        '#EXTM3U\n#EXT-X-KEY:METHOD=SAMPLE-AES,URI="k"\n',
        BASE
      )
    ).toThrow(/SAMPLE-AES/);
  });
});

describe('parseM3U8', () => {
  it('follows the master playlist to the highest bandwidth and lists the variants', async () => {
    routes['https://cdn.test/master.m3u8'] = () =>
      respond(
        '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360\nlow/index.m3u8\n' +
          '#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720\nhigh/index.m3u8\n'
      );
    routes['https://cdn.test/high/index.m3u8'] = () => respond(playlist(3));
    const task = await parseM3U8('https://cdn.test/master.m3u8');
    expect(task.url).toBe('https://cdn.test/high/index.m3u8');
    expect(task.bandwidth).toBe(2800000);
    expect(task.variants?.map((v) => v.resolution)).toEqual([
      '1280x720',
      '640x360',
    ]);
    expect(task.tsUrlList).toHaveLength(3);
    expect(task.durationSecond).toBe(12);
  });

  it('reports HTTP errors and non-playlists clearly', async () => {
    await expect(
      parseM3U8('https://cdn.test/missing.m3u8')
    ).rejects.toMatchObject({
      code: 'http',
    });
    routes['https://cdn.test/page.html'] = () => respond('<html></html>');
    await expect(parseM3U8('https://cdn.test/page.html')).rejects.toMatchObject(
      {
        code: 'invalid-playlist',
      }
    );
  });
});

describe('rangeFromSkipConfig', () => {
  const task = {
    segmentDurations: [10, 10, 10, 10, 10, 10],
    durationSecond: 60,
  } as unknown as M3U8Task;

  it('keeps the segment that contains the intro / outro boundary', () => {
    expect(rangeFromSkipConfig(task, 15, -15)).toEqual({ start: 2, end: 5 });
    expect(rangeFromSkipConfig(task, 20, -20)).toEqual({ start: 3, end: 4 });
    expect(rangeFromSkipConfig(task, 0, 0)).toEqual({ start: 1, end: 6 });
  });

  it('falls back to the full range when intro and outro overlap', () => {
    expect(rangeFromSkipConfig(task, 50, -50)).toEqual({ start: 1, end: 6 });
  });
});

describe('sanitizeFilename', () => {
  it('strips characters that are illegal in file names and old extensions', () => {
    expect(sanitizeFilename('a/b:c*?"<>|d.mp4')).toBe('a_b_c______d');
    expect(sanitizeFilename('  ...  ')).toBe('video');
  });
});

// ---------------------------------------------------------------------------
// 下载
// ---------------------------------------------------------------------------

describe('DownloadJob (memory mode)', () => {
  it('downloads every segment, saves them in order and releases the data', async () => {
    routes[BASE] = () => respond(playlist(5));
    serveSegments(5);
    const task = await parseM3U8(BASE);
    task.title = 'My: Movie';
    const progress: number[] = [];
    const result = await new DownloadJob(task, {
      concurrency: 3,
      onProgress: (p) => p.phase === 'downloading' && progress.push(p.done),
    }).run();

    expect(result).toMatchObject({ saved: true, failed: 0, missing: 0 });
    expect(saved).toHaveLength(1);
    expect(saved[0].name).toBe('My_ Movie.ts');
    expect(await blobBytes(saved[0].blob)).toEqual([
      0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4,
    ]);
    expect(progress[progress.length - 1]).toBe(5);
    expect(task.downloadedSegments).toBeUndefined();
  });

  it('only downloads the selected range', async () => {
    routes[BASE] = () => respond(playlist(6));
    serveSegments(6);
    const task = await parseM3U8(BASE);
    task.rangeDownload = { startSegment: 2, endSegment: 4 };
    await new DownloadJob(task).run();
    expect(await blobBytes(saved[0].blob)).toEqual([1, 1, 1, 2, 2, 2, 3, 3, 3]);
    expect(fetchLog.filter((u) => u.endsWith('.ts'))).toHaveLength(3);
  });

  it('retries failed segments with backoff', async () => {
    routes[BASE] = () => respond(playlist(2));
    serveSegments(2);
    let attempts = 0;
    routes['https://cdn.test/video/seg1.ts'] = () =>
      ++attempts < 3 ? respond('busy', 503) : respond(bytes(9));
    const task = await parseM3U8(BASE);
    const result = await new DownloadJob(task, {
      maxRetries: 3,
      retryDelayMs: 5,
    }).run();
    expect(result.saved).toBe(true);
    expect(attempts).toBe(3);
    expect(await blobBytes(saved[0].blob)).toEqual([0, 0, 0, 9]);
  });

  it('keeps downloaded data when segments fail, and a second run only refetches the failures', async () => {
    routes[BASE] = () => respond(playlist(4));
    serveSegments(4);
    routes['https://cdn.test/video/seg2.ts'] = () => respond('gone', 500);
    const task = await parseM3U8(BASE);

    const first = await new DownloadJob(task, { maxRetries: 0 }).run();
    expect(first).toMatchObject({ saved: false, failed: 1 });
    expect(saved).toHaveLength(0);
    expect(task.downloadedSegments?.size).toBe(3);
    expect(task.finishList.map((s) => s.status)).toEqual([
      'success',
      'success',
      'error',
      'success',
    ]);

    fetchLog.length = 0;
    routes['https://cdn.test/video/seg2.ts'] = () => respond(bytes(2, 2, 2));
    const second = await new DownloadJob(task, { maxRetries: 0 }).run();
    expect(second.saved).toBe(true);
    expect(fetchLog).toEqual(['https://cdn.test/video/seg2.ts']);
    expect(await blobBytes(saved[0].blob)).toEqual([
      0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3,
    ]);
  });

  it('times out a stalled request instead of hanging forever', async () => {
    routes[BASE] = () => respond(playlist(2));
    serveSegments(2);
    routes['https://cdn.test/video/seg1.ts'] = (_u, init) => hang(init);
    const task = await parseM3U8(BASE);
    const result = await new DownloadJob(task, {
      maxRetries: 0,
      segmentTimeoutMs: 50,
    }).run();
    expect(result).toMatchObject({ saved: false, failed: 1 });
  });

  it('finishNow saves what is already downloaded', async () => {
    routes[BASE] = () => respond(playlist(3));
    serveSegments(3);
    routes['https://cdn.test/video/seg2.ts'] = (_u, init) => hang(init);
    const task = await parseM3U8(BASE);
    const job = new DownloadJob(task, { concurrency: 3 });
    const running = job.run();
    await new Promise((r) => setTimeout(r, 30));
    job.finishNow();
    const result = await running;
    expect(result).toMatchObject({ saved: true, failed: 0, missing: 1 });
    expect(await blobBytes(saved[0].blob)).toEqual([0, 0, 0, 1, 1, 1]);
  });

  it('pause stops new requests until resumed', async () => {
    routes[BASE] = () => respond(playlist(6));
    serveSegments(6);
    const task = await parseM3U8(BASE);
    const job = new DownloadJob(task, { concurrency: 1 });
    job.pause();
    const running = job.run();
    await new Promise((r) => setTimeout(r, 30));
    expect(fetchLog.filter((u) => u.endsWith('.ts'))).toHaveLength(0);
    job.resume();
    await running;
    expect(fetchLog.filter((u) => u.endsWith('.ts'))).toHaveLength(6);
  });

  it('pause aborts in-flight requests and refetches them after resume', async () => {
    routes[BASE] = () => respond(playlist(3));
    serveSegments(3);
    let attempts = 0;
    let aborted = 0;
    routes['https://cdn.test/video/seg1.ts'] = (_u, init) => {
      attempts++;
      if (attempts > 1) return respond(bytes(1, 1, 1));
      return hang(init).catch((e) => {
        aborted++;
        throw e;
      });
    };
    const task = await parseM3U8(BASE);
    const job = new DownloadJob(task, { concurrency: 3 });
    const running = job.run();
    await new Promise((r) => setTimeout(r, 30));
    job.pause();
    await new Promise((r) => setTimeout(r, 30));
    expect(aborted).toBe(1);
    expect(task.finishList[1].status).toBe('');
    job.resume();
    const result = await running;
    expect(result).toMatchObject({ saved: true, failed: 0 });
    expect(attempts).toBe(2);
    expect(await blobBytes(saved[0].blob)).toEqual([0, 0, 0, 1, 1, 1, 2, 2, 2]);
  });

  it('decrypts AES-128 segments, deriving the IV from the media sequence', async () => {
    const key = Buffer.alloc(16, 7);
    const encrypt = (plain: number[], seq: number) => {
      const iv = Buffer.alloc(16);
      iv.writeUInt32BE(seq, 12);
      const c = createCipheriv('aes-128-cbc', key, iv);
      return new Uint8Array(
        Buffer.concat([c.update(Buffer.from(plain)), c.final()])
      );
    };
    routes[BASE] = () =>
      respond(
        '#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:41\n#EXT-X-KEY:METHOD=AES-128,URI="/key"\n' +
          '#EXTINF:4,\nseg0.ts\n#EXTINF:4,\nseg1.ts\n#EXT-X-ENDLIST\n'
      );
    routes['https://cdn.test/key'] = () => respond(new Uint8Array(key));
    routes['https://cdn.test/video/seg0.ts'] = () =>
      respond(encrypt([1, 2, 3], 41));
    routes['https://cdn.test/video/seg1.ts'] = () =>
      respond(encrypt([4, 5], 42));
    const task = await parseM3U8(BASE);
    await new DownloadJob(task).run();
    expect(await blobBytes(saved[0].blob)).toEqual([1, 2, 3, 4, 5]);
  });

  it('removes ad segments when asked to', async () => {
    let text = '#EXTM3U\n#EXT-X-TARGETDURATION:6\n';
    for (let i = 0; i < 30; i++) text += `#EXTINF:6.000,\n/movie/part${i}.ts\n`;
    text += '#EXT-X-DISCONTINUITY\n';
    for (let i = 0; i < 3; i++) text += `#EXTINF:5.567,\n/ads/ad${i}.ts\n`;
    text += '#EXT-X-DISCONTINUITY\n';
    for (let i = 30; i < 60; i++)
      text += `#EXTINF:6.000,\n/movie/part${i}.ts\n`;
    text += '#EXT-X-ENDLIST\n';
    routes[BASE] = () => respond(text);
    const plain = await parseM3U8(BASE);
    const filtered = await parseM3U8(BASE, { removeAds: true });
    expect(plain.tsUrlList).toHaveLength(63);
    expect(filtered.tsUrlList).toHaveLength(60);
    expect(filtered.tsUrlList.some((u) => u.includes('/ads/'))).toBe(false);
    expect(filtered.adsRemoved?.segments).toBe(3);
    // 序号保持原值（AES 默认 IV 依赖它）
    expect(filtered.segmentSequence[30]).toBe(33);
  });
});

describe('DownloadJob (streaming mode)', () => {
  it('writes segments in order even when responses arrive out of order', async () => {
    routes[BASE] = () => respond(playlist(8));
    for (let i = 0; i < 8; i++) {
      routes[`https://cdn.test/video/seg${i}.ts`] = () =>
        new Promise((r) => setTimeout(() => r(respond(bytes(i))), (8 - i) * 3));
    }
    const task = await parseM3U8(BASE);
    const out = collectingSink();
    const result = await new DownloadJob(task, {
      concurrency: 4,
      sink: out.sink,
    }).run();
    expect(result.saved).toBe(true);
    expect(out.chunks).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(out.closed).toBe(true);
    expect(saved).toHaveLength(0);
  });

  it('bounds how far downloads run ahead of a stalled segment', async () => {
    routes[BASE] = () => respond(playlist(60));
    serveSegments(60);
    let release: (() => void) | null = null;
    routes['https://cdn.test/video/seg0.ts'] = () =>
      new Promise((r) => {
        release = () => r(respond(bytes(0)));
      });
    const task = await parseM3U8(BASE);
    const out = collectingSink();
    const running = new DownloadJob(task, {
      concurrency: 2,
      sink: out.sink,
    }).run();
    await new Promise((r) => setTimeout(r, 50));
    const started = fetchLog.filter((u) => u.endsWith('.ts')).length;
    // lookahead = max(concurrency * 3, 8) = 8：最多领先 8 个切片
    expect(started).toBeLessThanOrEqual(9);
    (release as unknown as () => void)();
    await running;
    expect(out.chunks).toHaveLength(1 + 59 * 3);
  });

  it('pausing and resuming mid-stream still writes every segment in order', async () => {
    routes[BASE] = () => respond(playlist(40));
    for (let i = 0; i < 40; i++) {
      routes[`https://cdn.test/video/seg${i}.ts`] = (_u, init) =>
        new Promise((resolve, reject) => {
          const timer = setTimeout(
            () => resolve(respond(bytes(i))),
            5 + (i % 4) * 3
          );
          init?.signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          });
        });
    }
    const task = await parseM3U8(BASE);
    const out = collectingSink();
    const job = new DownloadJob(task, { concurrency: 3, sink: out.sink });
    const running = job.run();
    for (let k = 0; k < 4; k++) {
      await new Promise((r) => setTimeout(r, 12));
      job.pause();
      await new Promise((r) => setTimeout(r, 8));
      job.resume();
    }
    await running;
    expect(out.chunks).toEqual(Array.from({ length: 40 }, (_, i) => i));
  });

  it('skips failed segments and still closes the file', async () => {
    routes[BASE] = () => respond(playlist(3));
    serveSegments(3);
    routes['https://cdn.test/video/seg1.ts'] = () => respond('x', 404);
    const task = await parseM3U8(BASE);
    const out = collectingSink();
    const result = await new DownloadJob(task, {
      maxRetries: 0,
      sink: out.sink,
    }).run();
    expect(result).toMatchObject({ saved: true, failed: 1 });
    expect(out.chunks).toEqual([0, 0, 0, 2, 2, 2]);
    expect(out.closed).toBe(true);
  });

  it('cancel aborts the file and in-flight requests', async () => {
    routes[BASE] = () => respond(playlist(3));
    routes['https://cdn.test/video/seg0.ts'] = (_u, init) => hang(init);
    routes['https://cdn.test/video/seg1.ts'] = (_u, init) => hang(init);
    routes['https://cdn.test/video/seg2.ts'] = (_u, init) => hang(init);
    const task = await parseM3U8(BASE);
    const out = collectingSink();
    const job = new DownloadJob(task, { sink: out.sink });
    const running = job.run();
    await new Promise((r) => setTimeout(r, 20));
    job.cancel();
    await expect(running).rejects.toMatchObject({ code: 'aborted' });
    expect(out.aborted).toBe(true);
  });

  it('reports a write failure (e.g. the user cancelled the browser download)', async () => {
    routes[BASE] = () => respond(playlist(4));
    serveSegments(4);
    const task = await parseM3U8(BASE);
    const sink = new WritableStream<Uint8Array>({
      write() {
        throw new Error('disk full');
      },
    });
    await expect(new DownloadJob(task, { sink }).run()).rejects.toMatchObject({
      code: 'write',
    });
  });
});
