/**
 * 海报图片地址加密：服务端把上游图片地址加密成不透明的令牌，浏览器只看到
 * /api/img/<令牌>，由 src/app/api/img/[token]/route.ts 解密后代为请求上游。
 *
 * - AES-GCM 加密，IV 取 HMAC(地址) 的前 12 字节：同一地址总是得到同一令牌，
 *   浏览器 / CDN 缓存才能命中，播放记录、收藏里存的封面也一直有效。
 * - 密钥由 IMAGE_PROXY_SECRET（未设置时用 PASSWORD）派生。更换密钥后旧令牌失效，
 *   已存的封面会显示不出来，直到重新搜索 / 观看后被新地址覆盖。
 * - 令牌只能由服务端生成，/api/img 不会代理任意地址。
 */

export const IMAGE_PROXY_PATH = '/api/img/';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface SealKeys {
  aes: CryptoKey;
  hmac: CryptoKey;
}

let keysPromise: Promise<SealKeys> | null = null;

function getSecret(): string {
  return (
    process.env.IMAGE_PROXY_SECRET ||
    process.env.PASSWORD ||
    // 未配置任何密钥时只能做到混淆：源码公开，固定值可被他人解出
    'dreamtv-image-proxy'
  );
}

async function deriveKey(label: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest(
    'SHA-256',
    encoder.encode(`${getSecret()}:${label}`)
  );
}

function getKeys(): Promise<SealKeys> {
  if (!keysPromise) {
    keysPromise = (async () => {
      const [aesRaw, hmacRaw] = await Promise.all([
        deriveKey('image-aes'),
        deriveKey('image-iv'),
      ]);
      const [aes, hmac] = await Promise.all([
        crypto.subtle.importKey('raw', aesRaw, 'AES-GCM', false, [
          'encrypt',
          'decrypt',
        ]),
        crypto.subtle.importKey(
          'raw',
          hmacRaw,
          { name: 'HMAC', hash: 'SHA-256' },
          false,
          ['sign']
        ),
      ]);
      return { aes, hmac };
    })();
    keysPromise.catch(() => {
      keysPromise = null;
    });
  }
  return keysPromise;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** 加密图片地址，返回令牌 */
export async function sealImageUrl(url: string): Promise<string> {
  const { aes, hmac } = await getKeys();
  const data = encoder.encode(url);
  const iv = new Uint8Array(await crypto.subtle.sign('HMAC', hmac, data)).slice(
    0,
    12
  );
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, data)
  );
  const token = new Uint8Array(iv.length + cipher.length);
  token.set(iv);
  token.set(cipher, iv.length);
  return toBase64Url(token);
}

/** 解密令牌；令牌无效（被篡改 / 换过密钥）返回 null */
export async function openImageToken(token: string): Promise<string | null> {
  try {
    const bytes = fromBase64Url(token);
    if (bytes.length <= 12 + 16) return null;
    const { aes } = await getKeys();
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.slice(0, 12) },
      aes,
      bytes.slice(12)
    );
    return decoder.decode(plain);
  } catch {
    return null;
  }
}

/**
 * 把上游图片地址换成本站 /api/img/ 地址。
 * 空值、已处理过的地址、非 http(s) 地址原样返回。
 */
export async function proxiedImageUrl(
  url?: string | null,
  base = ''
): Promise<string> {
  if (!url) return url || '';
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) return url;
  return `${base}${IMAGE_PROXY_PATH}${await sealImageUrl(trimmed)}`;
}

/**
 * 本站对外地址（考虑反向代理头）。给不在浏览器里运行的客户端（TVBox 等）
 * 拼完整图片地址用；浏览器端直接用相对地址即可。
 */
export function publicOrigin(request: Request): string {
  const url = new URL(request.url);
  const host =
    request.headers.get('x-forwarded-host') || request.headers.get('host');
  const proto =
    request.headers.get('x-forwarded-proto')?.split(',')[0].trim() ||
    url.protocol.replace(':', '');
  return host ? `${proto}://${host.split(',')[0].trim()}` : url.origin;
}

/** 批量处理对象数组上的图片字段 */
export async function proxyImageFields<T>(
  items: T[],
  field: keyof T,
  base = ''
): Promise<T[]> {
  return Promise.all(
    items.map(async (item) => ({
      ...item,
      [field]: await proxiedImageUrl(item[field] as unknown as string, base),
    }))
  );
}

/** 播放记录 / 收藏（{ key: { cover } }）：旧数据里存的是原始封面地址，读取时一并处理 */
export async function proxyRecordCovers<T extends { cover: string }>(
  records: Record<string, T>
): Promise<Record<string, T>> {
  const entries = await Promise.all(
    Object.entries(records || {}).map(
      async ([key, record]) =>
        [
          key,
          { ...record, cover: await proxiedImageUrl(record.cover) },
        ] as const
    )
  );
  return Object.fromEntries(entries);
}
