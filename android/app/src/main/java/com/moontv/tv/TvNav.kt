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

  /*
   * 导航音效。用 WebAudio 现场合成，不带音频文件 —— 省掉一个二进制资源和一次请求，
   * 也不会在网络慢的时候延迟到听不见。
   *
   * 调子刻意压得很轻：暗房间里的电视，界面音大一点就变成噪音。
   * 移动是一记短促的高音"嗒"，确认是两声下行的柔和音，两者音色不同，
   * 不用看屏幕也能分辨"我移动了"和"我选中了"。
   */
  var actx = null;
  var lastTick = 0;

  function tone(freq, dur, peak, type, delay) {
    try {
      if (!actx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        actx = new AC();
      }
      if (actx.state === 'suspended') actx.resume();
      var t0 = actx.currentTime + (delay || 0);
      var osc = actx.createOscillator();
      var gain = actx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      // 指数衰减，不要方波般的硬起停，否则在电视喇叭上会"啪"一声
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain);
      gain.connect(actx.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    } catch (e) { /* 没有音频设备就当没这回事 */ }
  }

  function soundMove() {
    // 长按时按时间节流，否则一路按下去会变成机关枪
    var now = Date.now();
    if (now - lastTick < 70) return;
    lastTick = now;
    tone(880, 0.045, 0.025, 'sine', 0);
  }

  function soundSelect() {
    tone(660, 0.09, 0.05, 'triangle', 0);
    tone(440, 0.16, 0.04, 'triangle', 0.06);
  }

  function rectOf(el) { return el.getBoundingClientRect(); }

  /*
   * 必须是 preventScroll —— 否则浏览器会先按 scroll-margin 把元素滚进视野，
   * keepInView 紧接着再滚一次，两次滚动叠在一起就是那种"跳一下再回弹"的顿挫感。
   * 滚动完全交给 keepInView 一家负责。
   */
  var lastRect = null;
  function focusEl(el) { el.focus({ preventScroll: true }); lastRect = rectOf(el); }

  /*
   * 按住方向键不放时必须瞬间滚动。
   * 平滑滚动是异步动画：长按的重复事件来得比动画结束快，下一次按键量到的是
   * 动画中途的坐标，于是又发一次平滑滚动去纠正，两个动画互相打架 ——
   * 表现出来就是选择框在原地上下弹，像被重置回起点又弹回去。
   */
  var repeating = false;
  function smooth() {
    if (repeating) return 'auto';
    return matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  }

  function onScreen(r) {
    return r.top < innerHeight && r.bottom > 0 && r.left < innerWidth && r.right > 0;
  }

  // 覆盖层选择器。任何一个存在，就意味着屏幕上有东西盖着页面，
  // 这时才需要逐个做命中测试来判断"够不够得着"。
  var OVERLAYS = '.tv-source-picker, .tv-player-menu, .swal2-container, [data-tv-overlay]';

  /*
   * An element is reachable if it is rendered and nothing is painted on top of it.
   * The hit test is what makes modals work: everything behind the overlay fails it,
   * so the remote can only reach the dialog's own buttons.
   *
   * 但 elementFromPoint 每调一次都要强制一次命中测试，而首页一屏有 100 多个可聚焦元素 ——
   * 每按一次方向键就是 100 多次命中测试，在 2GB 的盒子上就是那种"按下去过半拍才动"的迟滞。
   * 没有覆盖层的时候根本不存在"被盖住"这回事，整轮命中测试可以直接跳过。
   */
  var hitTest = false;

  /*
   * 候选集：一趟扫完，顺手把每个元素的矩形一起带出来。
   *
   * 之前这里有两笔开销，都是按"每个可聚焦元素"计价的，而首页现在有十几行海报，
   * 一屏能有两三百个可聚焦元素：
   *
   *  1) getComputedStyle(el) —— 每调一次就要为那个元素解析一遍层叠样式。
   *     它挡的是 display:none / visibility:hidden / opacity:0，可 display:none 的元素
   *     矩形本来就是 0×0，上面那行已经滤掉了；剩下两种在这个页面里没有真实用例
   *     （ScrollableRow 那两个 opacity-0 的箭头按钮它其实也挡不住 —— 透明的是父元素，
   *     按钮自己的 opacity 是 1，那两个已经改成电视端 display:none 了）。
   *     纯亏，删掉。
   *
   *  2) 矩形算了两遍以上：这里一遍，pick() 里每个候选再算一遍，而 pick() 一次移动
   *     要跑两轮（先同行、再放宽）。改成扫描时算一次，装进 {el, r} 一路带下去。
   *
   * 剩下的 elementFromPoint 只在屏幕上真有覆盖层时才跑（hitTest），
   * 那种时候候选也就十来个。
   */
  function candidates() {
    hitTest = !!document.querySelector(OVERLAYS);
    var all = document.querySelectorAll(FOCUSABLE);
    var out = [];
    // 只看视口上下各两屏。一次方向键最多跨一行，两屏外的元素不可能是这一步的目标，
    // 但首页滚到底之后它们能占到候选集的九成 —— 每按一次键都白量一遍布局。
    var near = innerHeight * 2;
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      var r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.bottom < -near || r.top > innerHeight + near) continue;
      if (hitTest && onScreen(r)) {
        // offscreen 的够不着也测不了，放行，好让上面能滚过去
        var hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (!(hit && (hit === el || el.contains(hit) || hit.contains(el)))) continue;
      }
      out.push({ el: el, r: r });
    }
    return out;
  }

  /* 两个矩形在某个轴上是否有重叠 —— 用来判断"是不是同一行/同一列" */
  function overlapsY(a, b) { return a.top < b.bottom - 4 && b.top < a.bottom - 4; }
  function overlapsX(a, b) { return a.left < b.right - 4 && b.left < a.right - 4; }

  /* 最近的可横向滚动的祖先（海报行） */
  function scrollerX(el) {
    var body = document.body, root = document.documentElement;
    for (var p = el.parentElement; p && p !== body && p !== root; p = p.parentElement) {
      var s = getComputedStyle(p);
      if ((s.overflowX === 'auto' || s.overflowX === 'scroll') && p.scrollWidth > p.clientWidth) {
        return p;
      }
    }
    return null;
  }

  /*
   * 最近的可纵向滚动的祖先（选源列表、选集网格这类内部滚动容器）。
   * 没有这个的话，上下键在一个 30 项的列表里照样能把焦点移下去，但滚的是 window ——
   * 而覆盖层是 fixed 的，window 根本没得滚，于是列表永远停在第一屏，
   * 焦点已经跑到看不见的地方去了。
   *
   * **必须在 <body>/<html> 之前停下。** 这两个不是"内部容器"，它们就是页面本身。
   *
   * globals.css 有 `html, body { overflow-x: hidden }`，而按规范，overflow-x 一旦不是
   * visible，overflow-y 就从 visible 提升成 auto —— 所以 getComputedStyle(html).overflowY
   * 是 'auto'。再加上根元素的 clientHeight 按定义返回的是**视口高度**，而 scrollHeight
   * 是整篇文档的高度，于是"页面比一屏长"就恒等于 `scrollHeight > clientHeight` 成立，
   * 循环每次都在 <html> 上命中。
   *
   * 命中之后 keepInView 会走"容器分支"，而它量的是 col.getBoundingClientRect()：
   * <html> 的这个矩形高度是整篇文档（比如 8000px），于是
   * `bottom > cr.height - 8` 永远不成立、`top < 8` 也永远不成立 —— 一次都不滚，
   * 然后 return，页面级的那段舒适区逻辑根本轮不到执行。
   *
   * 表现就是：方向键能把焦点移到下一行，但画面纹丝不动，焦点走出屏幕就再也找不回来。
   * 页面的滚动本来就该交给下面那段 18%–52% 舒适区的代码。
   */
  function scrollerY(el) {
    var body = document.body, root = document.documentElement;
    for (var p = el.parentElement; p && p !== body && p !== root; p = p.parentElement) {
      var s = getComputedStyle(p);
      if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && p.scrollHeight > p.clientHeight) {
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

    /*
     * 内部纵向滚动容器优先。这里不用视口的舒适区（18%–52%）—— 那是给整页算的，
     * 一个 400dp 高的列表套进去，区间比容器还高，永远判定为"要滚"，列表会抖。
     * 容器里就按"焦点整行留在容器内，边上留 8dp"来滚。
     */
    var col = scrollerY(el);
    if (col) {
      var cr = rectOf(col);
      var top = r.top - cr.top;
      var bottom = r.bottom - cr.top;
      if (bottom > cr.height - 8) col.scrollBy({ top: bottom - cr.height + 8, behavior: behavior });
      else if (top < 8) col.scrollBy({ top: top - 8, behavior: behavior });
      return;
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
    var visible = list.filter(function (c) { return onScreen(c.r); });
    var content = visible.filter(function (c) { return !c.el.closest('.tv-nav'); });
    var first = content[0] || (strict ? null : (visible[0] || list[0]));
    if (!first) return false;
    focusEl(first.el);
    keepInView(first.el, 'down');
    return true;
  }

  function move(dir) {
    var list = candidates();
    if (!list.length) return false;

    var cur = document.activeElement;
    var c;
    if (
      cur && cur !== document.body && cur !== document.documentElement &&
      document.contains(cur) && rectOf(cur).width > 0
    ) {
      // 只要它还在文档里就以它为起点，不做命中测试 —— 候选集已经过滤过了，
      // 焦点不可能跳到被遮住的元素上，起点没必要再测一次。
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

    // 先只在"同一行/同一列"里找。
    var best = pick(list, cur, c, dir, true);

    /*
     * 找不到就放宽 —— 但只对上下放宽，左右不放。
     *
     * 左右放宽的后果：走到一行的最后一张再按右，同行已经没人了，放宽之后评分函数
     * 会挑中"右上方最近的那个"，也就是这一行标题旁边的「查看更多」——
     * 焦点从屏幕中间的海报一下子飞到右上角。用户按的是"再往右一张"，
     * 得到的是"跳去了另一个东西"，这正是"在电视上导航感觉很怪"的那个瞬间。
     *
     * 主流流媒体应用里，横向永远被锁死在当前这一行：走到头就是不动。
     * 要离开这一行只有上下键，而上下键必须能放宽（不然从海报上不去「查看更多」）。
     */
    if (!best && (dir === 'up' || dir === 'down')) best = pick(list, cur, c, dir, false);
    if (!best) return false;

    focusEl(best);
    keepInView(best, dir);
    soundMove();
    return true;
  }

  function pick(list, cur, c, dir, sameLine) {
    var cx = c.left + c.width / 2, cy = c.top + c.height / 2;
    var best = null, bestScore = Infinity;

    for (var i = 0; i < list.length; i++) {
      var el = list[i].el;
      if (el === cur) continue;
      var r = list[i].r;

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

  /*
   * 确认键的音效。这里不能 preventDefault —— 点击事件还得照常派发出去。
   * 播放页在播放时会自己吃掉 Enter（播放/暂停），那种情况下 defaultPrevented
   * 为真，下面直接返回，正片进行中不会有界面音。
   */
  addEventListener('keydown', function (e) {
    if (e.defaultPrevented) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var a = document.activeElement;
    if (!a || a === document.body) return;
    if (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable) return;
    soundSelect();
  }, false);

  var DIRS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };

  addEventListener('keyup', function () { repeating = false; }, false);

  addEventListener('keydown', function (e) {
    if (e.defaultPrevented) return;           // the page already handled it (e.g. player seek)
    var dir = DIRS[e.key];
    if (!dir) return;
    // 输入框里左右键留给光标，上下键必须能把焦点带出去 —— 否则搜索框一旦聚焦，
    // 遥控器就再也走不到下面的搜索结果，只剩返回键一条出路。
    var t = e.target;
    var editing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    if (editing && (dir === 'left' || dir === 'right')) return;
    repeating = !!e.repeat;
    if (move(dir)) e.preventDefault();        // otherwise fall through and let the page scroll
  }, false);
})();
"""
