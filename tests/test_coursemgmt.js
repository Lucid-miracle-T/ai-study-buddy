/* 课程管理：清空记录 / 删除课程
 *
 * 背景：用户问「我怎么删除课程」。查下来是**没有这个入口**——代码里有个 removeFile()
 * 函数，但从来没接到任何按钮上；能做的只有「清空会话」（只清对话，教材/闪卡/进度都留着）
 * 和设置里的「清空全部本地数据」（所有课程一起没）。
 *
 * 用户的取舍（本次确认）：两个按钮都要，放设置页。
 *   · 清空记录 —— 只把对话、闪卡、掌握进度归零；教材和勾选的章节留着，随时能重新开课
 *   · 删除课程 —— 连教材正文一起移除，课程从课程栏消失（内置教材之后能再载入回来）
 *
 * 断言：入口存在、统计口径正确、两个按钮各删各的、删当前课程会回落、
 * 取消确认就不动数据、内置教材的提示里说明「还能载入回来」、自由问答不给删。
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
      win.__idb = s;                      /* 让测试能直接看库里有什么 */
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

function boot(preset) {
  const vc = new VirtualConsole();
  const errs = [];
  vc.on('jsdomError', e => {
    const msg = e.message || String(e);
    if (/Not implemented: navigation/.test(msg)) return;
    errs.push('jsdomError: ' + msg);
  });
  const dom = new JSDOM(HTML(), {
    url: 'https://x.test/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      installIDB(win);
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

  const b = boot();
  const wnd = b.wnd;
  const ev = s => { try { return wnd.eval(s) } catch (e) { errors.push('eval: ' + e.message); return undefined } };
  const eva = async s => {
    try { return await wnd.eval(s) } catch (e) { errors.push('eval: ' + e.message); return undefined }
  };
  await wait(700);
  const rows = () => [...wnd.document.querySelectorAll('#courselist .crs')];

  /* 造两门课，各自有教材、对话、闪卡、掌握进度、勾选 */
  await eva('addFile("线代.md","# 第一章 行列式\\n行列式讲面积\\n# 第二章 矩阵\\n矩阵讲变换")');
  await eva('addFile("C语言.md","# 第一章 类型\\n类型与转换\\n# 第二章 循环\\n循环与迭代")');
  await wait(120);
  ev('COURSE="线代.md";LS.s("course",COURSE);'
    + 'MS=[{r:"user",c:"甲"},{r:"a",c:"乙"}];saveMs();'
    + 'PR={"线代.md#1":2};CTX=["线代.md#1"];saveCourseData();'
    + 'CD=[{id:"k1",q:"问",a:"答",c:"线代.md",box:0,due:0},{id:"k2",q:"问",a:"答",c:"__free",box:0,due:0}];LS.s("cards",CD);'
    + 'LS.s("ctx.C语言.md",["C语言.md#1"]);LS.s("bkn.线代.md","测试教材");'
    + 'updateCourses();renderBook();');
  await wait(120);

  /* === 1. 入口 === */
  log('=== 1. 设置页有课程管理 ===');
  ok(!!wnd.document.getElementById('courselist'), '设置页有 #courselist 容器');
  ok(rows().length === 3, '列出全部课程：自由问答 + 两门教材课（实际 ' + rows().length + ' 行）');
  {
    const txt = rows().map(r => r.textContent);
    ok(txt.some(t => /线代/.test(t)) && txt.some(t => /C语言/.test(t)), '两门课都在列表里');
    ok(txt.filter(t => /当前/.test(t)).length === 1, '只有一门课标「当前」');
  }

  /* === 2. 统计口径 === */
  log('');
  log('=== 2. 每门课的记录统计 ===');
  {
    const row = rows().find(r => /线代/.test(r.textContent));
    const t = row ? row.textContent : '';
    ok(/教材 2 节/.test(t), '教材节数对（2 节）—— 实际 ' + JSON.stringify(t));
    ok(/对话 2 条/.test(t), '对话条数对（2 条）');
    ok(/闪卡 1 张/.test(t), '闪卡只算本课的（1 张）—— 自由问答那张不算进来');
    ok(/掌握 1 节/.test(t), '掌握进度对（1 节）');
    ok(/1 册教材/.test(t), '写清了有几册教材');
    const free = rows().find(r => /自由问答/.test(r.textContent));
    ok(free && /对话 0 条/.test(free.textContent), '自由问答单独统计（对话 0 条）');
  }

  /* === 3. 自由问答不能删 === */
  log('');
  log('=== 3. 自由问答只给清空 ===');
  {
    const free = rows().find(r => /自由问答/.test(r.textContent));
    const btns = [...free.querySelectorAll('button')].map(x => x.textContent);
    ok(btns.length === 1 && btns[0] === '清空记录', '自由问答只有一个按钮：清空记录（实际 ' + JSON.stringify(btns) + '）');
    ok(/没有教材/.test(free.textContent), '并说明原因：没有教材');
  }

  /* === 4. 清空记录：只清记录 === */
  log('');
  log('=== 4. 清空记录（教材留着） ===');
  {
    ev('clearCourse({k:"线代.md",f:["线代.md"]})');
    await wait(120);
    /* 清的是「当前课程」：记录会走正常保存路径回写成空数组/空对象（键还在、值为空），
       而不是把键删掉——标签栏角标靠「键是否存在」判断统计口径，这样更稳。 */
    ok(ev('(LS.g("msgs.线代.md",[])||[]).length') === 0, '对话归零');
    ok(ev('Object.keys(LS.g("prog.线代.md",null)||{}).length') === 0, '掌握进度归零');
    ok(ev('LS.g("cards",[]).length') === 1, '本课闪卡删了，通用那张还在');
    ok(ev('CH.length') === 4, '教材一节没动（4 节）');
    ok(ev('LS.g("ctx.线代.md",null)!==null') === true, '勾选的章节留着 —— 重新开课不用重勾');
    ok(ev('LS.g("bkn.线代.md",null)!==null') === true, '教材名也留着（那是设置，不是记录）');
    ok(ev('MS.length') === 0, '当前课程的会话已清空');
    ok(wnd.document.querySelectorAll('#mw .msg').length === 0, '聊天区也空了');
    const row = rows().find(r => /线代/.test(r.textContent));
    ok(row && /对话 0 条/.test(row.textContent), '统计跟着刷新（对话 0 条）');
    /* 清空之后还能接着用 */
    await eva('addFile("线代.md","# 第一章 行列式\\n行列式讲面积\\n# 第二章 矩阵\\n矩阵讲变换")');
    await wait(100);
    ok(ev('CH.length') === 4, '教材还在，可以重新开课');
  }

  /* === 5. 删除课程：连教材一起 === */
  log('');
  log('=== 5. 删除课程（教材一起走） ===');
  {
    const before = rows().length;
    await eva('dropCourse({k:"C语言.md",f:["C语言.md"]})');
    await wait(150);
    ok(ev('CH.length') === 2, '这门课的教材正文从 IndexedDB 移除了（剩 2 节）');
    ok(ev('LS.g("msgs.C语言.md",null)') === null, '对话记录清掉');
    ok(ev('LS.g("ctx.C语言.md",null)') === null, '勾选也清掉（课程都没了，留着没意义）');
    ok(!ev('courseList().gs.some(function(g){return g.k==="C语言.md"})'), '课程从课程列表消失');
    ok(rows().length === before - 1, '设置页也少了一行（' + before + ' → ' + rows().length + '）');
    ok(!ev('LS.g("course",null)==="C语言.md"'), '当前课程没有被误设成已删的课');
  }

  /* === 6. 删掉当前课程 → 回落到自由问答 === */
  log('');
  log('=== 6. 删掉正在上的课 ===');
  {
    ev('COURSE="线代.md";LS.s("course",COURSE);MS=[{r:"user",c:"甲"}];saveMs();loadCourseData();reloadMsgs();');
    ok(ev('COURSE') === '线代.md', '前提：当前在线上代课');
    await eva('dropCourse({k:"线代.md",f:["线代.md"]})');
    await wait(150);
    ok(ev('COURSE') === '__free', '当前课程回落到自由问答（实际 ' + ev('COURSE') + '）');
    ok(ev('MS.length') === 0, '会话换成自由问答的（空的）');
    ok(ev('CH.length') === 0, '教材都清掉了');
    ok(rows().length === 1 && /自由问答/.test(rows()[0].textContent), '只剩自由问答一行');
  }

  /* === 7. 取消确认就不动数据 === */
  log('');
  log('=== 7. 点取消什么也不发生 ===');
  {
    await eva('addFile("概率论.md","# 第一章 事件\\n事件与概率\\n# 第二章 分布\\n分布与密度")');
    await wait(120);
    const n0 = ev('CH.length');
    ev('window.confirm=function(){return false}');
    ev('clearCourse({k:"概率论.md",f:["概率论.md"]})');
    await eva('dropCourse({k:"概率论.md",f:["概率论.md"]})');
    await wait(120);
    ok(ev('CH.length') === n0, '取消后教材还在（' + n0 + ' 节）');
    ok(rows().length === 2, '课程行也没少');
  }

  /* === 8. 确认框得说清要删什么 === */
  log('');
  log('=== 8. 确认框把代价说清楚 ===');
  {
    ev('window.__cf="";window.confirm=function(m){window.__cf=m;return false}');
    ev('clearCourse({k:"概率论.md",f:["概率论.md"]})');
    const t1 = ev('window.__cf') || '';
    ok(/对话/.test(t1) && /闪卡/.test(t1) && /掌握/.test(t1), '清空记录列了要清的三样：' + JSON.stringify(t1.split('\n')[0]));
    ok(/教材和勾选/.test(t1), '并说明教材和勾选会留着');

    await eva('dropCourse({k:"概率论.md",f:["概率论.md"]})');
    const t2 = ev('window.__cf') || '';
    ok(/教材 1 册/.test(t2), '删除课程写了要删几册教材');
    ok(/不可恢复/.test(t2), '提醒不可恢复');
    ok(/导出一份/.test(t2), '提示先导出备份');

    /* 内置教材：还要说明「可以再载入回来」 */
    await eva('dropCourse({k:"__local",f:["x.md"]})');
    const t3 = ev('window.__cf') || '';
    ok(/内置教材/.test(t3) && /载入回来/.test(t3), '内置教材的提示说明还能再载入回来');
    ok(ev('CH.length') === 2, '取消后依然没动数据');
  }

  if (b.errs.length) errors.push(...b.errs);
  log('');
  if (errors.length) { console.log(out.join('\n')); console.log(''); console.log('失败 ' + errors.length + ' 项：'); errors.forEach(e => console.log('  ✗ ' + e)); process.exit(1); }
  console.log(out.join('\n'));
  console.log('');
  console.log('全部通过');
  process.exit(0);
})();
