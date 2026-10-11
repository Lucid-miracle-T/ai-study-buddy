/* 课程隔离专项测试：验证「每本教材一个独立对话框 + 独立进度/勾选」 */
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8')
  .replace(/<script src="https:\/\/[^"]+"><\/script>/g, '');

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push('jsdomError: ' + (e.message || e)));
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

function installIDB(win) {
  const store = new Map();
  win.indexedDB = {
    open() {
      const req = {};
      const db = {
        objectStoreNames: { contains: () => true },
        createObjectStore() { return {} },
        transaction() {
          const os = {
            put: o => { store.set(o.id, o); return {} },
            getAll() { return { result: [...store.values()] } },
            delete: id => { store.delete(id); return {} },
            clear() { store.clear(); return {} }
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

const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/',
  virtualConsole: vc,
  beforeParse(win) { installIDB(win); win.confirm = () => true; win.alert = () => {}; }
});
const w = dom.window;
const A = '线代合编本.md', B = '高数八上.md';
const srcA = '# 第1章 行列式\n\n正文。\n\n## 第5节 行列式按行展开\n\n讲 $M_{32}$。\n';
const srcB = '# 第二章 导数与微分\n\n正文。\n\n## 第五节 函数的微分\n\n讲 $dy$。\n';

const wait = ms => new Promise(r => setTimeout(r, ms));
const out = [];
const log = (...a) => out.push(a.join(' '));

(async () => {
  await wait(60);
  const ev = s => { try { return w.eval(s); } catch (e) { errors.push('eval[' + s.slice(0, 40) + ']: ' + e.message); return ''; } };

  await Promise.all([
    w.eval('addFile(' + JSON.stringify(A) + ',' + JSON.stringify(srcA) + ')'),
    w.eval('addFile(' + JSON.stringify(B) + ',' + JSON.stringify(srcB) + ')')
  ]);
  await wait(60);

  log('--- 课程标签栏 ---');
  log('标签数(含自由问答)', w.document.querySelectorAll('#ctabs .ctab').length);
  log('标签文字          ', [...w.document.querySelectorAll('#ctabs .ctab')].map(b => b.textContent.trim()).join(' | '));

  ev('switchCourse(' + JSON.stringify(A) + ')');
  await wait(20);
  ev("MS.push({r:'user',c:'我学第5节 M32'}); saveMs()");
  ev('PR[CH.filter(function(c){return c.file===' + JSON.stringify(A) + '})[1].id]=2; saveCourseData()');
  ev('toggleCtx(CH.filter(function(c){return c.file===' + JSON.stringify(A) + '})[1].id)');
  await wait(20);
  const prA = ev('JSON.stringify(PR)'), ctxA = ev('JSON.stringify(CTX)'), msA = ev('MS.length');

  ev('switchCourse(' + JSON.stringify(B) + ')');
  await wait(20);
  ev("MS.push({r:'user',c:'我学微分 dy'}); saveMs()");
  ev('PR[CH.filter(function(c){return c.file===' + JSON.stringify(B) + '})[1].id]=1; saveCourseData()');
  await wait(20);
  const prB = ev('JSON.stringify(PR)'), ctxB = ev('JSON.stringify(CTX)'), msB = ev('MS.length');

  log('');
  log('--- 隔离检查 ---');
  log('A 进度/勾选/对话 ', prA, ctxA, msA);
  log('B 进度/勾选/对话 ', prB, ctxB, msB);
  log('B 串到 A 的勾选  ', JSON.parse(ctxB).some(x => String(x).indexOf(A) === 0) ? '是 ✗' : '否 ✓');
  const kA = Object.keys(JSON.parse(prA))[0];
  log('B 串到 A 的进度  ', JSON.parse(prB)[kA] !== undefined ? '是 ✗' : '否 ✓');

  ev('switchCourse(' + JSON.stringify(A) + ')');
  await wait(20);
  log('');
  log('--- 切回 A（关键）---');
  log('A 进度恢复       ', ev('JSON.stringify(PR)') === prA ? '✓ 完全一致' : '✗ ' + ev('JSON.stringify(PR)'));
  log('A 勾选恢复       ', ev('JSON.stringify(CTX)') === ctxA ? '✓ 完全一致' : '✗ ' + ev('JSON.stringify(CTX)'));
  log('A 对话恢复       ', ev('MS.length') === msA ? '✓ ' + msA + ' 条' : '✗ ' + ev('MS.length'));
  log('A 消息内容       ', ev('JSON.stringify(MS.map(function(m){return m.c}))'));

  ev('switchCourse(' + JSON.stringify(B) + ')');
  await wait(20);
  log('');
  log('--- 再切回 B ---');
  log('B 进度恢复       ', ev('JSON.stringify(PR)') === prB ? '✓ 完全一致' : '✗');
  log('B 对话恢复       ', ev('MS.length') === msB ? '✓ ' + msB + ' 条' : '✗');
  log('B 消息内容       ', ev('JSON.stringify(MS.map(function(m){return m.c}))'));

  log('');
  log('--- localStorage 键 ---');
  const ks = [];
  for (let i = 0; i < w.localStorage.length; i++) {
    const k = w.localStorage.key(i);
    if (k.indexOf('gx.msgs.') === 0 || k.indexOf('gx.prog.') === 0 || k.indexOf('gx.ctx.') === 0) ks.push(k);
  }
  log(ks.sort().join('\n') || '(无)');

  // 闪卡隔离
  ev('switchCourse(' + JSON.stringify(A) + ')'); await wait(20);
  ev("addCards([{q:'行列式A卡',a:'1'}])"); await wait(20);
  const cardA = ev('JSON.stringify(cardList().map(function(c){return c.q}))');
  ev('switchCourse(' + JSON.stringify(B) + ')'); await wait(20);
  const cardB = ev('JSON.stringify(cardList().map(function(c){return c.q}))');
  log('');
  log('--- 闪卡隔离 ---');
  log('A 的卡           ', cardA);
  log('B 的卡           ', cardB);
  log('B 看到 A 的卡    ', JSON.parse(cardB).indexOf('行列式A卡') >= 0 ? '✗ 串了' : '✓ 没串');
  ev('CD.push({id:"old1",q:"老卡无归属",a:"",box:0,due:0,rep:0})');
  const cardB2 = ev('JSON.stringify(cardList().map(function(c){return c.q}))');
  ev('switchCourse(' + JSON.stringify(A) + ')'); await wait(20);
  const cardA2 = ev('JSON.stringify(cardList().map(function(c){return c.q}))');
  log('通用老卡 B 可见  ', JSON.parse(cardB2).indexOf('老卡无归属') >= 0 ? '✓' : '✗');
  log('通用老卡 A 可见  ', JSON.parse(cardA2).indexOf('老卡无归属') >= 0 ? '✓' : '✗');

  // 目录树标题公式渲染（附录标题带 $ 的情况）
  const srcC = '# 附录\n\nx\n\n## (五) 含有 $\\\\sqrt{ax+b}$ 的积分\n\n内容\n';
  await w.eval('addFile("附录测试.md",' + JSON.stringify(srcC) + ')'); await wait(60);
  const blistHtml = w.document.querySelector('#blist').innerHTML;
  log('');
  log('--- 附录标题渲染 ---');
  log('标题还有裸 $ 公式', blistHtml.indexOf('$\\\\sqrt') >= 0 || blistHtml.indexOf('$\\sqrt') >= 0 ? '✗ 有' : '✓ 没有了');

  log('');
  log('--- 错误 ---');
  log(errors.length ? errors.join('\n') : '无');
  console.log(out.join('\n'));
  process.exit(0);
})();
