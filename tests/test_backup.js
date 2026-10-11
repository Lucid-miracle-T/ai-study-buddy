/* 学习记录备份 / 恢复
 *
 * 记录全在 localStorage，受 origin 限制：换域名、换设备、清缓存都会没。
 * 导出 JSON 是唯一能跨环境带走的手段，所以两条硬要求：
 *   · 导出文件**不含 API Key**（备份常被丢进网盘或聊天窗口）
 *   · 恢复时**也不许**用备份里的 Key 覆盖本机的 Key
 * 另加：非法文件、空备份要明确拒绝，不能静默吞掉。
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
  const out = [], errors = [], alerts = [];
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
      installIDB(win);
      win.confirm = () => true;
      win.alert = m => alerts.push(String(m));
      win.open = () => null;
      win.fetch = () => Promise.reject(new Error('测试不联网'));
      win.URL.createObjectURL = () => 'blob:x'; win.URL.revokeObjectURL = () => {};
    }
  });
  const wnd = dom.window, doc = wnd.document;
  await wait(700);
  const ev = s => { try { return wnd.eval(s); } catch (e) { errors.push('eval: ' + e.message); return undefined; } };
  const input = doc.getElementById('impf');
  const feed = async payload => {
    Object.defineProperty(input, 'files', {
      value: [typeof payload === 'string' ? { text: async () => payload } : payload],
      configurable: true
    });
    input.dispatchEvent(new wnd.Event('change'));
    await wait(140);
  };

  /* 造一份「用户已经学了几天」的现场 */
  ev([
    'LS.s("course","__local2");',
    'LS.s("msgs.__local2",[{r:"user",c:"线代第一问"},{r:"a",c:"答复"}]);',
    'LS.s("prog.__local2",{"第1章 行列式.md#1":2});',
    'LS.s("cards",[{id:"c1",q:"什么是行列式",a:"一个数",c:"__local2",box:0}]);',
    'LS.s("key","sk-secret-123");',
    'LS.s("base","https://api.test/v1");',
    'LS.s("qden","few");'
  ].join('\n'));

  /* === 1. 导出 === */
  log('=== 1. 导出学习记录 ===');
  let dumped = null, fileName = null;
  wnd.dl = (n, t) => { fileName = n; dumped = t; };
  doc.getElementById('expall').click();
  await wait(40);
  {
    ok(!!dumped, '点「导出学习记录」会产出文件');
    let j = null; try { j = JSON.parse(dumped); } catch (e) {}
    ok(!!j, '产出的是合法 JSON');
    ok(j && j.app === 'ai-study-buddy', '带本站标识，便于恢复时校验');
    ok(!!(j && j.data && j.data['gx.msgs.__local2']), '含线代对话');
    ok(!!(j && j.data && j.data['gx.prog.__local2']), '含掌握进度');
    ok(!!(j && j.data && j.data['gx.cards']), '含闪卡');
    ok(!!(j && j.data && j.data['gx.base']), '含接口地址');
    ok(!!(j && j.data && j.data['gx.qden']), '含操作习惯');
    ok(j && j.data['gx.key'] === undefined, '**不含 API Key**');
    ok(/学习记录备份/.test(String(fileName)) && /\.json$/.test(String(fileName)),
      '文件名带日期且是 .json，实际 ' + fileName);
  }

  /* === 2. 恢复 === */
  log('');
  log('=== 2. 从备份恢复 ===');
  {
    ev('localStorage.removeItem("gx.cards"); LS.s("msgs.__local2",[]);');
    await feed(JSON.stringify({
      app: 'ai-study-buddy', ver: 1, at: 'x',
      data: {
        'gx.msgs.__local2': JSON.stringify([{ r: 'user', c: '来自备份的对话' }]),
        'gx.cards': JSON.stringify([{ id: 'r1', q: '恢复的卡', a: '答案', box: 0 }]),
        'gx.key': JSON.stringify('sk-evil'),
        'evil.key': JSON.stringify('不该写进来')
      }
    }));
    ok(ev('(LS.g("msgs.__local2",[])||[]).length') === 1 &&
      ev('LS.g("msgs.__local2")[0].c') === '来自备份的对话', '对话已恢复');
    ok(ev('(LS.g("cards",[])||[]).length') === 1, '闪卡已恢复');
    ok(ev('LS.g("key")') === 'sk-secret-123', '**API Key 没被备份里的值覆盖**');
    ok(ev('localStorage.getItem("evil.key")') === null, '非本站前缀的键不会被写入');
  }

  /* === 3. 恢复会覆盖同名记录（这是恢复的本意） === */
  log('');
  log('=== 3. 同名记录按备份覆盖 ===');
  {
    await feed(JSON.stringify({
      app: 'ai-study-buddy', ver: 1,
      data: { 'gx.cards': JSON.stringify([{ id: 'r2', q: '新卡', a: 'a', box: 1 }]) }
    }));
    ok(ev('(LS.g("cards",[])||[]).length') === 1 && ev('LS.g("cards")[0].id') === 'r2',
      '同名键被备份内容替换');
  }

  /* === 4. 非法 / 空备份要拒绝 === */
  log('');
  log('=== 4. 拒绝非法文件 ===');
  {
    const before = alerts.length;
    await feed('{"foo":1}');
    ok(alerts.slice(before).some(a => /不是本站导出/.test(a)), '非本站文件被明确拒绝');
    await feed('这不是 JSON');
    ok(alerts.slice(before).some(a => /不是本站导出/.test(a)), '坏 JSON 被明确拒绝');
    const b2 = alerts.length;
    await feed(JSON.stringify({ app: 'ai-study-buddy', ver: 1, data: {} }));
    ok(alerts.slice(b2).some(a => /没有记录/.test(a)), '空备份被拒绝');
  }

  log('');
  if (errors.length) { console.log(out.join('\n')); console.log(''); console.log('失败 ' + errors.length + ' 项：'); errors.forEach(e => console.log('  ✗ ' + e)); process.exit(1); }
  console.log(out.join('\n'));
  console.log('');
  console.log('全部通过');
  process.exit(0);
})();
