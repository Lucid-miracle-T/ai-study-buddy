/* 课程标签栏 + 设置页模式区的一致性测试。
 * 起因：renderCTabs 原来统计的是「分册键」（msgs.第1章_xxx.md），
 *       但包课程的记录实际存在「包键」（msgs.__local）里——
 *       于是角标数字要么不显示，要么永远停在迁移时的旧快照、不随新对话增长。
 * 另外：renderModes() 一直在找 #mbox2 / #mcur，但设置页从没加过这两个元素，
 *       导致设置页无法切模式。这里一并断言它们存在且可用。
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

  /* === 1. 包课程的角标要反映真实记录 === */
  log('=== 1. 包课程角标（数据在包键里）===');
  ev([
    'CH=[{id:"第1章_函数与极限.md#1",file:"第1章_函数与极限.md",title:"函数",txt:"x"}];',
    'COURSE="__local"; LS.s("course",COURSE);',
    'LS.s("msgs.__local",[{r:"user",c:"a"},{r:"a",c:"b"},{r:"user",c:"c"}]);',
    'LS.s("prog.__local",{"第1章_函数与极限.md#1":2});',
    'MS=LS.g("msgs.__local",[]);',
    'renderCTabs();'
  ].join('\n'));
  {
    const t = String(ev('$("ctabs").textContent') || '');
    log('   标签栏: ' + JSON.stringify(t));
    ok(t.indexOf('3 条对话') >= 0, '包课程显示真实对话数 3（不再依赖分册键）');
    ok(t.indexOf('1 已掌握') >= 0, '包课程显示掌握数 1');
  }

  /* === 2. 新对话后角标要跟着涨（原来会卡在旧快照）=== */
  log('');
  log('=== 2. 新对话后角标增长 ===');
  ev('MS.push({r:"user",c:"新话"}); MS.push({r:"a",c:"新答"}); saveMs(); renderCTabs();');
  {
    const t = String(ev('$("ctabs").textContent') || '');
    ok(t.indexOf('5 条对话') >= 0, '聊完两句后角标涨到 5（实际: ' + t.replace('课程', '') + '）');
  }

  /* === 3. 迁移前（只有分册键）也要显示 === */
  log('');
  log('=== 3. 旧数据只在分册键时的回退 ===');
  ev([
    'localStorage.clear();',
    'CH=[{id:"第1章_函数与极限.md#1",file:"第1章_函数与极限.md",title:"函数",txt:"x"},',
    '    {id:"第2章_导数与微分.md#1",file:"第2章_导数与微分.md",title:"导数",txt:"x"}];',
    'COURSE="__local"; LS.s("course",COURSE);',
    'LS.s("msgs.第1章_函数与极限.md",[{r:"user",c:"旧1"}]);',
    'LS.s("msgs.第2章_导数与微分.md",[{r:"user",c:"旧2"}]);',
    'LS.s("prog.第1章_函数与极限.md",{"第1章_函数与极限.md#1":2});',
    'renderCTabs();'
  ].join('\n'));
  {
    const t = String(ev('$("ctabs").textContent') || '');
    log('   标签栏: ' + JSON.stringify(t));
    ok(t.indexOf('2 条对话') >= 0, '课程键为空时回退聚合分册键（2 条）');
    ok(t.indexOf('1 已掌握') >= 0, '回退时掌握数也对（1）');
  }

  /* === 4. 设置页应有「本轮模式」区，且能切 === */
  log('');
  log('=== 4. 设置页「本轮模式」区 ===');
  {
    ok(!!doc.getElementById('mbox2'), '设置页存在 #mbox2（模式药丸容器）');
    ok(!!doc.getElementById('mcur'), '设置页存在 #mcur（当前模式显示）');
    const pills = doc.querySelectorAll('#mbox2 .pill');
    ok(pills.length >= 5, '#mbox2 渲染出模式药丸（实际 ' + pills.length + ' 个）');
    ok(String(ev('$("mcur").textContent')).length > 0, '#mcur 显示当前模式：' + ev('$("mcur").textContent'));
    /* 点「陪练出题」应切换 MODEK 且两个容器都更新 */
    const drill = [...doc.querySelectorAll('#mbox2 .pill')].find(p => p.textContent === '陪练出题');
    ok(!!drill, '#mbox2 里有「陪练出题」');
    if (drill) {
      drill.click();
      await wait(30);
      ok(ev('MODEK') === 'drill', '点击后 MODEK 变为 drill');
      ok(ev('$("mcur").textContent') === '陪练出题', 'mcur 同步为「陪练出题」');
      const topOn = [...doc.querySelectorAll('#mbox .pill')].filter(p => p.className.indexOf('on') >= 0).map(p => p.textContent);
      ok(topOn.indexOf('陪练出题') >= 0, '上课页顶部那排也同步高亮（' + topOn.join(',') + '）');
    }
    ev('MODEK="teach"; LS.s("mode","teach"); renderModes();');
  }

  log('');
  log('--- 错误 ---');
  log(errors.length ? errors.join('\n') : '无');
  console.log(out.join('\n'));
  process.exit(errors.length ? 1 : 0);
})();
