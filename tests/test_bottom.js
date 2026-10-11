/* 刷新后停在最后一次对话
 *
 * 背景：用户反馈「刷新后记录恢复时不会自动停在最后一次对话」。
 *
 * 根因两条，都不在「没滚」而在「滚了但白滚」：
 *   1. #app 用 height:100vh。手机上地址栏收合后可视区变高，#msgs 的
 *      clientHeight 跟着变，开机那一刻滚到底的位置就不在底上了。
 *   2. 公式从备用源后到、字体回流会让内容变高 —— 只在启动时滚一次，
 *      位置就留在半中间（jsdom 测不了布局，这条靠「钉住」机制保证）。
 *
 * 所以断言七件事：
 *   1. 有记录时启动就滚到底
 *   2. 启动后处于「钉住」状态（内容后长高还会跟到底）
 *   3. 内容变高 → 跟到底；用户一翻 → 立刻松手，不再拽人
 *   4. 钉住有期限，过一会儿自动松开（不会永久劫持滚动）
 *   5. 可视区高度变化（resize）时，钉住期间跟到底
 *   6. 公式备源就绪（katexready）时，钉住期间再拉回底
 *   7. 全新用户没有记录 → 不钉，别把欢迎语也锁在滚动逻辑里
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
      /* jsdom 不带 ResizeObserver；给一个假的，把回调捞出来手动触发 */
      win.ResizeObserver = function (cb) {
        win.__rocb = cb;
        this.observe = function () {}; this.disconnect = function () {}; this.unobserve = function () {};
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

/* jsdom 没有布局，scrollTop/scrollHeight 恒为 0。把这两个属性改成可写的替身，
   才测得出「滚到底」这件事到底有没有发生。 */
function fakeScroll(wnd) {
  const m = wnd.document.getElementById('msgs');
  const st = { top: 0, height: 1200, client: 400 };
  Object.defineProperty(m, 'scrollHeight', { get: () => st.height, configurable: true });
  Object.defineProperty(m, 'clientHeight', { get: () => st.client, configurable: true });
  Object.defineProperty(m, 'scrollTop', {
    get: () => st.top, set: v => { st.top = v; }, configurable: true
  });
  return st;
}

(async () => {
  const out = [], errors = [];
  const log = s => out.push(s);
  const ok = (c, m) => { log((c ? '✓ ' : '✗ ') + m); if (!c) errors.push(m); };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const SRC = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  /* === 1. 有记录：启动就落回最后一次对话 === */
  log('=== 1. 有记录时启动即到底 ===');
  {
    const b = boot({ 'gx.msgs.__free': JSON.stringify(MSGS) });
    const wnd = b.wnd, ev = s => { try { return wnd.eval(s) } catch (e) { errors.push('eval: ' + e.message) } };
    await wait(700);
    ok(ev('MS.length') === 3, '三条记录都恢复了（实际 ' + ev('MS.length') + '）');
    ok(!!wnd.document.getElementById('msgs'), '消息容器在');
    ok(ev('PINB') === true, '启动后处于「钉住」状态（内容后长高会跟到底）');
    ok(typeof ev('toBottom') === 'function' && typeof ev('pinBottom') === 'function', 'toBottom / pinBottom 已挂上');
    if (b.errs.length) errors.push(...b.errs);

    /* === 2. 内容变高 → 跟到底 === */
    log('');
    log('=== 2. 会后长高的内容也跟着到底 ===');
    const st = fakeScroll(wnd);
    ev('pinBottom()');                       /* 重钉一次，确保替换后立刻到底 */
    ok(st.top === st.height, '滚到底（top=' + st.top + ' / height=' + st.height + '）');
    st.height = 2600;                        /* 公式渲染完，内容长高 */
    ev('__rocb && __rocb()');
    ok(st.top === st.height, '内容长高后仍停在最后一条（top=' + st.top + '）');

    /* === 3. 用户一翻就松手 === */
    log('');
    log('=== 3. 用户自己翻历史时不再被拽回 ===');
    wnd.document.getElementById('msgs').dispatchEvent(new wnd.Event('wheel'));
    ok(ev('PINB') === false, '一滚就松开（PINB=false）');
    st.top = 300;                            /* 用户翻到上面读 */
    st.height = 4000;
    ev('__rocb && __rocb()');
    ok(st.top === 300, '松开后内容再长高也不动用户的位置（top=' + st.top + '）');
    wnd.dispatchEvent(new wnd.Event('resize'));
    ok(st.top === 300, '松开后窗口尺寸变化也不动（top=' + st.top + '）');

    /* === 4. 钉住有期限 === */
    log('');
    log('=== 4. 钉住会自动松开，不永久劫持滚动 ===');
    ev('pinBottom(60)');
    ok(ev('PINB') === true, '钉住中');
    await wait(140);
    ok(ev('PINB') === false, '到期自动松开');

    /* === 5. resize / katexready 跟着到底 === */
    log('');
    log('=== 5. 地址栏收合与公式后到都能跟上 ===');
    ev('pinBottom(2000)');
    st.top = 0; st.height = 5000;
    wnd.dispatchEvent(new wnd.Event('resize'));
    ok(st.top === st.height, '可视区高度变了 → 跟到底');
    st.top = 0;
    wnd.dispatchEvent(new wnd.Event('katexready'));      /* 备用源公式渲染完成 → 重画消息 */
    await wait(20);
    ok(st.top === st.height, '公式就绪重画后仍停在最后一条（top=' + st.top + '）');
    ev('unpin()');
  }

  /* === 6. 全新用户不钉 === */
  log('');
  log('=== 6. 全新用户没有记录就不钉 ===');
  {
    const b = boot();
    await wait(700);
    const wnd = b.wnd;
    /* 欢迎语只画在 DOM 里，不进 MS（MS 只记真实对话），所以数气泡 */
    ok(wnd.document.querySelectorAll('#mw .msg').length >= 1, '欢迎语照常出现');
    ok(wnd.eval('PINB') === false, '没有历史记录时不做「停在最后一条」');
  }

  /* === 7. 手机地址栏：100vh 才是根因 === */
  log('');
  log('=== 7. 布局高度跟随可视区 ===');
  ok(/height:100vh;height:100dvh/.test(SRC), '#app 用 100dvh 跟随地址栏收合，并留 100vh 回落');
  ok(/orientationchange/.test(SRC), '旋屏后重新停到最后一条');
  ok(/addEventListener\('wheel'|addEventListener\(t,unpin/.test(SRC), '滚轮/触摸/按键都能松开钉住');

  log('');
  if (errors.length) { console.log(out.join('\n')); console.log(''); console.log('失败 ' + errors.length + ' 项：'); errors.forEach(e => console.log('  ✗ ' + e)); process.exit(1); }
  console.log(out.join('\n'));
  console.log('');
  console.log('全部通过');
  process.exit(0);
})();
