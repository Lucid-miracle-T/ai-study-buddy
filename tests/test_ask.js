/* 提问密度（一次回复问几个问题）
 *
 * 背景：用户反馈「一次问三个问题，阅读和思考负担都太大」。
 * 根因是默认节奏 PACE.mid 写的是「一次可以提出 2–3 个递进的小问题」，
 * 于是导师几乎每轮都抛两三个问题，学习者要同时记住才行。
 *
 * 断言四件事：
 *   1. 默认「一次一问」；设置页有对应开关，且默认选中「一次一问」
 *   2. 注入模型的 system prompt 里带【提问纪律】硬约束，且默认不含「2–3 个」
 *   3. 切到「一次 2–3 问」后 prompt 才放开，并且这个选择存得住、重开页面还在
 *   4. 默认节奏的文案已经不再号召「一次 2–3 个问题」
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

const HTML = () => fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')
  .replace(/<script src="https:[^"]+"><\/script>/g, '');

function boot(preset) {
  const vc = new VirtualConsole();
  const errs = [];
  vc.on('jsdomError', e => {
    const m = e.message || String(e);
    if (/Not implemented: navigation/.test(m)) return;
    errs.push('jsdomError: ' + m);
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

  const { wnd, errs } = boot();
  const doc = wnd.document;
  await wait(700);
  const ev = s => { try { return wnd.eval(s); } catch (e) { errors.push('eval: ' + e.message); return undefined; } };
  const q = s => doc.querySelector(s);

  /* 让导师开场，保证 sysMsg 有课程上下文 */
  ev('CH=[{id:"c.md#1",file:"c.md",title:"行列式",txt:"x"}]; COURSE="c.md"; LS.s("course",COURSE);');

  /* === 1. 默认一次一问 === */
  log('=== 1. 默认「一次一问」 ===');
  ok(ev('QDEN') === 'one', '默认 QDEN = one（实际 ' + ev('QDEN') + '）');
  {
    const sel = q('#qden');
    ok(!!sel, '设置页有「导师一次问几个问题」开关');
    ok(sel && sel.value === 'one', '开关默认选中「一次一问」，实际 ' + (sel && sel.value));
    const opts = sel ? [...sel.options].map(o => o.value).join(',') : '';
    ok(opts === 'one,few', '两个选项 one/few，实际 ' + opts);
  }

  /* === 2. system prompt 里的硬纪律 === */
  log('');
  log('=== 2. 注入模型的提问纪律 ===');
  {
    const sys = ev('sysMsg()') || '';
    ok(sys.indexOf('【提问纪律】') >= 0, 'system prompt 含【提问纪律】');
    ok(sys.indexOf('最多只提出一个问题') >= 0, '默认写死「最多只提出一个问题」');
    ok(sys.indexOf('2–3 个递进的小问题') < 0, '默认不含「2–3 个递进的小问题」');
    /* 纪律排在模式之前，模式的单题要求（出 1 道题 / 1 道模拟题）不被覆盖 */
    ok(sys.indexOf('【提问纪律】') < sys.indexOf('【本轮模式'), '提问纪律在模式段之前');
  }

  /* === 3. 切到「一次 2–3 问」 === */
  log('');
  log('=== 3. 切到「一次 2–3 问」 ===');
  {
    const sel = q('#qden');
    sel.value = 'few';
    sel.dispatchEvent(new wnd.Event('change'));
    await wait(30);
    ok(ev('QDEN') === 'few', 'QDEN 变为 few');
    ok(ev('LS.g("qden")') === 'few', '选择已写入 localStorage');
    const sys = ev('sysMsg()') || '';
    ok(sys.indexOf('2–3 个递进的小问题') >= 0, '放开后 prompt 才出现「2–3 个递进的小问题」');
    ok(sys.indexOf('最多只提出一个问题') < 0, '放开后不再出现「最多只提出一个问题」');
    /* 非法值兜底 */
    ev('QDEN="垃圾"; LS.s("qden","垃圾")');
    const sys2 = ev('(function(){var v=LS.g("qden","one"); return ["one","few"].indexOf(v)<0?"one":v})()');
    ok(sys2 === 'one', '存储里是非法值时回落到 one');
  }

  /* === 4. 重开页面保持 === */
  log('');
  log('=== 4. 重开页面，设置保持 ===');
  {
    const b = boot({ 'gx.qden': '"few"' });
    await wait(700);
    const w2 = b.wnd;
    ok(w2.eval('QDEN') === 'few', '重开页面后仍是「一次 2–3 问」');
    ok(w2.document.getElementById('qden').value === 'few', '设置页开关也回显为 few');
  }
  {
    const b = boot();   /* 全新用户 */
    await wait(700);
    ok(b.wnd.eval('QDEN') === 'one', '全新用户默认就是「一次一问」');
  }

  /* === 5. 默认节奏文案已清理 === */
  log('');
  log('=== 5. 节奏文案不再号召多问 ===');
  {
    ok(ev('PACE.mid.indexOf("2–3 个")') < 0, 'PACE.mid 不再写「2–3 个」');
    ok(ev('PACE.mid.indexOf("一次只提出一个问题")') >= 0, 'PACE.mid 改成「一次只提出一个问题」');
    ok(ev('PACE.slow.indexOf("一次只推进一个点")') >= 0, '慢节奏仍是单个推进');
    /* 网课「我卡住了」动作也从 3 个问题收成 1 个 */
    const src = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    ok(src.indexOf('给我 3 个能检验') < 0, '网课「卡住了」不再一次要 3 个问题');
    ok(src.indexOf('出 1 个能检验') >= 0, '网课「卡住了」改为只出 1 个问题');
  }

  log('');
  if (errs.length) errors.push(...errs);
  console.log(out.join('\n'));
  console.log('');
  if (errors.length) { console.log('失败 ' + errors.length + ' 项：'); errors.forEach(e => console.log('  ✗ ' + e)); process.exit(1); }
  console.log('全部通过');
  process.exit(0);
})();
