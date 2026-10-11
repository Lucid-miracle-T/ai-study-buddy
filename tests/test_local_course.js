/* 自带分册合并测试：book/ 下 9 个高数分册应合成一门课程，而不是 9 个对话框 */
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
const wait = ms => new Promise(r => setTimeout(r, ms));
const out = [];
const log = (...a) => out.push(a.join(' '));

(async () => {
  await wait(60);
  const ev = s => { try { return w.eval(s); } catch (e) { errors.push('eval[' + s.slice(0, 40) + ']: ' + e.message); return ''; } };

  /* 模拟旧版散装记录：用户以前在第1/第2章分册名下各有对话与进度 */
  w.localStorage.setItem('gx.msgs.第1章_函数与极限.md', JSON.stringify([{ r: 'user', c: '旧版第1章的提问' }]));
  w.localStorage.setItem('gx.msgs.第2章_导数与微分.md', JSON.stringify([{ r: 'user', c: '旧版第2章的提问' }]));
  w.localStorage.setItem('gx.prog.第1章_函数与极限.md', JSON.stringify({ '第1章_函数与极限.md#1': 2 }));

  /* 载入 3 个自带分册（真实文件名） */
  await w.eval('addFile("第1章_函数与极限.md","# 第一章 函数与极限\\n\\n## 第一节 邻域\\n\\n内容\\n")');
  await w.eval('addFile("第2章_导数与微分.md","# 第二章 导数与微分\\n\\n## 第一节 导数定义\\n\\n内容\\n")');
  await w.eval('addFile("线代合编本.md","# 第1章 行列式\\n\\n## 第5节 按行展开\\n\\n讲 $M_{32}$\\n")');
  await wait(80);

  log('--- 课程标签栏（载入 2 个分册 + 1 本线代）---');
  log('标签数', w.document.querySelectorAll('#ctabs .ctab').length, '（应为 3：自由问答/高数合课/线代）');
  log('标签文字', [...w.document.querySelectorAll('#ctabs .ctab')].map(b => b.textContent.trim()).join(' | '));
  log('当前课程', ev('COURSE'));

  log('');
  log('--- 自带教材课程内部 ---');
  log('对话条数', ev('MS.length'), '（应含迁移来的 2 条旧对话）');
  log('消息内容', ev('JSON.stringify(MS.map(function(m){return m.c}))'));
  ev("MS.push({r:'user',c:'新版第1章提问'});saveMs()"); await wait(20);
  log('新提问后', ev('MS.length'), '条');

  ev('switchCourse("线代合编本.md")'); await wait(20);
  log('');
  log('--- 切到线代 ---');
  log('线代对话', ev('MS.length'), '条（应为 0，与高数不串）');

  ev('switchCourse("__local")'); await wait(20);
  log('');
  log('--- 切回高数 ---');
  log('高数对话', ev('MS.length'), '条（应为 3）');
  log('进度', ev('JSON.stringify(PR)'));
  log('标签栏当前高亮', [...w.document.querySelectorAll('#ctabs .ctab')].filter(b => b.className.indexOf('on') >= 0).map(b => b.textContent.trim()).join(','));

  log('');
  log('--- localStorage 课程键 ---');
  const ks = [];
  for (let i = 0; i < w.localStorage.length; i++) {
    const k = w.localStorage.key(i);
    if (k.indexOf('gx.msgs.') === 0 || k.indexOf('gx.prog.') === 0 || k.indexOf('gx.ctx.') === 0) ks.push(k);
  }
  log(ks.sort().join('\n'));

  log('');
  log('--- 教材名按课程隔离 ---');
  ev('switchCourse("线代合编本.md")'); await wait(20);
  const bknXian = ev('getBkn()');
  ev('setBkn("赵礼峰《线性代数与解析几何》")'); await wait(10);
  const bknSet = ev('getBkn()');
  ev('switchCourse("__local")'); await wait(20);
  const bknGao = ev('getBkn()');
  log('线代默认教材名  ', bknXian, bknXian.indexOf('同济高数') < 0 && bknXian.indexOf('线代') >= 0 ? '✓ 用文件名，不再拿高数书名' : '✗');
  log('线代设置后      ', bknSet, bknSet === '赵礼峰《线性代数与解析几何》' ? '✓' : '✗');
  log('高数课教材名    ', bknGao, bknGao.indexOf('高等数学') >= 0 ? '✓ 不受线代影响' : '✗');

  log('');
  log('--- 错误 ---');
  log(errors.length ? errors.join('\n') : '无');
  console.log(out.join('\n'));
  process.exit(errors.length ? 1 : 0);
})();
