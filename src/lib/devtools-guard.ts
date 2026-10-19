/**
 * 生产环境的开发者工具防护（只是增加门槛，无法真正阻止：页面代码终究运行在用户的浏览器里）。
 *
 * - 屏蔽右键菜单与 F12 / Ctrl+Shift+I/J/C / Ctrl+U 等快捷键
 * - 清空 console 输出
 * - 检测到开发者工具打开（debugger 被断住）后用遮罩盖住页面并暂停播放
 *
 * 真正需要保密的上游地址都只在服务端使用（见 /api/douban、/api/danmaku 等代理路由），
 * 这里只是让普通用户不方便翻看。
 *
 * 该函数会被序列化后以内联脚本注入 <head>，必须自包含：不能引用外部变量，
 * 也不要用会被编译出辅助函数的语法（展开、async 等）。
 */
export function devtoolsGuard() {
  let detected = false;

  function lock() {
    if (detected) return;
    detected = true;
    const videos = document.getElementsByTagName('video');
    for (let i = 0; i < videos.length; i++) {
      try {
        videos[i].pause();
      } catch (e) {
        /* ignore */
      }
    }
    const overlay = document.createElement('div');
    overlay.setAttribute(
      'style',
      'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;' +
        'justify-content:center;padding:24px;text-align:center;background:#111;' +
        'color:#fff;font:16px/1.6 system-ui,sans-serif'
    );
    overlay.textContent = '检测到开发者工具，请关闭后刷新页面';
    (document.body || document.documentElement).appendChild(overlay);
  }

  // 屏蔽右键与常见的开发者工具快捷键
  document.addEventListener('contextmenu', function (e) {
    e.preventDefault();
  });
  document.addEventListener(
    'keydown',
    function (e) {
      const key = (e.key || '').toUpperCase();
      const mod = e.ctrlKey || e.metaKey;
      if (
        key === 'F12' ||
        (mod && (e.shiftKey || e.altKey) && 'IJC'.indexOf(key) !== -1) ||
        (mod && key === 'U') ||
        (e.metaKey && e.altKey && key === 'U')
      ) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true
  );

  // 清空 console
  const noop = function () {
    /* noop */
  };
  const methods = [
    'log',
    'info',
    'warn',
    'error',
    'debug',
    'table',
    'dir',
    'trace',
  ];
  for (let i = 0; i < methods.length; i++) {
    try {
      (console as unknown as Record<string, unknown>)[methods[i]] = noop;
    } catch (e) {
      /* ignore */
    }
  }

  // 开发者工具打开时 debugger 会断住，执行时间明显变长。
  // 用 Function 构造而不是直接写 debugger 语句，避免被压缩工具移除。
  const trap = Function('debugger');
  setInterval(function () {
    const start = Date.now();
    trap();
    if (Date.now() - start > 200) lock();
  }, 1000);
}
