/* 2026-11-09 这轮的专项回归：
 *   1) 「导师」全站更名「伙伴」；#start 的确认框文案与判据一致
 *   2) 聊天式头像：用户可取名/传图，伙伴可传图，没传就用名字首字
 *   3) 三门教材并列；自由问答改成「课余 · 群聊」，成员从已创立的伙伴里挑
 *   4) 群聊：一句话 → 每位成员各回一条，消息带头像与名字，独立存储、老记录迁移
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
      win.fetch = (url, opt) => {
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
  const ok = (c, m) => { log((c ? '✓ ' : '✗ ') + m); if (!c) errors.push(m); };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const src = HTML();

  /* ============ 1. 全站更名 + 确认框判据 ============ */
  log('=== 1. 「导师」→「伙伴」与开课确认框 ===');
  {
    ok(src.indexOf('导师') < 0, '页面源码里已经没有「导师」这个称呼');
    ok(src.indexOf('选择伙伴') >= 0 && src.indexOf('推荐一位伙伴') >= 0,
      '向导 / 推荐入口都写成「伙伴」');
    ok(/if\(cur\.length&&confirm\(/.test(src), '「确定＝开新的一节」不再取反（!confirm 已修）');
    const { wnd, errs } = boot({ width: 1024 });
    const doc = wnd.document;
    await wait(850);
    const ev = s => { try { return wnd.eval(s); } catch (e) { errors.push('eval: ' + e.message); return undefined; } };
    ok(ev('meName()') === '我', '没取名时默认叫「我」');
    ok(errs.length === 0, '更名后启动无 JS 异常：' + errs.join(' | '));
    wnd.close();
  }

  /* ============ 2. 名片与头像 ============ */
  log('');
  log('=== 2. 名片与头像（首字 / 上传 / 聊天气泡） ===');
  {
    const { wnd, errs } = boot({ width: 1024 });
    const doc = wnd.document;
    await wait(850);
    const ev = s => { try { return wnd.eval(s); } catch (e) { errors.push('eval: ' + e.message); return undefined; } };
    const q = s => doc.querySelector(s);
    const qa = s => Array.from(doc.querySelectorAll(s));

    ok(!!q('#myname') && !!q('#myavup') && !!q('#myavclr') && !!q('#avlist'),
      '设置页有「我的名片与头像」整块入口');
    ok(qa('#avlist .avitem').length === ev('pKeys().length'), '每位伙伴一行，可单独传图 / 清除');
    ok(qa('#avlist .avitem img').length === 0, '默认一张图都没有，全是名字首字');
    ok(/柯/.test(qa('#avlist .avitem')[0].textContent), '首字头像取的是伙伴名字首字');

    ok(/class="av/.test(ev('avHtml("cauchy","柯西")')) && /柯/.test(ev('avHtml("cauchy","柯西")')),
      'avHtml：没图就渲染带首字的圆角方块');
    ev('MECARD.name="小明";LS.s("me",MECARD);renderIdCard();reloadMsgs();');
    ok(ev('meName()') === '小明', '给自己取名后 meName() 跟着变');
    ok(/小/.test(q('#myav').textContent), '我的头像变成「小」字');

    const img1 = 'data:image/jpeg;base64,AAAA', img2 = 'data:image/png;base64,BBBB';
    ev('MECARD.av=' + JSON.stringify(img1) + ';AVS.cauchy=' + JSON.stringify(img2)
      + ';LS.s("me",MECARD);LS.s("avatars",AVS);renderIdCard();renderLaunch();reloadMsgs();');
    ok(!!q('#myav img') && q('#myav img').src === img1, '我上传的头像显示在名片里');
    ok(qa('#avlist .avitem img').length === 1, '伙伴头像只给上传过的那一位换成图片');
    ok(!!q('#lhWho .lh-av img'), '开课向导的大卡也显示上传的头像');

    ev('MS=[{r:"user",c:"你好",s:CURS},{r:"a",c:"在的",s:CURS}];saveMs();reloadMsgs();');
    const msgs = qa('#mw .msg');
    ok(msgs.length === 2, '两条对话照常渲染');
    ok(!!msgs[0].querySelector('.avbox .av') && msgs[0].classList.contains('me'),
      '自己那条有头像、靠右');
    ok(!!msgs[1].querySelector('.avbox .av') && !msgs[1].classList.contains('me'),
      '伙伴那条也有头像、靠左');
    ok(msgs[0].querySelector('.who').textContent.indexOf('小明') === 0, '气泡上写的是我取的名字');
    ok(/柯西/.test(msgs[1].querySelector('.who').textContent), '伙伴气泡上写伙伴名字');
    ok(msgs[0].querySelector('.av img') !== null && msgs[1].querySelector('.av img') !== null,
      '两条都用上传的图（没上传才是首字）');

    ok(ev('bkpKeys().indexOf("gx.me")>=0') && ev('bkpKeys().indexOf("gx.avatars")>=0'),
      '名片与头像会跟着备份一起导出');
    q('#myavclr').click();
    ok(/小/.test(q('#myav').textContent) && !q('#myav img'), '点「清除」换回名字首字');
    ok(errs.length === 0, '头像流程没有 JS 异常：' + errs.join(' | '));
    wnd.close();
  }

  /* ============ 3. 三门教材并列 + 群聊在课余 ============ */
  log('');
  log('=== 3. 三门教材并列，群聊移进「课余」 ===');
  {
    const { wnd, errs } = boot({ width: 1024 });
    const doc = wnd.document;
    await wait(850);
    const ev = s => { try { return wnd.eval(s); } catch (e) { errors.push('eval: ' + e.message); return undefined; } };
    const q = s => doc.querySelector(s);
    const qa = s => Array.from(doc.querySelectorAll(s));

    ev('CH=['
      + '{id:"a.md#1",file:"第1章_函数与极限.md",title:"极限",txt:"内容"},'
      + '{id:"b.md#1",file:"第1章 行列式.md",title:"行列式",txt:"内容"},'
      + '{id:"c.md#1",file:"第1章 C语言概述.md",title:"C语言",txt:"内容"}'
      + '];renderBook();');
    await wait(40);
    const names = ev('JSON.stringify(visibleCourses().map(function(g){return cname(g.k)}))');
    ok(JSON.parse(names).length === 3, '可见课程 3 门，实际 ' + names);
    ok(/高等数学/.test(names) && /解析几何与线性代数/.test(names) && /C语言/.test(names),
      '高数 / 解析几何与线性代数 / C 语言是并列的独立课程');
    ok(ev('visibleCourses().every(function(g){return g.k!=="__free"})'),
      '自由问答不再占一个课程标签');
    ok(qa('#ctabs .ctab').length === 3, '课程标签栏正好 3 个');
    ok(ev('cname("__free")') === '群聊', '__free 显示名改成「群聊」');
    ok(!!q('[data-v="chat"][data-g="life"]'), '群聊按钮挂在「课余」分组');
    ok(!!q('#v-chat') && !!q('#chatmembers') && !!q('#chatlog'), '群聊视图骨架齐全');
    ev('syncNavGroup("chat")');
    ok(doc.body.dataset.navgrp === 'life', '点群聊会切到「课余」标签组');
    ok(qa('#chatmembers .memchip').length === ev('pKeys().length'),
      '成员从已创立的伙伴里列出来（含自定义人设）');
    ok(errs.length === 0, '课程 / 群聊骨架没有 JS 异常：' + errs.join(' | '));
    wnd.close();
  }

  /* ============ 4. 群聊：选人、各回一条、独立存储 ============ */
  log('');
  log('=== 4. 群聊成员与多伙伴回复 ===');
  {
    const { wnd, errs } = boot({ width: 1024 });
    const doc = wnd.document;
    await wait(850);
    const ev = s => { try { return wnd.eval(s); } catch (e) { errors.push('eval: ' + e.message); return undefined; } };
    const q = s => doc.querySelector(s);
    const qa = s => Array.from(doc.querySelectorAll(s));

    ok(ev('CHAT_MAX') === 3, '含我最多 4 人 → 伙伴上限 3 位');
    ok(ev('GMEM.length') === 2, '默认两位伙伴在群里');
    const chips = qa('#chatmembers .memchip');
    ok(chips.filter(c => c.classList.contains('on')).length === 2, '选中的成员高亮');
    chips[2].click();
    ok(ev('members().length') === 3 && ev('LS.g("chat.members",[]).length') === 3,
      '点一位加进群，选择写进 gx.chat.members');

    /* 满员：第 4 位伙伴加不进来，界面要说明怎么换人 */
    qa('#chatmembers .memchip')[3].click();
    ok(ev('members().length') === 3 && ev('LS.g("chat.members",[]).length') === 3,
      '满 3 位后再点第 4 位伙伴被拦下，成员数不变（含我仍 4 人）');
    ok(/最多 4 人/.test((q('#toast') || {}).textContent || ''),
      '并提示「含你最多 4 人，先移出一位」');
    ok(qa('#chatmembers .memchip')[3].classList.contains('full'),
      '满员时没进群的伙伴置灰');

    chips[2].click();
    ok(ev('members().length') === 2, '再点一次移出群');
    qa('#chatmembers .memchip')[3].click();
    ok(ev('members().length') === 3, '移出一位后就能换人进来');
    qa('#chatmembers .memchip')[3].click();
    ok(ev('members().length') === 2, '把刚换进来的再移出');
    qa('#chatmembers .memchip')[0].click();
    ok(ev('members().length') === 1, '可以只剩一位');
    qa('#chatmembers .memchip').filter(c => c.classList.contains('on'))[0].click();
    ok(ev('members().length') === 1, '但至少留一位，最后一位移不出去');
    ok(/含你 2\/4 人/.test(q('#chathint').textContent), '人数提示写明「含你 2/4 人」');

    ev('$("key").value="k";$("base").value="https://x.test/v1";$("model").value="m";');
    ev('GMEM=["cauchy","newton"];saveMem();renderChat();');
    await ev('chatAsk("大家好")');
    await wait(80);
    ok(ev('GCHAT.length') === 3, '一句提问 + 两位伙伴各回一条 = 3 条');
    ok(ev('GCHAT[0].r') === 'user' && ev('GCHAT[0].c') === '大家好', '提问存进 gx.chat');
    ok(ev('JSON.stringify(GCHAT.slice(1).map(function(m){return m.w}))') === '["cauchy","newton"]',
      '两条回复各自记着是哪位伙伴说的');
    ok(ev('GCHAT[1].c') === '收到啦' && ev('GCHAT[2].c') === '收到啦', 'SSE 流式内容收全了');
    ok(ev('LS.g("chat",[]).length') === 3, '群聊消息落盘，和 msgs.* 完全分开');
    ok(ev('LS.g("msgs."+COURSE,[]).length') === 0, '课堂对话没有被群聊污染');
    const cm = qa('#chatmw .msg');
    ok(cm.length === 3, '群聊区渲染三条消息');
    ok(cm[0].classList.contains('me') && /我/.test(cm[0].querySelector('.who').textContent),
      '自己那条带头像、靠右、写着「我」');
    ok(/柯西/.test(cm[1].querySelector('.who').textContent)
      && /牛顿/.test(cm[2].querySelector('.who').textContent), '回复分别挂着伙伴名字');
    ok(cm.every(m => !!m.querySelector('.avbox .av')), '三条都有头像');
    ok(/群聊规则/.test(ev('chatSys("cauchy")')), '群聊提示词写明「只代表自己、别替别人发言」');
    q('#chatclr').click();
    ok(ev('GCHAT.length') === 0 && !!q('#chatmw .empty'), '清空群聊只清这一室');

    /* 上限是硬约束：哪怕运行时被塞进 5 位成员，也只按 3 位发请求 */
    let calls = 0; const f0 = wnd.fetch;
    wnd.fetch = function (u, o) { calls++; return f0(u, o); };
    ev('GMEM=pKeys().slice(0,5);saveMem();renderChat();');
    ok(ev('members().length') === 3, '5 位成员被裁到 3 位，界面高亮＝实际回复数');
    ok(qa('#chatmembers .memchip.on').length === 3, '只高亮 3 位，不会「看着 5 个、回了 3 条」');
    await ev('chatAsk("再问一句")');
    await wait(80);
    ok(calls === 3, '只发 3 次请求，不打爆额度（实际 ' + calls + ' 次）');
    ok(ev('GCHAT.length') === 4, '1 句提问 + 3 条回复');
    wnd.fetch = f0;
    ok(errs.length === 0, '群聊流程没有 JS 异常：' + errs.join(' | '));
    wnd.close();
  }

  /* ============ 5. 老「自由问答」记录搬进群聊 + 体验版 ============ */
  log('');
  log('=== 5. 老记录迁移 / LITE 体验版 ===');
  {
    const A = boot({ width: 1024, storage: {
      'gx.msgs.__free': JSON.stringify([
        { r: 'user', c: '老问题一' }, { r: 'a', c: '老回答一' }, { r: 'user', c: '老问题二' }
      ])
    } });
    await wait(850);
    ok(A.wnd.eval('GCHAT.length') === 3, '老自由问答的 3 条记录搬进群聊');
    ok(A.wnd.eval('LS.g("chat.migrated",0)') === 1, '只搬一次，做了标记');
    ok(A.wnd.eval('(LS.g("msgs.__free",[])||[]).length') === 3, '原键保留，不删旧数据');
    ok(A.errs.length === 0, '迁移没有 JS 异常：' + A.errs.join(' | '));

    const B = boot({ width: 390, url: 'https://demo.github.io/' });
    await wait(850);
    const bd = B.wnd.document;
    ok(B.wnd.eval('LITE') === true, 'github.io 判定为体验版');
    ok(bd.querySelector('[data-v="chat"]').style.display !== 'none', '体验版课余仍保留群聊');
    ok(bd.querySelectorAll('#chatmembers .memchip').length === 3, '体验版成员只给前三位伙伴');
    ok(B.errs.length === 0, '体验版群聊没有 JS 异常：' + B.errs.join(' | '));
    A.wnd.close(); B.wnd.close();
  }

  /* ============ 6. 备份 / 老数据带回超额成员 ============ */
  log('');
  log('=== 6. 备份带回超额成员，启动就裁到上限 ===');
  {
    const C = boot({ width: 1024, storage: {
      'gx.chat.members': JSON.stringify(
        ['cauchy', 'leibniz', 'newton', 'aemeath', 'verina', 'changli'])
    } });
    await wait(850);
    const cd = C.wnd.document;
    ok(C.wnd.eval('GMEM.length') === 3, '备份带回 6 位伙伴，启动就裁到 3 位（含我 4 人）');
    ok(C.wnd.eval('(LS.g("chat.members",[])||[]).length') === 3,
      '并写回存储，下次打开不会又冒出 6 位');
    ok(C.wnd.eval('members().length') === 3, '实际回复人数与上限一致');
    ok(cd.querySelectorAll('#chatmembers .memchip.on').length === 3, '只高亮 3 位');
    ok(C.errs.length === 0, '超额成员规范化没有 JS 异常：' + C.errs.join(' | '));
    C.wnd.close();
  }

  /* ============ 7. 手机群聊：成员区不许把对话挤没 ============ */
  log('');
  log('=== 7. 手机群聊：成员区收成一行，悬浮胶囊不挡消息 ===');
  {
    const src = HTML();
    ok(/body\.mobile \.chatmem\{[^}]*flex-wrap:nowrap[^}]*overflow-x:auto/.test(src),
      '手机上 .chatmem 单行横滑（原来是 3 行 185px，对话区只剩一条缝）');
    ok(/body\.mobile #chatmembers\{flex-wrap:nowrap\}/.test(src),
      '成员胶囊跟着单行排，不再换行堆高');
    ok(/body\.mobile:not\(\[data-view="lesson"\]\) #mfab\{display:none\}/.test(src),
      '「偏好 / Ω」只在课堂页露出，其他页不压在内容上');

    /* jsdom 没有布局，量不了高度，但能确认「收起来」不等于「删掉」：
       8 位伙伴的胶囊、提示文案、点击加人都得还在。 */
    const D = boot({ width: 1024 });
    await wait(850);
    const dd = D.wnd.document;
    dd.body.classList.add('mobile', 'compact');
    dd.body.dataset.view = 'chat';
    ok(dd.querySelectorAll('#chatmembers .memchip').length === D.wnd.eval('pKeys().length'),
      '收成一行后成员胶囊一个没少（仍是全部伙伴）');
    ok(!!dd.getElementById('chathint') && /含你 \d\/4 人/.test(dd.getElementById('chathint').textContent),
      '人数提示还在（横向滑到头就能看到，顶栏也有一份）');
    ok(D.errs.length === 0, '手机群聊没有 JS 异常：' + D.errs.join(' | '));
    D.wnd.close();
  }

  console.log(out.join('\n'));
  console.log('\n--- 异常 ---\n  ' + (errors.length ? errors.join('\n  ') : '无'));
  if (errors.length) { console.log('\n失败 ' + errors.length + ' 条'); process.exit(1); }
  console.log('\n全部通过');
})();
