/* 提问的分量：考判断，不考算术
 *
 * 背景：用户贴了一张柯西的回复——它让学生算「第 3 行 (3,2,5) 减掉 3 倍的第 2 行 (1,4,2)
 * 之后，后两个元素分别是多少」，也就是 5−3×2、3−3×1。用户问「为什么要问这么基础的问题」。
 *
 * 这不是「问几个」的问题（那个是提问密度 QDEN），而是「问什么」：
 * 学生不是不会算，是被拉低了强度 —— 注意力花在两步心算上，
 * 真正该练的判断（该动哪一行、系数为什么取 3、这个枢轴为什么能用）反而没被考到。
 *
 * 断言六件事：
 *   1. QDIFF 存在，写清「一步出数的加减乘除自己算完写出来」
 *   2. 注入 system prompt，位置在【提问纪律】之后、【本轮模式】之前
 *   3. 换人格 / 换模式 / 换节奏 / 换动作档都在，自定义人格也在
 *   4. 留了例外口子，不会把速算、量纲换算、手算训练一起禁掉
 *   5. 和提问密度正交：切到「一次 2–3 问」时这条仍在
 *   6. 没有为了这条把陪练出题模式削掉
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

const HTML = () => fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8')
  .replace(/<script src="https:[^"]+"><\/script>/g, '');

function boot(preset) {
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
      if (preset) Object.keys(preset).forEach(k => win.localStorage.setItem(k, preset[k]));
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
  await wait(700);
  const ev = s => { try { return wnd.eval(s) } catch (e) { errors.push('eval: ' + e.message); return undefined } };

  ev('CH=[{id:"c.md#1",file:"c.md",title:"行列式",txt:"x"}]; COURSE="c.md"; LS.s("course",COURSE);');

  /* === 1. 规则本身写清了什么 === */
  log('=== 1. 规则的内容 ===');
  {
    const d = ev('QDIFF') || '';
    ok(d.indexOf('【提问的分量】') >= 0, '有【提问的分量】这一段');
    ok(d.indexOf('你考的是判断，不是算术') >= 0, '一句话点明：考的是判断，不是算术');
    ok(d.indexOf('一步就能出数的加减乘除') >= 0, '点名禁的是什么：一步出数的加减乘除');
    ok(d.indexOf('自己算完直接写出来') >= 0, '给了替代做法：自己算完写出来，不要问');
    ok(d.indexOf('该动第几行') >= 0 && d.indexOf('系数取几') >= 0, '指明该问什么：动哪行 / 系数取几');
    ok(d.indexOf('为什么取这个数') >= 0 || d.indexOf('为什么能用') >= 0, '要问理由，不只是结论');
    /* 用户截图里的原话形态：一个元素一个元素地报 */
    ok(/不要让我一个元素一个元素地报/.test(d), '禁止逐元素报数（截图里就是让报「后两个元素」）');
  }

  /* === 2. 注入位置 === */
  log('');
  log('=== 2. 在 system prompt 里的位置 ===');
  {
    const sys = ev('sysMsg()') || '';
    ok(sys.indexOf('【提问的分量】') >= 0, 'system prompt 含【提问的分量】');
    ok(sys.indexOf('【提问纪律】') < sys.indexOf('【提问的分量】'), '排在【提问纪律】之后（先管几个，再管问什么）');
    ok(sys.indexOf('【提问的分量】') < sys.indexOf('【本轮模式'), '排在模式段之前（模式要求优先级最高）');
    ok(sys.indexOf('【提问的分量】') < sys.indexOf('【教材依据】'), '在教材依据之前');
  }

  /* === 3. 全人格 / 全模式 / 全节奏 / 全动作档 === */
  log('');
  log('=== 3. 换人格、模式、节奏、动作档都在 ===');
  {
    ev('who="cauchy";');
    ev('Object.keys(PERSONA).forEach(function(k){who=k;var s=sysMsg();if(s.indexOf("【提问的分量】")<0)window.__miss="who:"+k});');
    ok(!ev('window.__miss'), '8 个人格全都在（缺的：' + ev('window.__miss') + '）');
    ev('who="cauchy";window.__miss="";');
    ev('Object.keys(MODE).forEach(function(k){MODEK=k;var s=sysMsg();if(s.indexOf("【提问的分量】")<0)window.__miss="mode:"+k});');
    ok(!ev('window.__miss'), '5 个模式全都在（含陪练出题，缺的：' + ev('window.__miss') + '）');
    ev('MODEK="teach";window.__miss="";');
    ev('Object.keys(PACE).forEach(function(k){PA=k;var s=sysMsg();if(s.indexOf("【提问的分量】")<0)window.__miss="pace:"+k});');
    ok(!ev('window.__miss'), '3 档节奏全都在（缺的：' + ev('window.__miss') + '）');
    ev('PA="mid";window.__miss="";');
    ev('Object.keys(ACTS).forEach(function(k){ACT=k;var s=sysMsg();if(s.indexOf("【提问的分量】")<0)window.__miss="act:"+k});');
    ok(!ev('window.__miss'), '3 档动作描写全都在（缺的：' + ev('window.__miss') + '）');
    ev('ACT="mid";');
    /* 用户自己写的人设走的也是同一段拼装 */
    const b = boot({ 'gx.myp': JSON.stringify({ who: 'me_x', p: '你是测试人格。' }) });
    await wait(700);
    ok((b.wnd.eval('sysMsg()') || '').indexOf('【提问的分量】') >= 0, '用户自定义人格同样带上这条');
  }

  /* === 4. 不误伤该算的场合 === */
  log('');
  log('=== 4. 例外口子留住了 ===');
  {
    const d = ev('QDIFF') || '';
    ok(d.indexOf('例外') >= 0, '写明了例外');
    ok(/速算|单位换算|矩阵乘法手算/.test(d), '例外覆盖速算 / 单位换算 / 手算');
    ok(d.indexOf('我明确说了想自己动手算') >= 0, '学生自己要求动手算时照算');
    ok(d.indexOf('一次要一整行') >= 0, '真要算就要一整行结果，不是逐个元素');
  }

  /* === 5. 与提问密度正交 === */
  log('');
  log('=== 5. 与「一次问几个」互不干扰 ===');
  {
    const sel = wnd.document.getElementById('qden');
    sel.value = 'few';
    sel.dispatchEvent(new wnd.Event('change'));
    await wait(30);
    ok(ev('QDEN') === 'few', '已切到一次 2–3 问');
    const sys = ev('sysMsg()') || '';
    ok(sys.indexOf('2–3 个递进的小问题') >= 0, '密度规则已放开');
    ok(sys.indexOf('【提问的分量】') >= 0, '「考判断不考算术」仍然在');
  }

  /* === 6. 陪练模式没被削 === */
  log('');
  log('=== 6. 出题模式照旧 ===');
  {
    const d = ev('MODE.drill.p') || '';
    ok(d.indexOf('本轮你只出题') >= 0, '陪练仍是只出题、不给答案');
    ok(/3 分钟内能动笔的题/.test(d), '仍要求出一道 3 分钟能动笔的题');
    ok(!/不许出题|不要出题/.test(ev('sysMsg()') || ''), 'system prompt 里没有出现「不要出题」这类反效果约束');
  }

  log('');
  if (errs.length) errors.push(...errs);
  if (errors.length) { console.log(out.join('\n')); console.log(''); console.log('失败 ' + errors.length + ' 项：'); errors.forEach(e => console.log('  ✗ ' + e)); process.exit(1); }
  console.log(out.join('\n'));
  console.log('');
  console.log('全部通过');
  process.exit(0);
})();
