/**
 * @jest-environment node
 */
import { webcrypto } from 'node:crypto';

import {
  openImageToken,
  proxiedImageUrl,
  proxyImageFields,
  publicOrigin,
  sealImageUrl,
} from '../image-seal';

// jest 27 的沙箱里没有 Web Crypto，借用 Node 的实现（边缘运行时自带）
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
}

function fakeRequest(url: string, headers: Record<string, string> = {}) {
  return {
    url,
    headers: { get: (name: string) => headers[name] ?? null },
  } as unknown as Request;
}

const POSTER = 'https://img.secret-source.example/upload/vod/2026/poster.jpg';

describe('image-seal', () => {
  it('round-trips and never exposes the original url', async () => {
    const token = await sealImageUrl(POSTER);
    expect(token).not.toContain('secret-source');
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(await openImageToken(token)).toBe(POSTER);
  });

  it('is deterministic so browsers and CDNs can cache', async () => {
    expect(await sealImageUrl(POSTER)).toBe(await sealImageUrl(POSTER));
    expect(await sealImageUrl(POSTER)).not.toBe(
      await sealImageUrl(POSTER + '?v=2')
    );
  });

  it('rejects tampered or garbage tokens', async () => {
    const token = await sealImageUrl(POSTER);
    const flipped =
      token.slice(0, -2) +
      (token.slice(-2, -1) === 'A' ? 'B' : 'A') +
      token.slice(-1);
    expect(await openImageToken(flipped)).toBeNull();
    expect(await openImageToken('not-a-token')).toBeNull();
    expect(await openImageToken('')).toBeNull();
  });

  it('only rewrites http(s) urls', async () => {
    expect(await proxiedImageUrl('')).toBe('');
    expect(await proxiedImageUrl(undefined)).toBe('');
    expect(await proxiedImageUrl('/api/img/abc')).toBe('/api/img/abc');
    const out = await proxiedImageUrl(POSTER);
    expect(out.startsWith('/api/img/')).toBe(true);
    expect(await proxiedImageUrl(POSTER, 'https://tv.example')).toBe(
      `https://tv.example${out}`
    );
  });

  it('rewrites a field on every item', async () => {
    const [item] = await proxyImageFields(
      [{ id: '1', poster: POSTER }],
      'poster'
    );
    expect(item.id).toBe('1');
    expect(item.poster).not.toContain('secret-source');
  });

  it('builds the public origin from proxy headers', () => {
    const req = fakeRequest('http://10.0.0.5:3000/api/x', {
      'x-forwarded-host': 'tv.example',
      'x-forwarded-proto': 'https',
    });
    expect(publicOrigin(req)).toBe('https://tv.example');
    expect(publicOrigin(fakeRequest('http://localhost:3000/a'))).toBe(
      'http://localhost:3000'
    );
  });
});
