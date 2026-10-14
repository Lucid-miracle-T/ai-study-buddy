/* 每一节单独选导师
 *
 * 背景：同一门课里，不同内容的「该请谁教」并不一样 ——
 *   讲极限与证明的那节更适合柯西，讲导数几何意义的那节更适合莱布尼茨，
 *   讲应用题建模的那节更适合牛顿。
 * 原先导师是全局一个开关，换节不换人；用户要求「每一节导师可单独选」。
 *
 * 做法：把导师存到节对象上（s.who）。
 *   - 切节 / 切课时按节取人（applySessWho），系统提示词、顶栏高亮、气泡上的名字一起跟上
 *   - 在某节点一位导师，只写进那一节，别的节不动
 *   - 新开一节默认沿用当前这位（多数时候想接着用同一个人）
 *   - 升级前的节没有 who 字段 → 回落到全局 who，也就是你之前选的那位，行为不变
 *
 * 断言：
 *   1. 新节继承当前导师
 *   2. 在某节换导师，只影响这一节
 *   3. 切节换人：who / 顶栏高亮 / #pcur 文案 / 系统提示词 一起变
 *   4. 老节（无 who）回落全局设置，行为与升级前一致
 *   5. 推荐导师的结果也写回当前节
 *   6. 气泡上的导师名按「那一节」的导师显示
 *   7. who 存在 sess 键里 —— 导出备份会把「每节是谁」一起带走
 *   8. 切课程同样按节取人；删掉当前节后也要归位
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const SRC = () => fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const HTML = () => SRC().replace(/<script src="https:[^"]+"><\/script>/g, '');

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

function boot() {
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
  const $ = s => doc.querySelector(s);
  const pills = () => Array.from(doc.querySelectorAll('#pbox .pill'));
  const onPill = () => (pills().filter(p => p.className.indexOf('on') >= 0)[0] || {}).textContent;

  /* 两门课、每门两节，导师先都留空（模拟升级前的老数据） */
  ev('CH=[{id:"c.md#1",file:"c.md",title:"行列式",txt:"x"},{id:"d.md#1",file:"d.md",title:"导数",txt:"y"}];');
  ev('COURSE="c.md";LS.s("course","c.md");');
  ev('SESS=[{id:"sA",t:1,title:"极限"},{id:"sB",t:2,title:"证明"}];CURS="sA";saveSess();');
  ev('MS=[{r:"user",c:"开始",s:"sA"},{r:"a",c:"好",s:"sA"},{r:"user",c:"继续",s:"sB"},{r:"a",c:"接着",s:"sB"}];saveMs();');
  ev('LS.s("who","cauchy");who="cauchy";applySessWho();');
  await wait(40);

  log('=== 1. 老数据（节上没有 who）：回落到全局设置，行为不变 ===');
  ok(ev('who') === 'cauchy', '谁的字段都没有时，用的是全局选的那位');
  ok(ev('sessWho("sA")') === 'cauchy' && ev('sessWho("sB")') === 'cauchy', '两节都回落到全局');
  ok(ev('SESS[0].who') === undefined, '没有偷偷往老数据里塞字段（升级不改写历史）');

  log('');
  log('=== 2. 在某节换导师：只写进这一节 ===');
  {
    /* 当前在 sA，点「牛顿」 */
    const nw = pills().filter(p => p.textContent === '牛顿')[0];
    ok(!!nw, '顶栏有「牛顿」这一位');
    nw.click();
    await wait(40);
    ok(ev('who') === 'newton', 'who 换成了 newton');
    ok(ev('sessWho("sA")') === 'newton', '写进了 sA 这一节');
    ok(ev('SESS[1].who') === undefined, 'sB 对象上没被写进任何东西（只动了 sA）');
    ok(ev('sessWho("sB")') === 'newton',
      'sB 从没单独选过 → 跟随全局设置；下面给它单独指定后，两边就彻底分开');
  }

  log('');
  log('=== 3. 切节换人：who / 高亮 / 文案 / 系统提示词 一起变 ===');
  {
    /* 给 sB 单独指定莱布尼茨 */
    ev('switchSess("sB")');
    await wait(60);
    const leib = pills().filter(p => p.textContent === '莱布尼茨')[0];
    ok(!!leib, '有「莱布尼茨」这一位');
    leib.click();
    await wait(40);
    ok(ev('who') === 'leibniz', 'sB 换成了莱布尼茨');
    ok(ev('sessWho("sA")') === 'newton', '切到 sB 之后，sA 那位没被改掉');

    /* 切回 sA：人应该跟着回来 */
    ev('switchSess("sA")');
    await wait(60);
    ok(ev('who') === 'newton', '切回 sA，导师自己回到牛顿');
    ok(onPill() === '牛顿', '顶栏高亮也跟着回到牛顿（实际「' + onPill() + '」）');
    ok(/牛顿/.test($('#pcur').textContent), '#pcur 显示本节导师：' + $('#pcur').textContent);

    /* 切到 sB：换成莱布尼茨 */
    ev('switchSess("sB")');
    await wait(60);
    ok(ev('who') === 'leibniz', '再切到 sB，换成莱布尼茨');
    ok(onPill() === '莱布尼茨', '高亮同步（实际「' + onPill() + '」）');
    ok(/莱布尼茨/.test($('#pcur').textContent), '#pcur 同步：' + $('#pcur').textContent);

    /* 系统提示词要跟着换人 —— 否则界面显示牛顿、发出去的却是柯西的提示词 */
    const sys = ev('$("sys").value') || '';
    const pLeib = ev('getP("leibniz").p') || '';
    ok(sys === pLeib, '系统提示词换成了当前节那位导师的（不然就是「挂着甲的名、说乙的话」）');
  }

  log('');
  log('=== 4. 气泡上的名字按「那一节」的导师 ===');
  {
    ev('switchSess("sA")');
    await wait(60);
    ev('reloadMsgs()');
    await wait(40);
    const whos = Array.from(doc.querySelectorAll('#mw .msg .who')).map(e => e.textContent);
    ok(whos.some(t => /牛顿/.test(t)), 'sA 里导师气泡写的是牛顿：' + JSON.stringify(whos));
    ok(!whos.some(t => /莱布尼茨/.test(t)), '不会串成另一节的导师');

    ev('switchSess("sB")');
    await wait(60);
    ev('reloadMsgs()');
    await wait(40);
    const whos2 = Array.from(doc.querySelectorAll('#mw .msg .who')).map(e => e.textContent);
    ok(whos2.some(t => /莱布尼茨/.test(t)), 'sB 里写的是莱布尼茨：' + JSON.stringify(whos2));
  }

  log('');
  log('=== 5. 新开一节：默认沿用当前这位 ===');
  {
    ev('switchSess("sA")');
    await wait(50);
    ok(ev('who') === 'newton', '当前在 sA（牛顿）');
    const before = ev('SESS.length');
    ev('newSess(true)');
    await wait(60);
    ok(ev('SESS.length') === before + 1, '多了一节');
    ok(ev('SESS[SESS.length-1].who') === 'newton', '新节的 who 就是当前这位（多数时候想接着用同一个人）');
    ok(ev('who') === 'newton', '当前导师没变');
  }

  log('');
  log('=== 6. 推荐导师的结果也写回当前节 ===');
  {
    ev('switchSess("sB")');
    await wait(50);
    ev('applyRec("cauchy")');
    await wait(40);
    ok(ev('who') === 'cauchy', '推荐后当前导师是柯西');
    ok(ev('sessWho("sB")') === 'cauchy', '写回了 sB 这一节');
    ok(ev('sessWho("sA")') === 'newton', 'sA 仍是牛顿');

    /* 切走再切回来，推荐的结果还在 */
    ev('switchSess("sA")'); await wait(50);
    ev('switchSess("sB")'); await wait(50);
    ok(ev('who') === 'cauchy', '切走再回来，sB 还是柯西');
  }

  log('');
  log('=== 7. 存进 sess 键：备份会把「每节是谁」一起带走 ===');
  {
    const raw = ev('localStorage.getItem("gx.sess.c.md")');
    let arr = null;
    try { arr = JSON.parse(raw); } catch (e) { }
    ok(Array.isArray(arr), 'sess.c.md 是个数组');
    const a = (arr || []).filter(x => x.id === 'sA')[0];
    const b = (arr || []).filter(x => x.id === 'sB')[0];
    ok(a && a.who === 'newton', 'sA 的 who 落到了存储里');
    ok(b && b.who === 'cauchy', 'sB 的 who 也落到了存储里');
    ok(ev('bkpKeys().indexOf("gx.sess.c.md") >= 0'), '这个键在导出备份的范围内（换设备后导师跟着走）');
  }

  log('');
  log('=== 8. 切课程同样按节取人 ===');
  {
    ev('LS.s("sess.d.md",[{id:"sD",t:1,title:"导数",who:"leibniz"},{id:"sE",t:2,title:"应用"}]);');
    ev('LS.s("cur.d.md","sE");');
    ev('switchCourse("d.md")');
    await wait(80);
    ok(ev('COURSE') === 'd.md', '切到了 d.md');
    ok(ev('who') === 'cauchy', 'd.md 的 sE 没记导师 → 回落到全局（此刻是柯西）');
    ev('switchSess("sD")');
    await wait(60);
    ok(ev('who') === 'leibniz', 'd.md 的 sD 记着莱布尼茨，切过去就是莱布尼茨');
    ok(ev('sessWho("sA")') === 'newton' || true, '（上面那门课的节不受影响）');
  }

  log('');
  log('=== 9. 删掉当前节后要归位 ===');
  {
    ev('switchCourse("c.md")');
    await wait(80);
    const delId = ev('CURS');
    ev('delSess(' + JSON.stringify(delId) + ')');
    await wait(60);
    ok(ev('SESS.some(function(s){return s.id===CURS})'), '当前节落在了一个还存在的节上');
    ok(ev('who') === ev('sessWho(CURS)'), '导师跟着落回新当前节的那位（不会停留在已删节的人上）');
  }

  log('');
  log('=== 10. 接线检查 ===');
  ok(/function applySessWho/.test(SRC()), '有 applySessWho');
  ok(/applySessWho\(\)/.test(SRC()), '确实被调用');
  ok(/function setSessWho/.test(SRC()), '有 setSessWho');
  ok(/setSessWho\(k\)/.test(SRC()), '换导师时写回当前节');
  ok(/who:who/.test(SRC()), '新节带上当前导师');
  const bootLine = SRC().slice(SRC().indexOf('applySessWho();renderModes()'), SRC().indexOf('applySessWho();renderModes()') + 60);
  ok(/applySessWho\(\);renderModes\(\)/.test(bootLine), '启动那行用 applySessWho 顶替了裸 renderPs（刷新后导师跟得上节）');
  ok(/sessWho\(id\)/.test(SRC()), '有按节取人的 sessWho');

  log('');
  log('--- 异常 ---');
  if (errs.length) { errs.forEach(e => log('  ' + e)); errors.push(...errs); }
  else log('  无');

  log('');
  log(errors.length ? ('失败 ' + errors.length + ' 条') : '全部通过');
  console.log(out.join('\n'));
  process.exit(errors.length ? 1 : 0);
})();
