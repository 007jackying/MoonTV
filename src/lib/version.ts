/* eslint-disable no-console */

'use client';

const CURRENT_VERSION = '3.8.2';

export enum UpdateStatus {
  HAS_UPDATE = 'has_update',
  NO_UPDATE = 'no_update',
  FETCH_FAILED = 'fetch_failed',
}

const VERSION_URL =
  'https://raw.githubusercontent.com/Stardm0/MoonTV/main/VERSION.txt';

export async function checkForUpdates(): Promise<UpdateStatus> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${VERSION_URL}?_t=${Date.now()}`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) return UpdateStatus.FETCH_FAILED;
    const remote = (await res.text()).trim();
    return compareVersions(remote);
  } catch {
    return UpdateStatus.FETCH_FAILED;
  }
}

function compareVersions(remote: string): UpdateStatus {
  const parse = (v: string) => v.split('.').map(Number);
  const [r, c] = [parse(remote), parse(CURRENT_VERSION)];
  for (let i = 0; i < 3; i++) {
    if ((r[i] ?? 0) > (c[i] ?? 0)) return UpdateStatus.HAS_UPDATE;
    if ((r[i] ?? 0) < (c[i] ?? 0)) return UpdateStatus.NO_UPDATE;
  }
  return UpdateStatus.NO_UPDATE;
}

export { compareVersions, CURRENT_VERSION };
