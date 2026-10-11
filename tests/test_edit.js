/* 两个新功能的一致性测试：
 *   1) 说话能改——点自己那条消息的「编辑」，改完「重发」，之后的对话截断后重新回答
 *   2) 操作习惯——设置页能改发送方式（Ctrl+Enter / Enter）、对话字号、符号面板默认状态
 *
 * 重点断言三条容易出错的边界：
 *   · 重发必须从被编辑的那条重新开始（MS 截断），不能把旧回答留在上下文里
 *   · 接口没配置时不许截断（否则对话白丢、还发不出去）
 *   · 中文输入法选字时的 Enter 不能当发送（isComposing）
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

function fakeStream() {
  return {
    ok: true, status: 200, statusText: 'OK', json: async () => ({}),
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

const REPLY = '好$M_{32}$，按行展开。';

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
  let fetchCount = 0;
  const dom = new JSDOM(html, {
    url: 'https://x.test/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      installIDB(win);
      win.confirm = () => true;
      win.alert = m => alerts.push(String(m));
      win.fetch = () => { fetchCount++; return Promise.resolve(fakeStream()); };
      win.URL.createObjectURL = () => 'blob:x'; win.URL.revokeObjectURL = () => {};
    }
  });
  const wnd = dom.window, doc = wnd.document;
  await wait(700);
  const ev = s => { try { return wnd.eval(s); } catch (e) { errors.push('eval: ' + e.message); return undefined; } };
  const q = s => doc.querySelector(s);
  const qa = s => [...doc.querySelectorAll(s)];

  function press(el, opts) {
    const init = Object.assign({ key: 'Enter', bubbles: true, cancelable: true }, opts || {});
    const e = new wnd.KeyboardEvent('keydown', init);
    if (init.isComposing) { try { Object.defineProperty(e, 'isComposing', { value: true }); } catch (_) {} }
    el.dispatchEvent(e);
    return e;
  }
  const sendKeySelect = () => doc.getElementById('sendkey');
  const change = el => el.dispatchEvent(new wnd.Event('change'));

  /* ask() 会先检查接口地址和 Key，空着就直接返回。这里先假装配好 */
  ev('$("key").value="sk-test"; $("base").value="https://api.test/v1";');

  /* === 1. 渲染：每条消息带索引，用户消息才有「编辑」 === */
  log('=== 1. 消息索引与编辑入口 ===');
  ev([
    'CH=[{id:"c.md#1",file:"c.md",title:"行列式",txt:"x"}];',
    'COURSE="c.md"; LS.s("course",COURSE);',
    'MS=[{r:"user",c:"第一问 $M_{32}$"},{r:"a",c:"答复一"},{r:"user",c:"第二问"},{r:"a",c:"答复二"}];',
    'saveMs(); reloadMsgs();'
  ].join('\n'));
  await wait(40);
  {
    const msgs = qa('#mw .msg');
    ok(msgs.length === 4, '渲染出 4 条消息，实际 ' + msgs.length);
    ok(msgs.map(m => m.dataset.i).join(',') === '0,1,2,3',
      'data-i 依次为 0,1,2,3（实际 ' + msgs.map(m => m.dataset.i).join(',') + '）');
    const userBtns = msgs.filter(m => m.classList.contains('me')).map(m => m.querySelector('.who button'));
    const aiBtns = msgs.filter(m => !m.classList.contains('me')).map(m => m.querySelector('.who button'));
    ok(userBtns.every(b => b && b.textContent === '编辑'), '用户消息的按钮是「编辑」');
    ok(aiBtns.every(b => b && b.textContent === '🔊'), '导师消息的按钮还是「朗读」');
    ok(qa('#mw .msg.me button').length === 2 && qa('#mw .msg:not(.me) button').length === 2,
      '两类按钮各 2 个，没有串');
  }

  /* === 2. 打开编辑器 === */
  log('');
  log('=== 2. 打开「编辑」 ===');
  q('#mw .msg[data-i="0"] .who button').click();
  await wait(40);
  {
    const ta = q('#mw .msg[data-i="0"] textarea.edta');
    ok(!!ta, '点「编辑」后出现文本域');
    ok(ta && ta.value === '第一问 $M_{32}$', '文本域里是原始内容（实际 ' + JSON.stringify(ta && ta.value) + '）');
    const bar = qa('#mw .msg[data-i="0"] .edbar button').map(b => b.textContent);
    ok(bar.join(',') === '重发,取消', '有「重发」和「取消」，实际 ' + bar.join('/'));
    const hint = q('#mw .msg[data-i="0"] .edhint');
    ok(hint && hint.textContent.indexOf('3 条对话') >= 0,
      '提示会清掉后面几条（实际 ' + JSON.stringify(hint && hint.textContent) + '）');
    ok(q('#mw .msg[data-i="0"]').classList.contains('editing'), '消息进入 editing 态');
    /* 最后一条消息编辑时不该出现"会清掉后面"的提示 */
    ok(!q('#mw .msg[data-i="3"] .edbar'), '导师消息没有编辑器（3 号是导师的）');
  }

  /* === 3. 取消要能还原 === */
  log('');
  log('=== 3. 取消还原 ===');
  qa('#mw .msg[data-i="0"] .edbar button').find(b => b.textContent === '取消').click();
  await wait(40);
  {
    ok(!q('#mw .msg[data-i="0"] textarea.edta'), '取消后文本域消失');
    ok(!q('#mw .msg[data-i="0"]').classList.contains('editing'), 'editing 态移除');
    ok(q('#mw .msg[data-i="0"] .body').innerHTML.indexOf('第一问') >= 0, '正文渲染回来了');
  }

  /* === 4. 接口没配置：不许截断 === */
  log('');
  log('=== 4. 接口未配置时的保护 ===');
  {
    const keyBefore = ev('$("key").value');
    const baseBefore = ev('$("base").value');
    ev('$("key").value=""; $("base").value="";');
    alerts.length = 0;
    q('#mw .msg[data-i="0"] .who button').click();
    await wait(30);
    q('#mw .msg[data-i="0"] textarea.edta').value = '改过的第一问';
    qa('#mw .msg[data-i="0"] .edbar button').find(b => b.textContent === '重发').click();
    await wait(80);
    ok(ev('MS.length') === 4, '没配接口时不截断，MS 仍是 4 条（实际 ' + ev('MS.length') + '）');
    ok(alerts.length > 0, '并且给了提示：' + (alerts[0] || '').slice(0, 24));
    qa('#mw .msg[data-i="0"] .edbar button').find(b => b.textContent === '取消').click();
    ev('$("key").value=' + JSON.stringify(keyBefore) + '; $("base").value=' + JSON.stringify(baseBefore) + ';');
  }

  /* === 5. 重发：截断 + 重新回答 === */
  log('');
  log('=== 5. 重发 ===');
  {
    const before = fetchCount;
    q('#mw .msg[data-i="0"] .who button').click();
    await wait(40);
    const ta = q('#mw .msg[data-i="0"] textarea.edta');
    ta.value = '改后的第一问：$M_{32}$ 怎么算？';
    qa('#mw .msg[data-i="0"] .edbar button').find(b => b.textContent === '重发').click();
    await wait(200);
    ok(fetchCount > before, '重发真的发出了一次请求');
    ok(ev('MS.length') === 2, 'MS 截断成 2 条（改后的问 + 新答），实际 ' + ev('MS.length'));
    ok(ev('MS[0].c') === '改后的第一问：$M_{32}$ 怎么算？', 'MS[0] 是改过的内容');
    ok(ev('MS[1].r') === 'a' && String(ev('MS[1].c')) === REPLY, 'MS[1] 是新回答');
    ok(qa('#mw .msg').length === 2, '界面上也只剩 2 条消息');
    ok(!ev('JSON.stringify(MS)').match(/答复一|第二问|答复二/), '被截断的旧内容没留在上下文里');
    const stale = qa('#mw .msg').map(m => m.dataset.i).join(',');
    ok(stale === '0,1', '重排后 data-i 重新编号（实际 ' + stale + '）');
  }

  /* === 6. 发送键位：默认 Ctrl+Enter，中文输入法 Enter 不算 === */
  log('');
  log('=== 6. 发送键位（默认 Ctrl+Enter）===');
  {
    ok(ev('SENDKEY') === 'ctrl', '默认仍是 Ctrl+Enter');
    const inp = doc.getElementById('in');
    const n0 = ev('MS.length');
    inp.value = '键盘测试一';
    press(inp, { key: 'Enter' });
    await wait(20);
    ok(ev('MS.length') === n0 && inp.value === '键盘测试一', '裸 Enter 不发送，草稿留着');
    press(inp, { key: 'Enter', ctrlKey: true });
    await wait(150);
    ok(ev('MS.length') === n0 + 2, 'Ctrl+Enter 发送成功（MS +2）');
    ok(inp.value === '', '发送后输入框清空');

    inp.value = '输入法选字';
    press(inp, { key: 'Enter', isComposing: true });
    await wait(20);
    ok(inp.value === '输入法选字', 'isComposing 的 Enter 不发送（中文选字安全）');
    inp.value = '';
  }

  /* === 7. 切到 Enter 发送 === */
  log('');
  log('=== 7. 改成 Enter 发送 ===');
  {
    const s = sendKeySelect();
    ok(!!s, '设置页存在「发送方式」下拉');
    s.value = 'enter'; change(s);
    await wait(30);
    ok(ev('SENDKEY') === 'enter', 'SENDKEY 切到 enter');
    ok(ev('LS.g("sendkey",null)') === 'enter', '选择写进了本地存储');
    ok(String(ev('$("in").placeholder')).indexOf('Enter 发送') >= 0,
      '输入框提示跟着改：' + ev('$("in").placeholder'));
    const inp = doc.getElementById('in');
    const n0 = ev('MS.length');
    inp.value = '回车发送测试';
    press(inp, { key: 'Enter' });
    await wait(150);
    ok(ev('MS.length') === n0 + 2, 'Enter 直接发送（MS +2）');
    inp.value = '换行草稿';
    press(inp, { key: 'Enter', shiftKey: true });
    await wait(20);
    ok(inp.value === '换行草稿', 'Shift+Enter 仍可换行，不发送');
    inp.value = '';
  }

  /* === 8. 其余习惯项 === */
  log('');
  log('=== 8. 字号与符号面板默认状态 ===');
  {
    const f = doc.getElementById('fsz');
    ok(!!f, '设置页存在「对话字号」下拉');
    f.value = '2'; change(f);
    await wait(30);
    ok(doc.body.classList.contains('fs2'), '选「大」后 body 带 fs2');
    ok(ev('LS.g("fsz",null)') === '2', '字号写进本地存储');
    f.value = '1'; change(f);
    await wait(20);
    ok(!doc.body.classList.contains('fs2'), '切回「标准」后 fs2 移除');

    const a = doc.getElementById('symadef');
    ok(!!a, '设置页存在「符号面板默认状态」下拉');
    a.value = '0'; change(a);
    await wait(30);
    ok(ev('SYMA') === 0, '选「默认收起」后 SYMA=0');
    ok(a.value === '0', '下拉本身同步');
    a.value = '1'; change(a);
    await wait(20);
    ok(ev('SYMA') === 1, '切回「默认展开」后 SYMA=1');
    ok(q('#symtoggle').className.indexOf('pri') >= 0, '工具条上那个按钮也跟着亮起来');
  }

  log('');
  log('--- 错误 ---');
  log(errors.length ? errors.join('\n') : '无');
  console.log(out.join('\n'));
  process.exit(errors.length ? 1 : 0);
})();
