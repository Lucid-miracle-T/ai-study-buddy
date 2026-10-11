/* 教材目录树测试：课程 → 分册 → 章节 两级折叠。
 * 起因：原来所有教材的分册（高数 9 + 线代 8）全部展开平铺在一列，
 *       找一节要滚很久。现在课程层默认展开、分册层默认只开正在读的那本，
 *       点标题可折叠，搜索时强制全展开。
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

(async () => {
  const out = [], errors = [];
  const log = s => out.push(s);
  const ok = (c, m) => { log((c ? '✓ ' : '✗ ') + m); if (!c) errors.push(m); };
  const wait = ms => new Promise(r => setTimeout(r, ms));

  const vc = new VirtualConsole();
  vc.on('jsdomError', e => {
    const m = e.message || String(e);
    if (/Not implemented: navigation/.test(m)) return;
    errors.push('jsdomError: ' + m);
  });

  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')
    .replace(/<script src="https:[^"]+"><\/script>/g, '');
  const dom = new JSDOM(html, {
    url: 'https://x.test/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      installIDB(win); win.confirm = () => true; win.alert = () => {};
      win.fetch = () => Promise.reject(new Error('no net'));
      win.URL.createObjectURL = () => 'blob:x'; win.URL.revokeObjectURL = () => {};
    }
  });
  const wnd = dom.window, doc = wnd.document;
  await wait(600);
  const ev = s => { try { return wnd.eval(s); } catch (e) { errors.push('eval: ' + e.message); return undefined; } };

  /* 造数据：高数 3 个分册 + 线代 2 个分册，每册 2 节 */
  const GAO = ['第1章_函数与极限.md', '第2章_导数与微分.md', '第3章_微分中值定理与导数的应用.md'];
  const XIAN = ['第1章 行列式.md', '第2章 矩阵及其运算.md'];
  const ch = [];
  GAO.concat(XIAN).forEach(f => {
    ch.push({ id: f + '#0', file: f, title: '第一节 概念', level: 1, txt: 'aaa' });
    ch.push({ id: f + '#1', file: f, title: '第二节 例题', level: 2, txt: 'bbb' });
  });

  const setCourse = c => ev('COURSE="' + c + '"; LS.s("course",COURSE); curCh=null; window.__t=0; renderBook();');
  ev('CH=' + JSON.stringify(ch) + ';');

  const cnt = sel => doc.querySelectorAll(sel).length;

  /* === 1. 两级结构 === */
  log('=== 1. 课程 → 分册 两级 ===');
  setCourse('__local');
  ok(cnt('#blist .cgrp') === 2, '两门课各一个课程分组（实际 ' + cnt('#blist .cgrp') + '）');
  {
    const titles = [...doc.querySelectorAll('#blist .cgrp>h3')].map(h => h.textContent.replace(/\d+\/\d+ 掌握|\d+ 节/g, '').trim());
    log('   课程标题: ' + JSON.stringify(titles));
    ok(titles[0].indexOf('高等数学') >= 0, '第一组是高等数学');
    ok(titles[1].indexOf('线性代数') >= 0, '第二组是线性代数');
  }
  ok(cnt('#blist .cgrp.open') === 2, '课程层默认展开（' + cnt('#blist .cgrp.open') + '/2）');
  ok(cnt('#blist .grp') === 5, '两门课共 5 本分册（实际 ' + cnt('#blist .grp') + '）');

  /* === 2. 分册默认折叠（没在读）=== */
  log('');
  log('=== 2. 分册默认折叠，章节不铺满 ===');
  ok(cnt('#blist .grp.open') === 0, '没在读时没有分册默认展开（实际 ' + cnt('#blist .grp.open') + '）');
  ok(cnt('#blist .item') === 0, '折叠状态下不渲染章节项（实际 ' + cnt('#blist .item') + '）');

  /* === 3. 点分册标题展开 === */
  log('');
  log('=== 3. 点分册标题展开 / 收起 ===');
  {
    const h = doc.querySelectorAll('#blist .grp>h3')[0];
    log('   点的是: ' + h.textContent.trim());
    h.click();
    await wait(30);
    ok(cnt('#blist .grp.open') === 1, '展开后 1 本分册打开');
    ok(cnt('#blist .item') === 2, '展开的分册里出现 2 节（实际 ' + cnt('#blist .item') + '）');
    /* 再点一次收起 */
    const h2 = doc.querySelectorAll('#blist .grp>h3')[0];
    h2.click();
    await wait(30);
    ok(cnt('#blist .grp.open') === 0, '再点一次收起');
    ok(cnt('#blist .item') === 0, '收起后章节消失');
  }

  /* === 4. 折叠状态在重渲染后保持 === */
  log('');
  log('=== 4. 折叠状态可记忆 ===');
  {
    doc.querySelectorAll('#blist .grp>h3')[0].click();
    await wait(30);
    ev('renderBook()');
    await wait(30);
    ok(cnt('#blist .grp.open') === 1, '重渲染后仍保持展开（BOPEN 记住了）');
    ev('BOPEN={}; COPEN={}; renderBook();');
    await wait(20);
  }

  /* === 5. 折叠整门课 === */
  log('');
  log('=== 5. 点课程标题折叠整门课 ===');
  {
    doc.querySelectorAll('#blist .cgrp>h3')[0].click();
    await wait(30);
    ok(cnt('#blist .cgrp.open') === 1, '折叠后只剩 1 个课程展开');
    ok(cnt('#blist .grp') === 2, '折叠的课里分册也不渲染（只剩线代的 2 本，实际 ' + cnt('#blist .grp') + '）');
    doc.querySelectorAll('#blist .cgrp>h3')[0].click();
    await wait(30);
    ok(cnt('#blist .grp') === 5, '再点展开恢复 5 本');
  }

  /* === 6. 正在读的那本默认展开 === */
  log('');
  log('=== 6. 正在读的分册默认展开 ===');
  {
    ev('curCh="第2章_导数与微分.md#1"; BOPEN={}; renderBook();');
    await wait(30);
    ok(cnt('#blist .grp.open') === 1, '只有正在读的那本展开');
    const on = doc.querySelector('#blist .grp.open>h3').textContent;
    ok(on.indexOf('第2章_导数与微分') >= 0, '展开的是第2章_导数与微分（实际 ' + on + '）');
    const sel = doc.querySelector('#blist .item.on');
    ok(!!sel, '该节在列表里高亮为当前阅读');
  }

  /* === 7. 搜索时强制全展开 === */
  log('');
  log('=== 7. 搜索时强制全展开 ===');
  {
    ev('curCh=null; BOPEN={}; $("bq").value="例题"; renderBook();');
    await wait(30);
    ok(cnt('#blist .grp.open') === 5, '搜到 5 本分册全展开（实际 ' + cnt('#blist .grp.open') + '）');
    ok(cnt('#blist .item') === 5, '每本里各 1 条匹配（实际 ' + cnt('#blist .item') + '）');
    ev('$("bq").value="不存在的东西"; renderBook();');
    await wait(30);
    ok(cnt('#blist .item') === 0 && cnt('#blist .grp') === 0, '搜不到时给出空状态');
    ev('$("bq").value=""; renderBook();');
  }

  log('');
  log('--- 错误 ---');
  log(errors.length ? errors.join('\n') : '无');
  console.log(out.join('\n'));
  process.exit(errors.length ? 1 : 0);
})();
