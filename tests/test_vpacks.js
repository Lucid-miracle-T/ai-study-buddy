/* 内置网课包测试：随站点分发的三个包应自动入库，换设备也在；状态要能持久化；不能误删 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const VIDEO = path.join(ROOT, 'video');

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
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

/* 把磁盘上的 video/*.json 当成站点资源喂给 fetch */
let fetchCount = 0;
function installFetch(win) {
  win.fetch = u => {
    const s = String(u);
    const rel = decodeURIComponent(s.slice(s.indexOf('video/') + 6));
    const p = path.join(VIDEO, rel);
    fetchCount++;
    if (!fs.existsSync(p)) return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    return Promise.resolve({ ok: true, status: 200, json: async () => JSON.parse(fs.readFileSync(p, 'utf8')) });
  };
}

const dom = new JSDOM(html, {
  runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/',
  virtualConsole: vc,
  beforeParse(win) {
    installIDB(win);
    installFetch(win);
    win.confirm = () => true; win.alert = () => {};
    win.open = () => null;
  }
});
const w = dom.window;
const wait = ms => new Promise(r => setTimeout(r, ms));
const out = [];
const log = (...a) => out.push(a.join(' '));
const ok = (c, m) => { log((c ? '✓ ' : '✗ ') + m); if (!c) errors.push(m); };

(async () => {
  await wait(600);
  const ev = s => { try { return w.eval(s); } catch (e) { errors.push('eval[' + s.slice(0, 40) + ']: ' + e.message); return ''; } };
  const doc = w.document;

  log('=== 1. 内置包定义 ===');
  const bi = ev('VBUILTIN.map(b=>({id:b.id,name:b.name,f:b.f}))');
  log(JSON.stringify(bi, null, 0));
  ok(bi.length === 3, '三个内置网课包');
  ok(new Set(bi.map(b => b.id)).size === 3, 'id 互不相同');
  ok(bi.every(b => fs.existsSync(path.join(VIDEO, b.f))), '三个 json 都在 video/ 里');
  ok(bi.some(b => b.name.indexOf('C语言') >= 0 && b.name.indexOf('翁恺') >= 0), '包含翁恺 C 语言');

  log('');
  log('=== 2. 首次打开自动入库 ===');
  const vs = ev('VS.map(s=>({id:s.id,title:s.title,n:(s.items||[]).length,builtin:!!s.builtin,ver:s.ver}))');
  log(JSON.stringify(vs, null, 0));
  ok(vs.length === 3, '自动出现 3 个合集，实际 ' + vs.length + ' → ' + JSON.stringify(vs.map(s => s.id)));
  ok(vs.every(s => s.builtin), '都标记为内置');
  const nOf = id => (vs.find(s => s.id === id) || {}).n;
  ok(nOf('__v_c') === 132, 'C语言 132 讲，实际 ' + nOf('__v_c'));
  ok(nOf('__v_stm1') === 50, 'STM32 入门 50 讲，实际 ' + nOf('__v_stm1'));
  ok(nOf('__v_stm2') === 48, 'STM32 HAL 重制 48 讲，实际 ' + nOf('__v_stm2'));
  ok(doc.querySelectorAll('#vset option').length === 3, '合集下拉 3 项');
  log('状态栏: ' + doc.querySelector('#vstat').textContent);
  ok(doc.querySelector('#vstat').textContent.indexOf('230 讲') >= 0, '合计 132+50+48=230 讲');
  ok(doc.querySelectorAll('#vlist .vlec').length === 132, '课表渲染出 132 行');
  ok(doc.querySelector('#vlist .vlec').textContent.indexOf('1.1') >= 0, '第一讲标题正常');

  log('');
  log('=== 3. 换设备：第二次打开不再下载，状态还在 ===');
  const before = fetchCount;
  ev('LS.s("probe",1)');                       // 制造一次写入，确保下面读的是同一份存储
  // 给 C语言第一讲打卡「已看」=2
  const st = doc.querySelectorAll('#vlist .vst')[0];
  st.dispatchEvent(new w.MouseEvent('click', { bubbles: true })); await wait(20);
  doc.querySelectorAll('#vlist .vst')[0].dispatchEvent(new w.MouseEvent('click', { bubbles: true })); await wait(20);
  ok(ev('(vCur().items[0]||{}).st') === 2, '第一讲状态存成 2，实际 ' + ev('(vCur().items[0]||{}).st'));
  await ev('vLoad()'); await wait(120);
  ok(fetchCount === before, '版本没变就不重新下载（新增请求 ' + (fetchCount - before) + ' 次）');
  ok(ev('(vCur().items[0]||{}).st') === 2, '重新载入后「已看」状态保留');

  log('');
  log('=== 4. 网站改了包内容（版本号过期）→ 重新拉取，但进度搬过去 ===');
  const before2 = fetchCount;
  // VPKGVER 是 const，改不了；改成把库里记录的版本号写旧，效果一样
  await ev('(async function(){const all=await VDB.all();for(const s of all){s.ver="0";await VDB.put(s)}})()');
  await wait(60);
  await ev('vLoad()'); await wait(300);
  ok(fetchCount > before2, '版本过期就重新拉取（新增 ' + (fetchCount - before2) + ' 次）');
  ok(ev('(vCur().items[0]||{}).st') === 2, '重新拉取后「已看」状态没丢（按讲标题搬过去）');
  ok(ev('(vCur().ver)') === ev('VPKGVER'), '版本号刷新成当前值，实际 ' + ev('(vCur().ver)'));

  log('');
  log('=== 5. 内置包不能被删 ===');
  const n1 = ev('VS.length');
  doc.querySelector('#vdel').dispatchEvent(new w.MouseEvent('click', { bubbles: true })); await wait(60);
  ok(ev('VS.length') === n1, '点了删除，合集还在（' + ev('VS.length') + '）');

  log('');
  log('=== 6. 自己导入的包和内置包并存，且可删 ===');
  ev('vParse(' + JSON.stringify(JSON.stringify({
    title: '我的自定义合集', url: '', items: [{ t: 'P1 测试', u: '', dur: '01:00', doc: '[00:00] 内容' }]
  })) + ',"自定义")');
  await wait(120);
  ok(ev('VS.length') === 4, '导入后 4 个合集，实际 ' + ev('VS.length'));
  const mine = ev('VS.filter(function(s){return !s.builtin})[0].id');
  ev('VSET=' + JSON.stringify(mine) + '; renderVSets()'); await wait(20);
  doc.querySelector('#vdel').dispatchEvent(new w.MouseEvent('click', { bubbles: true })); await wait(80);
  ok(ev('VS.filter(function(s){return !s.builtin}).length') === 0, '自定义合集删掉了');
  ok(ev('VS.length') === 3, '三个内置包还在');

  log('');
  log('=== 7. 不联网 / 本地 file:// 打开也不崩 ===');
  ev('window.fetch=function(){return Promise.reject(new Error("offline"))}');
  const e0 = errors.length;
  await ev('vLoad()'); await wait(150);
  ok(errors.length === e0, '断网时 vLoad 不报错');

  log('');
  log('--- 错误 ---');
  log(errors.length ? errors.join('\n') : '无');
  console.log(out.join('\n'));
  process.exit(errors.length ? 1 : 0);
})();
