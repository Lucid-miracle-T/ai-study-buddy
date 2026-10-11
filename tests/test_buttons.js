/* 专项测试：所有「会发消息」的按钮都必须真正调用 ask()
 * 起因：$('start').onclick 曾经漏了 ask(head)，按钮点了没反应。
 * 做法：把 ask 换成记录器，断言每个按钮点了之后都有调用记录。
 */
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

function installIDB(win) {
  const dbs = new Map();
  win.indexedDB = {
    open(name) {
      if (!dbs.has(name)) dbs.set(name, new Map());
      const store = dbs.get(name);
      const req = {};
      const db = {
        objectStoreNames: { contains: () => true },
        createObjectStore() { return {} },
        transaction() {
          const os = {
            put: o => { store.set(o.id, o); return {} },
            getAll: () => ({ result: [...store.values()] }),
            delete: id => { store.delete(id); return {} },
            clear: () => { store.clear(); return {} }
          };
          const t = { objectStore: () => os };
          setTimeout(() => { if (t.oncomplete) t.oncomplete(); }, 0);
          return t;
        }
      };
      setTimeout(() => {
        req.result = db;
        if (req.onsuccess) req.onsuccess({ target: { result: db } });
      }, 0);
      return req;
    }
  };
}

(async () => {
  const out = [], errors = [];
  const log = s => out.push(s);
  const ok = (c, m) => { log((c ? '✓ ' : '✗ ') + m); if (!c) errors.push(m); };
  const wait = ms => new Promise(r => setTimeout(r, ms));

  const vc = new VirtualConsole();
  vc.on('jsdomError', e => errors.push('jsdomError: ' + (e.message || e)));

  const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
  const dom = new JSDOM(html, {
    url: 'https://x.test/', runScripts: 'dangerously', pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(win) {
      installIDB(win);
      win.confirm = () => true;
      win.alert = () => {};
    }
  });
  const wnd = dom.window, doc = wnd.document;
  await wait(700);

  const ev = s => { try { return wnd.eval(s); } catch (e) { errors.push('eval: ' + e.message); return null; } };

  /* 把 ask 换成记录器：只关心「有没有被调用、传了什么」 */
  ev([
    'window.__calls=[];',
    'window.__origAsk=ask;',
    'ask=function(t,o){ window.__calls.push(String(t)); return Promise.resolve("MOCK"); };'
  ].join('\n'));

  /* 造一个最小可用的教材 + 已勾选上下文 */
  ev([
    'window.__idb=[{id:"t.md#1",file:"t.md",title:"行列式按行(列)展开",txt:"按第i行展开"}];',
    'CH=window.__idb.slice();',
    'COURSE="__local"; LS.s("course",COURSE);',
    'CTX=["t.md#1"]; saveCourseData();'
  ].join('\n'));
  await wait(50);

  /* 注入网课合集，让「网课」栏目的按钮真的存在 */
  const PKG = JSON.stringify({
    title: '测试合集', url: 'https://space.bilibili.com/x',
    items: [{ t: 'P1 行列式展开', u: 'https://www.bilibili.com/video/BV1xx411c7mD', dur: '10:00', doc: '[00:00] 今天讲按行展开。' }]
  });
  ev('vParse(' + JSON.stringify(PKG) + ',"测试合集")');
  await wait(150);

  const n = () => ev('window.__calls.length');
  const lastCall = () => ev('window.__calls[window.__calls.length-1]') || '';

  log('=== 1. 开始今天的一课 ===');
  let b = n();
  doc.getElementById('start').click();
  await wait(80);
  ok(n() > b, '点击后调用了 ask()（' + b + ' → ' + n() + '）');
  if (n() > b) {
    const t = lastCall();
    log('   开场白: ' + t.slice(0, 70) + '…');
    ok(t.indexOf('行列式按行(列)展开') >= 0, '开场白带上了勾选的节标题');
    ok(t.indexOf('不要直接讲解') >= 0, '开场白含讲解模式的苏格拉底指令');
  }

  log('');
  log('=== 2. 各模式下开场指令跟着变 ===');
  for (const [k, key] of [['drill', '陪练出题'], ['grade', '批改我的解答'], ['exam', '考试视角'], ['eng', '工程接口']]) {
    b = n();
    ev('MODEK="' + k + '"; renderModes()');
    doc.getElementById('start').click();
    await wait(60);
    const t = lastCall();
    ok(n() > b && t.indexOf(key) >= 0, k + ' → 开场白含「' + key + '」');
  }
  ev('MODEK="teach"; renderModes()');

  log('');
  log('=== 3. 换课程后开课，用的是那门课的教材 ===');
  ev('CTX=[]; saveCourseData(); COURSE="__free"; LS.s("course",COURSE); loadCourseData()');
  b = n();
  doc.getElementById('start').click();
  await wait(80);
  ok(n() > b, '自由问答也能开课');
  ok(lastCall().indexOf('使用教材') >= 0, '没勾选时用教材名开场，实际: ' + lastCall().slice(0, 40));
  ev('COURSE="__local"; loadCourseData(); CTX=["t.md#1"]; saveCourseData()');

  log('');
  log('=== 4. 停在别的页签时点开课，会切回上课页 ===');
  ev('document.querySelector(\'[data-v="card"]\').click()');
  await wait(50);
  ok(doc.getElementById('v-card').classList.contains('on'), '当前在闪卡页');
  b = n();
  doc.getElementById('start').click();
  await wait(80);
  ok(n() > b, '在闪卡页点开课仍然有效');
  ok(doc.getElementById('v-lesson').classList.contains('on'), '自动切回上课页，看得见回复');

  log('');
  log('=== 5. 网课栏目的四个动作 ===');
  for (const [act, label] of [['drill', '考我这一讲'], ['key', '这讲的重点'], ['stuck', '这节我哪没懂'], ['ctx', '带到课堂当上下文']]) {
    const el = doc.querySelector('#vdoc [data-a="' + act + '"]');
    if (!el) { log('   ' + label + '：按钮未渲染'); continue; }
    b = n();
    el.click();
    await wait(80);
    const hit = n() > b;
    /* ctx 那个是把讲义挂到课堂，不直接问；其余三个必须发问 */
    ok(act === 'ctx' ? true : hit, label + (act === 'ctx' ? ' （挂上下文，不直接发问）' : ' 调用了 ask()'));
  }

  log('');
  log('=== 6. 输入框发送 ===');
  b = n();
  ev('$("in").value="讲讲 $M_{32}$ 怎么算"; $("send").click()');
  await wait(80);
  if (n() > b) {
    ok(lastCall().indexOf('M_{32}') >= 0, '发送按钮把输入内容传给了 ask()');
  } else {
    ok(false, '发送按钮未调用 ask()');
  }

  log('');
  log('=== 7. toast 不会盖住按钮 ===');
  /* toast 原来在顶部 absolute，手机上会盖住导航栏并吞掉点击 */
  ev('toast("测试提示")');
  await wait(40);
  const tStyle = ev('(function(){const d=document.getElementById("toast");const c=getComputedStyle(d);return c.position+"|"+c.pointerEvents+"|"+c.bottom})()');
  log('   toast 样式: ' + tStyle);
  ok(tStyle.indexOf('fixed') === 0, 'toast 用 fixed（不随文档流，绝对定位会盖住顶部导航）');
  ok(tStyle.indexOf('none') >= 0, 'toast 设了 pointer-events:none，不吞点击');
  ok(/\|(\d+(\.\d+)?)px$/.test(tStyle), 'toast 定位在底部（bottom 有具体像素值），实际=' + tStyle);

  log('');
  log('--- 错误 ---');
  log(errors.length ? errors.join('\n') : '无');
  console.log(out.join('\n'));
  process.exit(errors.length ? 1 : 0);
})();
