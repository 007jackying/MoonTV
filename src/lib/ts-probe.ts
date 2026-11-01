/**
 * 读取 MPEG-TS 切片的节目表（PAT / PMT），判断里面是什么编码。
 *
 * 转 MP4 用的 mux.js 只认 H.264 视频和 AAC 音频，遇到别的编码不会报错，而是悄悄丢掉
 * 那一路：H.265 的视频转出来只剩声音，AC-3 / MP3 的音频转出来没有声音。所以转换前先
 * 看一眼第一个切片，不能转的就直接保存原始的 TS。
 */

export interface TsCodecs {
  /** PMT 里列出的所有 stream_type */
  streamTypes: number[];
  /** 显示用的编码名，如 H.264、H.265；没有视频时为 undefined */
  video?: string;
  audio?: string;
  /** mux.js 能完整转成 MP4（视频是 H.264 或没有视频，音频是 AAC 或没有音频） */
  mp4: boolean;
}

const VIDEO: Record<number, string> = {
  0x01: 'MPEG-1',
  0x02: 'MPEG-2',
  0x10: 'MPEG-4',
  0x1b: 'H.264',
  0x24: 'H.265',
  0x42: 'AVS',
  0xd2: 'AVS2',
};

const AUDIO: Record<number, string> = {
  0x03: 'MP2/MP3',
  0x04: 'MP2/MP3',
  0x0f: 'AAC',
  0x11: 'AAC-LATM',
  0x81: 'AC-3',
  0x87: 'E-AC-3',
};

/** 不影响转换的流：ID3 时间元数据等 */
const IGNORED = new Set([0x15]);

const PACKET = 188;

function payloadOf(data: Uint8Array, offset: number): Uint8Array | null {
  const afc = (data[offset + 3] >> 4) & 0x03;
  if (afc === 0 || afc === 2) return null; // 没有负载
  let start = offset + 4;
  if (afc === 3) start += 1 + data[offset + 4];
  if (start >= offset + PACKET) return null;
  return data.subarray(start, offset + PACKET);
}

/** 带 pointer_field 的 PSI 段 */
function section(payload: Uint8Array): Uint8Array | null {
  const pointer = payload[0];
  const start = 1 + pointer;
  if (start + 3 > payload.length) return null;
  const length = ((payload[start + 1] & 0x0f) << 8) | payload[start + 2];
  return payload.subarray(start, Math.min(payload.length, start + 3 + length));
}

/**
 * 解析第一个切片的节目表。不是 TS（没有同步字节）或找不到 PMT 时返回 null，
 * 调用方按「未知」处理。
 */
export function probeTsCodecs(data: Uint8Array): TsCodecs | null {
  // 找到第一个同步字节（有的切片前面带少量填充）
  let first = -1;
  for (let i = 0; i < Math.min(data.length, PACKET * 2); i++) {
    if (
      data[i] === 0x47 &&
      (i + PACKET >= data.length || data[i + PACKET] === 0x47)
    ) {
      first = i;
      break;
    }
  }
  if (first < 0) return null;

  let pmtPid = -1;
  for (let off = first; off + PACKET <= data.length; off += PACKET) {
    if (data[off] !== 0x47) continue;
    const pusi = (data[off + 1] & 0x40) !== 0;
    const pid = ((data[off + 1] & 0x1f) << 8) | data[off + 2];
    if (!pusi || (pid !== 0 && pid !== pmtPid)) continue;
    const payload = payloadOf(data, off);
    const sec = payload && section(payload);
    if (!sec || sec.length < 12) continue;

    if (pid === 0 && sec[0] === 0x00 && pmtPid < 0) {
      // PAT：第一个 program_number 不为 0 的节目
      for (let i = 8; i + 4 <= sec.length - 4; i += 4) {
        const program = (sec[i] << 8) | sec[i + 1];
        if (program !== 0) {
          pmtPid = ((sec[i + 2] & 0x1f) << 8) | sec[i + 3];
          break;
        }
      }
    } else if (pid === pmtPid && sec[0] === 0x02) {
      // PMT：逐个读取 stream_type
      const infoLength = ((sec[10] & 0x0f) << 8) | sec[11];
      const streamTypes: number[] = [];
      for (let i = 12 + infoLength; i + 5 <= sec.length - 4; ) {
        streamTypes.push(sec[i]);
        const esInfo = ((sec[i + 3] & 0x0f) << 8) | sec[i + 4];
        i += 5 + esInfo;
      }
      return describe(streamTypes);
    }
  }
  return null;
}

export function describe(streamTypes: number[]): TsCodecs {
  const videos = streamTypes.filter((t) => VIDEO[t]);
  const audios = streamTypes.filter((t) => AUDIO[t]);
  const unknown = streamTypes.filter(
    (t) => !VIDEO[t] && !AUDIO[t] && !IGNORED.has(t)
  );
  const hasAac = audios.includes(0x0f);
  const mp4 =
    videos.length + audios.length > 0 &&
    videos.every((t) => t === 0x1b) &&
    audios.every((t) => t === 0x0f) &&
    // 0x06 等私有流可能是 AC-3 之类的音频；有 AAC 时它多半是字幕或附加数据，可以忽略
    (unknown.length === 0 || hasAac);
  return {
    streamTypes,
    video: videos.length ? VIDEO[videos[0]] : undefined,
    audio: audios.length
      ? AUDIO[audios.find((t) => t !== 0x0f) ?? audios[0]]
      : undefined,
    mp4,
  };
}

/** 不能转 MP4 的原因里要点名的编码，如「H.265」「AC-3」 */
export function incompatibleCodec(c: TsCodecs): string {
  if (c.video && c.video !== 'H.264') return c.video;
  if (c.audio && c.audio !== 'AAC') return c.audio;
  return c.video || c.audio || 'unknown';
}
