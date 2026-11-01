/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * 边下边存：File System Access API 方案（Chrome / Edge 桌面版）
 *
 * 由用户选择保存位置后直接写入磁盘，整个文件不经过内存。
 * showSaveFilePicker 必须在用户点击的同一次操作中调用，所以调用方应在点击处理函数里
 * 先调用本函数，再做其他异步操作。
 */

export class FilePickerError extends Error {
  /** cancelled：用户关闭了选择框；denied：没有用户手势或被浏览器拒绝 */
  constructor(public readonly reason: 'cancelled' | 'denied', message: string) {
    super(message);
    this.name = 'FilePickerError';
  }
}

/** 是否支持 File System Access API */
export function supportsFileSystemAccess(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as any).showSaveFilePicker === 'function'
  );
}

/**
 * 弹出保存对话框并返回写入流。
 * 用户取消或浏览器拒绝时抛出 FilePickerError。
 */
export async function createFileSystemWriteStream(
  filename: string
): Promise<WritableStream<Uint8Array>> {
  if (!supportsFileSystemAccess()) {
    throw new FilePickerError('denied', 'File System Access API 不可用');
  }

  const isMp4 = filename.toLowerCase().endsWith('.mp4');
  let handle: any;
  try {
    handle = await (window as any).showSaveFilePicker({
      suggestedName: filename,
      types: [
        {
          description: isMp4 ? 'MP4 video' : 'MPEG-TS video',
          accept: isMp4 ? { 'video/mp4': ['.mp4'] } : { 'video/mp2t': ['.ts'] },
        },
      ],
    });
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new FilePickerError('cancelled', '已取消选择保存位置');
    }
    throw new FilePickerError('denied', err?.message || String(err));
  }

  const writable = await handle.createWritable();
  return new WritableStream<Uint8Array>({
    write: (chunk) => writable.write(chunk),
    close: () => writable.close(),
    abort: (reason) => writable.abort(reason),
  });
}
