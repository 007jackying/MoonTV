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

global.fetch = jest.fn(async (input: RequestInfo | URL) => {
  const url = String(input);
  requested.push(url);
  const m = url.match(/\/(\w+)\/index\.m3u8$/);
  if (m) return respond(playlist(Number(m[1].replace(/\D/g, '')) || 3));
  if (segmentGate) await segmentGate.promise;
  if (failing.has(url)) return respond('nope', 500);
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
