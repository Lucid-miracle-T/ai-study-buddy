/* 网课刷新后要接着看：合集、第几讲、带到课堂的那一讲，都不能丢
 *
 * 用户原话：「网课刷新后也要能记录」
 *
 * 之前只有「看没看」（每讲的 st）存在 IndexedDB 里，位置全是内存变量：
 * 刷新一次就被弹回第一个合集的第 1 讲，「带到课堂」的讲义也一起没了——
 * 而那份讲义本来是要跟着下一轮提问发出去的。
 *
 * 本测试守的：
 *   1. 合集 / 第几讲 / 带到课堂，刷新后原样恢复
 *   2. 讲义正文不进 localStorage（只存 key），刷新后按 key 重建
 *   3. 合集被删、那一讲不在了 → 上下文跟着失效，不留指向空气的钩子
 *   4. 翻到哪一页也记着；但设置页不记（那是配置的地方）
 *   5. 旧的「看没看」状态不受影响
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const HTML = () => fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')
  .replace(/<script src="https:[^"]+"><\/script>/g, '');

/* 跨「刷新」共享的存储底座：两次 boot 用同一份 Maps，才是真的持久化 */
function makeStore(seedVid) {
  const st = { gxbook: new Map(), gxvid: new Map((seedVid || []).map(o => [o.id, o])) };
  st.open = win => {
    win.indexedDB = {
      open(name) {
        if (!st[name]) st[name] = new Map();
        const s = st[name]; const r = {};
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
  };
  return st;
}
const dumpLS = w => {
  const o = {};
  for (let i = 0; i < w.localStorage.length; i++) { const k = w.localStorage.key(i); o[k] = w.localStorage.getItem(k) }
  return o;
};
function boot(store, lsSeed) {
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
      store.open(win);
      win.confirm = () => true; win.alert = () => {}; win.open = () => null;
      /* 让内置网课包取不到：用我们自己的两个合集测，别被内置的盖住 */
      win.fetch = () => Promise.resolve({ ok: false, status: 404, statusText: 'NF', json: async () => ({}) });
      win.URL.createObjectURL = () => 'blob:x'; win.URL.revokeObjectURL = () => {};
      if (lsSeed) Object.keys(lsSeed).forEach(k => win.localStorage.setItem(k, lsSeed[k]));
    }
  });
  return { wnd: dom.window, errs };
}

const VIDS = [
  { id: 'v1', title: '合集甲', items: [
    { t: '甲一', doc: '[00:10] 甲的第一段', st: 0 },
    { t: '甲二', doc: '[00:20] 甲的第二段', st: 0 },
    { t: '甲三', doc: '[00:30] 甲的第三段', st: 0 }] },
  { id: 'v2', title: '合集乙', items: [
    { t: '乙一', doc: '乙的第一段', st: 0 },
    { t: '乙二', doc: '乙的第二段', st: 0 }] }
];

(async () => {
  const out = [], errors = [];
  const log = s => out.push(s);
  const ok = (c, m) => { log((c ? '✓ ' : '✗ ') + m); if (!c) errors.push(m); };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const mk = w => {
    const doc = w.document;
    return {
      doc,
      ev: s => { try { return w.eval(s) } catch (e) { errors.push('eval: ' + e.message); return undefined } },
      J: s => JSON.parse(w.eval('JSON.stringify(' + s + ')')),
      lecs: () => [...doc.querySelectorAll('#vlist .vlec')],
      sel: () => doc.querySelector('#vset'),
      ctxBtn: () => doc.querySelector('#vbar2 [data-a="ctx"]')
    };
  };

  const store = makeStore(VIDS);

  /* ============ 首次打开 ============ */
  log('=== 1. 第一次打开（干净） ===');
  const b1 = boot(store, null); const A = mk(b1.wnd);
  await wait(900);
  ok(A.ev('VS.length') === 2, '读到 2 个合集（不是内置包兜底）');
  ok(A.J('VSET') === 'v1', '默认停在第一个合集');
  ok(A.J('VLEC') === 0, '默认停在第一讲');
  ok(A.ev('VCTX') === null, '没有带到课堂的东西');

  /* ============ 换合集、跳讲、带到课堂 ============ */
  log('=== 2. 换合集 / 跳到第 2 讲 / 带到课堂 ===');
  A.ev('goView("vid")');                    /* 人本来就待在网课页 */
  ok(A.doc.querySelector('#v-vid').classList.contains('on'), '切到网课页');
  A.sel().value = 'v2'; A.sel().onchange();
  await wait(40);
  ok(A.J('VSET') === 'v2', '切到合集乙');
  ok(A.J('VLEC') === 0, '换合集后回到第 1 讲');
  const ls = A.lecs();
  ok(ls.length === 2, '课表渲染出 2 讲');
  ls[1].onclick();
  await wait(40);
  ok(A.J('VLEC') === 1, '点第 2 讲 → 当前讲跟着变');
  ok(A.doc.querySelectorAll('#vlist .vlec.on')[0].textContent.indexOf('乙二') >= 0, '课表上标出了当前讲');
  ok(A.doc.querySelector('#vdoc').textContent.indexOf('乙的第二段') >= 0, '右边讲义跟着换');

  A.ctxBtn().click();
  await wait(40);
  ok(A.J('VCTX.k') === 'v2#1', '「带到课堂」记下了 合集#第几讲');
  ok(A.doc.querySelector('#vbar2 [data-a="ctx"]').textContent.indexOf('已带到课堂') >= 0, '按钮变成「已带到课堂 ✓」');

  log('=== 3. 位置已经落盘（讲义正文不进 localStorage） ===');
  ok(A.J('JSON.parse(localStorage.getItem("gx.vpos.set"))') === 'v2', '合集 id 已存');
  ok(A.J('JSON.parse(localStorage.getItem("gx.vpos.lec"))') === '1', '第几讲已存');
  ok(A.J('JSON.parse(localStorage.getItem("gx.vpos.ctx"))') === 'v2#1', '上下文 key 已存');
  ok(A.J('(localStorage.getItem("gx.vpos.ctx")||"").indexOf("乙的第二段")') < 0, 'localStorage 里没有讲义正文（只有 key）');
  ok(A.J('(localStorage.getItem("gx.vpos.set")||"").indexOf("合集乙")') < 0, '也没存合集标题');

  /* ============ 刷新 ============ */
  const ls1 = dumpLS(b1.wnd);
  log('=== 4. 刷新 ===');
  const b2 = boot(store, ls1); const B = mk(b2.wnd);
  await wait(900);
  ok(b2.errs.length === 0, '刷新过程没有报错' + (b2.errs.length ? ('：' + b2.errs.join(' / ')) : ''));
  ok(B.J('VSET') === 'v2', '刷新后还在合集乙');
  ok(B.J('VLEC') === 1, '刷新后还停在第 2 讲');
  ok(B.sel().value === 'v2', '顶部下拉也选中合集乙');
  ok(B.doc.querySelectorAll('#vlist .vlec.on')[0].textContent.indexOf('乙二') >= 0, '课表高亮还是那一讲');
  ok(B.doc.querySelector('#vdoc').textContent.indexOf('乙的第二段') >= 0, '右边直接显示上次那讲的讲义（不用再点一次）');
  ok(B.J('VCTX && VCTX.k') === 'v2#1', '带到课堂的上下文还在');
  ok(B.ev('VCTX.doc') === '乙的第二段', '讲义正文按 key 重建了出来');
  ok(B.doc.querySelector('#vbar2 [data-a="ctx"]').textContent.indexOf('已带到课堂') >= 0, '按钮仍是「已带到课堂 ✓」');
  ok(B.ev('ctxText(9000).indexOf("乙的第二段")') >= 0, '老师给的上下文里确实带着这份讲义');
  ok(B.doc.querySelector('#v-vid').classList.contains('on'), '刷新后直接停在网课页，没被踢回上课页');

  /* ============ 再刷一次，位置不会被冲掉 ============ */
  log('=== 5. 再刷新几次，位置不漂 ===');
  const ls2 = dumpLS(b2.wnd);
  const b3 = boot(store, ls2); const C = mk(b3.wnd);
  await wait(900);
  ok(C.J('VSET') === 'v2' && C.J('VLEC') === 1, '第二次刷新仍然在合集乙第 2 讲');

  /* ============ 别的页面也记，设置页不记 ============ */
  log('=== 6. 记住待在哪一页，但设置页不算 ===');
  C.ev('goView("card")');
  ok(C.J('LS.g("view")') === 'card', '切到闪卡页会记下来');
  C.ev('goView("set")');
  ok(C.J('LS.g("view")') !== 'set', '进设置页不覆盖记录');
  const ls3 = dumpLS(b3.wnd);
  const b4 = boot(store, ls3); const D = mk(b4.wnd);
  await wait(900);
  ok(D.doc.querySelector('#v-card').classList.contains('on'), '关闭设置页后刷新，回到的是闪卡页而不是设置页');

  log('=== 7. 看没看的状态不受影响 ===');
  D.ev('goView("vid")');
  const D2 = D.lecs();
  D2[0].onclick();
  await wait(40);
  D.lecs()[0].querySelector('.vst').click();
  await wait(60);
  ok(D.ev('vCur().items[0].st') === 1, '点一下状态 → 在看');
  ok(D.doc.querySelectorAll('#vlist .vlec')[0].querySelector('.vst').textContent === '在看', '课表上显示「在看」');
  D.ev('goView("lesson")');
  const ls4 = dumpLS(b4.wnd);
  const b5 = boot(store, ls4); const E = mk(b5.wnd);
  await wait(900);
  ok(E.ev('vCur().items[0].st') === 1, '刷新后「看没看」也还在（本来就存 IndexedDB）');
  ok(E.J('VLEC') === 0, '刷新后停在前一次点的那一讲');

  /* ============ 合集没了 → 上下文要跟着失效 ============ */
  log('=== 8. 合集被删掉后，不能留一个指向空气的钩子 ===');
  E.ev('goView("vid")');
  E.ev('VCTX=null;saveVPos()');                 /* 先清干净，从零开始 */
  E.ev('VSET="v2";renderVSets()');
  await wait(40);
  ok(E.ev('VCTX') === null, '起点没有上下文');
  E.ev('VLEC=1;saveVPos();renderVLec();showLec()');
  await wait(40);
  E.doc.querySelector('#vbar2 [data-a="ctx"]').click();
  await wait(40);
  ok(E.J('VCTX && VCTX.k') === 'v2#1', '先正常带上上下文');
  E.doc.querySelector('#vdel').click();
  await wait(400);
  ok(E.ev('VS.some(function(s){return s.id==="v2"})') === false, '合集乙已删除');
  ok(E.ev('VCTX') === null, '被删合集上的上下文立刻失效');
  ok(E.J('LS.g("vpos.ctx")') === '', '失效后也落盘了（刷新不会把它捡回来）');
  ok(E.J('VSET') === 'v1', '当前合集回落到合集甲');
  const ls5 = dumpLS(b5.wnd);
  const b6 = boot(store, ls5); const F = mk(b6.wnd);
  await wait(900);
  ok(F.ev('VCTX') === null, '刷新后当然也不会复活');
  ok(F.J('VSET') === 'v1', '刷新后停在合集甲');

  /* ============ 旧数据兜底 ============ */
  log('=== 9. 旧记录里没有这些键时，安静地用默认值 ===');
  const legacy = { 'gx.who': '"newton"', 'gx.vpos.set': '"不存在的合集"', 'gx.vpos.lec': '"99"' };
  const b7 = boot(store, legacy); const G = mk(b7.wnd);
  await wait(900);
  ok(b7.errs.length === 0, '没有崩' + (b7.errs.length ? ('：' + b7.errs.join(' / ')) : ''));
  ok(G.J('VSET') === 'v1', '记着的合集已经不在 → 回落到第一个');
  ok(G.J('VLEC') === 0, '第几讲越界（99）→ 回落到第 1 讲');
  ok(G.ev('VCTX') === null, '没有上下文也不会报错');

  log('');
  log(errors.length ? ('--- 失败 ' + errors.length + ' ---') : '全部通过');
  console.log(out.join('\n'));
  if (errors.length) { console.log(errors.map(e => '  ✗ ' + e).join('\n')); process.exit(1) }
})().catch(e => { console.error('崩了：', e); process.exit(1) });
