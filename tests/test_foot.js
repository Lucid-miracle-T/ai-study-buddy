/* 导航栏底部那块统计（#foot）在手机上溢出成一条竖排乱码
 *
 * 症状：手机（≤720px）打开时，横向导航条最右边多出一竖条文字，
 *       「今天：还没开课 / 闪卡到期：0」被压成 78px 宽、溢出到屏幕外。
 *
 * 根因不是样式写得不对，而是**选择器指错了地方**：
 *   #foot 是 <nav> 的直接子元素（brand / .nv / #foot 三兄弟），并不在 .nv 里面。
 *   于是这两条规则从来没匹配上任何元素：
 *     .nv .foot{margin-top:auto; ...}     —— 桌面端页脚不贴底、也没有那条上分隔线
 *     @media(max-width:720px){.nv .foot{display:none}}  —— 手机上不隐藏
 *   手机端导航条是 flex row，多出来的这一项就被排到按钮组右边。
 *
 * 修法：两处都改成 #foot。
 *
 * 断言：
 *   1. DOM 事实：#foot 的父元素就是 nav，且它不在 .nv 里（这是根因）
 *   2. CSS 里用 #foot 命中它（用计算的 margin-top 验证真的命中了，而不是只有文本）
 *   3. 手机断点里确实隐藏它
 *   4. 不留 .nv .foot 这种永远匹配不上的写法
 *   5. 桌面端计算值：margin-top 是 auto（贴底）—— 这是「命中了」的可观测证据
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

(async () => {
  const out = [], errors = [];
  const log = s => out.push(s);
  const ok = (c, m) => { log((c ? '✓ ' : '✗ ') + m); if (!c) errors.push(m); };
  const wait = ms => new Promise(r => setTimeout(r, ms));

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
      win.confirm = () => true; win.alert = () => {}; win.open = () => null;
      win.fetch = () => Promise.reject(new Error('测试不联网'));
      win.URL.createObjectURL = () => 'blob:x'; win.URL.revokeObjectURL = () => {};
    }
  });
  const doc = dom.window.document;
  await wait(700);

  log('=== 1. DOM 事实：它到底住在哪儿 ===');
  const foot = doc.querySelector('#foot');
  ok(!!foot, '#foot 存在');
  ok(foot && foot.parentElement && foot.parentElement.id === 'nav',
    '它的父元素是 nav（实际 ' + (foot && foot.parentElement && (foot.parentElement.id || foot.parentElement.className)) + '）');
  ok(!doc.querySelector('.nv #foot'), '它不在 .nv 里面 —— 所以 .nv .foot 这种写法永远匹配不上（这就是根因）');
  ok(!!doc.querySelector('#nav .nv'), 'nav 里确实有一个 .nv（按钮组）');

  log('');
  log('=== 2. 页脚内容还在（不是把它删了，是换选择器） ===');
  const txt = foot ? foot.textContent : '';
  ok(/今天/.test(txt), '页脚里还有「今天：…」：' + JSON.stringify(txt.slice(0, 20)));
  ok(/闪卡到期/.test(txt), '还有「闪卡到期：…」');

  log('');
  log('=== 3. 桌面：样式真的命中了（可观测证据） ===');
  {
    const cs = dom.window.getComputedStyle(foot);
    ok(cs.marginTop === 'auto',
      '计算出的 margin-top 是 auto —— 说明 #foot 这条规则命中了它（写成 .nv .foot 时这里会是 0px）。实际 ' + cs.marginTop);
    /* jsdom 不解析 var()，border-top-width 会算成 0，所以分隔线只能查规则文本 */
    const rules = SRC().match(/#foot\{[^}]*\}/g) || [];
    ok(rules.some(r => /margin-top:auto/.test(r) && /border-top:1px solid/.test(r)),
      '「贴底 + 上分隔线」那条规则写在 #foot 上：' + JSON.stringify(rules));
  }

  log('');
  log('=== 4. 手机断点里要隐藏它 ===');
  {
    const src = SRC();
    const mq = src.slice(src.indexOf('@media (max-width:720px)'));
    const body = mq.slice(0, mq.indexOf('\n}\n') > 0 ? mq.indexOf('\n}\n') : 12000);
    ok(/#foot\{display:none\}/.test(body),
      '≤720px 的媒体查询里有 #foot{display:none}（手机上横向导航条才不会被它挤歪）');
  }

  log('');
  log('=== 5. 不留「永远匹配不上」的旧写法 ===');
  {
    const src = SRC();
    ok(!/\.nv\s+\.foot\s*\{/.test(src), '源码里已经没有 .nv .foot{…} 这种选择器');
  }

  log('');
  log('--- 异常 ---');
  if (errs.length) { errs.forEach(e => log('  ' + e)); errors.push(...errs); }
  else log('  无');

  log('');
  log(errors.length ? ('失败 ' + errors.length + ' 条') : '全部通过');
  console.log(out.join('\n'));
  process.exit(errors.length ? 1 : 0);
})();
