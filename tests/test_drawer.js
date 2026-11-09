/* 手机抽屉回归：把 chrome 收进侧栏 ≠ 功能被删
 *
 * 背景（2026-11-09）：用户对照 DeepSeek 手机界面，反馈「界面内容太庞杂」，
 * 要求用侧边栏 + 子栏目折叠功能、把空间还给对话。
 *
 * 实现约束（都要在这里守住）：
 *   - 只搬 DOM 节点（#nav / #ctabs / #stabs / #lbar1 / #lbar2 换父节点），不复制状态
 *   - 桌面 / jsdom（innerWidth=1024）一行不改：body.mobile 不存在，原结构原样
 *   - #foot 仍是 #nav 的直接子元素（test_foot.js / test_shell.js 的老根因）
 *   - 七个视图（含课余群聊）、LITE 过滤、每节独立状态、向导、原工具栏控件全部仍在
 *   - 抽屉里点页面要自动收起；遮罩 / Esc / 关闭按钮都能关
 *   - 顶栏的「停止」「＋」是遥控器，点它＝点原来的按钮，不另写一套逻辑
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const SRC = () => fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const HTML = () => SRC().replace(/<script src="https:[^"]+"><\/script>/g, '');

function installIDB(win) {
  const m = new Map();
  win.indexedDB = {
    open(n) {
      if (!m.has(n)) m.set(n, new Map());
      const s = m.get(n); const r = {};
      const db = {
        objectStoreNames: { contains: () => true },
        createObjectStore() { return {} },
        transaction() {
          const os = {
            put: o => { s.set(o.id, o); return {} },
            getAll: () => ({ result: [...s.values()] }),
            delete: id => { s.delete(id); return {} },
            clear: () => { s.clear(); return {} }
          };
          const t = { objectStore: () => os };
          setTimeout(() => { if (t.oncomplete) t.oncomplete(); }, 0);
          return t;
        }
      };
      setTimeout(() => { r.result = db; if (r.onsuccess) r.onsuccess({ target: { result: db } }); }, 0);
      return r;
    }
  };
}

function boot(opts) {
  opts = opts || {};
  const vc = new VirtualConsole(); const errs = [];
  vc.on('jsdomError', e => {
    const m = e.message || String(e);
    if (/Not implemented: navigation/.test(m)) return;
    errs.push('jsdomError: ' + m);
  });
  const dom = new JSDOM(HTML(), {
    url: opts.url || 'https://x.test/',
    runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      installIDB(win);
      if (opts.width !== undefined) {
        Object.defineProperty(win, 'innerWidth', { value: opts.width, configurable: true, writable: true });
      }
      win.confirm = () => true; win.alert = () => {}; win.open = () => null;
      win.fetch = () => Promise.reject(new Error('测试不联网'));
      win.URL.createObjectURL = () => 'blob:x'; win.URL.revokeObjectURL = () => {};
      Object.keys(opts.storage || {}).forEach(k => win.localStorage.setItem(k, opts.storage[k]));
    }
  });
  return { wnd: dom.window, errs };
}

(async () => {
  const out = [], errors = [];
  const log = s => out.push(s);
  const ok = (c, m) => { log((c ? '✓ ' : '✗ ') + m); if (!c) errors.push(m); };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const src = SRC();

  /* ============ 1. 桌面 / jsdom：一个字都不该变 ============ */
  log('=== 1. 桌面结构不变 ===');
  {
    const { wnd, errs } = boot();
    const doc = wnd.document;
    await wait(900);
    ok(!doc.body.classList.contains('mobile'), '桌面（innerWidth=1024）不加 mobile');
    ok(doc.querySelector('#nav').parentElement.id === 'app', '#nav 仍在 #app 下');
    ok(doc.querySelector('#ctabs').parentElement.id === 'stage', '#ctabs 仍在 #stage 下');
    ok(doc.querySelector('#lbar1').parentElement.id === 'v-lesson', '#lbar1 仍在课堂页里');
    ok(!!doc.querySelector('#topbar') && !!doc.querySelector('#drawer'), '抽屉骨架存在但不生效');
    ok(/#topbar,#drawer,#dmask\{display:none\}/.test(src), '抽屉相关元素默认 display:none');
    ok(errs.length === 0, '桌面启动无 JS 异常' + (errs.length ? '：' + errs[0] : ''));
    wnd.close();
  }

  /* ============ 2. 手机：节点搬进抽屉，功能一个没删 ============ */
  log('');
  log('=== 2. 手机抽屉：搬 DOM，不丢功能 ===');
  {
    const { wnd, errs } = boot({ width: 390 });
    const doc = wnd.document;
    await wait(900);
    const q = s => doc.querySelector(s);
    const qa = s => Array.from(doc.querySelectorAll(s));

    ok(doc.body.classList.contains('mobile'), '窄屏加上 body.mobile');
    ok(q('#nav').parentElement.id === 'dNav', '#nav 整块搬进「页面」子栏目');
    ok(q('#ctabs').parentElement.id === 'dTabs' && q('#stabs').parentElement.id === 'dTabs',
      '课程 / 节两条标签栏搬进「课程与节」子栏目');
    ok(q('#lbar1').parentElement.id === 'dSec', '伙伴 / 模式工具栏搬进「这一节」子栏目');
    ok(q('#lbar2').parentElement.id === 'dActs', '课堂操作按钮搬进「课堂操作」子栏目');
    ok(qa('#drawer details').length === 4, '抽屉有 4 个可折叠子栏目');
    ok(q('#drawer details').open === true, '默认展开「这一节」');
    ok(qa('#drawer details')[1].open === true, '「页面」子栏目默认展开，六个入口一点开就可见');
    ok(/#drawer details:not\(\[open\]\)>div\{display:none\}/.test(src),
      '收起的子栏目真的隐藏内容（否则原节点的 display:flex 会顶开 UA 隐藏）');

    const foot = q('#foot');
    ok(!!foot && foot.parentElement.id === 'nav' && !q('.nv #foot'),
      '#foot 仍是 #nav 的直接子元素（搬的是 #nav，不是拆开它）');
    const vs = qa('.nv button').map(b => b.dataset.v).sort().join(',');
    ok(vs === 'book,card,chat,lesson,prog,set,vid', '七个视图入口都还在（课余多了群聊）：' + vs);
    ok(/body\.mobile #drawer \.nv button\[data-v\]\{display:flex\}/.test(src),
      '抽屉里取消三标签分组隐藏，六个入口一次露全');
    ok(!/body\.mobile #drawer \.nv button\[data-v\]\{display:flex!important\}/.test(src),
      '这条规则不带 !important —— 否则会顶掉 LITE 的内联 display:none');

    const need = ['start', 'gen', 'exp2', 'close', 'clr', 'stop', 'pbox', 'mbox', 'pace',
      'tts', 'tok', 'kxst', 'ctxchips', 'rgo2', 'mctrl', 'lsetup', 'lexpand',
      'in', 'send', 'symtoggle', 'pctoggle', 'photo', 'mic'];
    const miss = need.filter(id => !q('#' + id));
    ok(miss.length === 0, '课堂控件一个没删' + (miss.length ? '，缺：' + miss : ''));
    ok(qa('#pacebar [data-cmd]').length >= 7, '节奏命令仍在主屏（底部一条，不进抽屉）');
    ok(!!q('#symbar #symtoggle'), '符号面板仍在主屏');
    ok(q('#topbar').parentElement.id === 'app', '顶栏是 #app 的直属项，开课向导盖不到它');

    /* 顶栏标题由 renderShell 现算，不另存状态 */
    ok(!!q('#dtCourse').textContent && !!q('#dtSess').textContent,
      '顶栏显示当前课程与节：' + q('#dtCourse').textContent + ' / ' + q('#dtSess').textContent);

    /* 抽屉开关 */
    q('#dOpen').click();
    ok(doc.body.classList.contains('drawer') && q('#drawer').getAttribute('aria-hidden') === 'false',
      '点 ☰ 打开抽屉，aria-hidden 同步');
    q('#dmask').click();
    ok(!doc.body.classList.contains('drawer'), '点遮罩关闭');
    q('#dOpen').click();
    doc.dispatchEvent(new wnd.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    ok(!doc.body.classList.contains('drawer'), '按 Esc 关闭');
    q('#dOpen').click();
    q('#dClose').click();
    ok(!doc.body.classList.contains('drawer'), '点 ✕ 关闭');

    /* 抽屉里点页面：goView 生效且自动收起 */
    q('#dOpen').click();
    qa('.nv button').filter(b => b.dataset.v === 'book')[0].click();
    ok(q('#v-book').classList.contains('on'), '抽屉里点「教材」真的切了页');
    ok(!doc.body.classList.contains('drawer'), '选完页面抽屉自动收起');
    qa('.nv button').filter(b => b.dataset.v === 'lesson')[0].click();

    /* ＋ ＝开新的一节：一律先摆出整屏向导，选完再上课 */
    q('#dOpen').click(); q('#dNew').click();
    ok(q('#launch').hidden === false, '点 ＋ 打开开课向导（不另写一套选课逻辑）');
    ok(!doc.body.classList.contains('drawer'), '打开向导时抽屉收起');
    q('#lhClose').click();
    ok(q('#launch').hidden === true && q('#notstarted').hidden === false,
      '这一节还没开课：✕ 收起向导、落到「未开课」空态（选择仍必经）');

    /* ⏹ 是 #stop 的遥控器：没在生成时点了不炸 */
    const before = errs.length;
    q('#dStop').click();
    ok(errs.length === before, '空闲时点 ⏹ 不抛异常（转给原来的 #stop）');
    ok(/function initDrawer\(\)/.test(src) && /initDrawer\(\);/.test(src), '抽屉只在启动行初始化一次');
    ok(errs.length === 0, '手机启动全程无 JS 异常' + (errs.length ? '：' + errs[0] : ''));
    wnd.close();
  }

  /* ============ 3. 体验版 + 手机：LITE 过滤不能被抽屉覆盖 ============ */
  log('');
  log('=== 3. 体验版（github.io）+ 手机 ===');
  {
    const { wnd, errs } = boot({ width: 390, url: 'https://lucid-miracle-t.github.io/ai-study-buddy/' });
    const doc = wnd.document;
    await wait(900);
    const vid = doc.querySelector('[data-v="vid"]');
    ok(!!vid && vid.style.display === 'none', '体验版「网课」入口仍被隐藏（内联样式赢过抽屉规则）');
    ok(doc.querySelectorAll('#lhWho .lh-card').length <= 3, '体验版伙伴仍只有前三位');
    ok(!!doc.querySelector('#dlfree'), '免费讲义入口在体验版保留');
    ok(doc.body.classList.contains('mobile'), '体验版手机同样启用抽屉');
    ok(errs.length === 0, '体验版手机启动无 JS 异常' + (errs.length ? '：' + errs[0] : ''));
    wnd.close();
  }

  log('');
  log(errors.length ? 'FAILED: ' + errors.length + ' 条' : 'ALL PASS');
  console.log(out.join('\n'));
  if (errors.length) { console.error('\n失败项：\n' + errors.join('\n')); process.exit(1); }
})();
