/* 「节」：课程内的学习单元
 *
 * 背景（用户原话）：「我要删的是课程标签……如果不同节在同一个标签下，那我积累了很长的对话后，
 * 之前的闪卡和总结怎么看？如果每次新开一个标签，标签又岂不是太多了？」
 * —— 这是两难：标签按「节」分就无穷无尽，全塞在一个标签里又翻不到旧内容。
 *
 * 解：把「课程」和「书里的节」分开——
 *   课程标签 ＝ 一本书（少而稳）；节 ＝ 一次学习（想开多少开多少，在课程内部，不占标签）。
 *   每节自己的对话、闪卡、小结；切回第 2 节看到的就是第 2 节的东西。
 *
 * 关键约束（本测试守的就是这些）：
 *   · 升级不改写历史数据：老消息没有 s 字段，一律归第一节；老闪卡同理
 *   · 节之间的对话完全隔离：发给导师的上下文只含当前节（不然「越聊越长」又回来了）
 *   · 编辑重发只截断本节，不牵连别的节
 *   · 清空会话只清本节；删除节不影响闪卡与教材
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
    end() { ended = true; while (waiters.length) waiters.shift()({ done: true }); },
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

(async () => {
  let feeder = makeFeeder();
  let lastPack = null;
  const vc = new VirtualConsole();
  const errors = [], out = [];
  const log = s => out.push(s);
  const ok = (c, m) => { log((c ? '✓ ' : '✗ ') + m); if (!c) errors.push(m); };
  const wait = ms => new Promise(r => setTimeout(r, ms));

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
      win.confirm = () => true; win.alert = () => {};
      /* 升级前的老数据：消息与闪卡都没有 s 字段，也没有 sess. 键 */
      win.localStorage.setItem('gx.msgs.__free', JSON.stringify([
        { r: 'user', c: '老问题一：极限是什么' }, { r: 'a', c: '老回答一' },
        { r: 'user', c: '老问题二' }, { r: 'a', c: '老回答二' }
      ]));
      win.localStorage.setItem('gx.cards', JSON.stringify([
        { id: 'old1', q: '老卡一 $x^2$', a: '答', box: 0, due: 0, c: '__free' }
      ]));
      win.fetch = (url, opt) => {
        try { lastPack = JSON.parse(opt.body).messages } catch (e) { lastPack = null }
        return Promise.resolve({ ok: true, status: 200, statusText: 'OK', json: async () => ({}), body: feeder.body });
      };
      win.URL.createObjectURL = () => 'blob:x'; win.URL.revokeObjectURL = () => {};
    }
  });
  const wnd = dom.window, doc = wnd.document;
  await wait(800);
  const ev = s => { try { return wnd.eval(s) } catch (e) { errors.push('eval: ' + e.message); return undefined } };
  const J = s => JSON.parse(ev('JSON.stringify(' + s + ')'));
  const msgs = () => [...doc.querySelectorAll('#mw .msg')];
  const stabs = () => [...doc.querySelectorAll('#stabs .stab[data-s]')];

  /* ---------- 1. 升级兼容 ---------- */
  log('=== 1. 升级兼容：老对话自动归第一节 ===');
  ok(ev('SESS.length') === 1, '一门课至少有一节');
  ok(ev('CURS===SESS[0].id'), '默认停在第一节');
  ok(ev('LS.g("sess.__free",[]).length') === 1, '节列表已落盘');
  ok(msgs().length === 4, '4 条老对话照常显示（实际 ' + msgs().length + '）');
  ok(ev('MS.every(function(m){return sid(m)===SESS[0].id})'), '老消息一律算第一节');
  ok(ev('LS.g("csel.__free","all")') === 'all', '闪卡默认看全部节');

  /* ---------- 2. 新开一节 ---------- */
  log('=== 2. 新开一节 ===');
  ev('newSess()');
  await wait(20);
  ok(ev('SESS.length') === 2, '节数变 2');
  ok(ev('CURS===SESS[1].id'), '停在新的第二节');
  ok(ev('MS.length') === 4, '旧对话仍在存储里（不是丢了，只是不在这一屏）');
  ok(msgs().length === 0 && !!doc.querySelector('#sempty'), '新节是空的，并给出「这一节还没开始」的提示');
  ok(stabs().length === 2, '节条上有 2 个节');
  ok(doc.querySelector('#newsess') !== null, '有「＋ 新一节」入口');

  /* ---------- 3. 各节消息互不串 ---------- */
  log('=== 3. 各节只显示自己的对话 ===');
  ev('MS.push({r:"user",c:"第二节的问题：行列式怎么算",s:CURS});'
    + 'MS.push({r:"a",c:"第二节的回答",s:CURS});saveMs();reloadMsgs();renderSTabs();');
  await wait(20);
  ok(msgs().length === 2, '第二节只显示自己的 2 条');
  ok(ev('$("mw").textContent.indexOf("老问题一")<0'), '第一节的老对话没有混进来');
  ev('switchSess(SESS[0].id)');
  await wait(20);
  ok(msgs().length === 4, '切回第一节又是 4 条');
  ok(ev('$("mw").textContent.indexOf("第二节的问题")<0'), '第二节的内容不会出现在第一节');
  ev('switchSess(SESS[1].id)');
  await wait(20);
  ok(msgs().length === 2, '再切回第二节，还是那 2 条');

  /* ---------- 4. 发给导师的上下文只含本节 ---------- */
  log('=== 4. 上下文只含当前节（各节独立）===');
  ev('$("key").value="sk-test";$("base").value="https://api.test/v1";$("model").value="m";');
  feeder = makeFeeder();
  ev('ask("这一节的新问题")');
  await wait(60);
  ok(lastPack !== null, '确实调用了接口');
  if (lastPack) {
    const txt = JSON.stringify(lastPack);
    /* system + 这一节已有的 2 条 + 刚问的 1 条；第一节那 4 条一条都不带 */
    ok(lastPack.length === 4, '只发 system + 本节 2 条 + 这一句（实际 ' + lastPack.length + ' 条）');
    ok(txt.indexOf('老问题一') < 0, '第一节的老对话没有被带上');
    ok(lastPack[lastPack.length - 1].content === '这一节的新问题', '最后一条就是刚问的话');
  }
  feeder.feed(seg('回答'));
  feeder.end();
  await wait(80);
  ok(ev('MS[MS.length-1].s===CURS'), '新回答落在当前这一节');
  ok(J('MS.filter(function(m){return sid(m)===SESS[1].id}).length') === 4, '第二节现在是 4 条（2 问 2 答）');

  /* ---------- 5. 编辑重发只截断本节 ---------- */
  log('=== 5. 编辑重发不牵连别的节 ===');
  ev('switchSess(SESS[0].id)');
  await wait(20);
  ev('startEdit(0)');   /* 第一节的第一条提问；它后面本节还有 3 条 */
  await wait(20);
  const hint = doc.querySelector('.edhint');
  ok(hint !== null, '给出了「会清掉后面几条」的提示');
  ok(!!hint && hint.textContent.indexOf('3') >= 0, '只数本节里后面的 3 条（实际：' + (hint ? hint.textContent : '无') + '）');
  ok(ev('MS.length') === 8, '此时两节加起来 8 条（4+4）');
  const okb = doc.querySelector('.edbar .pri');
  if (okb) {
    doc.querySelector('.edta').value = '老问题一（改过）';
    feeder = makeFeeder();
    okb.click();
    await wait(60);
    feeder.feed(seg('重答'));
    feeder.end();
    await wait(80);
  }
  ok(J('MS.filter(function(m){return sid(m)===SESS[1].id}).length') === 4,
    '第二节的 4 条没被这次重发删掉（实际 ' + J('MS.filter(function(m){return sid(m)===SESS[1].id}).length') + '）');
  ok(J('MS.filter(function(m){return sid(m)===SESS[0].id}).length') === 2, '第一节被截断成 2 条（问 + 重答）');
  ok(ev('$("mw").textContent.indexOf("改过")>=0'), '重发的那句已在第一节里');

  /* ---------- 6. 清空会话只清本节 ---------- */
  log('=== 6. 「清空会话」只清这一节 ===');
  ev('switchSess(SESS[1].id)');
  await wait(20);
  ev('$("clr").onclick()');
  await wait(20);
  ok(J('MS.filter(function(m){return sid(m)===SESS[1].id}).length') === 0, '第二节清空了');
  ok(J('MS.filter(function(m){return sid(m)===SESS[0].id}).length') > 0, '第一节的对话留着');

  /* ---------- 7. 闪卡按节 ---------- */
  log('=== 7. 闪卡按节分开 ===');
  ok(ev('sid(CD[0])===SESS[0].id'), '升级前的老卡归第一节');
  ev('addCards([{q:"第二节的卡",a:"答"}])');
  await wait(20);
  ok(ev('CD[CD.length-1].s===SESS[1].id'), '新卡记住是在哪一节加的');
  ev('CARD_S="all";renderCards()');
  ok(ev('cardList().length') === 2, '看全部：2 张');
  ev('CARD_S=SESS[0].id;renderCards()');
  ok(ev('cardList().length') === 1, '只看第一节：1 张');
  ok(doc.querySelector('#cse') !== null && doc.querySelectorAll('#cse option').length === 3, '闪卡页有「全部节 + 2 节」的下拉');
  ev('CARD_S=SESS[1].id;renderCards()');
  ok(ev('cardList().length') === 1 && ev('cardList()[0].q') === '第二节的卡', '只看第二节：拿到那 1 张');

  /* ---------- 8. 删节 ---------- */
  log('=== 8. 删除一节 ===');
  ev('CARD_S="all";renderCards();delSess(SESS[1].id)');
  await wait(20);
  ok(ev('SESS.length') === 1, '只剩一节');
  ok(J('MS.filter(function(m){return !m.s||m.s===SESS[0].id}).length') === ev('MS.length'), '第二节的消息清干净了');
  ok(ev('CD.length') === 2, '闪卡不受影响，都留着');
  ok(ev('CURS===SESS[0].id'), '删掉当前节后自动回落到还存在的节');

  /* ---------- 9. 节名 ---------- */
  log('=== 9. 节名 ===');
  ok(ev('sessLabel(SESS[0].id).indexOf("第 1 节")===0'), '节名前缀是「第 N 节」');
  ok(ev('sessAuto(SESS[0].id).length') > 0, '没起名字时用第一条提问当名字（' + ev('sessAuto(SESS[0].id)') + '）');
  ev('SESS[0].title="我的第一节";saveSess();');
  ok(ev('sessLabel(SESS[0].id)') === '第 1 节 · 我的第一节', '起了名字就用自己的');

  log('');
  log(errors.length ? ('--- 失败 ' + errors.length + ' ---') : '全部通过');
  console.log(out.join('\n'));
  if (errors.length) { console.log(errors.map(e => '  ✗ ' + e).join('\n')); process.exit(1) }
})().catch(e => { console.error('崩了：', e); process.exit(1) });
