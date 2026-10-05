/* eslint-disable no-console */

'use client';

const CURRENT_VERSION = '3.10.0';

/**
 * 本仓库地址，用于「前往仓库」等站内跳转。
 * 注意：应用品牌已更名为 DreamTV，但 GitHub 仓库名仍是 MoonTV；
 * 若日后在 GitHub 上重命名仓库，需要同步更新下面三个常量。
 */
export const REPO_URL = 'https://github.com/007jackying/MoonTV';
export const REPO_BRANCH = 'main';
export const CHANGELOG_URL = `https://raw.githubusercontent.com/007jackying/MoonTV/${REPO_BRANCH}/CHANGELOG`;

export enum UpdateStatus {
  HAS_UPDATE = 'has_update',
  NO_UPDATE = 'no_update',
  FETCH_FAILED = 'fetch_failed',
}

const VERSION_URL =
  'https://raw.githubusercontent.com/007jackying/MoonTV/main/VERSION.txt';

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
