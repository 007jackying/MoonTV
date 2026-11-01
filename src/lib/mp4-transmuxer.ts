/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * TS → MP4 转封装（基于 mux.js，见 https://github.com/videojs/mux.js）
 *
 * 逐个切片转封装：每推入一个 TS 切片就立刻 flush，输出该切片对应的 moof+mdat，
 * 第一次输出时额外带上 init 段（ftyp+moov）。这样无论是边下边存还是内存模式，
 * 都只需要按顺序拼接输出即可得到一个完整的（分片）MP4，mux.js 内部不会囤积整部影片。
 *
 * 时间轴：输出从 0 开始（范围下载、源时间戳不从 0 开始时也一样）。遇到
 * #EXT-X-DISCONTINUITY（源时间戳在这里重新开始，去广告后正片各组之间就保留了它）时，
 * 换一个新的转封装器，并把它的起点放在播放列表里该切片的时间点上，避免时间轴回退重叠。
 *
 * mux.js 的事件是同步触发的，push() 返回时本切片的输出已经全部收集完毕，
 * 调用方按返回顺序写入即可，不存在异步写入交错的问题。
 */

// @ts-expect-error - mux.js 没有 TypeScript 类型定义
import muxjs from 'mux.js';

/** MPEG-TS 的 90kHz 时钟 */
const TS_CLOCK = 90000;

export interface FragmentOptions {
  /** 该切片在输出文件里的起始时间（秒），只在 discontinuity 时使用 */
  startTime?: number;
  /** 源时间戳在这个切片处不连续 */
  discontinuity?: boolean;
}

export class TsToMp4Fragmenter {
  private transmuxer: any = null;
  private output: Uint8Array[] = [];
  private wroteInit = false;

  /** @param duration 视频总时长（秒），写入 moov 头，播放器据此显示总时长 */
  constructor(private duration = 0) {
    this.transmuxer = this.create(0);
  }

  private create(baseSeconds: number) {
    const transmuxer = new muxjs.mp4.Transmuxer({
      keepOriginalTimestamps: false,
      baseMediaDecodeTime: Math.max(0, Math.round(baseSeconds * TS_CLOCK)),
      duration: this.duration,
    });
    transmuxer.on('data', (segment: any) => {
      // 每个转封装器都会带 init 段，整个文件只写第一个
      if (!this.wroteInit && segment.initSegment?.byteLength) {
        this.output.push(new Uint8Array(segment.initSegment));
        this.wroteInit = true;
      }
      if (segment.data?.byteLength) {
        this.output.push(new Uint8Array(segment.data));
      }
    });
    return transmuxer;
  }

  /** 推入一个完整的 TS 切片，返回需要按顺序写出的 MP4 数据 */
  push(ts: Uint8Array, options: FragmentOptions = {}): Uint8Array[] {
    if (options.discontinuity && this.wroteInit) {
      this.transmuxer.dispose?.();
      this.transmuxer = this.create(options.startTime ?? 0);
    }
    this.transmuxer.push(ts);
    this.transmuxer.flush();
    const out = this.output;
    this.output = [];
    return out;
  }

  /** 是否已经输出过 init 段（没有任何可转封装的数据时为 false） */
  get hasOutput(): boolean {
    return this.wroteInit;
  }

  dispose(): void {
    this.output = [];
    this.transmuxer?.dispose?.();
    this.transmuxer = null;
  }
}
