/* 2026-11-09 晚这轮的专项回归：
 *   1) 左侧「课程 → 节」树：三门教材平级、节挂在各自课程下面、点课程/点节/新一节
 *   2) 课堂偏好：自定义文字、字数百分比、保存/清空、进 sysMsg、随备份导出
 *   3) 群聊多会话：另开一个、消息互不串、历史切换、删除、老数据迁移
 *   4) 向导 ✕：收起向导并落到「未开课」空态；手机点上课仍必须先选伙伴和节奏
 *   5) 手机对标外壳：顶部 tab / 底部大胶囊 / 四个主 tab / 右下悬浮工具
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const HTML = () => fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
  .replace(/<script src="https:[^"]+"><\/script>/g, '');

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
            put: o => { s.set(o.id, o); return {} },
            getAll: () => ({ result: [...s.values()] }),
            delete: id => { s.delete(id); return {} },
            clear: () => { s.clear(); return {} }
          };
          const t = { objectStore: () => os };
          setTimeout(() => { if (t.oncomplete) t.oncomplete(); }, 0);
          return t;
        }
      };
      setTimeout(() => { r.result = db; if (r.onsuccess) r.onsuccess({ target: { result: db } }); }, 0);
      return r;
    }
  };
}
function sse(text) {
  const body = 'data: {"choices":[{"delta":{"content":' + JSON.stringify(text) + '}}]}\n\n'
    + 'data: [DONE]\n\n';
  return {
    ok: true, status: 200, statusText: 'OK', json: async () => ({}),
    body: {
      getReader() {
        let done = false;
        return { read() {
          if (done) return Promise.resolve({ done: true });
          done = true;
          return Promise.resolve({ done: false, value: new TextEncoder().encode(body) });
        } };
      }
    }
  };
}
function boot(opts) {
  opts = opts || {};
  const vc = new VirtualConsole(); const errs = [];
  vc.on('jsdomError', e => {
    const s = e.message || String(e);
    if (/Not implemented: navigation/.test(s)) return;
    errs.push('jsdomError: ' + s);
  });
  const dom = new JSDOM(HTML(), {
    url: opts.url || 'https://x.test/',
    runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      installIDB(win);
      if (opts.width !== undefined) {
        Object.defineProperty(win, 'innerWidth', { value: opts.width, configurable: true, writable: true });
      }
      win.confirm = () => true; win.alert = () => {}; win.open = () => null;
      win.__fetches = 0;
      win.fetch = (url, opt) => {
        win.__fetches++;
        if (/\/api\/chat|\/chat\/completions/.test(String(url))) return Promise.resolve(sse('收到啦'));
        return Promise.reject(new Error('测试不联网'));
      };
      win.URL.createObjectURL = () => 'blob:x'; win.URL.revokeObjectURL = () => {};
      Object.keys(opts.storage || {}).forEach(k => win.localStorage.setItem(k, opts.storage[k]));
    }
  });
  return { wnd: dom.window, errs };
}

(async () => {
  const out = [], errors = [];
  const log = s => out.push(s);
  const ok = (c, m) => { log((c ? 'OK  ' : 'BAD ') + m); if (!c) errors.push(m); };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const src = HTML();

  /* ============ 1. 源码骨架 ============ */
  log('=== 1. 结构：新入口都在，老入口没删 ===');
  ok(/id="ctree"/.test(src), '左侧课程树容器存在');
  ok(/#stage>#ctabs,#stage>#stabs\{display:none\}/.test(src),
    '顶部两行横排标签在桌面隐藏，但 DOM 保留（老事件 / 老测试还在）');
  ok(/id="prefpanel"/.test(src) && /id="preftxt"/.test(src) && /id="prefopen"/.test(src),
    '课堂偏好：入口 + 面板 + 输入框');
  ok(/id="notstarted"/.test(src) && /id="nsGo"/.test(src), '未开课空态与「开始上课」出口');
  ok(/id="chatsessions"/.test(src) && /id="chatnew"/.test(src) && /id="chatdel"/.test(src),
    '群聊：会话历史条 + 新会话 + 删除会话');
  ok(/id="mtabs"/.test(src) && /id="mcaps"/.test(src) && /id="mtabbar"/.test(src) && /id="mfab"/.test(src),
    '手机对标外壳四块都在');
  ok(/【课堂偏好 · 学习者自己写的】/.test(src), '课堂偏好会拼进 sysMsg');
  ok(/function renderCourseTree\(/.test(src) && /function newChat\(/.test(src),
    '课程树与多会话函数都在');

  /* ============ 2. 桌面：课程树 ============ */
  log('');
  log('=== 2. 左侧课程树：三门并列，节各自收纳 ===');
  {
    const A = boot(); const w = A.wnd, doc = w.document;
    const q = s => doc.querySelector(s), qa = s => [...doc.querySelectorAll(s)], ev = s => w.eval(s);
    await wait(120);
    ev(`window.__idb=[];PACKS.forEach(p=>p.files.forEach(f=>window.__idb.push({id:f+'#1',file:f,title:'测试节',txt:'内容'})));
         CH=window.__idb.slice();updateCourses();`);
    await wait(40);
    const crs = qa('#ctree .ct-crs');
    ok(crs.length === 3, '树里三门教材平级并列，实际 ' + crs.length);
    const names = qa('#ctree .ct-nm').map(x => x.textContent);
    log('课程名: ' + JSON.stringify(names));
    ok(names.some(n => n.indexOf('高等数学') >= 0) && names.some(n => n.indexOf('解析几何') >= 0)
      && names.some(n => n.indexOf('C语言') >= 0), '三个课程名都在树上');
    ok(qa('#ctree .ct-s[data-s]').length >= 1, '展开的那门课下面挂着它的节');
    ok(qa('#ctree .ct-s.new').length === 1, '展开的课有「＋ 新一节」');
    ok(qa('#ctabs .ctab').length === 3, '原来的课程标签 DOM 仍在（没删功能）');

    const k2 = qa('#ctree .ct-c')[1].dataset.c;
    qa('#ctree .ct-c')[1].click();
    ok(ev('COURSE') === k2, '点课程名＝切到那门课');
    ok(q('#ctree').dataset.open === k2, '点课程同时展开它的节');
    ok(qa('#ctree .ct-crs.on').length === 1, '当前课程在树里高亮');

    const sEl = qa('#ctree .ct-s[data-s]')[0], sid = sEl.dataset.s;
    sEl.click();
    ok(ev('CURS') === sid, '点节＝切到那一次学习');
    ok(qa('#ctree .ct-s.on').length === 1, '当前节在树里高亮');

    qa('#ctree .ct-s.new')[0].click();
    ok(q('#launch').hidden === false, '树里的「＋ 新一节」也必经开课向导');
    ok(A.errs.length === 0, '课程树流程无 JS 异常：' + A.errs.join(' | '));
    w.close();
  }

  /* ============ 3. 课堂偏好 ============ */
  log('');
  log('=== 3. 课堂偏好：保存 / 清空 / 生效 / 备份 ===');
  {
    const A = boot(); const w = A.wnd, doc = w.document;
    const q = s => doc.querySelector(s), ev = s => w.eval(s);
    await wait(120);
    ok(q('#prefpanel').hidden === true, '偏好面板默认收起');
    q('#prefopen').click();
    ok(q('#prefpanel').hidden === false, '点右下角「偏好」打开卡片');

    const t = q('#preftxt');
    t.value = '多用生活中的例子，每次只问一个问题';
    t.dispatchEvent(new w.Event('input', { bubbles: true }));
    ok(q('#pfpct').textContent !== '0%' && /%$/.test(q('#pfpct').textContent),
      '字数百分比随输入变化：' + q('#pfpct').textContent);
    ok(q('#pfsave').disabled === false, '有改动时「保存」才可点');
    q('#pfsave').click();
    ok(ev('PREF') === t.value && ev('LS.g("pref","")') === t.value, '保存写进 gx.pref 并落盘');
    ok(ev('sysMsg()').indexOf('多用生活中的例子') >= 0, '偏好拼进了系统提示词');
    ok(ev('sysMsg().indexOf("【课堂偏好") < sysMsg().indexOf("【节奏权归学习者")'),
      '偏好排在 EXIT 之前：比人格/模式优先，压不过当场节奏命令');
    ok(ev('bkpKeys().indexOf("gx.pref") >= 0'), '偏好随一键备份导出');
    ok(q('#pfsave').disabled === true, '保存后按钮回到禁用态');

    q('#pfclr').click();
    ok(ev('PREF') === '' && q('#pfpct').textContent === '0%', '清空后偏好与百分比归零');
    q('#pfpace').click();
    ok(doc.body.classList.contains('paceopen'), '偏好面板里仍能展开原来的节奏命令条');
    ok(q('#pacebar') !== null && q('#pctoggle') !== null, '节奏命令条功能没删，只是收起');
    ok(/body\.paceopen #pacebar\{display:flex\}/.test(src), 'CSS 里 paceopen 时恢复显示');
    ok(A.errs.length === 0, '偏好流程无 JS 异常：' + A.errs.join(' | '));
    w.close();
  }

  /* ============ 4. 群聊多会话 ============ */
  log('');
  log('=== 4. 群聊：单独另开会话、记录互不串 ===');
  {
    const A = boot(); const w = A.wnd, doc = w.document;
    const q = s => doc.querySelector(s), ev = s => w.eval(s);
    await wait(120);
    ok(ev('CSESS.length') === 1, '启动默认一个群聊会话');
    ok(q('#chatsessions').children.length === 1, '历史条只有一个 chip');
    q('#chatnew').click();
    ok(ev('CSESS.length') === 2 && ev('GCHAT.length') === 0, '「＋ 新会话」另开一个空会话');
    ok(q('#chatsessions').children.length === 2 && q('#chatsessions').children[1].className === 'on',
      '新会话在历史条里高亮');

    ev('document.getElementById("key").value="k";document.getElementById("base").value="https://api.test"');
    await w.eval('chatAsk("聊聊极限")');
    await wait(30);
    ok(ev('GCHAT.length') >= 3, '新会话里：我一句 + 每位伙伴各一条，实际 ' + ev('GCHAT.length'));
    ok(/极限/.test(q('#chatsessions').children[1].textContent), '会话名取第一句提问');
    ok(ev('LS.g("chat.log."+CCUR,[]).length') === ev('GCHAT.length'), '当前会话消息单独落盘');

    q('#chatsessions').children[0].click();
    ok(ev('GCHAT.length') === 0, '切回旧会话：记录互不串');
    q('#chatsessions').children[1].click();
    ok(ev('GCHAT.length') >= 3, '再切回来消息还在');
    ok(ev('bkpKeys().indexOf("gx.chat.sessions") >= 0')
      && ev('bkpKeys().some(k=>k.indexOf("gx.chat.log.")===0)'),
      '会话名册与各会话消息都随备份导出');

    q('#chatdel').click();
    ok(ev('CSESS.length') === 1, '删除当前会话后只剩一个');
    ok(q('#chatsessions').children.length === 1, '历史条同步');
    ok(ev('members().length') <= 3, '含你最多 4 人的上限没被多会话破坏');
    ok(A.errs.length === 0, '群聊多会话流程无 JS 异常：' + A.errs.join(' | '));
    w.close();
  }

  /* ============ 5. 老群聊数据自动成为第一个会话 ============ */
  log('');
  log('=== 5. 老数据 / 备份恢复 ===');
  {
    const A = boot({ storage: {
      'gx.chat': JSON.stringify([{ r: 'user', c: '老问题', t: 1 }]),
      'gx.chat.migrated': '1'
    } });
    const w = A.wnd, doc = w.document, ev = s => w.eval(s);
    await wait(120);
    ok(ev('GCHAT.length') === 1 && ev('GCHAT[0].c') === '老问题', '老 gx.chat 记录没丢');
    ok(ev('CSESS.length') === 1, '自动补上会话名册');
    ok(doc.querySelector('#chatsessions').children.length === 1, '历史条显示老会话');
    ok(ev('LS.g("chat.log."+CCUR,[]).length') === 1, '老记录写进第一个会话的日志');
    w.close();
  }

  /* ============ 6. 手机：向导 ✕ / 必经选择 / 对标外壳 ============ */
  log('');
  log('=== 6. 手机：点上课必须先选，✕ 有反应，对标外壳可用 ===');
  {
    const A = boot({ width: 390 }); const w = A.wnd, doc = w.document;
    const q = s => doc.querySelector(s), qa = s => [...doc.querySelectorAll(s)], ev = s => w.eval(s);
    await wait(120);
    ok(doc.body.classList.contains('mobile'), '窄屏自动加 body.mobile');
    ok(q('#dTabs #ctree') !== null, '课程树搬进抽屉的「课程与节」');
    ok(q('#dTabs #ctabs') !== null && q('#dTabs #stabs') !== null, '原标签 DOM 仍搬进抽屉（不删）');
    ok(qa('#mtabbar [data-go]').length === 4, '底部四个主 tab');
    ok(qa('#mcaps [data-act]').length === 3, '底部三个大胶囊');
    ok(q('#mfab') !== null && q('#mfSym') !== null, '右下悬浮工具胶囊');

    ok(q('#launch').hidden === false, '手机启动先摆出开课向导');
    q('#lhClose').click();
    ok(q('#launch').hidden === true, '✕ 有反应：整屏向导收起');
    ok(q('#notstarted').hidden === false, '退出后是「这一节还没开课」空态');
    ok(doc.body.classList.contains('pending'), '空态标记为 pending，不反复弹整屏向导');

    const before = w.__fetches;
    await w.eval('ask("绕过向导偷偷提问")');
    ok(q('#launch').hidden === false, '手机未开课时直接提问：摆回向导');
    ok(w.__fetches === before, '没有偷偷发出请求');
    ok(ev('BUSY') === false, '也没把课堂标记成正在回答');

    q('#lhStart').click();
    ok(ev('cfgLocked()') === true && q('#notstarted').hidden === true,
      '点「开始上课 →」才开课、空态收起，伙伴和节奏锁定');
    q('#mtabs [data-go="chat"]').click();
    ok(doc.body.dataset.view === 'chat', '顶部 tab 能切到群聊');
    q('#mtabbar [data-go="lesson"]').click();
    ok(doc.body.dataset.view === 'lesson' && q('#launch').hidden === true,
      '底部「学习」tab 回到课堂，已开课不再拿向导拦人');
    q('#mcaps [data-act="start"]').click();
    ok(q('#launch').hidden === false, '底部「✦ 上课」开新的一节时必经向导');
    ok(A.errs.length === 0, '手机流程无 JS 异常：' + A.errs.join(' | '));
    w.close();
  }

  log('');
  log(errors.length ? '失败 ' + errors.length + ' 条：\n' + errors.join('\n') : '全部通过');
  console.log(out.join('\n'));
  if (errors.length) process.exit(1);
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
