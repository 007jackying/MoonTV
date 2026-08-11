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

function el(name, x, y, w, h, parent) {
  const e = {
    name,
    tagName: 'A',
    rect: { left: x, top: y, width: w, height: h, right: x + w, bottom: y + h },
    parentElement: parent || null,
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

// 两行海报（每行 3 张），上面压着一个「查看更多」
const more = el('more', 700, 10, 80, 20);
const row1 = [el('a1', 0, 60, 120, 180), el('a2', 140, 60, 120, 180), el('a3', 280, 60, 120, 180)];
const row2 = [el('b1', 0, 280, 120, 180), el('b2', 140, 280, 120, 180), el('b3', 280, 280, 120, 180)];
const all = [more, ...row1, ...row2];

const dom = {
  activeElement: null,
  querySelectorAll: () => all,
  querySelector: () => null, // 没有覆盖层
  contains: () => true,
  documentElement: {},
  body: {},
  elementFromPoint: () => null,
};

global.window = global;
global.document = dom;
global.innerWidth = 960;
global.innerHeight = 540;
global.getComputedStyle = () => ({ overflowX: 'visible', overflowY: 'visible' });
global.matchMedia = () => ({ matches: false });
global.addEventListener = () => {};
global.scrollBy = () => {};
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
move('down');
assert.strictEqual(dom.activeElement.name, 'b2', '「下」应该落到下一行的同一列');

dom.activeElement = row1[2];
move('up');
assert.strictEqual(dom.activeElement.name, 'more', '第一行按「上」才轮到「查看更多」');

console.log('tvnav: ok');
