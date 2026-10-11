/* 切课程不能打断正在进行的导师回答（用户反馈：「切换课程后原课程导师回答进度会被打断」）
 *
 * 根因：ask() 是异步流式函数，靠全局 MS 存消息、靠 el（DOM 节点）渲染。
 * switchCourse() 会把 MS 换成新课程的数组、并 reloadMsgs() 清空 DOM ——
 *   ① 流结束时 MS.push({r:'a'}) 会把回答写进「切过去的那门课」，串数据
 *   ② 正在渲染的 el 变成游离节点，原课程看起来「回答停在半句」
 *
 * 断言四件事：
 *   1. 切走后，回答完整写回「原课程」，不丢
 *   2. 回答不会串到切过去的那门课
 *   3. 切回来能看到完整回答
 *   4. 中途切走再切回，回答仍在原地继续完成
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

/* 可控流：由测试决定「什么时候吐出下一段」，才能在流进行中间切换课程 */
function makeFeeder() {
  const chunks = [], waiters = [];
  let ended = false;
  return {
    feed(str) {
      if (ended) return;
      const u = new TextEncoder().encode(str);
      if (waiters.length) waiters.shift()({ done: false, value: u });
      else chunks.push(u);
    },
    end() {
      ended = true;
      while (waiters.length) waiters.shift()({ done: true });
    },
    body: {
      getReader() {
        return {
          read() {
            if (chunks.length) return Promise.resolve({ done: false, value: chunks.shift() });
            if (ended) return Promise.resolve({ done: true });
            return new Promise(res => waiters.push(res));
          }
        };
      }
    }
  };
}
const seg = t => 'data: {"choices":[{"delta":{"content":' + JSON.stringify(t) + '}}]}\n\n';
const DONE = 'data: [DONE]\n\n';

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

  let feeder = makeFeeder();
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')
    .replace(/<script src="https:[^"]+"><\/script>/g, '');
  const dom = new JSDOM(html, {
    url: 'https://x.test/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      installIDB(win);
      win.confirm = () => true; win.alert = () => {};
      win.fetch = () => Promise.resolve({
        ok: true, status: 200, statusText: 'OK', json: async () => ({}), body: feeder.body
      });
      win.URL.createObjectURL = () => 'blob:x'; win.URL.revokeObjectURL = () => {};
    }
  });
  const wnd = dom.window, doc = wnd.document;
  await wait(700);
  const ev = s => { try { return wnd.eval(s); } catch (e) { errors.push('eval: ' + e.message); return undefined; } };
  const J = s => JSON.parse(ev('JSON.stringify(' + s + ')'));

  ev('$("key").value="sk-test"; $("base").value="https://api.test/v1"; $("model").value="m";');
  /* 两门内置课都在教材里（高数 __local / 线代 __local2），否则切不过去 */
  ev([
    'CH=[',
    ' {id:"第1章_函数与极限.md#1",file:"第1章_函数与极限.md",title:"函数",txt:"x"},',
    ' {id:"第1章 行列式.md#1",file:"第1章 行列式.md",title:"行列式",txt:"y"}',
    '];',
    'COURSE="__local";LS.s("course",COURSE);',
    'loadCourseData();MS=[];saveMs();',
    'updateCourses();renderBook();reloadMsgs();'
  ].join('\n'));
  await wait(30);

  /* === 1. 流进行中切换课程：回答写回原课程、不串课 === */
  log('=== 1. 流进行中切走：回答不丢、不串课 ===');
  feeder = makeFeeder();
  const asked = ev('ask("请讲解行列式")');
  await wait(40);
  feeder.feed(seg('第一段：'));
  await wait(40);
  ok(J('LS.g("msgs.__local",[]).map(m=>m.r)').join(',') === 'user',
    '进行中：原课程已记下我的提问（此时还没有回答）');

  ev('switchCourse("__local2")');
  await wait(30);
  ok(ev('COURSE') === '__local2', '已切到线代');

  feeder.feed(seg('按行展开。'));
  feeder.feed(DONE);
  feeder.end();
  await asked;
  await wait(40);

  const A = J('LS.g("msgs.__local",[])');
  const B = J('LS.g("msgs.__local2",[])');
  log('  原课程 msgs.__local  = ' + JSON.stringify(A));
  log('  切过去的 msgs.__local2 = ' + JSON.stringify(B));
  ok(A.length === 2 && A[1].r === 'a' && A[1].c === '第一段：按行展开。', '回答完整写回原课程（高数）');
  ok(!B.some(m => m.c && String(m.c).indexOf('按行展开') >= 0), '回答没有串进切过去的那门课（线代）');

  ev('switchCourse("__local")');
  await wait(30);
  ok(ev('$("mw").textContent').indexOf('按行展开') >= 0, '切回来能看到完整回答');

  /* === 2. 中途切走再切回来：回答在原来的位置继续完成 === */
  log('');
  log('=== 2. 中途切走再切回：原地继续完成 ===');
  ev('MS=[];saveMs();');
  feeder = makeFeeder();
  const p2 = ev('ask("第二问")');
  await wait(40);
  feeder.feed(seg('A'));
  await wait(40);
  ev('switchCourse("__local2")');
  await wait(30);
  ev('switchCourse("__local")');
  await wait(30);
  feeder.feed(seg('B'));
  feeder.feed(DONE);
  feeder.end();
  await p2;
  await wait(40);

  const A2 = J('LS.g("msgs.__local",[])');
  log('  msgs.__local = ' + JSON.stringify(A2));
  ok(A2.length === 2 && A2[1].r === 'a' && A2[1].c === 'AB', '切走再切回：回答完整写回原课程');
  ok(ev('$("mw").textContent').indexOf('AB') >= 0, '切回后页面上能看到完整回答');

  /* === 3. 切到别的课后又提问，两条流互不污染 === */
  log('');
  log('=== 3. 切过去后另起一问：两条流互不污染 ===');
  ev('switchCourse("__local2")');
  await wait(30);
  ev('MS=[];saveMs();');
  feeder = makeFeeder();
  const p3 = ev('ask("线代的问题")');
  await wait(40);
  feeder.feed(seg('线代答'));
  feeder.feed(DONE);
  feeder.end();
  await p3;
  await wait(40);
  const B3 = J('LS.g("msgs.__local2",[])');
  const A3 = J('LS.g("msgs.__local",[])');
  log('  msgs.__local2 = ' + JSON.stringify(B3));
  ok(B3.length === 2 && B3[1].c === '线代答', '新课程的回答落在新课程');
  ok(A3.length === 2 && A3[1].c === 'AB', '原课程记录没有被新课程的回答覆盖');

  log('');
  log(errors.length ? ('✗ 失败 ' + errors.length + ' 项：' + errors.join(' | ')) : '✓ 全部通过');
  console.log(out.join('\n'));
  process.exit(errors.length ? 1 : 0);
})();
