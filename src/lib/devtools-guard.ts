/**
 * 开发者工具拦截（威慑措施，不是安全边界）。
 *
 * 做两件事：
 * 1. 屏蔽打开开发者工具 / 查看源代码的常用快捷键和右键菜单；
 * 2. 用 `debugger` 计时检测开发者工具：工具打开时 `debugger` 会让脚本暂停，
 *    恢复后两次 performance.now() 之间的间隔远超正常值，据此判定为已打开，
 *    随即停止页面上所有音视频并整页跳转到 /blocked。整页跳转会让浏览器默认
 *    清空 Network 面板（用户手动勾选 Preserve log 时除外）。
 *
 * 刻意**没有**使用「窗口内外尺寸差」检测：Chrome 侧边栏（Gemini / 阅读清单）、
 * Edge Copilot 侧栏、页面缩放都会让尺寸差变大，普通用户会被误判踢走。
 *
 * 局限：暂停前已经发出的请求仍会出现在 Network 面板；关闭断点（Ctrl+F8）、
 * 用抓包代理或直接调接口都能绕过。真正需要保密的数据只能靠服务端不下发。
 *
 * 脚本以内联 <script> 形式写进 <head>（见 app/layout.tsx），在应用水合、发起
 * 任何 API 请求之前就开始检测。它是一段独立的 ES5 字符串，不经过打包器，
 * 这样 SWC 的 drop_debugger 也不会把检测语句删掉。
 */

import type { AdminConfig } from './admin.types';

/** 检测到开发者工具后跳转的页面 */
export const DEVTOOLS_BLOCKED_PATH = '/blocked';

/** 两次计时之间超过这个毫秒数即判定为被 debugger 暂停过 */
export const DEVTOOLS_PAUSE_THRESHOLD_MS = 100;

/** 检测间隔 */
export const DEVTOOLS_CHECK_INTERVAL_MS = 1000;

/**
 * 是否启用拦截。默认开启；`DEVTOOLS_GUARD=false` 关闭；开发环境始终关闭。
 */
export function isDevToolsGuardEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  if (env.NODE_ENV === 'development') return false;
  return (env.DEVTOOLS_GUARD || '').trim().toLowerCase() !== 'false';
}

/**
 * 站长和管理员不受拦截。
 *
 * 角色从服务端配置里查，而不是信任 cookie 里的 role 字段（那个字段没有签名，
 * 用户可以自己改）。cookie 里的用户名已由 middleware 校验过签名。
 * 未设置 PASSWORD（开放访问）或 localstorage 模式下没有可信的用户身份，
 * 一律不豁免——站长需要调试时用 DEVTOOLS_GUARD=false 关闭。
 */
export function isDevToolsGuardExempt(
  username: string | undefined,
  config: Pick<AdminConfig, 'UserConfig'> | null,
  env: Record<string, string | undefined> = process.env
): boolean {
  if (!username || !env.PASSWORD) return false;
  if ((env.NEXT_PUBLIC_STORAGE_TYPE || 'localstorage') === 'localstorage') {
    return false;
  }
  if (env.USERNAME && username === env.USERNAME) return true;
  const user = config?.UserConfig?.Users?.find((u) => u.username === username);
  return !!user && !user.banned && (user.role === 'admin' || user.role === 'owner');
}

/**
 * 生成内联脚本。纯 ES5，无外部依赖；运行时只读取全局的
 * window / document / location / performance。
 */
export function buildDevToolsGuardScript(
  blockedPath: string = DEVTOOLS_BLOCKED_PATH
): string {
  const path = JSON.stringify(blockedPath);
  return `(function(){
var BLOCKED=${path},blocked=false;
function stopMedia(){try{var m=document.querySelectorAll('video,audio');for(var i=0;i<m.length;i++){try{m[i].pause();m[i].removeAttribute('src');m[i].load();}catch(e){}}}catch(e){}}
function block(){if(blocked)return;stopMedia();if(location.pathname===BLOCKED)return;blocked=true;location.replace(BLOCKED);}
function check(){var t=performance.now();Function('debugger')();if(performance.now()-t>${DEVTOOLS_PAUSE_THRESHOLD_MS})block();}
function letter(e){var c=e.code||'';if(c.indexOf('Key')===0)return c.slice(3);return String(e.key||'').toUpperCase();}
function isShortcut(e){
if(e.key==='F12'||e.code==='F12')return true;
var k=letter(e);
if(e.ctrlKey&&e.shiftKey&&'IJCKE'.indexOf(k)>=0&&k.length===1)return true;
if(e.metaKey&&e.altKey&&'IJCKEU'.indexOf(k)>=0&&k.length===1)return true;
if(e.metaKey&&e.shiftKey&&k==='C')return true;
if(e.ctrlKey&&!e.shiftKey&&!e.altKey&&!e.metaKey&&k==='U')return true;
return false;}
function editable(t){if(!t||!t.tagName)return false;var n=t.tagName;return n==='INPUT'||n==='TEXTAREA'||t.isContentEditable===true;}
window.addEventListener('keydown',function(e){if(isShortcut(e)){e.preventDefault();e.stopPropagation();}},true);
document.addEventListener('contextmenu',function(e){if(!editable(e.target))e.preventDefault();});
check();setInterval(check,${DEVTOOLS_CHECK_INTERVAL_MS});
})();`;
}
