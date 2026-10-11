/* 学习记录持久性：更新／重开后，用户的课程选择不能被覆盖
 *
 * 现场：`updateCourses()` 用「当前已载入的教材」反推有效课程列表；只要课程不在
 * 这个列表里，就判定为「教材已被移除」，把 COURSE 重置成 __free 并写回 localStorage。
 * 但**启动瞬间教材还没载入**（CH 为空），列表恒为 [__free] —— 于是每次打开
 * 站点，用户上次所在的课程都会被重置成「自由问答」，看起来「学习记录不见了」
 * （数据其实还在 msgs.<课程> 里，只是当前展示的那门课被换掉了）。
 *
 * 断言四件事：
 *   1. 教材未载入（CH 为空）时，不许改 COURSE，也不许覆盖 localStorage 里的 course
 *   2. 该课程的对话与进度原样还在，切回去能读到
 *   3. 教材确实载入、而课程名真的不在列表里时，才允许回落（原兜底保留）
 *   4. 「自由问答」里已经有对话时，载入教材不许把人踢走
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

function installIDB(win, seed) {
  const m = new Map();
  if (seed) m.set('gxbook', new Map(seed.map(o => [o.id, o])));
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

/* seed：预置 localStorage（模拟用户上次留下的记录）；books：预置 IndexedDB 教材 */
function boot(seed, books) {
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
      installIDB(win, books);
      win.confirm = () => true; win.alert = () => {}; win.open = () => null;
      /* 没有教材可下：让内置教材载入失败，CH 保持为空 */
      win.fetch = () => Promise.resolve({ ok: false, status: 404, statusText: 'NF', json: async () => ({}) });
      win.URL.createObjectURL = () => 'blob:x'; win.URL.revokeObjectURL = () => {};
      if (seed) Object.keys(seed).forEach(k => win.localStorage.setItem(k, seed[k]));
    }
  });
  return { wnd: dom.window, errs };
}

const MSG = JSON.stringify([
  { r: 'user', c: '线代第一问' }, { r: 'a', c: '答复一' }, { r: 'user', c: '线代第二问' }
]);

(async () => {
  const out = [], errors = [];
  const log = s => out.push(s);
  const ok = (c, m) => { log((c ? '✓ ' : '✗ ') + m); if (!c) errors.push(m); };
  const wait = ms => new Promise(r => setTimeout(r, ms));

  /* === 1. 核心场景：上次在线代课，这次打开时教材还没载入 === */
  log('=== 1. 教材未载入时，课程选择不能被重置 ===');
  {
    const { wnd, errs } = boot({
      'gx.course': '"__local2"',
      'gx.msgs.__local2': MSG,
      'gx.prog.__local2': '{"第1章 行列式.md#1":2}'
    });
    await wait(900);
    ok(wnd.eval('COURSE') === '__local2',
      'COURSE 保持 __local2，实际 ' + wnd.eval('COURSE'));
    ok(wnd.eval('LS.g("course")') === '__local2',
      'localStorage 里的课程选择没被覆盖，实际 ' + JSON.stringify(wnd.eval('LS.g("course")')));
    ok(wnd.eval('(LS.g("msgs.__local2",[])||[]).length') === 3, '线代对话仍是 3 条');
    ok(wnd.eval('Object.keys(LS.g("prog.__local2",{})||{}).length') === 1, '线代进度仍在');
    ok(wnd.eval('LS.g("msgs.__free",null)') === null, '没有被顺手写出一条空的自由问答记录');
    ok(errs.length === 0, '无 jsdom 异常' + (errs.length ? '：' + errs.join('; ') : ''));
  }

  /* === 2. 教材正常载入时，课也还在 === */
  log('');
  log('=== 2. 教材载入完成后仍停在原课程 ===');
  {
    const { wnd } = boot({
      'gx.course': '"__local2"',
      'gx.msgs.__local2': MSG
    }, [{ id: '第1章 行列式.md#1', file: '第1章 行列式.md', title: '行列式', txt: 'x' }]);
    await wait(900);
    ok(wnd.eval('COURSE') === '__local2', 'COURSE 仍是 __local2，实际 ' + wnd.eval('COURSE'));
    ok(wnd.eval('MS.length') === 3, '对话已读入内存（3 条），实际 ' + wnd.eval('MS.length'));
    ok(wnd.eval('LS.g("msgs.__local2",[]).length') === 3, '存储里的对话没被动过');
  }

  /* === 3. 教材真的没了 —— 才允许回落（保留原有兜底） === */
  log('');
  log('=== 3. 课程确实失效时才回落 ===');
  {
    /* 存储里记的是某本外部教材，但 IndexedDB 里只有高数分册 → 该课程真的不存在了 */
    const { wnd } = boot({
      'gx.course': '"已经删掉的书.md"',
      'gx.msgs.已经删掉的书.md': MSG
    }, [{ id: '第1章_函数与极限.md#1', file: '第1章_函数与极限.md', title: '函数', txt: 'x' }]);
    await wait(900);
    const c = wnd.eval('COURSE');
    ok(c !== '已经删掉的书.md', '失效课程已回落，实际 ' + c);
    ok(c === '__local' || c === '__free', '回落到某门真实存在的课，实际 ' + c);
  }

  /* === 4. 自由问答里已经聊过，载入教材不许把人踢走 === */
  log('');
  log('=== 4. 自由问答有对话时不被自动切走 ===');
  {
    const { wnd } = boot({
      'gx.course': '"__free"',
      'gx.msgs.__free': MSG
    }, [{ id: '第1章_函数与极限.md#1', file: '第1章_函数与极限.md', title: '函数', txt: 'x' }]);
    await wait(900);
    ok(wnd.eval('COURSE') === '__free',
      '停在自由问答，实际 ' + wnd.eval('COURSE'));
    ok(wnd.eval('MS.length') === 3, '自由问答的对话还在，实际 ' + wnd.eval('MS.length'));
  }

  log('');
  if (errors.length) { console.log(out.join('\n')); console.log(''); console.log('失败 ' + errors.length + ' 项：'); errors.forEach(e => console.log('  ✗ ' + e)); process.exit(1); }
  console.log(out.join('\n'));
  console.log('');
  console.log('全部通过');
  process.exit(0);
})();
