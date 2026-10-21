/* 教材取不到时，页面不能变成一块「点了没反应」的空地
 *
 * 用户原话：「现在教材按不动了」→ 追问后是「进了教材页，里面点不动」+「没有教材/空白」。
 *
 * 复现出来的真相：打开页面的那几分钟正撞上部署（沙盒在重启），取 book/*.md 全部失败，
 * 教材一份都没进来。左边于是只剩一句「还没有教材。点右上角导入 md。」——
 * 目录里一条可点的东西都没有，人当然觉得「点不动」；
 * 而 autoLoad 只在启动时跑一次、失败也不重试，于是它就一直空着。
 *
 * 本测试守的：
 *   1. 教材一份都没有时，空状态里得有一个能直接点的「载入全部内置教材」
 *   2. 点它就真的能把教材载进来、把列表画出来（网络已经恢复的情况）
 *   3. 首次一无所获时，启动流程自己会再试一次，不用人管
 *   4. 有教材、只是被搜索词筛空了 → 提示换关键词，不给载入按钮（那是另一回事）
 *   5. 取教材用 no-store，别被缓存住一个失败的响应
 *   6. 没接住的异常要冒成一句可见的提示，而不是静默「点了没反应」
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const HTML = () => fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')
  .replace(/<script src="https:[^"]+"><\/script>/g, '');

function makeStore(seed) {
  const st = { gxbook: new Map((seed || []).map(c => [c.id, c])) };
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

/* verdict: 'ok' | 'fail' | fn(url, nthCall) → 'ok'|'fail'   —— 只作用于 book/ 的请求 */
function boot(store, verdict, lsSeed) {
  const vc = new VirtualConsole(); const errs = [];
  vc.on('jsdomError', e => {
    const m = e.message || String(e);
    if (/Not implemented: navigation/.test(m)) return;
    errs.push('jsdomError: ' + m);
  });
  const calls = [];
  const dom = new JSDOM(HTML(), {
    url: 'https://x.test/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      store.open(win);
      win.confirm = () => true; win.alert = () => {}; win.open = () => null;
      win.URL.createObjectURL = () => 'blob:x'; win.URL.revokeObjectURL = () => {};
      win.fetch = function (u, o) {
        u = String(u); calls.push({ url: u, opts: o || null });
        /* 内置网课包一律取不到：本测试只关心教材 */
        if (/video\//.test(u)) return Promise.resolve({ ok: false, status: 404, text: async () => '' });
        const nth = calls.filter(c => /book\//.test(c.url)).length;
        const v = (typeof verdict === 'function') ? verdict(u, nth) : verdict;
        if (v === 'fail') return Promise.resolve({ ok: false, status: 404, text: async () => '' });
        const name = decodeURIComponent(u.split('/').pop());
        const base = name.replace(/\.md$/, '');
        return Promise.resolve({ ok: true, status: 200, text: async () => '# ' + base + '\n\n正文一段。\n' });
      };
      if (lsSeed) Object.keys(lsSeed).forEach(k => win.localStorage.setItem(k, lsSeed[k]));
    }
  });
  return { wnd: dom.window, errs, calls: { all: calls, book: () => calls.filter(c => /book\//.test(c.url)) } };
}

(async () => {
  const out = [], errors = [];
  const log = s => out.push(s);
  const ok = (c, m) => { log((c ? '✓ ' : '✗ ') + m); if (!c) errors.push(m); };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const mk = w => ({
    doc: w.document,
    ev: s => { try { return w.eval(s) } catch (e) { errors.push('eval: ' + e.message); return undefined } },
    J: s => JSON.parse(w.eval('JSON.stringify(' + s + ')')),
    list: () => w.document.querySelector('#blist'),
    txt: () => (w.document.querySelector('#blist').textContent || '')
  });

  /* ============ 1. 教材全取不到：空状态必须能自救 ============ */
  log('=== 1. 打开时教材一份都取不到 ===');
  const st1 = makeStore();
  const b1 = boot(st1, 'fail');
  const A = mk(b1.wnd);
  await wait(3200);                                   /* 留足「启动重试」那一轮 */
  ok(b1.errs.length === 0, '没有崩' + (b1.errs.length ? ('：' + b1.errs.join(' / ')) : ''));
  ok(A.ev('CH.length') === 0, '教材确实一份都没进来');
  A.ev('goView("book")');
  await wait(60);
  ok(!!A.doc.querySelector('#ldempty'), '空状态里有一个可以点的「载入全部内置教材」按钮');
  ok(!/点右上角导入 md/.test(A.txt()), '不再只说「点右上角导入 md」——那句话人都不知道该点哪儿');
  ok(!!A.doc.querySelector('#reload'), '顶部那排按钮也还在（两条路都能走）');
  const bookCalls1 = b1.calls.book().length;
  /* 现在不再挨个抓几十个注定 404 的分册：先 HEAD 探一册，确认没有就直接去载示例。
     但「自己再试一轮」这件事必须还在 —— 部署空档那几十秒里第一次会全失败。 */
  ok(bookCalls1 >= 2, '首次一无所获时自动重试了一轮（实际 ' + bookCalls1 + ' 次请求）');
  ok(b1.calls.book().some(c => c.opts && c.opts.method === 'HEAD'),
    '先用 HEAD 探一下这个站点到底带没带教材（探到 404 就不再挨个抓一遍）');
  ok(b1.calls.book().every(c => c.opts && c.opts.cache === 'no-store'), '取教材用的是 no-store，不会被缓存住一个失败响应');

  /* ============ 2. 点那个按钮，网络已经好了 ============ */
  log('=== 2. 网络恢复后点「载入全部内置教材」 ===');
  const st2 = makeStore();
  let healthy = false;
  const b2 = boot(st2, (u, nth) => (healthy ? 'ok' : 'fail'));
  const B = mk(b2.wnd);
  await wait(3200);
  ok(B.ev('CH.length') === 0, '先还是空的（此刻网络仍然不通）');
  healthy = true;
  B.ev('goView("book")');
  await wait(60);
  const btn = B.doc.querySelector('#ldempty');
  ok(!!btn, '按钮在');
  if (btn) {
    btn.click();                                       /* 就当作用户点下去 */
    await wait(900);
  }
  ok(B.ev('CH.length') > 0, '教材进来了（CH=' + B.ev('CH.length') + ' 节）');
  ok(b2.calls.book().length > 0, 'autoLoad 真的去取过教材文件（' + b2.calls.book().length + ' 次）');
  await wait(200);
  B.ev('renderBook()');
  await wait(60);
  ok(B.doc.querySelectorAll('#blist .cgrp').length > 0, '列表画出来了（有课程组）');
  ok(B.doc.querySelectorAll('#blist .grp').length > 0, '有分册可以点');
  ok(!B.doc.querySelector('#blist .empty'), '空状态已经让位给真正的目录');
  ok(/已载入/.test((B.doc.querySelector('#toast') || {}).textContent || ''), '给了「已载入 N 个分册」的回执');

  /* ============ 3. 首次失败、第二次成功 → 自己补上，不用人管 ============ */
  log('=== 3. 首次一无所获，第二次能取到 → 启动流程自动补上 ===');
  const st3 = makeStore();
  const t3open = Date.now() + 800;                     /* 让第一轮全败，重试那一轮全成 —— 不写死册数，PACKS 变了也不影响 */
  const b3 = boot(st3, () => (Date.now() < t3open ? 'fail' : 'ok'));
  const C = mk(b3.wnd);
  await wait(3600);
  ok(C.ev('CH.length') > 0, '没人干预，教材自己补上了（CH=' + C.ev('CH.length') + ' 节）');
  const perRound3 = C.ev('PACKS.reduce(function(n,p){return n+p.files.length},0)');
  const b3book = b3.calls.book().length;
  ok(b3book > perRound3, '确实跑了不止一轮（' + b3book + ' 次 > 一轮 ' + perRound3 + ' 册）');
  C.ev('goView("book")');
  await wait(60);
  ok(!!C.doc.querySelector('#blist .cgrp'), '教材页有内容，不是空地');

  /* ============ 4. 有教材、只是被搜索词筛空：别把人引到「载入」上去 ============ */
  log('=== 4. 有教材但被搜索词筛空 ===');
  const st4 = makeStore([{ id: '第1章_函数与极限.md#0', file: '第1章_函数与极限.md', title: '函数与极限', level: 1, txt: '正文' }]);
  const b4 = boot(st4, 'fail');
  const D = mk(b4.wnd);
  await wait(900);
  ok(D.ev('CH.length') === 1, '本来就有 1 节教材（所以不会去自动载入）');
  D.ev('goView("book")');
  await wait(60);
  D.ev('$("bq").value="绝不可能匹配的词zzz";renderBook()');
  await wait(60);
  ok(/换个关键词/.test(D.txt()), '提示换关键词');
  ok(!D.doc.querySelector('#ldempty'), '这时候不给「载入全部内置教材」——那是两码事，别把人带偏');
  D.ev('$("bq").value="";renderBook()');
  await wait(60);
  ok(!!D.doc.querySelector('#blist .grp'), '清掉关键词，目录立刻回来');

  /* ============ 5. 未捕获的异常要看得见 ============ */
  log('=== 5. 没接住的异常 → 冒成可见提示 ===');
  const st5 = makeStore();
  const b5 = boot(st5, 'fail');
  const E = mk(b5.wnd);
  await wait(900);
  E.ev('window.dispatchEvent(new ErrorEvent("error",{message:"测试异常ABC"}))');
  await wait(60);
  const t = E.doc.querySelector('#toast');
  ok(!!t, '弹出了提示条');
  ok(!!t && /测试异常ABC/.test(t.textContent), '提示条里写着是什么错了（' + (t ? t.textContent : '') + '）');

  log('');
  log(errors.length ? ('--- 失败 ' + errors.length + ' ---') : '全部通过');
  console.log(out.join('\n'));
  if (errors.length) { console.log(errors.map(e => '  ✗ ' + e).join('\n')); process.exit(1) }
})().catch(e => { console.error('崩了：', e); process.exit(1) });
