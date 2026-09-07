/* eslint-disable */
// D-pad 焦点移动的自检。跑法：node android/tvnav.check.js
//
// 只盯两件会让遥控器彻底不能用的事：
//   1. 「右」必须沿着当前这一行走，不能跳到上面的「查看更多」；
//   2. 「下」必须落到下一行，而不是回到行首。
// 这两条都建立在候选集里那份缓存好的矩形上（见 TvNav.kt 的 candidates），
// 缓存写错了这里立刻就红。

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(
  path.join(__dirname, 'app/src/main/java/com/moontv/tv/TvNav.kt'),
  'utf8'
);
const js = src.split('"""')[1];

// ---- 一个刚好够用的假 DOM ------------------------------------------------

// <html> 和 <body>：照着真实页面配置。globals.css 的 `overflow-x: hidden` 让
// overflow-y 计算成 auto，而根元素的 clientHeight 按定义是视口高度、scrollHeight 是
// 整篇文档 —— 只要页面比一屏长，这两个就永远长得像个"可滚动容器"。
// scrollerY/scrollerX 必须在它们之前停下，否则页面级滚动一次都不会发生。
const htmlEl = {
  name: 'html',
  className: 'tv dark',
  parentElement: null,
  scrollHeight: 8000,
  clientHeight: 540,
  scrollWidth: 960,
  clientWidth: 960,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 960, height: 8000, right: 960, bottom: 8000 }),
  scrollBy() {
    scrolled.container = true;
  },
};
const bodyEl = { name: 'body', parentElement: htmlEl };

function el(name, x, y, w, h, parent) {
  const e = {
    name,
    tagName: 'A',
    rect: { left: x, top: y, width: w, height: h, right: x + w, bottom: y + h },
    parentElement: parent || bodyEl,
    getBoundingClientRect() {
      return this.rect;
    },
    closest: () => null,
    contains(o) {
      return o === this;
    },
    focus() {
      dom.activeElement = this;
    },
  };
  return e;
}

// 两行海报（每行 3 张），上面压着一个「查看更多」。
// 视口是 960×540，第二行放在 y=460，也就是舒适区（18%–52% ≈ 97–281）下方 ——
// 焦点落上去时页面必须往下滚。
const more = el('more', 700, 10, 80, 20);
const row1 = [el('a1', 0, 60, 120, 180), el('a2', 140, 60, 120, 180), el('a3', 280, 60, 120, 180)];
const row2 = [el('b1', 0, 460, 120, 180), el('b2', 140, 460, 120, 180), el('b3', 280, 460, 120, 180)];
const all = [more, ...row1, ...row2];

const scrolled = { page: false, container: false };

const dom = {
  activeElement: null,
  querySelectorAll: () => all,
  querySelector: () => null, // 没有覆盖层
  contains: () => true,
  documentElement: htmlEl,
  body: bodyEl,
  elementFromPoint: () => null,
};

global.window = global;
global.document = dom;
global.innerWidth = 960;
global.innerHeight = 540;
// html/body 在真实页面里就是这个值 —— 见上面 htmlEl 的注释
global.getComputedStyle = (e) =>
  e === htmlEl || e === bodyEl
    ? { overflowX: 'hidden', overflowY: 'auto' }
    : { overflowX: 'visible', overflowY: 'visible' };
global.matchMedia = () => ({ matches: false });
global.addEventListener = () => {};
global.scrollBy = () => {
  scrolled.page = true;
};
global.scrollTo = () => {};
global.history = { pushState() {}, replaceState() {} };
global.setTimeout = () => 0;
global.clearTimeout = () => {};

// 抓住脚本内部的 move()，它没导出
const captured = {};
eval(js.replace('function move(dir) {', 'captured.move = move; function move(dir) {'));

const move = captured.move;
assert(typeof move === 'function', 'move() 没抓到，TvNav.kt 里的函数名变了？');

// ---- 断言 ----------------------------------------------------------------

dom.activeElement = row1[0];
move('right');
assert.strictEqual(dom.activeElement.name, 'a2', '「右」应该走到同一行的下一张');

dom.activeElement = row1[2];
move('right');
assert.strictEqual(dom.activeElement.name, 'a3', '行尾按「右」不该跳去别处');

dom.activeElement = row1[1];
scrolled.page = false;
scrolled.container = false;
move('down');
assert.strictEqual(dom.activeElement.name, 'b2', '「下」应该落到下一行的同一列');
// 这两条是 2026-08-10 那个"焦点会动、画面不动"的回归：scrollerY 一路走到 <html>，
// 把整篇文档当成内部滚动容器，于是页面级的舒适区逻辑永远轮不到。
assert(scrolled.page, '走到舒适区下面时页面必须滚动');
assert(!scrolled.container, '不能把 <html>/<body> 当成内部滚动容器来滚');

dom.activeElement = row1[2];
move('up');
assert.strictEqual(dom.activeElement.name, 'more', '第一行按「上」才轮到「查看更多」');

console.log('tvnav: ok');
