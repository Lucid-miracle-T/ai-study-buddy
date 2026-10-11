/* 暴力点击测试：把页面上所有可点元素逐个点一遍，捕捉运行时异常。
 * 目的：现有 7 套测试只覆盖"已知关键路径"，这个测试负责发现没人想到的死角。
 * 做法：mock fetch 返回一条 SSE 流；mock confirm/alert/open；
 *       遍历各视图的 .pill / button / .chip / .ctab / [data-a] 逐个点击，
 *       任何一次点击引发的 jsdomError / console.error / 未捕获异常都算失败。
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

/* 一个假的 SSE 流：先吐几个 token，再结束 */
function fakeStream(win) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({}),
    body: {
      getReader() {
        let done = false;
        return {
          read() {
            if (done) return Promise.resolve({ done: true });
            done = true;
            const chunk = 'data: {"choices":[{"delta":{"content":"好$M_{32}$"}}]}\n\n' +
              'data: {"choices":[{"delta":{"content":"，按行展开。"}}],"usage":{"prompt_tokens":10,"completion_tokens":5}}\n\n' +
              'data: [DONE]\n\n';
            return Promise.resolve({ done: false, value: new TextEncoder().encode(chunk) });
          }
        };
      }
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
    /* jsdom 不实现页面导航；「清空全部本地数据」会 location.reload()，属环境限制而非代码 bug */
    if (/Not implemented: navigation/.test(m)) return;
    errors.push('jsdomError: ' + m);
  });

  const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
  const dom = new JSDOM(html, {
    url: 'https://x.test/', runScripts: 'dangerously', pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(win) {
      installIDB(win);
      win.confirm = () => true;
      win.alert = () => {};
      win.open = () => null;
      win.fetch = () => Promise.resolve(fakeStream(win));
      /* jsdom 没实现这两个，但真实浏览器都有；补上以免误报 */
      win.URL.createObjectURL = () => 'blob:mock';
      win.URL.revokeObjectURL = () => {};
      try { Object.defineProperty(win.location, 'reload', { configurable: true, value: () => {} }); } catch (e) {}
      /* 记录未处理的 promise 拒绝 */
      win.addEventListener('unhandledrejection', e => {
        errors.push('unhandledrejection: ' + (e.reason && (e.reason.message || e.reason)));
      });
      win.onerror = (msg, src, line, col, err) => {
        errors.push('window.onerror: ' + (err && err.message || msg));
      };
    }
  });
  const wnd = dom.window, doc = wnd.document;
  await wait(700);

  const ev = s => { try { return wnd.eval(s); } catch (e) { errors.push('eval: ' + e.message); return null; } };

  /* 配好接口，否则任何发问都会因缺 key 直接 return（测不到内部） */
  ev([
    '$("base").value="https://api.test/v1";',
    '$("key").value="sk-test";',
    '$("model").value="test-model";'
  ].join('\n'));

  /* 造教材 + 勾选 + 网课包，让各视图都有真实内容可点 */
  ev([
    'window.__idb=[{id:"t.md#1",file:"t.md",title:"行列式按行(列)展开",txt:"按第i行展开"},',
    '               {id:"t.md#2",file:"t.md",title:"行列式的性质",txt:"互换两行变号"}];',
    'CH=window.__idb.slice();',
    'COURSE="__local"; LS.s("course",COURSE);',
    'CTX=["t.md#1"]; saveCourseData();'
  ].join('\n'));
  await wait(50);

  const PKG = JSON.stringify({
    title: '测试合集', url: 'https://space.bilibili.com/x',
    items: [
      { t: 'P1 行列式展开', u: 'https://www.bilibili.com/video/BV1xx411c7mD', dur: '10:00', doc: '[00:00] 今天讲按行展开。' },
      { t: 'P2 行列式性质', u: 'https://www.bilibili.com/video/BV1xx411c7mD?p=2', dur: '12:00', doc: '' }
    ]
  });
  ev('vParse(' + JSON.stringify(PKG) + ',"测试合集")');
  await wait(150);

  /* 造几张闪卡，让闪卡页有内容可点（归属字段是 c，不是 course） */
  ev([
    'CD.push({id:"c1",q:"$M_{32}$ 怎么算？",a:"按第3行第2列展开",c:"__local",box:0});',
    'CD.push({id:"c2",q:"行列式互换两行会怎样？",a:"变号",c:"__local",box:1});',
    'LS.s("cards",CD); renderCards();'
  ].join('\n'));
  await wait(30);

  const errBefore = () => errors.length;
  const views = ['lesson', 'book', 'vid', 'card', 'prog', 'set'];
  const total = { clicked: 0, failed: 0 };
  const failures = [];

  for (const v of views) {
    log('');
    log('=== 视图「' + v + '」===');
    const tab = doc.querySelector('[data-v="' + v + '"]');
    if (!tab) { log('   没有这个导航项，跳过'); continue; }
    tab.click();
    await wait(60);

    /* 先收集该视图（及全局）所有可点元素的下标，边点边点重新查询，避免失效引用 */
    const sel = '.pill, button, .chip, .ctab, [data-a], [data-c], [data-x], .seg b, .rcT, .rcF, .vw, #blist h3, #blist .item';
    const seen = new Set();
    for (let round = 0; round < 3; round++) {
      const els = [...doc.querySelectorAll(sel)];
      let clickedThisRound = false;
      for (let i = 0; i < els.length; i++) {
        const el = els[i];
        /* 只点「当前可见视图」里的元素，以及不在任何 .view 里的全局元素 */
        const view = el.closest('.view');
        if (view && !view.classList.contains('on')) continue;
        /* 跳过重复元素（用外层容器 + 文本 + 类名做键） */
        const key = (el.className || '') + '|' + (el.textContent || '').slice(0, 24) + '|' + i;
        if (seen.has(key)) continue;
        seen.add(key);
        if (el.disabled) continue;
        const before = errBefore();
        try {
          el.click();
        } catch (e) {
          errors.push('click(' + key.slice(0, 40) + '): ' + e.message);
        }
        total.clicked++;
        clickedThisRound = true;
        await wait(25);
        if (errBefore() > before) {
          total.failed++;
          failures.push('[' + v + '] ' + (el.textContent || el.className || '').trim().slice(0, 30));
        }
      }
      if (!clickedThisRound) break;
    }
  }

  log('');
  log('=== 汇总 ===');
  log('共点击 ' + total.clicked + ' 次，' + total.failed + ' 次引发异常');
  if (failures.length) log('出问题的元素：\n  ' + failures.join('\n  '));

  log('');
  log('--- 错误 ---');
  log(errors.length ? errors.join('\n') : '无');
  console.log(out.join('\n'));
  process.exit(errors.length ? 1 : 0);
})();
