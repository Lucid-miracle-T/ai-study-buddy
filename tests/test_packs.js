/* 专项测试：内置教材包（高数 + 线代）机制 */
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

/* IndexedDB 桩：按库名分开存 */
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
  vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

  const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
  const w = new JSDOM(html, {
    url: 'https://x.test/', runScripts: 'dangerously', pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(win) { installIDB(win); win.confirm = () => true; win.alert = () => {}; }
  });
  const wnd = w.window;

  await wait(700);
  const ev = s => { try { return wnd.eval(s); } catch (e) { errors.push('eval[' + s + ']: ' + e.message); return null; } };
  const doc = wnd.document;

  // 屏蔽 fetch，避免真的去下载；教材数据改由测试自己往 IDB 塞
  wnd.fetch = () => Promise.reject(new Error('no net'));
  ev('window.__idb=[]');
  ev('IDB.put=async function(o){ window.__idb.push(o); return o }');
  ev('IDB.del=async function(id){ window.__idb=window.__idb.filter(function(x){return x.id!==id}) }');
  ev('IDB.all=async function(){ return window.__idb.slice() }');
  ev('IDB.clear=async function(){ window.__idb=[] }');
  const idb = () => ev('window.__idb');

  log('=== 1. 包定义 ===');
  const packs = ev('PACKS.map(p=>({key:p.key,name:p.name,dir:p.dir,n:p.files.length}))');
  log(JSON.stringify(packs));
  ok(packs.length === 2, '两个内置包');
  ok(packs[0].name.indexOf('高等数学') >= 0, '高数包名正确');
  ok(packs[1].name.indexOf('线性代数') >= 0, '线代包名正确');
  ok(ev('packOf("第1章 行列式.md")') && ev('packOf("第1章 行列式.md").key') === '__local2', '线代分册归属正确包');
  ok(ev('packOf("第1章_函数与极限.md").key') === '__local', '高数分册归属正确包');
  ok(ev('packOf("C语言.md")') === null, '外部教材不属于任何包');

  log('');
  log('=== 2. 课程标签栏 ===');
  // 模拟：两包全部载入
  ev(`
    PACKS.forEach(p=>p.files.forEach(f=>window.__idb.push({id:f+'#1',file:f,title:'测试节',txt:'内容'})));
    CH=window.__idb.slice(); updateCourses();
  `);
  await wait(50);
  const tabs = [...doc.querySelectorAll('#ctabs .ctab')].map(b => b.textContent);
  log('标签: ' + JSON.stringify(tabs));
  ok(tabs.length === 3, '标签数 3（自由问答 + 两门内置课），实际 ' + tabs.length);
  ok(tabs.some(t => t.indexOf('线性代数与解析几何') >= 0), '线代作为一个标签出现');
  ok(tabs.some(t => t.indexOf('高等数学') >= 0), '高数作为一个标签出现');
  ok(!tabs.some(t => t.indexOf('行列式.md') >= 0), '没有按分册拆出标签');

  log('');
  log('=== 3. 两门课记录互相隔离 ===');
  ev('switchCourse("__local2")');
  await wait(30);
  ev('addMsg("me","线代提问"); MS.push({c:"me",t:"线代提问"}); saveMs()');
  ev('switchCourse("__local")');
  await wait(30);
  const gCount = ev('(function(){const m=LS.g("msgs.__local",[])||[];return m.length})()');
  const lCount = ev('(function(){const m=LS.g("msgs.__local2",[])||[];return m.length})()');
  log('高数对话数 ' + gCount + ' / 线代对话数 ' + lCount);
  ok(gCount === 0 && lCount === 1, '对话按包隔离');
  const gP = ev('JSON.stringify(LS.g("prog.__local",{}))');
  const lP = ev('JSON.stringify(LS.g("prog.__local2",{}))');
  ok(gP !== lP || gP === '{}', '进度键各自独立: 高数=' + gP + ' 线代=' + lP);
  ok(ev('cname("__local2")') === '线性代数与解析几何', '线代课程名可读');

  log('');
  log('=== 4. 切走再切回，状态恢复 ===');
  ev('switchCourse("__local2")');
  await wait(30);
  ev('CTX=["第1章 行列式.md#1"]; saveCourseData()');
  ev('switchCourse("__free")');
  await wait(30);
  ok(ev('CTX.length') === 0, '自由问答的勾选是空的，不串线代');
  ev('switchCourse("__local2")');
  await wait(30);
  ok(ev('CTX.join(",")') === '第1章 行列式.md#1', '上下文勾选恢复，实际=' + JSON.stringify(ev('CTX')));
  ok(ev('MS.length') === 1, '对话恢复');

  log('');
  log('=== 5. 分册被删 → 回落到所属包 ===');
  ev('switchCourse("__local2")');
  await wait(20);
  ev("window.__idb=window.__idb.filter(function(x){return x.file!=='第1章 行列式.md'})");
  ev('CH=window.__idb.slice(); updateCourses()');
  await wait(30);
  log('当前课程: ' + ev('COURSE'));
  ok(ev('COURSE') === '__local2', '删掉线代一个分册后仍留在线代这门课');
  ok(ev('(LS.g("msgs.__local2",[])||[]).length') === 1, '记录没丢');

  log('');
  log('=== 6. 全包被删 → 回落自由问答，记录保住 ===');
  ev('switchCourse("__local")');
  await wait(20);
  ev('window.__idb=window.__idb.filter(function(x){return !packOf(x.file)})');
  ev('CH=window.__idb.slice(); updateCourses()');
  await wait(30);
  log('当前课程: ' + ev('COURSE'));
  ok(ev('COURSE') === '__free', '两门内置课都删光后回落自由问答');
  ok(ev('(LS.g("msgs.__local2",[])||[]).length') === 1, '线代记录仍在存储里，没被清');

  log('');
  log('--- 错误 ---');
  log(errors.length ? errors.join('\n') : '无');
  console.log(out.join('\n'));
  process.exit(errors.length ? 1 : 0);
})();
