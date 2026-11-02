import {
  buildDevToolsGuardScript,
  DEVTOOLS_BLOCKED_PATH,
  isDevToolsGuardEnabled,
  isDevToolsGuardExempt,
} from '../devtools-guard';

describe('isDevToolsGuardEnabled', () => {
  it('is on by default in production', () => {
    expect(isDevToolsGuardEnabled({ NODE_ENV: 'production' })).toBe(true);
  });

  it('can be turned off with DEVTOOLS_GUARD=false (any case, trimmed)', () => {
    expect(
      isDevToolsGuardEnabled({ NODE_ENV: 'production', DEVTOOLS_GUARD: ' FALSE ' })
    ).toBe(false);
  });

  it('stays on for any other value', () => {
    expect(
      isDevToolsGuardEnabled({ NODE_ENV: 'production', DEVTOOLS_GUARD: 'true' })
    ).toBe(true);
    expect(
      isDevToolsGuardEnabled({ NODE_ENV: 'production', DEVTOOLS_GUARD: '0' })
    ).toBe(true);
  });

  it('is always off in development', () => {
    expect(
      isDevToolsGuardEnabled({ NODE_ENV: 'development', DEVTOOLS_GUARD: 'true' })
    ).toBe(false);
  });
});

describe('isDevToolsGuardExempt', () => {
  const env = {
    PASSWORD: 'pw',
    USERNAME: 'boss',
    NEXT_PUBLIC_STORAGE_TYPE: 'redis',
  };
  const config = {
    UserConfig: {
      AllowRegister: false,
      Users: [
        { username: 'boss', role: 'owner' as const },
        { username: 'mod', role: 'admin' as const },
        { username: 'banned-mod', role: 'admin' as const, banned: true },
        { username: 'viewer', role: 'user' as const },
      ],
    },
  } as any; // eslint-disable-line @typescript-eslint/no-explicit-any

  it('exempts the owner (USERNAME) even without a config entry', () => {
    expect(isDevToolsGuardExempt('boss', null, env)).toBe(true);
  });

  it('exempts admins looked up from server config', () => {
    expect(isDevToolsGuardExempt('mod', config, env)).toBe(true);
  });

  it('does not exempt regular, banned or unknown users', () => {
    expect(isDevToolsGuardExempt('viewer', config, env)).toBe(false);
    expect(isDevToolsGuardExempt('banned-mod', config, env)).toBe(false);
    expect(isDevToolsGuardExempt('nobody', config, env)).toBe(false);
    expect(isDevToolsGuardExempt(undefined, config, env)).toBe(false);
  });

  it('exempts nobody without PASSWORD or in localstorage mode', () => {
    expect(
      isDevToolsGuardExempt('boss', config, { ...env, PASSWORD: '' })
    ).toBe(false);
    expect(
      isDevToolsGuardExempt('boss', config, {
        ...env,
        NEXT_PUBLIC_STORAGE_TYPE: 'localstorage',
      })
    ).toBe(false);
  });
});

describe('buildDevToolsGuardScript', () => {
  let replace: jest.Mock;
  let now: number;
  let pauseNextCheck: boolean;

  /** 用遮蔽全局变量的方式执行内联脚本，便于注入假的 location / performance */
  function run(pathname = '/play') {
    replace = jest.fn();
    now = 0;
    pauseNextCheck = false;
    const fakeLocation = { pathname, replace };
    const fakePerformance = {
      // 第一次调用返回 t，第二次调用模拟被 debugger 暂停了 500ms
      now: () => {
        const t = now;
        if (pauseNextCheck) {
          now += 500;
          pauseNextCheck = false;
        }
        return t;
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function('location', 'performance', buildDevToolsGuardScript())(
      fakeLocation,
      fakePerformance
    );
  }

  function key(init: KeyboardEventInit) {
    const e = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      ...init,
    });
    document.body.dispatchEvent(e);
    return e.defaultPrevented;
  }

  beforeEach(() => {
    jest.useFakeTimers();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('blocks DevTools and view-source shortcuts', () => {
    run();
    expect(key({ key: 'F12', code: 'F12' })).toBe(true);
    expect(key({ key: 'I', code: 'KeyI', ctrlKey: true, shiftKey: true })).toBe(true);
    expect(key({ key: 'J', code: 'KeyJ', ctrlKey: true, shiftKey: true })).toBe(true);
    expect(key({ key: 'C', code: 'KeyC', ctrlKey: true, shiftKey: true })).toBe(true);
    // macOS: Option 会改变 e.key（ˆ / ∆ / ç），所以按 e.code 判断
    expect(key({ key: 'ˆ', code: 'KeyI', metaKey: true, altKey: true })).toBe(true);
    expect(key({ key: '∆', code: 'KeyJ', metaKey: true, altKey: true })).toBe(true);
    expect(key({ key: 'c', code: 'KeyC', metaKey: true, shiftKey: true })).toBe(true);
    expect(key({ key: 'u', code: 'KeyU', ctrlKey: true })).toBe(true);
    expect(key({ key: 'u', code: 'KeyU', metaKey: true, altKey: true })).toBe(true);
  });

  it('leaves ordinary shortcuts alone', () => {
    run();
    expect(key({ key: 'c', code: 'KeyC', ctrlKey: true })).toBe(false); // copy
    expect(key({ key: 'v', code: 'KeyV', metaKey: true })).toBe(false); // paste
    expect(key({ key: 'i', code: 'KeyI' })).toBe(false);
    expect(key({ key: ' ', code: 'Space' })).toBe(false);
    expect(key({ key: 'Shift', code: 'ShiftLeft', ctrlKey: true, shiftKey: true })).toBe(false);
  });

  it('blocks the context menu except on editable fields', () => {
    run();
    document.body.innerHTML = '<div id="d"></div><input id="i" />';
    const menu = (id: string) => {
      const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
      document.getElementById(id)?.dispatchEvent(e);
      return e.defaultPrevented;
    };
    expect(menu('d')).toBe(true);
    expect(menu('i')).toBe(false);
  });

  it('does nothing while no debugger pause is observed', () => {
    run();
    jest.advanceTimersByTime(5000);
    expect(replace).not.toHaveBeenCalled();
  });

  it('stops media and redirects to the blocked page after a debugger pause', () => {
    run();
    document.body.innerHTML = '<video src="https://cdn.example/a.m3u8"></video>';
    const video = document.querySelector('video') as HTMLVideoElement;
    const pause = jest.spyOn(video, 'pause').mockImplementation(() => undefined);
    jest.spyOn(video, 'load').mockImplementation(() => undefined);

    pauseNextCheck = true;
    jest.advanceTimersByTime(1000);

    expect(pause).toHaveBeenCalled();
    expect(video.hasAttribute('src')).toBe(false);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith(DEVTOOLS_BLOCKED_PATH);

    // 只跳转一次
    pauseNextCheck = true;
    jest.advanceTimersByTime(1000);
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it('does not redirect again when already on the blocked page', () => {
    run(DEVTOOLS_BLOCKED_PATH);
    pauseNextCheck = true;
    jest.advanceTimersByTime(1000);
    expect(replace).not.toHaveBeenCalled();
  });
});
