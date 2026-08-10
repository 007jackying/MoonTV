package com.moontv.tv

/**
 * D-pad navigation for a page that was written for a mouse.
 *
 * Android WebView has no spatial navigation: arrow keys scroll a scrollable page instead of
 * moving focus, so on any page taller than the screen the remote can't reach anything.
 *
 * Two things here make it feel like a TV app rather than a scrolling web page:
 *
 *  1. Movement is gated to the row/column you are in. Netflix, Prime and Disney+ all guarantee
 *     that "right" walks along the row you're on — it never sidesteps up to a header link.
 *  2. Focus stays put and the content slides underneath it. The browser's
 *     scrollIntoView('nearest') only scrolls once an element is already clipped, so focus
 *     marches to the screen edge and then the row jumps to catch up. That lurch is what makes
 *     a web page feel wrong on a television.
 *
 * It listens on `window` during the bubble phase, which runs *after* the page's own handlers on
 * `document`. So the play page still owns the arrow keys while the player is focused (it calls
 * preventDefault), and everywhere else the arrows move focus.
 */
const val TV_NAV_JS = """
(function () {
  if (window.__tvNavInstalled) return;
  window.__tvNavInstalled = true;

  var FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),' +
                  'select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

  // 焦点停留的舒适区：横向让焦点卡待在行的左 45% 内，纵向待在视口 18%–52% 之间。
  // 超出就滚动内容，而不是让焦点自己跑到屏幕边缘。
  var BAND_X = 0.45;
  var BAND_TOP = 0.18;
  var BAND_BOTTOM = 0.52;

  function rectOf(el) { return el.getBoundingClientRect(); }

  /*
   * 必须是 preventScroll —— 否则浏览器会先按 scroll-margin 把元素滚进视野，
   * keepInView 紧接着再滚一次，两次滚动叠在一起就是那种"跳一下再回弹"的顿挫感。
   * 滚动完全交给 keepInView 一家负责。
   */
  var lastRect = null;
  function focusEl(el) { el.focus({ preventScroll: true }); lastRect = rectOf(el); }

  function smooth() {
    return matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  }

  function onScreen(r) {
    return r.top < innerHeight && r.bottom > 0 && r.left < innerWidth && r.right > 0;
  }

  // An element is reachable if it is rendered and nothing is painted on top of it.
  // The hit test is what makes modals work: everything behind the overlay fails it,
  // so the remote can only reach the dialog's own buttons.
  function reachable(el) {
    var r = rectOf(el);
    if (r.width === 0 || r.height === 0) return false;
    var s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.display === 'none' || s.opacity === '0') return false;
    if (!onScreen(r)) return true; // offscreen: can't hit-test, allow so we can scroll to it
    var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    var hit = document.elementFromPoint(cx, cy);
    return !!hit && (hit === el || el.contains(hit) || hit.contains(el));
  }

  function candidates() {
    return Array.prototype.filter.call(document.querySelectorAll(FOCUSABLE), reachable);
  }

  /* 两个矩形在某个轴上是否有重叠 —— 用来判断"是不是同一行/同一列" */
  function overlapsY(a, b) { return a.top < b.bottom - 4 && b.top < a.bottom - 4; }
  function overlapsX(a, b) { return a.left < b.right - 4 && b.left < a.right - 4; }

  /* 最近的可横向滚动的祖先（海报行） */
  function scrollerX(el) {
    for (var p = el.parentElement; p; p = p.parentElement) {
      var s = getComputedStyle(p);
      if ((s.overflowX === 'auto' || s.overflowX === 'scroll') && p.scrollWidth > p.clientWidth) {
        return p;
      }
    }
    return null;
  }

  /*
   * 把内容滑到焦点下面，而不是把焦点推到屏幕边上。
   * 横向：焦点卡超出行宽的 45% 就把行往左推，回到左边界外就往右推。
   * 纵向：焦点行超出舒适区就滚动页面，让它回到区间内。
   */
  function keepInView(el, dir) {
    var r = rectOf(el);
    var behavior = smooth();

    if (dir === 'left' || dir === 'right') {
      var row = scrollerX(el);
      if (row) {
        var rr = rectOf(row);
        var pos = r.left - rr.left;
        var maxPos = rr.width * BAND_X;
        if (pos > maxPos) row.scrollBy({ left: pos - maxPos, behavior: behavior });
        else if (pos < 0) row.scrollBy({ left: pos, behavior: behavior });
        return;
      }
    }

    var lo = innerHeight * BAND_TOP;
    var hi = innerHeight * BAND_BOTTOM;
    if (r.top > hi) scrollBy({ top: r.top - hi, behavior: behavior });
    else if (r.top < lo) scrollBy({ top: r.top - lo, behavior: behavior });
  }

  /*
   * 首次聚焦落在内容上，而不是导航栏 —— 打开一个页面应该先看到内容。
   * strict = 只接受内容元素：页面还在骨架屏阶段时宁可什么都不聚焦，也不要把焦点
   * 丢在导航栏上再也不动（卡片是稍后才挂上来的）。
   */
  function focusFirstContent(strict) {
    var list = candidates();
    if (!list.length) return false;
    var visible = list.filter(function (el) { return onScreen(rectOf(el)); });
    var content = visible.filter(function (el) { return !el.closest('.tv-nav'); });
    var first = content[0] || (strict ? null : (visible[0] || list[0]));
    if (!first) return false;
    focusEl(first);
    keepInView(first, 'down');
    return true;
  }

  function move(dir) {
    var list = candidates();
    if (!list.length) return false;

    var cur = document.activeElement;
    var c;
    if (cur && cur !== document.body && cur !== document.documentElement && reachable(cur)) {
      c = rectOf(cur);
    } else if (lastRect) {
      /*
       * 焦点丢了（列表重排把 DOM 节点换掉、元素被盖住、组件重新挂载）。
       * 这时候**不能**回到"页面第一个元素" —— 那会把你从列表深处一路弹回顶部的
       * 分类标签，是最让人火大的一种表现。从上次的位置接着往下走。
       */
      c = lastRect;
      cur = null;
    } else {
      return focusFirstContent(false);
    }

    // 先只在"同一行/同一列"里找，找不到再放宽 —— 这样右键永远沿着当前行走，
    // 不会莫名其妙跳到上面的"查看更多"。
    var best = pick(list, cur, c, dir, true);
    if (!best) best = pick(list, cur, c, dir, false);
    if (!best) return false;

    focusEl(best);
    keepInView(best, dir);
    return true;
  }

  function pick(list, cur, c, dir, sameLine) {
    var cx = c.left + c.width / 2, cy = c.top + c.height / 2;
    var best = null, bestScore = Infinity;

    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (el === cur) continue;
      var r = rectOf(el);

      if (sameLine) {
        if ((dir === 'left' || dir === 'right') && !overlapsY(c, r)) continue;
        if ((dir === 'up' || dir === 'down') && !overlapsX(c, r)) continue;
      }

      var dx = r.left + r.width / 2 - cx;
      var dy = r.top + r.height / 2 - cy;
      var along, across;
      if (dir === 'left')       { along = -dx; across = Math.abs(dy); }
      else if (dir === 'right') { along =  dx; across = Math.abs(dy); }
      else if (dir === 'up')    { along = -dy; across = Math.abs(dx); }
      else                      { along =  dy; across = Math.abs(dx); }
      if (along <= 1) continue;               // not in the direction we're heading
      var score = along + across * 3;          // prefer staying in the same row/column
      if (score < bestScore) { bestScore = score; best = el; }
    }
    return best;
  }

  /*
   * 返回键行为（指南「App with navigation」）：
   * 焦点在内容里 → 返回键把焦点交给导航栏的当前项，而不是直接退出；
   * 焦点已经在导航里 → 返回 false，交给 Android 去做后退/退出。
   * 指南同时要求不能有"确认退出"这类拦截，所以这里最多只拦一层。
   */
  window.__tvBack = function () {
    /*
     * 返回键 = 撤销上一步，一次退一层，不管当前站在哪个组件里。
     * Android 把返回键吃掉了，不会变成 keydown，页面自己监听不到 —— 只能由这里代按。
     * 顺序就是"最近打开的先关"。
     */

    // 1) SweetAlert 这类第三方弹窗有自己的一套 DOM，点它自己的取消/关闭按钮
    var swal = document.querySelector('.swal2-container');
    if (swal) {
      var close = swal.querySelector('.swal2-cancel, .swal2-deny, .swal2-close') ||
                  swal.querySelector('.swal2-confirm');
      if (close) { close.click(); return true; }
    }

    // 2) 页面自己的覆盖层。取最后一个 —— DOM 里靠后的就是后开的那层，
    //    这样选集面板盖在播放器菜单上时，先关选集，再关菜单。
    var dismissers = document.querySelectorAll('[data-tv-dismiss]');
    if (dismissers.length) {
      dismissers[dismissers.length - 1].click();
      return true;
    }

    var nav = document.querySelector('.tv-nav');
    if (!nav) return false;
    var cur = document.activeElement;
    if (cur && nav.contains(cur)) return false; // 已经在导航里，放行
    var target = nav.querySelector('[data-tv-nav="active"]') || nav.querySelector('a[href]');
    if (!target) return false;
    focusEl(target);
    scrollTo({ top: 0, behavior: smooth() });
    return true;
  };

  /*
   * 换页之后页面上一个焦点都没有，遥控器得先按一下方向键才会亮起第一个元素。
   * 电视应用任何时候都有一个"当前项"，这段空窗期正是它不像电视应用的地方。
   * Next.js 的 <Link> 走 pushState，包一层就能收到通知；内容是异步拉回来的，
   * 所以要重试几次，等第一张卡片挂上来为止。
   */
  var settle = 0;
  function autoFocus(tries) {
    lastRect = null; // 换页了，上一页的坐标没有意义
    clearTimeout(settle);
    settle = setTimeout(function () {
      var a = document.activeElement;
      if (a && a !== document.body && a !== document.documentElement) return;
      if (!focusFirstContent(true) && (tries || 0) < 8) autoFocus((tries || 0) + 1);
    }, 300);
  }
  ['pushState', 'replaceState'].forEach(function (m) {
    var orig = history[m];
    history[m] = function () { var r = orig.apply(this, arguments); autoFocus(0); return r; };
  });
  addEventListener('popstate', function () { autoFocus(0); });
  autoFocus(0);

  var DIRS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };

  addEventListener('keydown', function (e) {
    if (e.defaultPrevented) return;           // the page already handled it (e.g. player seek)
    var dir = DIRS[e.key];
    if (!dir) return;
    // 输入框里左右键留给光标，上下键必须能把焦点带出去 —— 否则搜索框一旦聚焦，
    // 遥控器就再也走不到下面的搜索结果，只剩返回键一条出路。
    var t = e.target;
    var editing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    if (editing && (dir === 'left' || dir === 'right')) return;
    if (move(dir)) e.preventDefault();        // otherwise fall through and let the page scroll
  }, false);
})();
"""
