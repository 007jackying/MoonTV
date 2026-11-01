import { incompatibleCodec, probeTsCodecs, TsCodecs } from '../ts-probe';

/** 造一个只含 PAT + PMT 的 TS 切片（CRC 不校验，填 0） */
function fakeTs(streamTypes: number[], leadingJunk = 0): Uint8Array {
  const packet = (pid: number, section: number[]) => {
    const p = new Uint8Array(188).fill(0xff);
    p.set([0x47, 0x40 | (pid >> 8), pid & 0xff, 0x10, 0x00, ...section]);
    return p;
  };
  const pat = [
    0x00, 0xb0, 13, 0x00, 0x01, 0xc1, 0x00, 0x00, 0x00, 0x01, 0xe1, 0x00, 0, 0,
    0, 0,
  ];
  const streams = streamTypes.flatMap((t, i) => [
    t,
    0xe1,
    0x01 + i,
    0xf0,
    0x00,
  ]);
  const pmtLength = 9 + streams.length + 4;
  const pmt = [
    0x02,
    0xb0,
    pmtLength,
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
  ];
  const out = new Uint8Array(leadingJunk + 188 * 3);
  out.set(packet(0, pat), leadingJunk);
  out.set(packet(0x100, pmt), leadingJunk + 188);
  out.set(packet(0x101, []), leadingJunk + 376);
  return out;
}

describe('probeTsCodecs', () => {
  it.each([
    [[0x1b, 0x0f], 'H.264', 'AAC', true],
    [[0x24, 0x0f], 'H.265', 'AAC', false],
    [[0x1b, 0x81], 'H.264', 'AC-3', false],
    [[0x1b, 0x03], 'H.264', 'MP2/MP3', false],
    [[0x02, 0x04], 'MPEG-2', 'MP2/MP3', false],
    [[0x1b], 'H.264', undefined, true],
    [[0x0f], undefined, 'AAC', true],
    [[0x1b, 0x0f, 0x15], 'H.264', 'AAC', true],
  ])('%j → video %s, audio %s, MP4 %s', (types, video, audio, mp4) => {
    const c = probeTsCodecs(fakeTs(types as number[]));
    expect(c).toMatchObject({ video, audio, mp4 });
  });

  it('treats an unknown private stream as unsafe unless AAC is present', () => {
    expect(probeTsCodecs(fakeTs([0x1b, 0x06]))?.mp4).toBe(false);
    expect(probeTsCodecs(fakeTs([0x1b, 0x0f, 0x06]))?.mp4).toBe(true);
  });

  it('finds the sync byte after leading padding', () => {
    expect(probeTsCodecs(fakeTs([0x24, 0x0f], 7))?.video).toBe('H.265');
  });

  it('returns null for data that is not MPEG-TS', () => {
    expect(probeTsCodecs(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(
      probeTsCodecs(
        new Uint8Array(400).fill(0x47).map((v, i) => (i % 188 ? 0 : v))
      )
    ).toBeNull();
  });

  it('names the codec that blocks MP4', () => {
    expect(
      incompatibleCodec(probeTsCodecs(fakeTs([0x24, 0x0f])) as TsCodecs)
    ).toBe('H.265');
    expect(
      incompatibleCodec(probeTsCodecs(fakeTs([0x1b, 0x81])) as TsCodecs)
    ).toBe('AC-3');
  });
});
