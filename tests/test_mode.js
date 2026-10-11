/* 模式层专项测试：人格（怎么说话）与模式（这一轮干什么）正交，模式进入 system prompt 且优先级高于人格 */
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
  await wait(80);
  const ev = s => { try { return w.eval(s); } catch (e) { errors.push('eval[' + s.slice(0, 40) + ']: ' + e.message); return ''; } };

  log('--- UI：上课页模式开关 ---');
  log('模式按钮', [...w.document.querySelectorAll('#mbox .pill')].map(b => b.textContent).join(' | '));
  log('人格数 / 模式数', w.document.querySelectorAll('#pbox .pill').length + ' / ' + w.document.querySelectorAll('#mbox .pill').length);
  log('默认模式', ev('MODEK'), ev('curMode().n'));

  const clickMode = n => {
    const b = [...w.document.querySelectorAll('#mbox .pill')].filter(x => x.textContent === n)[0];
    if (!b) { errors.push('找不到模式按钮 ' + n); return; }
    b.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  };
  const clickP = n => {
    const b = [...w.document.querySelectorAll('#pbox .pill')].filter(x => x.textContent === n)[0];
    if (!b) { errors.push('找不到人格按钮 ' + n); return; }
    b.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  };

  log('');
  log('--- 切到「批改我的解答」（真实点击）---');
  clickMode('批改我的解答'); await wait(20);
  log('持久化 MODEK', ev('MODEK'), ev('LS.g("mode")'));
  log('高亮按钮', [...w.document.querySelectorAll('#mbox .pill')].filter(b => b.className.indexOf('on') >= 0).map(b => b.textContent).join(','));
  log('输入框提示', w.document.querySelector('#in').placeholder.slice(0, 24));
  const sys = ev('sysMsg()');
  log('sysMsg 含批改规则', sys.indexOf('按考试阅卷标准批改') >= 0 ? '✓' : '✗');
  log('sysMsg 含硬伤类型标注', sys.indexOf('【漏步骤】') >= 0 ? '✓' : '✗');
  log('sysMsg 有优先级声明', sys.indexOf('以模式要求为准') >= 0 ? '✓' : '✗');
  log('模式段在人格之后', sys.indexOf('柯西') >= 0 && sys.indexOf('按考试阅卷标准批改') > sys.indexOf('柯西') ? '✓' : '✗');

  log('');
  log('--- 切到「陪练出题」---');
  clickMode('陪练出题'); await wait(20);
  const sys2 = ev('sysMsg()');
  log('sysMsg 含不出提示规则', sys2.indexOf('不讲解、不给答案、不给提示') >= 0 ? '✓' : '✗');
  log('不含批改规则（互相独立）', sys2.indexOf('按考试阅卷标准批改') < 0 ? '✓' : '✗');

  log('');
  log('--- 人格与模式正交 ---');
  clickMode('考试视角'); clickP('柯西'); await wait(20);
  const s1 = ev('sysMsg()');
  clickP('莱布尼茨'); await wait(10);
  const s2 = ev('sysMsg()');
  log('换人格后模式仍在', s1.indexOf('关键得分点') >= 0 && s2.indexOf('关键得分点') >= 0 ? '✓' : '✗');
  log('换人格后风格变了', s1.indexOf('柯西') >= 0 && s2.indexOf('莱布尼茨') >= 0 ? '✓' : '✗');
  log('当前人格', ev('who'), '| 当前模式', ev('MODEK'));

  log('');
  log('--- 非法值回落 ---');
  ev('MODEK="不存在"'); await wait(10);
  log('回落默认', ev('curMode().n') === '讲解' ? '✓ 讲解' : '✗ ' + ev('curMode().n'));

  log('');
  log('--- 错误 ---');
  log(errors.length ? errors.join('\n') : '无');
  console.log(out.join('\n'));
  process.exit(errors.length ? 1 : 0);
})();
