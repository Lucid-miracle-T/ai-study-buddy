/* 每一节单独选「带进课堂的章节」
 *
 * 背景：同一门课里，第 1 节讲第一章节、第 2 节讲第二章节，是常态；
 *   原先章节勾选（CTX）是「整门课一份」，在第 2 节勾了新章节，
 *   第 1 节的上下文也跟着变了 —— 用户要求「每一节学的内容能独立选，
 *   不同节能分开，互不影响」。
 *
 * 做法：和 s.who（每节导师）完全同一套思路，把勾选存到节对象上（s.ch）。
 *   - 节上有 ch 就用节的；没有（升级前的老数据）回落到课程级老勾选 CTX0
 *   - 勾 / 取消只写进当前这一节（setSessCtx）
 *   - 切节、切课、新建、删除后都按节取（applySessCtx），
 *     顶栏 chips、教材页勾选、发给模型的教材片段（ctxText）一起跟上
 *   - 新开一节默认沿用当前这几章（多数时候想接着学）
 *
 * 断言：
 *   1. 老节（无 ch）回落课程级勾选 —— 升级不改行为
 *   2. 在某节勾章节，只写进这一节
 *   3. 切到另一节，顶栏 chips 跟着换成那一节的
 *   4. 切到另一节，教材页的 checkbox 也跟着换
 *   5. 新开一节继承当前勾选
 *   6. 发给模型的教材片段只含当前节的章节
 *   7. ch 存在 sess 键里 —— 导出备份会把「每节带了哪几章」一起带走
 *   8. 删掉当前节后勾选归位
 *   9. 换课程时按节取，两门课互不影响
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const SRC = () => fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const HTML = () => SRC().replace(/<script src="https:[^"]+"><\/script>/g, '');

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

function boot() {
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
      win.confirm = () => true; win.alert = () => {};
      win.open = () => null;
      win.fetch = () => Promise.reject(new Error('测试不联网'));
      win.URL.createObjectURL = () => 'blob:x'; win.URL.revokeObjectURL = () => {};
    }
  });
  return { wnd: dom.window, errs };
}

(async () => {
  const out = [], errors = [];
  const log = s => out.push(s);
  const ok = (c, m) => { log((c ? '✓ ' : '✗ ') + m); if (!c) errors.push(m); };
  const wait = ms => new Promise(r => setTimeout(r, ms));

  const { wnd, errs } = boot();
  const doc = wnd.document;
  await wait(700);
  const ev = s => { try { return wnd.eval(s); } catch (e) { errors.push('eval: ' + e.message); return undefined; } };
  const chips = () => Array.from(doc.querySelectorAll('#ctxchips .chip')).map(c => c.textContent.replace('×', ''));
  const boxes = () => Array.from(doc.querySelectorAll('.item')).map(d => {
    const t = d.querySelector('.t'); const ck = d.querySelector('.ck');
    return [t ? t.textContent.trim() : '', !!(ck && ck.checked)];
  });

  /* 三章教材，分在两本书里；两个课程各有一节 */
  ev('CH=[{id:"c.md#1",file:"c.md",level:2,title:"行列式",txt:"甲"},{id:"c.md#2",file:"c.md",level:2,title:"矩阵",txt:"乙"},{id:"e.md#1",file:"e.md",level:2,title:"导数",txt:"丙"}];');
  ev('COURSE="c.md";LS.s("course","c.md");');
  ev('SESS=[{id:"sA",t:1,title:"极限"},{id:"sB",t:2,title:"证明"}];CURS="sA";saveSess();');
  ev('MS=[{r:"user",c:"开始",s:"sA"},{r:"a",c:"好",s:"sA"},{r:"user",c:"继续",s:"sB"},{r:"a",c:"接着",s:"sB"}];saveMs();');
  /* 升级前的状态：整门课共用一份勾选，节上没有 ch */
  ev('CTX0=["c.md#1"];CTX=["c.md#1"];LS.s(ctxKey(),CTX0);saveSess();');
  ev('BOPEN={"c.md":true,"e.md":true};');
  ev('applySessCtx();renderBook();');
  await wait(60);

  ok(ev('sessCtx("sA")') && ev('sessCtx("sA").join()') === 'c.md#1',
    '1. 老节（没有 ch 字段）回落课程级勾选，升级不改行为');
  ok(chips().length === 1 && chips()[0].indexOf('行列式') >= 0, '1b. 顶栏 chips 画出这一章');

  /* ---- 在第 1 节勾上「矩阵」 ---- */
  ev('toggleCtx("c.md#2")');
  await wait(40);
  ok(ev('JSON.stringify(sessOf("sA").ch)') === '["c.md#1","c.md#2"]', '2. 勾选写进了第 1 节（sA.ch 两章）');
  ok(ev('CTX0.join()') === 'c.md#1', '2b. 课程级老勾选没被改写（CTX0 仍是原来那章）');
  ok(ev('sessOf("sB").ch') === undefined, '2c. 第 2 节没有被牵连（仍然没有自己的 ch）');

  /* ---- 翻到第 2 节 ---- */
  ev('switchSess("sB")');
  await wait(60);
  ok(ev('CTX.join()') === 'c.md#1', '3. 切到第 2 节，CTX 换回那一节的（只带了行列式）');
  ok(chips().length === 1, '3b. 顶栏 chips 跟着变（不是第 1 节那两章）');
  const b2 = boxes();
  ok(b2.filter(x => x[0].indexOf('矩阵') >= 0 && x[1]).length === 0, '4. 教材页「矩阵」在第 2 节里是未勾的');
  ok(b2.filter(x => x[0].indexOf('行列式') >= 0 && x[1]).length === 1, '4b. 教材页「行列式」在第 2 节里是勾上的');

  /* ---- 回第 1 节看它自己那两章 ---- */
  ev('switchSess("sA")');
  await wait(60);
  ok(ev('CTX.join()') === 'c.md#1,c.md#2', '5. 回第 1 节，两章都还在');
  ok(boxes().filter(x => x[1]).length === 2, '5b. 教材页勾选回到两章');

  /* ---- 在第 1 节勾上「导数」，再翻第 2 节，不该串过去 ---- */
  ev('toggleCtx("e.md#1")');
  ev('switchSess("sB")');
  await wait(60);
  ok(ev('CTX.indexOf("e.md#1")') === -1, '6. 别处勾的章节不会串到这一节');
  ok(ev('ctxText().indexOf("矩阵")') === -1 && ev('ctxText().indexOf("导数")') === -1,
    '6b. 发给模型的教材片段只含当前节的章节');

  /* ---- 新开一节：继承当前 ----
     newSess 要求当前节已经有对话，否则直接复用（sB 有两条） */
  ev('switchSess("sB")');
  const nid = ev('newSess(true)');
  await wait(60);
  ok(nid && nid !== 'sB', '7. 新开了一节');
  ok(ev('JSON.stringify(sessOf("' + nid + '").ch)') === '["c.md#1"]', '7b. 新节继承当前的勾选（行列式）');

  /* ---- 备份：ch 落在 sess 键里 ---- */
  const raw = ev('LS.g("sess.c.md",[])');
  const withCh = (raw || []).filter(s => Array.isArray(s.ch)).length;
  ok(withCh >= 2, '8. ch 存在 sess 键里（' + withCh + ' 节），导出备份会一起带走');

  /* ---- 删掉当前节，勾选归位 ---- */
  ev('delSess("' + nid + '")');
  await wait(60);
  ok(ev('CTX.join()') === 'c.md#1', '9. 删掉当前节后，CTX 归位到剩下的那一节');

  /* ---- 换课程：另一本书有自己的节，互不影响 ---- */
  ev('LS.s("sess.e.md",[{id:"eA",t:3,title:"导数课",ch:["e.md#1"]}]);');
  ev('LS.s("cur.e.md","eA");');
  ev('switchCourse("e.md")');
  await wait(80);
  ok(ev('CURS') === 'eA' && ev('CTX.join()') === 'e.md#1', '10. 换课程按节取，拿到那门课那一节的勾选');
  ev('switchCourse("c.md")');
  await wait(80);
  ok(ev('CTX.join()') === 'c.md#1', '10b. 切回来还是本课那一节自己的，没被别的课覆盖');

  /* ---- 界面要说得清「勾给哪一节」：教材页提示 + 节条 title ---- */
  const bs = () => String((doc.getElementById('bsess') || {}).textContent || '');
  ok(/第 2 节/.test(bs()), '11. 教材页标出勾选落在哪一节，实际：' + bs());
  ev('switchSess("sA")');
  await wait(50);
  ok(/第 1 节/.test(bs()), '11b. 切节后这行提示跟着换，实际：' + bs());
  const tt = (doc.querySelector('.stab[data-s="sA"]') || {}).title || '';
  ok(/带 3 章/.test(tt), '11c. 节条提示里写明这一节带了几章，实际：' + tt.replace(/\n/g, ' / '));

  if (errs.length) { log('--- 页面报错 ---'); errs.forEach(e => log(e)); }
  console.log(out.join('\n'));
  if (errs.length || errors.length) {
    console.log('\n--- 错误 ---');
    (errors.length ? errors : errs).forEach(e => console.log('✗ ' + e));
    process.exit(1);
  }
  console.log('\n全部通过');
})();
