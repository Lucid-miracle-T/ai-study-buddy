/* 刷新后停在最后一次对话
 *
 * 背景：用户两次反馈「刷新后不会自动停在最后一次对话」。第一次按「启动时滚一次 + 钉一小会儿」
 * 修，用户说还是不行。于是上真浏览器实测（Edge headless + CDP，scripts/probe_scroll.mjs），
 * 复现出两个真根因——都不是「没滚」：
 *   1. 滚的那一刻内容还差 28px 没长完（字体度量到位后兄弟栏变高，把 #msgs 挤矮了）。
 *      滚完位置就留在半中间，之后再没人补。
 *   2. 只盯 #mw（内容盒子）会漏掉「兄弟栏变高 → #msgs 变矮」：那时 #mw 尺寸没变，
 *      ResizeObserver 不回调，可位置已经不在底上了。
 *   还有第三个、最隐蔽的：scroll 事件是异步派发的，我们滚完那一刻内容常常还没长完，
 *   事件回来时「已在底部」已是 false —— 会把自己滚的误判成用户滚的，跟随当场被关掉。
 *
 * 本测试守住这套逻辑。jsdom 没有布局，scrollTop/scrollHeight 恒为 0，
 * 所以把这两个属性换成可写替身，并塞一个假 ResizeObserver 把回调捞出来手动触发。
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

function installIDB(win) {
  const m = new Map();
  win.indexedDB = {
    open(n) {
      if (!m.has(n)) m.set(n, new Map());
      const s = m.get(n); const r = {};
      const db = {
        objectStoreNames: { contains: () => true }, createObjectStore() { return {} },
        transaction() {
          const os = {
            put: o => { s.set(o.id, o); return {} }, getAll: () => ({ result: [...s.values()] }),
            delete: id => { s.delete(id); return {} }, clear: () => { s.clear(); return {} }
          };
          const t = { objectStore: () => os };
          setTimeout(() => { if (t.oncomplete) t.oncomplete(); }, 0); return t;
        }
      };
      setTimeout(() => { r.result = db; if (r.onsuccess) r.onsuccess({ target: { result: db } }); }, 0);
      return r;
    }
  };
}

const HTML = () => fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')
  .replace(/<script src="https:[^"]+"><\/script>/g, '');

const MSGS = [
  { r: 'assistant', c: '先说说行列式在讲什么。' },
  { r: 'user', c: '讲的是面积。' },
  { r: 'assistant', c: '对。那 $\\det A=0$ 时呢？' }
];

function boot(preset) {
  const vc = new VirtualConsole();
  const errs = [];
  vc.on('jsdomError', e => {
    const m = e.message || String(e);
    if (/Not implemented: navigation/.test(m)) return;
    errs.push('jsdomError: ' + m);
  });
  const dom = new JSDOM(HTML(), {
    url: 'https://x.test/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      installIDB(win);
      /* jsdom 不带 ResizeObserver：给一个假的，记录盯了谁、把回调捞出来手动触发 */
      win.ResizeObserver = function (cb) {
        win.__ro = win.__ro || { cbs: [], targets: [] };
        win.__ro.cbs.push(cb);
        this.observe = function (el) { win.__ro.targets.push(el && el.id); };
        this.disconnect = function () {}; this.unobserve = function () {};
      };
      win.confirm = () => true; win.alert = () => {};
      win.open = () => null;
      win.fetch = () => Promise.reject(new Error('测试不联网'));
      win.URL.createObjectURL = () => 'blob:x'; win.URL.revokeObjectURL = () => {};
      if (preset) Object.keys(preset).forEach(k => win.localStorage.setItem(k, preset[k]));
    }
  });
  return { wnd: dom.window, errs };
}

(async () => {
  const out = [], errors = [];
  const log = s => out.push(s);
  const ok = (c, m) => { log((c ? '✓ ' : '✗ ') + m); if (!c) errors.push(m); };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  const b = boot({ 'gx.msgs.__free': JSON.stringify(MSGS) });
  const wnd = b.wnd;
  const ev = s => { try { return wnd.eval(s) } catch (e) { errors.push('eval: ' + e.message); return undefined } };
  await wait(700);
  const doc = wnd.document;
  const m = doc.getElementById('msgs');

  /* jsdom 没有布局：scrollTop/scrollHeight/clientHeight 换成可写替身 */
  const st = { top: 0, height: 1200, client: 400 };
  Object.defineProperty(m, 'scrollHeight', { get: () => st.height, configurable: true });
  Object.defineProperty(m, 'clientHeight', { get: () => st.client, configurable: true });
  Object.defineProperty(m, 'scrollTop', { get: () => st.top, set: v => { st.top = v; }, configurable: true });
  const fireRO = () => (wnd.__ro ? wnd.__ro.cbs.forEach(cb => cb()) : 0);
  const fireScroll = () => m.dispatchEvent(new wnd.Event('scroll'));
  const gesture = t => m.dispatchEvent(new wnd.Event(t));

  /* === 1. 启动就落回最后一次对话 === */
  log('=== 1. 启动即到底 ===');
  ok(ev('MS.length') === 3, '三条记录都恢复了（实际 ' + ev('MS.length') + '）');
  ok(ev('PINB') === true, '启动后处于跟随状态');
  ok(ev('typeof toBottom') === 'function' && ev('typeof settleBottom') === 'function', 'toBottom / settleBottom 已挂上');
  {
    /* 启动是「逐帧跟一小会儿」而不是滚一次：把内容改高，等几帧看它自己有没有跟上 */
    st.height = 5000;
    await wait(120);
    ok(st.top === 5000, '启动后自动跟到新的底部（top=' + st.top + '）');
  }
  if (b.errs.length) errors.push(...b.errs);

  /* === 2. 两个盒子都要盯（这次丢 28px 的直接原因）=== */
  log('');
  log('=== 2. 盯住两个盒子 ===');
  {
    const tg = (wnd.__ro && wnd.__ro.targets) || [];
    ok(tg.indexOf('msgs') >= 0, 'ResizeObserver 盯了消息容器 #msgs（实际 ' + JSON.stringify(tg) + '）');
    ok(tg.indexOf('mw') >= 0, '也盯了内容盒子 #mw');
    ok(/ro\.observe\(\$\('msgs'\)\);ro\.observe\(\$\('mw'\)\)/.test(SRC),
      '两处都 observe —— 只盯 #mw 会漏掉「兄弟栏变高把 #msgs 挤矮」');
  }

  /* === 3. 长高 / 变矮都跟着走 === */
  log('');
  log('=== 3. 内容长高、容器变矮都跟到底 ===');
  {
    ev('unpin()'); await wait(60);              /* 先把手动跟随关掉，避免逐帧循环干扰 */
    ev('pinBottom()');
    ok(st.top === st.height, '滚到底（top=' + st.top + ' / h=' + st.height + '）');
    st.height = 6600; fireRO();
    ok(st.top === 6600, '内容长高 → 跟到底（top=' + st.top + '）');
    st.client = 300; fireRO();                  /* 容器变矮：等效于兄弟栏变高 */
    ok(st.top === 6600, '容器变矮也不掉队（top=' + st.top + '）');
    st.client = 400;
  }

  /* === 4. 我们自己的 scroll 事件不许关掉跟随 === */
  log('');
  log('=== 4. 自己的滚动不算用户操作 ===');
  {
    ev('pinBottom()');
    fireScroll();                               /* 位置 == 我们刚滚到的位置 */
    ok(ev('PINB') === true, '位置停在我们滚到的地方 → 跟随不被误关');
    st.height = 7200; fireRO();
    ok(st.top === 7200, '还能继续跟上（top=' + st.top + '）');
  }

  /* === 5. 用户的手一动就松手 === */
  log('');
  log('=== 5. 用户一动手立刻松手 ===');
  {
    gesture('wheel');
    ok(ev('PINB') === false, '滚轮一动就松开');
    ev('pinBottom()');
    gesture('touchstart');
    ok(ev('PINB') === false, '触摸也一样（手机上没有 wheel 事件）');
  }

  /* === 6. 自己滚走就不动他，滚回来又接上 === */
  log('');
  log('=== 6. 翻历史时不被拽回来 ===');
  {
    ev('pinBottom()');
    st.top = 300; fireScroll();                 /* 用户滚到上面 */
    ok(ev('PINB') === false, '离开底部 → 松手');
    st.height = 9000; fireRO();
    ok(st.top === 300, '内容再长高也不动他（top=' + st.top + '）');
    wnd.dispatchEvent(new wnd.Event('resize'));
    ok(st.top === 300, '窗口尺寸变化也不动他（top=' + st.top + '）');
    st.top = st.height; fireScroll();           /* 自己滚回底部 */
    ok(ev('PINB') === true, '滚回底部 → 跟随接回来');
    ev('unpin()'); await wait(60);
  }

  /* === 7. 没跟随时重画不许踹人 === */
  log('');
  log('=== 7. 晚到的公式重画时不踹人 ===');
  {
    st.top = 300;
    ev('reloadMsgs()');
    ok(st.top === 300, '没跟随时重画保住用户读到的地方（top=' + st.top + '）');
    ev('pinBottom()');
    ev('reloadMsgs()');
    ok(st.top === st.height, '跟随时重画则落到最新一条');
    ev('unpin()'); await wait(60);
  }

  /* === 8. 逐帧跟随：松手就停 === */
  log('');
  log('=== 8. 逐帧跟一小会儿，松手就停 ===');
  {
    ev('pinBottom();followFor(300)');
    st.height = 12000;
    await wait(150);
    ok(st.top === 12000, '跟随时逐帧补到底（top=' + st.top + '）');
    ev('unpin()');
    st.height = 14000;
    await wait(150);
    ok(st.top === 12000, '松手后循环停下，不再改动位置（top=' + st.top + '）');
  }

  /* === 9. 自己发话就恢复跟随 === */
  log('');
  log('=== 9. 自己发了话就恢复跟随 ===');
  {
    ev('unpin();$("key").value="k";$("base").value="https://x.test/v1";$("model").value="m"');
    ok(ev('PINB') === false, '前提：现在是松手状态');
    ev('ask("测试一句")');
    ok(ev('PINB') === true, '提问后恢复跟随 —— 自己发的问，就该看到回答');
    ev('unpin()'); await wait(60);
  }

  /* === 10. 全新用户不钉 === */
  log('');
  log('=== 10. 全新用户没有记录就不跟 ===');
  {
    const b2 = boot();
    await wait(700);
    ok(b2.wnd.document.querySelectorAll('#mw .msg').length >= 1, '欢迎语照常出现');
    ok(b2.wnd.eval('PINB') === false, '没有历史记录时不做「停在最后一条」');
  }

  /* === 11. 布局高度跟随可视区 === */
  log('');
  log('=== 11. 布局高度跟随可视区 ===');
  ok(/height:100vh;height:100dvh/.test(SRC), '#app 用 100dvh，并留 100vh 回落');
  ok(/orientationchange/.test(SRC), '旋屏后仍在跟随时重新到底');

  log('');
  if (errors.length) { console.log(out.join('\n')); console.log(''); console.log('失败 ' + errors.length + ' 项：'); errors.forEach(e => console.log('  ✗ ' + e)); process.exit(1); }
  console.log(out.join('\n'));
  console.log('');
  console.log('全部通过');
  process.exit(0);
})();
