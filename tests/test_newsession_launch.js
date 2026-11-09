/* 「每要开始新的一节，都先出现整屏开课向导；选完点「开始上课 →」才进课堂」
 * 专项回归（2026-11-09）
 *
 * 规则：
 *   · 所有新节入口（节条 ＋、向导「开新的一节 →」、手机顶栏 ＋、newSess(true)）
 *     一律先摆出 #launch，不在背后偷偷进课堂
 *   · 点「开始上课 →」＝这一节正式开课，标记写进 s.beg
 *   · 开课后伙伴与节奏固定（沿用上一轮课中锁定规则），开新的一节可重选
 *   · 没开课时 ✕ 不能跳过选择；去教材 / 切页仍可用，切回学习页向导重新摆出来
 *   · 老数据没有 s.beg：有用户发言仍算课中，刷新不拿向导拦人
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const HTML = () => fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
  .replace(/<script src="https:[^"]+"><\/script>/g, '');

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
    const s = e.message || String(e);
    if (/Not implemented: navigation/.test(s)) return;
    errs.push('jsdomError: ' + s);
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

function dumpStore(wnd) {
  const s = {};
  for (let i = 0; i < wnd.localStorage.length; i++) {
    const k = wnd.localStorage.key(i); s[k] = wnd.localStorage.getItem(k);
  }
  return s;
}

(async () => {
  const out = [], errors = [];
  const log = s => out.push(s);
  const ok = (c, m) => { log((c ? '✓ ' : '✗ ') + m); if (!c) errors.push(m); };
  const wait = ms => new Promise(r => setTimeout(r, ms));

  /* ============ 1. 首次进入：选完才能开课 ============ */
  log('=== 1. 首次进入：向导必经，选择后开课并锁定 ===');
  let savedStore = null, savedErrs = [];
  {
    const { wnd, errs } = boot({ width: 1024 });
    const doc = wnd.document;
    await wait(850);
    const ev = s => { try { return wnd.eval(s); } catch (e) { errors.push('eval: ' + e.message); return undefined; } };
    const q = s => doc.querySelector(s);
    const qa = s => Array.from(doc.querySelectorAll(s));
    const toastText = () => (q('#toast') || {}).textContent || '';

    ok(q('#launch').hidden === false, '首次进入先摆出整屏开课向导');
    ok(ev('begunSess()') === false && ev('cfgLocked()') === false, '还没开课：未锁定');
    ok(q('#lhNext').hidden === true, '未开课时不显示「开新的一节 →」');
    ok(/开始上课/.test(q('.lh-note').textContent), '底部说明写清「点开始上课才进课堂」');

    q('#lhClose').click();
    ok(q('#launch').hidden === false, '✕ 不能跳过选择，向导仍摊着');
    ok(/开始上课/.test(toastText()), '✕ 给出「先点开始上课」的提示');

    const other = qa('#lhWho .lh-card').filter(c => c.className.indexOf('on') < 0)[0];
    ok(!!other, '向导里有可选伙伴卡');
    if (other) other.click();
    ok(ev('sessOf(CURS).who') === ev('who'), '选伙伴写回当前这一节');
    const pace = qa('#lhPace .lh-opt').filter(o => o.className.indexOf('on') < 0)[0];
    ok(!!pace, '向导里有可选节奏卡');
    if (pace) pace.click();
    ok(ev('sessOf(CURS).pace') === ev('PA'), '选节奏写回当前这一节');

    q('#lhStart').click();
    ok(q('#launch').hidden === true, '点「开始上课 →」收起向导、进课堂');
    ok(ev('begunSess()') === true && ev('cfgLocked()') === true, '本节从此判定为已开课');
    ok(ev('sessOf(CURS).beg') === 1, '开课标记写进这一节（s.beg）');
    ok(ev('LS.g("sess."+COURSE,[]).some(function(s){return s.id===CURS&&s.beg===1})'),
      '开课标记已落盘（备份会一起带走）');
    ok(doc.body.classList.contains('cfglock'), 'body 带锁定态，药丸 / 下拉看起来不可点');

    q('#lsetup').click();
    ok(q('#launch').classList.contains('locked'), '课中再打开向导是 locked 态');
    ok(q('#lhNext').hidden === false, '课中向导出现「开新的一节 →」');
    const w0 = ev('who');
    const lockedCard = qa('#lhWho .lh-card').filter(c => c.className.indexOf('on') < 0)[0];
    if (lockedCard) lockedCard.click();
    ok(ev('who') === w0, '课中点伙伴大卡改不动（节奏同理，test_lock.js 已守）');

    /* 切页：没开课要重摆向导，已开课不打扰 */
    q('#lhClose').click();
    q('[data-v="book"]').click();
    ok(q('#launch').hidden === true, '切到别的页签时向导收起');
    q('[data-v="lesson"]').click();
    ok(q('#launch').hidden === true, '已经开课：切回学习页不拿向导拦人');

    savedStore = dumpStore(wnd);
    savedErrs = errs;
    ok(errs.length === 0, '首次开课流程没有 JS 异常：' + errs.join(' | '));
    wnd.close();
  }

  /* ============ 2. 刷新：开课标记跟着节走 ============ */
  log('');
  log('=== 2. 刷新回已开课的一节：不再弹向导 ===');
  {
    const store = Object.assign({}, savedStore, { 'gx.view': JSON.stringify('lesson') });
    const { wnd, errs } = boot({ width: 1024, storage: store });
    await wait(850);
    ok(wnd.document.querySelector('#launch').hidden === true, '刷新后直接回课堂，向导不重复出现');
    ok(wnd.eval('begunSess()') === true && wnd.eval('cfgLocked()') === true,
      '刷新后仍记得这一节已开课、伙伴与节奏仍固定');
    ok(errs.length === 0, '刷新没有 JS 异常：' + errs.join(' | '));
    wnd.close();
  }

  /* ============ 3. 所有「新的一节」入口都先出向导 ============ */
  log('');
  log('=== 3. 每个开新节的入口：先出现向导，再开始上课 ===');
  {
    const { wnd, errs } = boot({ width: 1024 });
    const doc = wnd.document;
    await wait(850);
    const ev = s => { try { return wnd.eval(s); } catch (e) { errors.push('eval: ' + e.message); return undefined; } };
    const q = s => doc.querySelector(s);
    const startAndLock = () => {
      q('#lhStart').click();
      ok(q('#launch').hidden === true && ev('cfgLocked()') === true, '  → 点「开始上课」后本节锁定');
    };

    /* 先把第一节开起来（空节点过开始上课，再点新节不会复用它） */
    q('#lhStart').click();
    const id1 = ev('CURS');
    ok(ev('begunSess()') === true, '第一节已开课');

    /* ① 节条上的「＋ 新一节」 */
    q('#newsess').click();
    await wait(30);
    const id2 = ev('CURS');
    ok(id2 !== id1 && ev('SESS.length') === 2, '① 节条 ＋ 真的新建了一节');
    ok(q('#launch').hidden === false, '① 新节先出现向导（没有偷偷进课堂）');
    ok(ev('cfgLocked()') === false && !q('#launch').classList.contains('locked'),
      '① 新节未锁，伙伴 / 节奏可以重新选');
    ok(ev('startedSess("' + id1 + '")') === true, '① 上一节仍然锁定');
    const c2 = Array.from(doc.querySelectorAll('#lhWho .lh-card')).filter(c => c.className.indexOf('on') < 0)[0];
    if (c2) c2.click();
    ok(ev('sessOf(CURS).who') === ev('who') && ev('sessOf("' + id1 + '").beg') === 1,
      '① 新节改伙伴不牵动上一节');
    startAndLock();

    /* ② 向导里的「开新的一节 →」 */
    q('#lsetup').click();
    const id2b = ev('CURS');
    q('#lhNext').click();
    await wait(30);
    ok(ev('CURS') !== id2b && ev('SESS.length') === 3, '② 「开新的一节 →」又建了一节');
    ok(q('#launch').hidden === false, '② 同样先摆出向导');
    ok(ev('cfgLocked()') === false, '② 新节未开课、未锁定');
    startAndLock();

    /* ③ 静默路径 newSess(true)（「开始今天的一课」在旧节里开新节走的就是它） */
    const id3 = ev('CURS');
    ev('newSess(true)');
    await wait(30);
    ok(ev('CURS') !== id3 && ev('SESS.length') === 4, '③ newSess(true) 也建了一节');
    ok(q('#launch').hidden === false, '③ silent 路径同样先出现向导');
    ok(ev('cfgLocked()') === false, '③ 新节仍是可选状态');

    /* ④ 没开课时连点新节不攒空节 */
    const before = ev('SESS.length');
    q('#newsess').click();
    await wait(20);
    ok(ev('SESS.length') === before && q('#launch').hidden === false,
      '④ 空节且未开课：复用这一节、向导照样摊着，不攒一串空节');
    ok(errs.length === 0, '新节流程没有 JS 异常：' + errs.join(' | '));
    wnd.close();
  }

  /* ============ 4. 手机 ＋ 与「切页回来」 ============ */
  log('');
  log('=== 4. 手机 ＋ / 切回学习页重新摆出向导 ===');
  {
    const { wnd, errs } = boot({ width: 390 });
    const doc = wnd.document;
    await wait(850);
    const ev = s => { try { return wnd.eval(s); } catch (e) { errors.push('eval: ' + e.message); return undefined; } };
    const q = s => doc.querySelector(s);

    ok(doc.body.classList.contains('mobile'), '手机抽屉生效');
    ok(q('#launch').hidden === false, '手机启动同样先出向导');
    q('#dOpen').click(); q('#dNew').click();
    ok(q('#launch').hidden === false, '手机顶栏 ＋ 也先出向导');
    ok(!doc.body.classList.contains('drawer'), '打开向导时抽屉收起');
    ok(ev('SESS.length') === 1, '空节未开课：＋ 复用当前节，不攒空节');

    q('#lhGoBook').click();
    ok(q('#launch').hidden === true && doc.body.dataset.view === 'book',
      '「去教材勾选」仍放人去教材页');
    q('[data-v="lesson"]').click();
    ok(q('#launch').hidden === false, '切回学习页：向导重新摆出来，选择绕不过去');
    q('#lhStart').click();
    q('[data-v="book"]').click(); q('[data-v="lesson"]').click();
    ok(q('#launch').hidden === true, '开课后切页回来不再打扰');
    ok(errs.length === 0, '手机流程没有 JS 异常：' + errs.join(' | '));
    wnd.close();
  }

  /* ============ 5. 老数据兼容 ============ */
  log('');
  log('=== 5. 老数据（没有 s.beg）不被向导拦住 ===');
  {
    const base = {
      'gx.sess.__free': JSON.stringify([{ id: 'sA', t: 1, title: '' }]),
      'gx.cur.__free': JSON.stringify('sA'),
      'gx.view': JSON.stringify('lesson')
    };
    const A = boot({ width: 1024, storage: Object.assign({}, base, {
      'gx.msgs.__free': JSON.stringify([{ r: 'user', c: '老问题', s: 'sA' }])
    }) });
    await wait(850);
    ok(A.wnd.eval('begunSess()') === false, '老节确实没有 s.beg 字段');
    ok(A.wnd.eval('cfgLocked()') === true, '但有过我发的话 → 仍判定为课中');
    ok(A.wnd.document.querySelector('#launch').hidden === true, '刷新后不拿向导拦住正在上的老课');
    ok(A.errs.length === 0, '老数据 A 没有 JS 异常：' + A.errs.join(' | '));

    const B = boot({ width: 1024, storage: Object.assign({}, base, {
      'gx.msgs.__free': JSON.stringify([])
    }) });
    await wait(850);
    ok(B.wnd.eval('cfgLocked()') === false, '老节既没 beg 也没发言 → 未开课');
    ok(B.wnd.document.querySelector('#launch').hidden === false, '空节仍按新规则先摆出向导');
    ok(B.errs.length === 0, '老数据 B 没有 JS 异常：' + B.errs.join(' | '));
    A.wnd.close(); B.wnd.close();
  }

  console.log(out.join('\n'));
  console.log('\n--- 异常 ---\n  ' + (errors.length ? errors.join('\n  ') : '无'));
  if (errors.length) { console.log('\n失败 ' + errors.length + ' 条'); process.exit(1); }
  console.log('\n全部通过');
})();
