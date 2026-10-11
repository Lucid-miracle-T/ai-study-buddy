/* 网课栏目专项测试：导入网课包 → 课表/状态/讲义时间戳/考我/带到课堂/合集分析 */
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8')
  .replace(/<script src="https:\/\/[^"]+"><\/script>/g, '');

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push('jsdomError: ' + (e.message || e)));
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

/* 按库名分开的 IndexedDB 桩：gxbook / gxvid 各一个 store */
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

const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/',
  virtualConsole: vc,
  beforeParse(win) {
    installIDB(win);
    win.confirm = () => true; win.alert = () => {};
    win.fetch = () => Promise.reject(new Error('测试环境无网络，预期内'));
    win.open = () => null;
  }
});
const w = dom.window;
const wait = ms => new Promise(r => setTimeout(r, ms));
const out = [];
const log = (...a) => out.push(a.join(' '));

const PKG = {
  title: '宋浩老师 高等数学（上）',
  url: 'https://space.bilibili.com/xxx',
  items: [
    { t: 'P1 数列的极限', u: 'https://www.bilibili.com/video/BV1xx411c7mD', dur: '18:20',
      doc: '[00:00] 今天我们讲数列的极限。\n[02:15] 先说 $\\varepsilon$-N 定义：对任意给定的 $\\varepsilon>0$。\n[07:40] 看一个例子 $a_n=\\frac{1}{n}$。' },
    { t: 'P2 函数的极限', u: 'https://www.bilibili.com/video/BV1yy411c7mE', dur: '22:05',
      doc: '[00:00] 回顾上节课。\n[05:30] 函数在一点极限的定义。' },
    { t: 'P3 无穷小与无穷大', u: '', dur: '', doc: '' }
  ]
};

(async () => {
  await wait(80);
  const ev = s => { try { return w.eval(s); } catch (e) { errors.push('eval[' + s.slice(0, 40) + ']: ' + e.message); return ''; } };

  log('--- 导入网课包 ---');
  ev('vParse(' + JSON.stringify(JSON.stringify(PKG)) + ',"宋浩高数")');
  await wait(80);
  log('合集下拉', w.document.querySelectorAll('#vset option').length, '个 | 状态栏', w.document.querySelector('#vstat').textContent);
  log('课表行数', w.document.querySelectorAll('#vlist .vlec').length, '（应 3）');
  log('第 3 讲标注', w.document.querySelectorAll('#vlist .vlec')[2].textContent.indexOf('无讲义') >= 0 ? '✓ 无讲义' : '✗');

  log('');
  log('--- 点第 1 讲 ---');
  w.document.querySelectorAll('#vlist .vlec')[0].dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await wait(30);
  const docHtml = w.document.querySelector('#vdoc').innerHTML;
  log('标题', w.document.querySelector('#vdoc h3').textContent);
  log('时间戳段数', (docHtml.match(/\[\d+:\d+\]/g) || []).length, '（应 3）');
  log('B站跳转 t= 秒', docHtml.indexOf('t=135') >= 0 ? '✓ 02:15 → t=135' : '✗ ' + (docHtml.match(/t=\d+/) || [''])[0]);
  log('公式走了渲染器', docHtml.indexOf('\\varepsilon') >= 0 ? '✗ 还是裸 LaTeX' : '✓ 已交给渲染器');

  log('');
  log('--- 状态切换 ---');
  const st = w.document.querySelectorAll('#vlist .vst')[0];
  st.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); await wait(30);
  log('点一次', w.document.querySelectorAll('#vlist .vst')[0].textContent);
  w.document.querySelectorAll('#vlist .vst')[0].dispatchEvent(new w.MouseEvent('click', { bubbles: true })); await wait(30);
  log('点两次', w.document.querySelectorAll('#vlist .vst')[0].textContent);
  log('已持久化', ev('JSON.stringify((vCur().items[0]||{}).st)'), '（应 2）');

  log('');
  log('--- 三个动作 ---');
  w.document.querySelector('#vdoc [data-a="drill"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  await wait(60);
  log('切到上课页', w.document.querySelector('#v-lesson').className.indexOf('on') >= 0 ? '✓' : '✗');
  log('模式自动切', ev('MODEK'), ev('curMode().n'), ev('MODEK') === 'drill' ? '✓' : '✗');

  w.document.querySelector('[data-v="vid"]').click(); await wait(30);
  w.document.querySelectorAll('#vlist .vlec')[0].dispatchEvent(new w.MouseEvent('click', { bubbles: true })); await wait(30);
  w.document.querySelector('#vdoc [data-a="ctx"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true })); await wait(30);
  log('带到课堂', ev('VCTX?VCTX.t:"(空)"'));
  log('ctxText 含网课讲义', ev('ctxText()').indexOf('网课讲义') >= 0 ? '✓' : '✗');
  w.document.querySelector('#vdoc [data-a="ctx"]').dispatchEvent(new w.MouseEvent('click', { bubbles: true })); await wait(30);
  log('再点一次取消', ev('VCTX?"还在":"已移除"'), ev('ctxText()').indexOf('网课讲义') < 0 ? '✓' : '✗');

  log('');
  log('--- 合集分析（无网络也应不崩）---');
  const before = errors.length;
  ev('vAnalyze()'); await wait(120);
  log('切换视图', w.document.querySelector('#v-lesson').className.indexOf('on') >= 0 ? '✓ 回到上课' : '✗');
  log('新增错误数', errors.length - before, errors.length - before === 0 ? '✓' : '（详见下方）');

  log('');
  log('--- md 兜底解析 ---');
  const mdSrc = '# 某网课合集\n\n## 第1讲 极限\n\nhttps://www.bilibili.com/video/BV1aaa\n\n[00:10] 内容一\n\n## 第2讲 连续\n\n[00:05] 内容二\n';
  ev('vParse(' + JSON.stringify(mdSrc) + ',"md兜底")');
  await wait(80);
  log('合集数', w.document.querySelectorAll('#vset option').length, '（应 2）');
  log('选中合集', w.document.querySelector('#vset').value === ev('VSET') ? '✓' : '✗');
  log('分讲数', ev('vCur()?(vCur().items||[]).length:0'), '（应 2）');
  log('md 里抓到链接', ev('(vCur().items[0]||{}).u') .indexOf('BV1aaa') >= 0 ? '✓' : '✗');

  log('');
  log('--- 错误 ---');
  log(errors.length ? errors.join('\n') : '无');
  console.log(out.join('\n'));
  process.exit(0);
})();
