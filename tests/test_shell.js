/* 破卷式外壳回归测试：入口收敛 ≠ 功能被删
 *
 * 背景（2026-11-08）：用户截图反馈「现在功能入口太多了」，参照破卷改成
 *   ① 侧栏三标签图标网格（学习 / 课余 / 生态）
 *   ② 开课向导：伙伴 / 节奏 / 模式 / 章节一屏选完，只有一个主按钮
 *   ③ 课堂两排工具栏默认收成一行，点「⋯」原样展开
 *
 * 必须守住的底线：
 *   - 七个视图（含群聊）、原来每一个按钮、每一颗药丸都还在 DOM 里，只是默认 display:none
 *   - 向导里的卡是「遥控器」，点它＝点原来的药丸 ⇒ 每节各记各的伙伴 / 章节、
 *     老数据回落、体验版只给前三位，这些旧逻辑一行都不用重写
 *   - #foot 仍是 <nav> 的直接子元素（test_foot.js 的根因），不能塞回 .nv
 *   - 有对话 / 停在别的页签时，别拿向导拦人
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const SRC = () => fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const HTML = () => SRC().replace(/<script src="https:[^"]+"><\/script>/g, '');

function installIDB(win) {
  const m = new Map();
  win.indexedDB = {
    open(n) {
      if (!m.has(n)) m.set(n, new Map());
      const s = m.get(n); const r = {};
      const db = {
        objectStoreNames: { contains: () => true },
        createObjectStore() { return {} },
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

function boot(storage, url) {
  const vc = new VirtualConsole(); const errs = [];
  vc.on('jsdomError', e => {
    const m = e.message || String(e);
    if (/Not implemented: navigation/.test(m)) return;
    errs.push('jsdomError: ' + m);
  });
  const dom = new JSDOM(HTML(), {
    url: url || 'https://x.test/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      installIDB(win);
      win.confirm = () => true; win.alert = () => {}; win.open = () => null;
      win.fetch = () => Promise.reject(new Error('测试不联网'));
      win.URL.createObjectURL = () => 'blob:x'; win.URL.revokeObjectURL = () => {};
      Object.keys(storage || {}).forEach(k => win.localStorage.setItem(k, storage[k]));
    }
  });
  return { wnd: dom.window, errs };
}

(async () => {
  const out = [], errors = [];
  const log = s => out.push(s);
  const ok = (c, m) => { log((c ? '✓ ' : '✗ ') + m); if (!c) errors.push(m); };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const src = SRC();

  const { wnd, errs } = boot();
  const doc = wnd.document;
  await wait(900);
  const ev = s => { try { return wnd.eval(s); } catch (e) { errors.push('eval: ' + e.message); return undefined; } };
  const q = s => doc.querySelector(s);
  const qa = s => Array.from(doc.querySelectorAll(s));

  /* ============ 1. 结构：入口收起来了，但一个都没删 ============ */
  log('=== 1. 结构：三标签导航 + 原按钮全在 ===');
  {
    ok(qa('#gtabs button').length === 3, '底部有三个分组标签');
    ok(qa('#gtabs button').map(b => b.textContent).join('') === '学习课余生态',
      '标签依次是 学习 / 课余 / 生态');
    const vs = qa('.nv button').map(b => b.dataset.v).sort().join(',');
    ok(vs === 'book,card,chat,lesson,prog,set,vid', '七个视图入口都还在（群聊是第七个）：' + vs);
    ok(qa('.nv button').every(b => !!b.dataset.g && !!b.dataset.ic),
      '每个视图都带分组与图标（图标走 CSS ::before，不污染按钮文字）');
    ok(q('.nv button').textContent === '上课', '按钮文字没被图标撑坏，仍是「上课」');
    ok(!!q('#nvcourse'), '侧栏有当前课程卡');
    const foot = q('#foot');
    ok(!!foot && foot.parentElement.id === 'nav' && !q('.nv #foot'),
      '#foot 仍是 nav 的直接子元素，没被塞回 .nv');

    const need = ['start', 'gen', 'exp2', 'close', 'clr', 'stop', 'pbox', 'mbox', 'pace',
      'tts', 'tok', 'kxst', 'ctxchips', 'rgo2', 'mctrl', 'in', 'send'];
    const miss = need.filter(id => !q('#' + id));
    ok(miss.length === 0, '课堂原工具栏控件一个没删' + (miss.length ? '，缺：' + miss : ''));
    ok(qa('#pacebar [data-cmd]').length >= 7, '九条节奏命令仍在（默认折叠）');
    ok(!!q('#pacebar [data-act="settle"]'), '「今天结束 · 结算」仍在');
    ok(/body\.compact:not\(\.expand\) #lbar1>#pbox/.test(src),
      '桌面端默认收起伙伴药丸的规则在源码里');
    ok(/body\.compact:not\(\.expand\):not\(\.paceopen\) #pacebar>button/.test(src),
      '节奏命令默认折叠的规则在源码里');
    ok(/#launch\[hidden\]\{display:none\}/.test(src), '向导用 hidden 属性开关，不会盖住聊天');
  }

  /* ============ 2. 开课向导：一屏选完，一个主按钮 ============ */
  log('');
  log('=== 2. 开课向导 ===');
  {
    ok(!!q('#launch') && q('#launch').hidden === false, '新的一节还没聊过：启动时自动摆出开课向导');
    ok(qa('.lh-go').length === 1 && !!q('#lhStart'), '整屏只有一个主按钮「开始上课」');
    const n = ev('pKeys().length');
    ok(qa('#lhWho .lh-card').length === n, '伙伴大卡数量＝可选人设数量（' + n + '）');
    ok(qa('#lhPace .lh-opt').length === 3, '教学节奏三选一');
    ok(qa('#lhMode button').length === ev('Object.keys(MODE).length'), '本轮模式全在向导里');
    ok(!!q('#lhCtx') && q('#lhCtx').textContent.length > 0, '带进课堂的章节有摘要');
    ok(!!q('#lhGoBook') && !!q('#lhSwap') && !!q('#lhClose'), '去勾选 / 换课程 / 关闭三个出口都在');
    ok(/开新的一节可重新选择|已经开课/.test(q('.lh-note').textContent),
      '说明「课中固定、开新的一节可重选」（新规则）');
  }

  /* ============ 3. 卡片是遥控器：仍然写回「每一节」 ============ */
  log('');
  log('=== 3. 卡片＝原药丸的遥控器（不另起状态） ===');
  {
    const cards = qa('#lhWho .lh-card');
    const ni = ev('pKeys().indexOf("newton")');
    ok(ni >= 0, '完整版里有牛顿');
    cards[ni].click();
    ok(ev('who') === 'newton', '点大卡真的换了伙伴');
    ok(ev('sessOf(CURS).who') === 'newton', '写回的是当前这一节，不是全局');
    ok(q('#pbox .pill.on') && q('#pbox .pill.on').textContent === '牛顿',
      '课堂那排药丸同步高亮（虽然默认收起）');
    ok(qa('#lhWho .lh-card.on').length === 1, '大卡只有一张选中');

    const opts = qa('#lhPace .lh-opt');
    opts[2].click();
    ok(ev('PA') === 'fast' && q('#pace').value === 'fast', '节奏卡同步了下拉框和 PA');
    ok(ev('sessOf(CURS).pace') === 'fast' && ev('LS.g("sess."+COURSE,null) !== null'),
      '节奏写进当前节（sess 存储），不覆盖全局 gx.pace');

    const drill = qa('#lhMode button').filter(b => b.textContent === '陪练出题')[0];
    ok(!!drill, '向导里有「陪练出题」');
    if (drill) {
      drill.click();
      ok(ev('MODEK') === 'drill', '模式卡同步了 MODEK');
      ok(q('#mbox .pill.on') && q('#mbox .pill.on').textContent === '陪练出题', '原模式药丸同步高亮');
    }
    ok(/牛顿/.test(q('#lsum').textContent), '课堂那一行摘要跟着变');
    ok(/3 章|0 章|1 章|2 章/.test(q('#lsum').textContent) || /章/.test(q('#lsum').textContent),
      '摘要里带章节数');
  }

  /* ============ 4. 三标签 / ⋯ / 节奏折叠 / 主题 ============ */
  log('');
  log('=== 4. 分组与展开开关 ===');
  {
    q('[data-v="set"]').click();
    ok(doc.body.dataset.navgrp === 'eco', '切到设置时侧栏自动切到「生态」组');
    ok(q('#gtabs button.on').textContent === '生态', '分组标签高亮同步');
    ok(/body\[data-navgrp="study"\] \.nv button\[data-g="eco"\]/.test(src),
      '非当前组的图标用 CSS 收起（不删 DOM，老代码点得到）');

    q('#gtabs [data-g="study"]').click();
    ok(doc.body.dataset.navgrp === 'study', '点「学习」能切回来');
    ['lesson', 'book', 'card', 'chat', 'vid', 'prog', 'set'].forEach(v => {
      q('[data-v="' + v + '"]').click();
      ok(q('#v-' + v).classList.contains('on'), '视图「' + v + '」仍然可达');
    });

    q('[data-v="lesson"]').click();
    ok(!doc.body.classList.contains('expand'), '默认收起完整工具栏');
    q('#lexpand').click();
    ok(doc.body.classList.contains('expand'), '点「⋯」展开原工具栏');
    q('#lexpand').click();
    ok(!doc.body.classList.contains('expand'), '再点一次收起');
    q('#pctoggle').click();
    ok(doc.body.classList.contains('paceopen') && /▴/.test(q('#pctoggle').textContent),
      '节奏命令可展开，标签变成「节奏 ▴」');
    ok(/body\.compact:not\(\.expand\):not\(\.paceopen\) #pacebar>button:not\(#pctoggle\)/.test(src),
      '折叠时开关自己不能被一起藏掉，点「⋯」展开时命令全回来');

    q('#symtoggle').click();
    ok(doc.body.classList.contains('symopen'), '「Ω 特殊符号」展开符号抽屉');
    ok(ev('SYMA') === 1 || ev('SYMA') === 0, '没有顺手改掉用户的「进入页面时符号面板」偏好');
    q('#symtoggle').click();
    ok(!doc.body.classList.contains('symopen'), '再点一次收起');
    ok(/body\.compact:not\(\.expand\):not\(\.symopen\) #symgrids/.test(src),
      '符号面板默认收起的规则在源码里');
    ok(/#lbar1>#ctxchips\{display:none!important\}/.test(src),
      '带内联 display:flex 的三个容器用了 !important，真浏览器里真能收起');

    ok(doc.body.classList.contains('dark'), '默认深色（对齐参考图）');
    q('#lhTheme').click();
    ok(!doc.body.classList.contains('dark') && ev('LS.g("theme")') === 'light',
      '一键切浅色并记住');
    q('#ltheme').click();
    ok(doc.body.classList.contains('dark'), '课堂顶栏那颗也能切回来');
    ok(/body\.dark\{/.test(src) && /--tx3:#888780/.test(src),
      '深色只是变量覆盖，浅色 :root 一个值都没动');
  }

  /* ============ 5. 开关向导 / 不打扰正在上的课 ============ */
  log('');
  log('=== 5. 向导开关 ===');
  {
    q('#lsetup').click();
    ok(q('#launch').hidden === false, '「开课设置」能重新打开向导');
    q('#lhClose').click();
    ok(q('#launch').hidden === true, '这一节还没开课：✕ 收起向导（不再是点了没反应）');
    ok(q('#notstarted').hidden === false, '退出后落到「这一节还没开课」空态，课堂被挡住');
    ok(/已退出开课设置/.test((q('#toast') || {}).textContent || ''), '并提示点「开始上课 →」回来');
    q('#nsGo').click();
    ok(q('#launch').hidden === false && q('#notstarted').hidden === true,
      '空态里点「开始上课 →」回到向导，选择仍然必经');
    q('#lhGoBook').click();
    ok(q('#launch').hidden === true && doc.body.dataset.view === 'book',
      '点「去教材勾选」跳到教材页且不带走向导');
    q('[data-v="lesson"]').click();
    ok(q('#launch').hidden === false, '从教材切回学习页：向导重新摆出来（选择是必经的）');
    q('#lhStart').click();
    ok(q('#launch').hidden === true, '主按钮收起向导、进课堂');
    ok(ev('cfgLocked()') === true, '点过「开始上课」后本节锁定，伙伴 / 节奏固定');
    q('#lsetup').click();
    q('#lhClose').click();
    ok(q('#launch').hidden === true, '已经开课：✕ 照常回到课堂');
    ok(ev('typeof ask') === 'function', '没配接口时不弹设置警告、也不发请求');
  }

  log('');
  log('--- 页面异常 ---');
  log(errs.length ? errs.join('\n') : '无');
  if (errs.length) errors.push(...errs);

  /* ============ 6. 体验版：只给前三位伙伴 ============ */
  log('');
  log('=== 6. 体验版（github.io） ===');
  {
    const L = boot({}, 'https://demo.github.io/');
    await wait(900);
    const ld = L.wnd.document;
    ok(L.wnd.eval('LITE') === true, 'LITE 判定为真');
    ok(ld.querySelectorAll('#lhWho .lh-card').length === 3,
      '向导只给前三位伙伴，不会推荐出选不到的人');
    ok(ld.querySelector('[data-v="vid"]').style.display === 'none', '网课入口照旧收起');
    ok(!!ld.querySelector('#ldfree'), '免费讲义入口照旧保留');
    ok(ld.querySelectorAll('#gtabs button').length === 3, '体验版也有三标签');
    ok(L.errs.length === 0, '体验版没有 JS 异常：' + L.errs.join(' | '));
  }

  /* ============ 7. 刷新停在别的页签：不拿向导拦人 ============ */
  log('');
  log('=== 7. 不打扰 ===');
  {
    const B = boot({ 'gx.view': JSON.stringify('card') });
    await wait(900);
    ok(B.wnd.document.querySelector('#launch').hidden === true,
      '刷新后停在闪卡页时，不弹开课向导');
    ok(B.errs.length === 0, '没有 JS 异常：' + B.errs.join(' | '));
  }

  log('');
  log(errors.length ? ('失败 ' + errors.length + ' 条：\n  ' + errors.join('\n  ')) : '全部通过');
  console.log(out.join('\n'));
  process.exit(errors.length ? 1 : 0);
})();
