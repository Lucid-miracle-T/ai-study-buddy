/* 2026-11-10 信息架构专项回归：注重「包含关系」+ 必要引导
 *   1) 结构：空间 → 页面 → 页内操作；课程 → 节是另一条独立的线
 *   2) 位置条 / 空间说明：任何一页都知道自己在哪、这一组是什么
 *   3) 全站地图：三步上手 + 三个空间的全量功能索引 + 直达跳转，首次使用有提示
 *   4) 手机：去掉重复的顶部 tab 行，抽屉里的 7 个页面按空间装起来，命名统一
 *   5) 老契约不回归：7 个 data-v 入口、3 个分组标签、每节独立、LITE、向导 ✕
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
      if (opts.width !== undefined)
        Object.defineProperty(win, 'innerWidth', { value: opts.width, configurable: true, writable: true });
      win.confirm = () => true; win.alert = () => {}; win.open = () => null;
      win.fetch = () => Promise.reject(new Error('测试不联网'));
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
  const src = SRC();

  /* ============ 1. 源码骨架：包含关系真的排对了 ============ */
  log('=== 1. 结构：空间 → 页面 → 操作，另一条线是课程 → 节 ===');
  {
    const nav = src.slice(src.indexOf('<nav id="nav">'), src.indexOf('</nav>'));
    ok(/id="crumb"/.test(src) && /id="cbGrp"/.test(src) && /id="cbCur"/.test(src),
      '位置条存在：任何一页都能看见「空间 › 页面」');
    ok(nav.indexOf('id="gtabs"') < nav.indexOf('class="nv"'),
      '空间标签排在它所包含的页面图标之前');
    ok(nav.indexOf('class="nv"') < nav.indexOf('id="ctree"'),
      '页面导航排在课程树之前（导航在上，树在下，不再埋在侧栏底部）');
    ok(nav.indexOf('id="foot"') > nav.indexOf('id="ctree"'),
      '统计信息回到侧栏最底部，不再夹在导航中间');
    ok(/id="nvcap"/.test(src), '空间说明一行存在');
    ok(/body\.mobile #mtabs\{display:none\}/.test(src),
      '手机收掉与底部主 tab 重复的顶部 tab 行');
    ok(/id="guide"/.test(src) && /id="gdOk"/.test(src) && /id="gdClose"/.test(src),
      '全站地图浮层存在（不自动弹，避免和向导叠成两层）');
    ok(['guideopen', 'dGuide', 'drGuide', 'lhGuide', 'nsGuide'].every(id => src.indexOf('id="' + id + '"') >= 0),
      '位置条 / 顶栏 / 抽屉 / 向导 / 未开课空态都有地图入口');
    ok(/id="mtabbar"[\s\S]{0,300}>上课<\/button>/.test(src)
      && /<i>⚙<\/i>设置<\/button>/.test(src),
      '底部四个 tab 改名与页面一致：上课 / 群聊 / 教材 / 设置');
    ok(!/data-go="set"><i>⚙<\/i>账户/.test(src), '不再有「账户 / 课后 / 目录」这类含糊别名');
  }

  /* ============ 2. 老契约没被改动 ============ */
  log('');
  log('=== 2. 老契约：八个入口 / 三标签 / #foot 归属 ===');
  {
    const A = boot(); const doc = A.wnd.document;
    await wait(900);
    const q = s => doc.querySelector(s), qa = s => [...doc.querySelectorAll(s)];
    ok(qa('.nv button').map(b => b.dataset.v).sort().join(',')
      === 'book,card,chat,lesson,prog,set,store,vid', '八个视图入口一个没少（新增书城）');
    ok(qa('#gtabs button').length === 3
      && qa('#gtabs button').map(b => b.textContent).join('') === '学习课余生态',
      '三个空间标签与文字保持原样（老测试靠它）');
    const foot = q('#foot');
    ok(!!foot && foot.parentElement.id === 'nav' && !q('.nv #foot'),
      '#foot 仍是 nav 的直接子元素');
    ok(!!q('#launch') && !!q('#notstarted') && !!q('#ctree'),
      '向导 / 未开课空态 / 课程树都还在');
    A.wnd.close();
  }

  /* ============ 3. 桌面：位置条 / 空间说明 / 全站地图 ============ */
  log('');
  log('=== 3. 桌面：位置条、空间说明、全站地图 ===');
  {
    const A = boot(); const w = A.wnd, doc = w.document;
    await wait(900);
    const q = s => doc.querySelector(s), qa = s => [...doc.querySelectorAll(s)];
    ok(q('#guide').hidden === true, '全站地图不自动弹，开课向导仍是第一屏');
    ok(q('#guideopen').classList.contains('new')
      && /第一次来/.test(q('#guideopen').textContent),
      '首次使用时位置条上的「?」高亮提示');
    ok(/学习/.test(q('#nvcap').textContent) && q('#nvcap').textContent.length > 5,
      '启动时空间说明已填好（不是空白条）');
    ok(q('#cbGrp').textContent === '学习' && q('#cbCur').textContent === '上课',
      '启动位置：学习 › 上课');

    q('#guideopen').click();
    ok(q('#guide').hidden === false, '点「?」打开全站地图');
    ok(!q('#guideopen').classList.contains('new')
      && q('#guideopen').textContent === '? 全站地图', '打开一次后不再高亮提示');
    ok(w.eval('LS.g("guide.seen",0)') === 1, '看过的状态写进 gx.guide.seen（自动进备份）');
    ok(qa('#guide .gd-steps li').length === 3, '「三步就能上课」有三步');
    ok(qa('#guide .gd-grp').length === 3, '功能地图按三个空间分组');
    ok(qa('#guide .gd-row').length === 8, '八个页面逐条列出「能干什么、怎么用」');
    ok(/开课设置/.test(q('#guide').textContent)
      && /快捷节奏命令/.test(q('#guide').textContent)
      && /错题本/.test(q('#guide').textContent),
      '「上课这一页里还藏着什么」把偏好 / 三个出口 / 闭环都讲到了');
    ok(qa('#guide [data-jump]').length >= 10, '三步与每个页面都有直达按钮');

    const jump = q('#guide [data-jump="prog"]');
    jump.click();
    ok(q('#guide').hidden === true, '点直达按钮会收起地图');
    ok(doc.body.dataset.view === 'prog', '直达按钮切到对应页面');
    ok(q('#cbGrp').textContent === '课余' && q('#cbCur').textContent === '进度',
      '位置条同步成 课余 › 进度');
    ok(doc.body.dataset.navgrp === 'life' && /课余/.test(q('#nvcap').textContent),
      '空间标签与说明同步');

    q('#guideopen').click();
    w.document.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    ok(q('#guide').hidden === true, 'Esc 能收起地图');

    q('[data-v="set"]').click();
    ok(q('#cbGrp').textContent === '生态' && q('#cbCur').textContent === '设置',
      '切到设置：生态 › 设置');
    ok(/接口/.test(q('#nvcap').textContent), '生态空间的说明换成接口 / 数据 / 习惯');

    q('#gtabs [data-g="life"]').click();
    ok(doc.body.dataset.view === 'chat'
      && q('#cbGrp').textContent === '课余' && q('#cbCur').textContent === '群聊',
      '点「课余」是真的进入课余空间，位置条不会还停在「学习 › 上课」');
    ok(doc.body.dataset.navgrp === 'life' && q('#gtabs button.on').dataset.g === 'life',
      '空间标签高亮由 goView 统一摆正');

    q('#lhGuide').click();
    ok(q('#guide').hidden === false, '开课向导顶栏的「? 使用指南」也能打开地图');
    q('#gdOk').click();
    ok(q('#guide').hidden === true, '「知道了」收起地图');
    q('#nsGuide').click();
    ok(q('#guide').hidden === false, '未开课空态里的引导链接也能打开地图');
    q('#guide').click();   /* 点遮罩本身不算，事件判断 target.id */
    q('#gdClose').click();
    ok(q('#guide').hidden === true, '✕ 收起地图');

    ok(A.errs.length === 0, '桌面流程无 JS 异常：' + A.errs.join(' | '));
    w.close();
  }

  /* ============ 4. 手机：抽屉就是全站地图 ============ */
  log('');
  log('=== 4. 手机：命名统一 + 抽屉按空间装好八个页面 ===');
  {
    const A = boot({ width: 390 }); const w = A.wnd, doc = w.document;
    await wait(900);
    const q = s => doc.querySelector(s), qa = s => [...doc.querySelectorAll(s)];
    ok(doc.body.classList.contains('mobile'), '窄屏自动加 body.mobile');
    ok(q('#dTabs #ctree') !== null, '课程树仍搬进「课程与节」');
    ok(qa('#drawer .nv .nvgh').length === 3, '抽屉里加了三个空间标题');
    const heads = qa('#drawer .nv .nvgh').map(e => e.textContent).join('|');
    ok(/学习空间/.test(heads) && /课余空间/.test(heads) && /生态空间/.test(heads),
      '三个标题分别是 学习 / 课余 / 生态空间');
    ok(qa('#drawer .nv button[data-v]').length === 8, '八个页面全在抽屉里，不按组隐藏');
    ok(qa('#mtabbar [data-go]').length === 4 && qa('#mcaps [data-act]').length === 3,
      '底部四个主 tab / 三个大胶囊的数量没变');
    ok(q('#dGuide') !== null, '顶栏有「?」入口');

    q('#dGuide').click();
    ok(q('#guide').hidden === false, '顶栏「?」能打开全站地图');
    q('#gdClose').click();
    q('#drGuide').click();
    ok(q('#guide').hidden === false, '抽屉标题栏「? 指南」也能打开');
    ok(!doc.body.classList.contains('drawer'), '打开地图会顺手收起抽屉，不叠两层');
    q('#gdClose').click();

    ok(/学习/.test(q('#cbGrp').textContent) || q('#cbGrp').textContent === '学习',
      '手机上位置条一样显示当前空间');
    ok(A.errs.length === 0, '手机流程无 JS 异常：' + A.errs.join(' | '));
    w.close();
  }

  /* ============ 5. 看过的状态持久化 ============ */
  log('');
  log('=== 5. 再看一次：提示不再出现，地图仍随时可开 ===');
  {
    const A = boot({ storage: { 'gx.guide.seen': '1' } }); const doc = A.wnd.document;
    await wait(900);
    const b = doc.querySelector('#guideopen');
    ok(!b.classList.contains('new') && b.textContent === '? 全站地图',
      '看过一次后位置条不再显示「第一次来」');
    b.click();
    ok(doc.querySelector('#guide').hidden === false, '但地图仍然是常驻入口');
    ok(A.errs.length === 0, '无 JS 异常：' + A.errs.join(' | '));
    A.wnd.close();
  }

  log('');
  log(errors.length ? '失败 ' + errors.length + ' 条：\n' + errors.join('\n') : '全部通过');
  console.log(out.join('\n'));
  if (errors.length) process.exit(1);
})();
