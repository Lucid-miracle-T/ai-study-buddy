/* 启动顺序：教材还没读出来之前，任何渲染都不许去碰 CH
 *
 * 用户报「教材按不动了」，真机截图 = 教材页进去全空、右上「未载入」、
 * 连课程标签栏和「节」那一条都没有。
 *
 * 两条独立的成因，本测试各守一遍：
 *   A（真凶）CH 从来没被声明过（隐式全局）。启动那一行先调 renderChips()，
 *     它内部 CTX.forEach(… CH.filter …) —— 只要勾选过章节（CTX 非空），
 *     此刻 CH 还不存在 → ReferenceError → 整个启动脚本当场中断，
 *     于是后面 renderBook/renderCTabs/renderSTabs 一个都不跑，
 *     页面就停在「导航还能点、教材页全空」的样子。
 *   B（并发面）教材库（IndexedDB）打不开时，await 抛出同样让后面全不画，
 *     所以存储失败也必须兜住：页面照常渲染，并给一条能看懂、能自救的提示。
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const HTML = () => fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')
  .replace(/<script src="https:[^"]+"><\/script>/g, '');

/* 可用的教材库；broken=true 时模拟「打不开」 */
function makeStore(seed, broken) {
  const st = { gxbook: new Map((seed || []).map(c => [c.id, c])) };
  st.open = win => {
    win.indexedDB = {
      open(name) {
        const r = {};
        if (broken) { setTimeout(() => { r.error = new Error('IndexedDB blocked (模拟打不开)'); if (r.onerror) r.onerror({ target: r }) }, 0); return r }
        if (!st[name]) st[name] = new Map();
        const s = st[name];
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
        setTimeout(() => { r.result = db; if (r.onsuccess) r.onsuccess({ target: { result: db } }) }, 0);
        return r;
      }
    };
  };
  return st;
}

function boot(store, lsSeed) {
  const vc = new VirtualConsole(); const errs = [];
  vc.on('jsdomError', e => {
    const m = e.message || String(e);
    if (/Not implemented: navigation/.test(m)) return;
    errs.push(m);
  });
  const dom = new JSDOM(HTML(), {
    url: 'https://x.test/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      store.open(win);
      win.confirm = () => true; win.alert = () => {}; win.open = () => null;
      win.URL.createObjectURL = () => 'blob:x'; win.URL.revokeObjectURL = () => {};
      win.fetch = function (u) {
        u = String(u);
        if (/video\//.test(u)) return Promise.resolve({ ok: false, status: 404, text: async () => '' });
        const name = decodeURIComponent(u.split('/').pop());
        return Promise.resolve({ ok: true, status: 200, text: async () => '# ' + name.replace(/\.md$/, '') + '\n\n正文。\n' });
      };
      if (lsSeed) Object.keys(lsSeed).forEach(k => win.localStorage.setItem(k, lsSeed[k]));
    }
  });
  return { wnd: dom.window, errs };
}

/* 一份「用了一阵子」的 localStorage：当前课程上有勾选的章节 */
function seedWithCtx(course) {
  /* 用内置包「高等数学」这门课：应用载入教材后会把 __free 自动切到 __local，
     所以勾选的章节要挂在它下面才留得住 */
  course = course || '__local';
  return {
    'gx.course': JSON.stringify(course),
    ['gx.ctx.' + course]: JSON.stringify(['第1章_函数与极限.md#0']),
    'gx.view': JSON.stringify('book')
  };
}

(async () => {
  const out = [], errors = [];
  const log = s => out.push(s);
  const ok = (c, m) => { log((c ? '✓ ' : '✗ ') + m); if (!c) errors.push(m) };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const mk = w => ({ doc: w.document, ev: s => { try { return w.eval(s) } catch (e) { errors.push('eval: ' + e.message) } } });

  /* ============ 1. 勾选过章节的老用户：启动不能断在半路 ============ */
  log('=== 1. 勾选过章节（CTX 非空）时刷新 ===');
  {
    const s = makeStore();
    const b = boot(s, seedWithCtx());
    const A = mk(b.wnd);
    await wait(2500);
    const re = b.errs.filter(m => /is not defined|ReferenceError/.test(m));
    ok(re.length === 0, '没有 ReferenceError' + (re.length ? '：' + re[0].split('\n')[0] : ''));
    ok(b.errs.length === 0, '整体没崩' + (b.errs.length ? '：' + b.errs[0].split('\n')[0] : ''));
    ok(A.ev('document.querySelectorAll("#ctabs .ctab").length') > 0, '课程标签栏画出来了');
    ok(A.ev('document.querySelectorAll("#stabs .stab").length') > 0, '「节」那一条画出来了');
    ok(A.ev('document.querySelectorAll("#blist .cgrp").length') > 0, '教材目录画出来了');
    ok(A.ev('document.querySelector("#bstat").textContent') !== '未载入', '右上角不再是「未载入」（' + A.ev('document.querySelector("#bstat").textContent') + '）');
    ok(A.ev('CH.length') > 0, '教材真的读出来了（CH=' + A.ev('CH.length') + '）');
    ok(A.ev('CTX.length') > 0, '勾选的章节还在（CTX=' + A.ev('CTX.length') + '）');
    ok(A.ev('document.querySelectorAll("#ctxchips .chip").length') > 0, '上课页的「带到课堂」chip 也在');
  }

  /* ============ 2. 没勾选过：也不能回归 ============ */
  log('\n=== 2. 什么都没勾选（CTX 为空）时刷新 ===');
  {
    const s = makeStore();
    const b = boot(s, { 'gx.course': JSON.stringify('__free') });
    const A = mk(b.wnd);
    await wait(2500);
    ok(b.errs.length === 0, '没崩' + (b.errs.length ? '：' + b.errs[0].split('\n')[0] : ''));
    ok(A.ev('document.querySelectorAll("#ctabs .ctab").length') > 0, '课程标签栏照常');
    ok(A.ev('document.querySelectorAll("#blist .cgrp").length') > 0, '教材目录照常');
  }

  /* ============ 3. 教材库打不开：页面照常，且有能自救的提示 ============ */
  log('\n=== 3. 教材库（IndexedDB）打不开 ===');
  {
    const s = makeStore([], true);
    const b = boot(s, seedWithCtx());
    const A = mk(b.wnd);
    await wait(2500);
    ok(A.ev('document.querySelectorAll("#ctabs .ctab").length') > 0, '课程标签栏照样画出来（没被存储问题带崩）');
    ok(A.ev('document.querySelectorAll("#stabs .stab").length') > 0, '「节」那一条照样画出来');
    ok(!!A.doc.querySelector('#storwarn'), '出现一条常驻提示，把原因说清楚');
    ok(/本地存储这次没能打开/.test(A.ev('document.querySelector("#storwarn").textContent') || ''), '提示里写明「本地存储没能打开」');
    ok(/没有丢/.test(A.ev('document.querySelector("#storwarn").textContent') || ''), '并且说明「记录没有丢」——别让人以为数据没了');
    A.ev('goView("book")');
    await wait(80);
    const etxt = A.ev('document.querySelector("#blist").textContent') || '';
    ok(/本地教材库这次没打开/.test(etxt), '教材页空状态说的是存储问题，而不是「还没有教材」');
    ok(!!A.doc.querySelector('#ldempty'), '空状态里有一个能点的按钮（再试一次）');
    ok(!/还没有教材/.test(etxt), '不会误报成「还没有教材」');
  }

  console.log(out.join('\n'));
  console.log('\n--- 错误 ---');
  console.log(errors.length ? errors.join('\n') : '无');
  process.exit(errors.length ? 1 : 0);
})();
