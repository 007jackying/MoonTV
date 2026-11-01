/**
 * @jest-environment node
 */
import { Blob as NodeBlob } from 'buffer';
import { webcrypto } from 'crypto';
import {
  ReadableStream as NodeReadableStream,
  WritableStream as NodeWritableStream,
} from 'stream/web';

import type { DownloadConfig, DownloadTaskView } from '../download-store';

Object.assign(globalThis, {
  Blob: NodeBlob,
  ReadableStream: NodeReadableStream,
  WritableStream: NodeWritableStream,
  crypto: webcrypto,
});

// ---- 假的下载文件夹（File System Access API 在 node 里不存在）----
const mockFolder = {
  handle: null as null | { name: string },
  granted: true,
  grantOnRequest: true,
  requests: 0,
  files: new Map<string, number[]>(),
};
jest.mock('../download-folder', () => ({
  loadFolder: async () => mockFolder.handle,
  cachedFolder: () => mockFolder.handle,
  ensureFolderPermission: async (_h: unknown, request: boolean) => {
    if (mockFolder.granted) return true;
    if (!request) return false;
    mockFolder.requests++;
    mockFolder.granted = mockFolder.grantOnRequest;
    return mockFolder.granted;
  },
  createFolderWriteStream: async (_dir: unknown, name: string) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { WritableStream: WS } = require('stream/web');
    const chunks: number[] = [];
    mockFolder.files.set(name, chunks);
    return {
      name,
      stream: new WS({
        write(c: Uint8Array) {
          chunks.push(...Array.from(c));
        },
      }),
    };
  },
}));

// ---- 假的浏览器环境 ----
class MemoryStorage {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}
const session = new MemoryStorage();
const local = new MemoryStorage();
const windowListeners: Record<string, Array<(e: unknown) => void>> = {};
Object.assign(globalThis, {
  window: {
    sessionStorage: session,
    localStorage: local,
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      (windowListeners[type] ||= []).push(fn);
    },
  },
});

const saved: string[] = [];
URL.createObjectURL = () => 'blob:test';
URL.revokeObjectURL = () => undefined;
(globalThis as unknown as { document: unknown }).document = {
  createElement: () => {
    const a = {
      style: {},
      download: '',
      click: () => saved.push(a.download),
      remove: () => undefined,
    };
    return a;
  },
  body: { appendChild: () => undefined },
};

// ---- 假的网络 ----
type Gate = { open: () => void; promise: Promise<void> };
function gate(): Gate {
  let open = () => undefined as void;
  const promise = new Promise<void>((r) => (open = r));
  return { open, promise };
}
let segmentGate: Gate | null = null;
let failing = new Set<string>();
const requested: string[] = [];

function respond(body: Uint8Array | string, status = 200): Response {
  const data = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  return {
    ok: status < 400,
    status,
    body: new NodeReadableStream({
      start(c) {
        c.enqueue(data);
        c.close();
      },
    }),
  } as unknown as Response;
}

function playlist(n: number) {
  let s = '#EXTM3U\n';
  for (let i = 0; i < n; i++) s += `#EXTINF:5,\ns${i}.ts\n`;
  return s + '#EXT-X-ENDLIST\n';
}

/** 只含 PAT + PMT 的 TS 切片，用来模拟不同编码（与 ts-probe.test.ts 相同） */
function fakeTs(streamTypes: number[]): Uint8Array {
  const packet = (pid: number, section: number[]) => {
    const p = new Uint8Array(188).fill(0xff);
    p.set([0x47, 0x40 | (pid >> 8), pid & 0xff, 0x10, 0x00, ...section]);
    return p;
  };
  const streams = streamTypes.flatMap((t, i) => [
    t,
    0xe1,
    0x01 + i,
    0xf0,
    0x00,
  ]);
  const out = new Uint8Array(376);
  out.set(
    packet(
      0,
      [
        0x00, 0xb0, 13, 0x00, 0x01, 0xc1, 0x00, 0x00, 0x00, 0x01, 0xe1, 0x00, 0,
        0, 0, 0,
      ]
    )
  );
  out.set(
    packet(0x100, [
      0x02,
      0xb0,
      13 + streams.length,
      0x00,
      0x01,
      0xc1,
      0x00,
      0x00,
      0xe1,
      0x01,
      0xf0,
      0x00,
      ...streams,
      0,
      0,
      0,
      0,
    ]),
    188
  );
  return out;
}

global.fetch = jest.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  requested.push(url);
  const m = url.match(/\/(\w+)\/index\.m3u8$/);
  if (m) return respond(playlist(Number(m[1].replace(/\D/g, '')) || 3));
  if (segmentGate) await segmentGate.promise;
  if (failing.has(url)) return respond('nope', 500);
  if (url.endsWith('/hevc3/s0.ts')) return respond(fakeTs([0x24, 0x0f]));
  return respond(new Uint8Array([1, 2, 3]));
}) as unknown as typeof fetch;

const config: DownloadConfig = {
  type: 'TS',
  concurrency: 2,
  maxRetries: 0,
  streamMode: 'disabled',
  removeAds: false,
  range: null,
};

type Store = typeof import('../download-store');
let store: Store;

async function waitFor(predicate: () => boolean, ms = 2000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}
const byId = (id: string) =>
  store.getTasks().find((t) => t.id === id) as DownloadTaskView;

beforeEach(() => {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  store = require('../download-store');
  session.data.clear();
  local.data.clear();
  saved.length = 0;
  requested.length = 0;
  segmentGate = null;
  failing = new Set();
  mockFolder.handle = null;
  mockFolder.granted = true;
  mockFolder.grantOnRequest = true;
  mockFolder.requests = 0;
  mockFolder.files.clear();
});

afterEach(() => store.__resetForTests());

describe('download store', () => {
  it('downloads a task to completion and notifies subscribers', async () => {
    const listener = jest.fn();
    store.subscribe(listener);
    const res = await store.addTask({
      url: 'https://cdn.test/v4/index.m3u8',
      title: 'Episode 1',
      config,
    });
    expect(res.ok).toBe(true);
    const id = (res as { id: string }).id;
    await waitFor(() => byId(id).status === 'completed');
    expect(byId(id)).toMatchObject({
      done: 4,
      total: 4,
      skipped: 0,
      bytes: 12,
    });
    expect(saved).toEqual(['Episode 1.ts']);
    expect(listener).toHaveBeenCalled();
    expect(store.countUnfinished(store.getTasks())).toBe(0);
  });

  it(`runs at most ${2} tasks at a time and queues the rest`, async () => {
    segmentGate = gate();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await store.addTask({
        url: `https://cdn.test/v${i + 3}/index.m3u8`,
        title: `t${i}`,
        config,
      });
      ids.push((r as { id: string }).id);
    }
    await waitFor(() => byId(ids[1]).status === 'downloading');
    expect(store.MAX_ACTIVE).toBe(2);
    expect(byId(ids[0]).status).toBe('downloading');
    expect(byId(ids[2]).status).toBe('queued');
    segmentGate.open();
    await waitFor(() => ids.every((id) => byId(id).status === 'completed'));
  });

  it('starts a queued task when an active one is paused, and resumes later', async () => {
    segmentGate = gate();
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await store.addTask({
        url: `https://cdn.test/v${i + 3}/index.m3u8`,
        title: `t${i}`,
        config,
      });
      ids.push((r as { id: string }).id);
    }
    await waitFor(() => byId(ids[0]).status === 'downloading');
    store.pauseTask(ids[0]);
    expect(byId(ids[0]).status).toBe('paused');
    await waitFor(() => byId(ids[2]).status === 'downloading');
    segmentGate.open();
    await waitFor(
      () =>
        byId(ids[1]).status === 'completed' &&
        byId(ids[2]).status === 'completed'
    );
    expect(byId(ids[0]).status).toBe('paused');
    await store.resumeTask(ids[0]);
    await waitFor(() => byId(ids[0]).status === 'completed');
  });

  it('marks a task incomplete when segments fail, retries only those, or saves anyway', async () => {
    failing = new Set(['https://cdn.test/v3/s1.ts']);
    const r = await store.addTask({
      url: 'https://cdn.test/v3/index.m3u8',
      title: 'x',
      config,
    });
    const id = (r as { id: string }).id;
    await waitFor(() => byId(id).status === 'incomplete');
    expect(byId(id)).toMatchObject({ done: 2, failed: 1 });
    expect(saved).toHaveLength(0);

    requested.length = 0;
    await store.resumeTask(id);
    await waitFor(
      () => byId(id).status === 'incomplete' && requested.length > 0
    );
    expect(requested).toEqual(['https://cdn.test/v3/s1.ts']);

    await store.saveNow(id);
    await waitFor(() => byId(id).status === 'completed');
    expect(byId(id).skipped).toBe(1);
    expect(saved).toEqual(['x.ts']);
  });

  it('remove cancels the download and frees the task', async () => {
    segmentGate = gate();
    const r = await store.addTask({
      url: 'https://cdn.test/v3/index.m3u8',
      title: 'x',
      config,
    });
    const id = (r as { id: string }).id;
    await waitFor(() => byId(id)?.status === 'downloading');
    store.removeTask(id);
    expect(store.getTasks()).toHaveLength(0);
    expect(store.getTaskDetail(id)).toBeUndefined();
    segmentGate.open();
    await new Promise((r) => setTimeout(r, 30));
    expect(saved).toHaveLength(0);
  });

  it('reports parse errors on the task', async () => {
    (global.fetch as jest.Mock).mockImplementationOnce(async () =>
      respond('<html>', 200)
    );
    const r = await store.addTask({
      url: 'https://cdn.test/bad.m3u8',
      title: 'x',
      config,
    });
    const id = (r as { id: string }).id;
    await waitFor(() => byId(id).status === 'error');
    expect(byId(id).error?.code).toBe('invalid-playlist');
  });

  it('persists to sessionStorage and restarts interrupted tasks after a reload', async () => {
    segmentGate = gate();
    const a = await store.addTask({
      url: 'https://cdn.test/v3/index.m3u8',
      title: 'a',
      config,
    });
    const b = await store.addTask({
      url: 'https://cdn.test/v4/index.m3u8',
      title: 'b',
      config: { ...config, streamMode: 'file-system' },
    });
    // 文件系统直写在 node 里无法打开保存框
    expect(b.ok).toBe(false);
    await waitFor(
      () => byId((a as { id: string }).id).status === 'downloading'
    );
    (windowListeners.pagehide || []).forEach((fn) => fn({}));
    const persisted = JSON.parse(session.getItem('moontv_downloads') as string);
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).not.toHaveProperty('speed');

    // 模拟刷新：新的模块实例读取 sessionStorage
    session.setItem(
      'moontv_downloads',
      JSON.stringify([
        ...persisted,
        {
          ...persisted[0],
          id: 'fs',
          config: { ...config, streamMode: 'file-system' },
        },
        { ...persisted[0], id: 'done', status: 'completed' },
      ])
    );
    store.__resetForTests();
    jest.resetModules();
    segmentGate.open();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    store = require('../download-store');
    local.setItem('downloadTasks', '[{"huge":"legacy"}]');
    store.init();
    expect(local.getItem('downloadTasks')).toBeNull();
    const restoredId = (a as { id: string }).id;
    expect(byId('fs')).toMatchObject({
      status: 'paused',
      needsGesture: true,
      restored: true,
    });
    expect(byId('done').status).toBe('completed');
    await waitFor(() => byId(restoredId).status === 'completed');
    expect(byId(restoredId).restored).toBe(true);
  });

  it('adds several episodes at once, queues them in order and trims each by the skip times', async () => {
    segmentGate = gate();
    const res = await store.addTasks(
      [3, 4, 6].map((n) => ({
        url: `https://cdn.test/v${n}/index.m3u8`,
        title: `剧 第0${n}集`,
        config: { ...config, skip: { intro: 6, outro: -6 } },
      }))
    );
    expect(res.ok).toBe(true);
    const ids = (res as { ids: string[] }).ids;
    await waitFor(() => byId(ids[1]).status === 'downloading');
    expect(byId(ids[2]).status).toBe('queued');
    segmentGate.open();
    await waitFor(() => ids.every((id) => byId(id).status === 'completed'));
    // 每集 5 秒一段：去掉片头 6 秒、片尾 6 秒后，从第 2 段到倒数第 2 段
    expect(ids.map((id) => byId(id).total)).toEqual([1, 2, 4]);
    expect(byId(ids[2]).timeRange).toEqual({ from: 5, to: 25 });
    expect(saved).toEqual(['剧 第03集.ts', '剧 第04集.ts', '剧 第06集.ts']);
  });

  it('writes into the chosen download folder without a save dialog', async () => {
    mockFolder.handle = { name: 'Movies' };
    const res = await store.addTasks(
      [3, 4].map((n) => ({
        url: `https://cdn.test/v${n}/index.m3u8`,
        title: `ep${n}`,
        config: { ...config, streamMode: 'file-system' as const, folder: true },
      }))
    );
    expect(res.ok).toBe(true);
    const ids = (res as { ids: string[] }).ids;
    await waitFor(() => ids.every((id) => byId(id).status === 'completed'));
    expect(Array.from(mockFolder.files.keys()).sort()).toEqual([
      'ep3.ts',
      'ep4.ts',
    ]);
    expect(mockFolder.files.get('ep4.ts')).toHaveLength(12);
    expect(byId(ids[0])).toMatchObject({
      folderName: 'Movies',
      savedName: 'ep3.ts',
    });
    expect(saved).toHaveLength(0);
  });

  it('refuses the folder mode without a folder, and several save dialogs in one click', async () => {
    const noFolder = await store.addTask({
      url: 'https://cdn.test/v3/index.m3u8',
      title: 'x',
      config: { ...config, streamMode: 'file-system', folder: true },
    });
    expect(noFolder).toMatchObject({ ok: false, reason: 'denied' });
    const many = await store.addTasks(
      [3, 4].map((n) => ({
        url: `https://cdn.test/v${n}/index.m3u8`,
        title: `x${n}`,
        config: { ...config, streamMode: 'file-system' as const },
      }))
    );
    expect(many).toMatchObject({ ok: false, reason: 'denied' });
    expect(store.getTasks()).toHaveLength(0);
  });

  it('waits for a click when the folder permission is gone after a reload', async () => {
    mockFolder.handle = { name: 'Movies' };
    mockFolder.granted = false;
    session.setItem(
      'moontv_downloads',
      JSON.stringify([
        {
          id: 'f1',
          url: 'https://cdn.test/v3/index.m3u8',
          title: 'f1',
          createdAt: 1,
          config: { ...config, streamMode: 'file-system', folder: true },
          status: 'downloading',
          done: 1,
          failed: 0,
          total: 3,
          bytes: 3,
          duration: 0,
          timeRange: null,
          skipped: 0,
        },
      ])
    );
    store.init();
    await waitFor(() => byId('f1').status === 'paused');
    expect(byId('f1').needsGesture).toBe(true);
    expect(mockFolder.requests).toBe(0);
    // 用户点击「继续」：在这次点击里申请权限，然后写进文件夹
    await store.resumeTask('f1');
    expect(mockFolder.requests).toBe(1);
    await waitFor(() => byId('f1').status === 'completed');
    expect(mockFolder.files.has('f1.ts')).toBe(true);
  });

  it('saves H.265 sources as TS when MP4 was asked for, and says why', async () => {
    const r = await store.addTask({
      url: 'https://cdn.test/hevc3/index.m3u8',
      title: '剧 第01集',
      config: { ...config, type: 'MP4' },
    });
    const id = (r as { id: string }).id;
    await waitFor(() => byId(id).status === 'completed');
    expect(byId(id)).toMatchObject({ savedFormat: 'TS', codecName: 'H.265' });
    expect(saved).toEqual(['剧 第01集.ts']);
    expect(requested.filter((u) => u.endsWith('/hevc3/s0.ts'))).toHaveLength(1);
  });

  it('asks the browser to confirm leaving while downloads are running', async () => {
    segmentGate = gate();
    await store.addTask({
      url: 'https://cdn.test/v3/index.m3u8',
      title: 'x',
      config,
    });
    const event = {
      preventDefault: jest.fn(),
      returnValue: undefined as unknown,
    };
    (windowListeners.beforeunload || []).forEach((fn) => fn(event));
    expect(event.preventDefault).toHaveBeenCalled();
    segmentGate.open();
  });
});
