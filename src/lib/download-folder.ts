/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 下载文件夹（Chrome / Edge 桌面版的 File System Access API）
 *
 * 用户用 showDirectoryPicker 选一次文件夹，句柄存进 IndexedDB，之后的下载直接在里面
 * 建文件，不用每个文件都弹保存框（批量下载多集时尤其需要）。
 *
 * 权限：选文件夹时浏览器会授予本次会话的读写权限；之后的会话需要用户点击时再确认一次
 * （requestPermission 必须在用户点击里调用），较新的 Chrome 也可以选择「每次访问都允许」。
 *
 * 句柄同时缓存在内存里，点击处理函数里可以同步拿到，确认权限时不会因为先等 IndexedDB
 * 而丢失用户手势。
 */

const DB_NAME = 'moontv-downloads';
const STORE = 'handles';
const KEY = 'folder';

let cached: FileSystemDirectoryHandle | null | undefined;

export function supportsDirectoryPicker(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as any).showDirectoryPicker === 'function' &&
    typeof indexedDB !== 'undefined'
  );
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idb<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = run(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/** 已保存的下载文件夹（没有选过时为 null） */
export async function loadFolder(): Promise<FileSystemDirectoryHandle | null> {
  if (cached !== undefined) return cached;
  if (!supportsDirectoryPicker()) return (cached = null);
  try {
    cached =
      (await idb<FileSystemDirectoryHandle | undefined>('readonly', (s) =>
        s.get(KEY)
      )) ?? null;
  } catch {
    cached = null;
  }
  return cached;
}

/** 内存里的文件夹句柄（loadFolder 之后可同步读取） */
export function cachedFolder(): FileSystemDirectoryHandle | null {
  return cached ?? null;
}

/** 弹出文件夹选择框并记住选择。用户取消时返回 null */
export async function pickFolder(): Promise<FileSystemDirectoryHandle | null> {
  let handle: FileSystemDirectoryHandle;
  try {
    handle = await (window as any).showDirectoryPicker({
      id: 'moontv-downloads',
      mode: 'readwrite',
      startIn: 'downloads',
    });
  } catch (err: any) {
    if (err?.name === 'AbortError') return null;
    throw err;
  }
  cached = handle;
  try {
    await idb('readwrite', (s) => s.put(handle, KEY));
  } catch {
    // 存不进 IndexedDB 时本次会话仍可使用
  }
  return handle;
}

export async function forgetFolder(): Promise<void> {
  cached = null;
  try {
    await idb('readwrite', (s) => s.delete(KEY));
  } catch {
    // ignore
  }
}

/**
 * 确认对文件夹的读写权限。request 为 true 时在需要时向用户申请（必须处于用户点击中）。
 */
export async function ensureFolderPermission(
  handle: FileSystemDirectoryHandle,
  request: boolean
): Promise<boolean> {
  const h = handle as any;
  const opts = { mode: 'readwrite' };
  try {
    if (typeof h.queryPermission !== 'function') return true;
    if ((await h.queryPermission(opts)) === 'granted') return true;
    if (!request || typeof h.requestPermission !== 'function') return false;
    return (await h.requestPermission(opts)) === 'granted';
  } catch {
    return false;
  }
}

async function exists(dir: FileSystemDirectoryHandle, name: string) {
  try {
    await dir.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

/** 文件夹里不重名的文件名：已存在时加上 (1)、(2)… */
export async function uniqueName(
  dir: FileSystemDirectoryHandle,
  filename: string
): Promise<string> {
  if (!(await exists(dir, filename))) return filename;
  const dot = filename.lastIndexOf('.');
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : '';
  for (let i = 1; i < 1000; i++) {
    const candidate = `${base} (${i})${ext}`;
    if (!(await exists(dir, candidate))) return candidate;
  }
  return `${base} (${Date.now()})${ext}`;
}

/** 在文件夹里新建文件并返回写入流（不会覆盖已有文件） */
export async function createFolderWriteStream(
  dir: FileSystemDirectoryHandle,
  filename: string
): Promise<{ stream: WritableStream<Uint8Array>; name: string }> {
  const name = await uniqueName(dir, filename);
  const file = await dir.getFileHandle(name, { create: true });
  const writable = await (file as any).createWritable();
  return {
    name,
    stream: new WritableStream<Uint8Array>({
      write: (chunk) => writable.write(chunk),
      close: () => writable.close(),
      abort: async (reason) => {
        await writable.abort(reason);
        // 未完成的文件不留在用户的文件夹里
        await dir.removeEntry(name).catch(() => undefined);
      },
    }),
  };
}

/** 仅供测试 */
export function __setCachedFolderForTests(h: FileSystemDirectoryHandle | null) {
  cached = h;
}
