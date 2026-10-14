/* 一条消息里的 \left| 与 \right| 变成了红字
 *
 * 背景：用户发来一张截图，自己写的那条消息里
 *   任意ε>0，存在N∈$N^{+}$，使$\left| $\left| x_{n}-a \right|$ \right|$<ε
 *   「\left| 」和「 \right|」两块是红的，中间那段 \left| x_{n}-a \right| 却是黑的原样文本。
 *
 * 红字不是本应用的功能，是 KaTeX 的报错色（#cc0000）：throwOnError:false 时它把
 * 「解析不了的那段原文」用红字吐回来。而 md() 提取 $...$ 用的是**非贪婪配对**，
 * 面对嵌套的 $（符号面板里反复点「绝对值」，在一次公式里又套了一次）会拆成：
 *   段1 $\left| $          → \left 没有 \right，残
 *   段2 \left| x-a \right| → 夹在两个 $ 之间，成了普通文本（所以是黑的）
 *   段3 $ \right|$         → \right 没有 \left，残
 * 于是两段残公式各自被 KaTeX 用红字原样吐出来。
 *
 * 修法两层：
 *   A 源头——insAt() 判断插入点是否已经在 $...$ 里；在里面就只插模板的"肉"，
 *     不再套一层 $。顺带把光标放到占位字母上（否则停在收尾 $ 之前，接着打字
 *     又会得到 $\left| x 打的字$，还是缺 \right）。
 *   B 兜底——md() 入口 healNestedTex() 把已经写成的嵌套压平。
 *
 * 断言：
 *   1. healNestedTex 把 $…$ 包 $…$ 压平
 *   2. 不能误伤：相邻的独立公式、成对的 \left…\right、$$…$$
 *   3. md() 端到端：用户那条消息只喂给 KaTeX 一段、且是完整的
 *   4. insAt：在公式外插模板 → 原样插入并把占位字母选中
 *   5. insAt：在公式内插模板 → 不新增 $（这是真凶）
 *   6. insAt：选区在公式内 → 同样不新增 $
 *   7. 面板里那几个「没有 {} 的模板」都能找到占位字母
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

const MD_STUB = 'window.marked={parse:function(s){return String(s).split(/\\n{2,}/).map(function(p){' +
  'return "<p>"+p.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/\\n/g,"<br>")+"</p>"}).join("")}};' +
  'window.DOMPurify={sanitize:function(h){return h}};';

/* 假 KaTeX：把收到的每一段 tex 记下来，顺便标出它像不像"残段"（\left 与 \right 不成对） */
const KX_STUB =
  'window.__tex=[];' +
  'window.katex={renderToString:function(t,o){' +
  '  window.__tex.push(String(t));' +
  '  var l=(String(t).match(/\\\\left\\b/g)||[]).length,r=(String(t).match(/\\\\right\\b/g)||[]).length;' +
  '  if(l!==r)return \'<span class="katex-error" style="color:#cc0000">\'+String(t)+\'</span>\';' +
  '  return \'<span class="katex"></span>\'}};';

(async () => {
  const out = [], errors = [];
  const log = s => out.push(s);
  const ok = (c, m) => { log((c ? '✓ ' : '✗ ') + m); if (!c) errors.push(m); };
  const wait = ms => new Promise(r => setTimeout(r, ms));

  const { wnd, errs } = boot();
  const doc = wnd.document;
  await wait(700);
  const ev = s => { try { return wnd.eval(s); } catch (e) { errors.push('eval: ' + e.message); return undefined; } };

  /* 用户那条消息：注意中间那层是"面板模板"$\left| x \right|$，外面又被套了一层 */
  const USER_MSG = '任意ε>0，存在N∈$N^{+}$，使$\\left| $\\left| x_{n}-a \\right|$ \\right|$<ε';

  /* === 1. healNestedTex 本体 === */
  log('=== 1. 把 $…$ 包 $…$ 的嵌套压平 ===');
  {
    const heal = t => ev('healNestedTex(' + JSON.stringify(t) + ')');
    const got = heal(USER_MSG);
    ok(got === '任意ε>0，存在N∈$N^{+}$，使$\\left| \\left| x_{n}-a \\right| \\right|$<ε',
      '嵌套被压平（实际 ' + JSON.stringify(got) + '）');
    ok((got.match(/\$/g) || []).length === 4, '压平后只剩 2 对 $（实际 ' + (got.match(/\$/g) || []).length + ' 个）');
    /* 压平之后每一段都成对 */
    const segs = ev('JSON.stringify((function(){var o=[],s=' + JSON.stringify(got) +
      ';s.replace(/(^|[^\\\\$])\\$([^$\\n]+?)\\$/g,function(m,pre,p){o.push(p);return m});return o})())');
    const list = JSON.parse(segs);
    ok(list.length === 2, '压平后被识别为 2 段公式（实际 ' + list.length + '）');
    ok(list.every(p => (p.match(/\\left\b/g) || []).length === (p.match(/\\right\b/g) || []).length),
      '每一段的 \\left 与 \\right 都成对：' + JSON.stringify(list));
  }

  /* === 2. 不能误伤 === */
  log('');
  log('=== 2. 相邻的独立公式 / 本来就成对的公式不动 ===');
  {
    const heal = t => ev('healNestedTex(' + JSON.stringify(t) + ')');
    const cases = [
      '$5$ 和 $10$',
      '价格 $5$ 与 $10$ 差一倍',
      '$\\left| x \\right|$ 和 $\\left| y \\right|$',
      '$\\left| x \\right|$',
      '没有公式的普通一句话',
      '$$\\left| x \\right|$$ 行间公式'
    ];
    cases.forEach(c => ok(heal(c) === c, '不动：' + JSON.stringify(c)));
  }

  /* === 3. md() 端到端 === */
  log('');
  log('=== 3. md() 端到端：用户那条消息不再吐红字 ===');
  {
    ev(MD_STUB); ev(KX_STUB);
    ev('__tex.length=0');
    const html = ev('md(' + JSON.stringify(USER_MSG) + ')') || '';
    const texes = JSON.parse(ev('JSON.stringify(__tex)') || '[]');
    log('    喂给 KaTeX 的段：' + JSON.stringify(texes));
    ok(texes.length === 2, '只喂了两段（实际 ' + texes.length + '）：$N^{+}$ 与压平后的绝对值');
    ok(texes.every(t => (t.match(/\\left\b/g) || []).length === (t.match(/\\right\b/g) || []).length),
      '两段都成对，没有残段');
    ok(html.indexOf('katex-error') < 0, '渲染结果里没有 katex-error 红字');
    ok(html.indexOf('cc0000') < 0, '也没有 KaTeX 的报错色');
    ok(html.indexOf('\\left') < 0, '不再把裸 LaTeX 源码甩在正文里');
    /* 正文照旧 */
    ok(html.indexOf('任意ε&gt;0') >= 0 || html.indexOf('任意ε>0') >= 0, '正文原样保留');
    ok(html.indexOf('&lt;ε') >= 0, '结尾的 <ε 还在（被转义成 &lt;ε）');
  }

  /* === 4. insAt：公式外 === */
  log('');
  log('=== 4. 插入点不在公式里：模板原样插入，占位字母被选中 ===');
  {
    const ta = doc.getElementById('in');
    const TMPL = '$\\left| x \\right|$';
    ta.value = '使'; ta.selectionStart = ta.selectionEnd = 1;
    ev('insAt(' + JSON.stringify(TMPL) + ')');
    ok(ta.value === '使' + TMPL, '插进来的是完整模板（实际 ' + JSON.stringify(ta.value) + '）');
    ok((ta.value.match(/\$/g) || []).length === 2, '一共 2 个 $');
    ok(ta.selectionStart === 1 + TMPL.indexOf('x') && ta.selectionEnd === ta.selectionStart + 1,
      '占位字母 x 被选中（' + ta.selectionStart + '..' + ta.selectionEnd + '），一打字就替换掉它');
  }

  /* === 5. insAt：公式内（真凶） === */
  log('');
  log('=== 5. 插入点已经在公式里：不再套一层 $（真凶） ===');
  {
    const ta = doc.getElementById('in');
    const TMPL = '$\\left| x \\right|$';
    const inner = '\\left| x \\right|';
    /* 光标停在已有公式里、占位字母 x 的位置（用户想再包一层绝对值时就停这儿） */
    ta.value = TMPL; ta.selectionStart = ta.selectionEnd = TMPL.indexOf('x');
    ev('insAt(' + JSON.stringify(TMPL) + ')');
    ok((ta.value.match(/\$/g) || []).length === 2,
      '仍然只有 2 个 $，没有嵌套（实际 ' + (ta.value.match(/\$/g) || []).length + ' 个）');
    ok(ta.value === '$\\left| ' + inner + 'x \\right|$',
      '插进去的是模板的"肉"，不再是带 $ 的整段（实际 ' + JSON.stringify(ta.value) + '）');
    /* 这样产生的整串，md() 不会拆出残段 */
    ev('__tex.length=0');
    ev('md(' + JSON.stringify(ta.value) + ')');
    const t2 = JSON.parse(ev('JSON.stringify(__tex)') || '[]');
    ok(t2.length === 1 && (t2[0].match(/\\left\b/g) || []).length === (t2[0].match(/\\right\b/g) || []).length,
      'md() 只把它当一段、且成对：' + JSON.stringify(t2));
  }

  /* === 5b. 连点两次同一个模板 === */
  log('');
  log('=== 5b. 连点两次「绝对值」也不再出嵌套 $ ===');
  {
    const ta = doc.getElementById('in');
    const TMPL = '$\\left| x \\right|$';
    ta.value = ''; ta.selectionStart = ta.selectionEnd = 0;
    ev('insAt(' + JSON.stringify(TMPL) + ')');
    ev('insAt(' + JSON.stringify(TMPL) + ')');       /* 第二次插在第一次选中的 x 上 */
    ok((ta.value.match(/\$/g) || []).length === 2,
      '一共只有 2 个 $（实际 ' + (ta.value.match(/\$/g) || []).length + ' 个）');
    ev('__tex.length=0');
    ev('md(' + JSON.stringify(ta.value) + ')');
    const t3 = JSON.parse(ev('JSON.stringify(__tex)') || '[]');
    ok(t3.length === 1 && (t3[0].match(/\\left\b/g) || []).length === (t3[0].match(/\\right\b/g) || []).length,
      '渲染成一段成对的公式：' + JSON.stringify(t3));
  }

  /* === 6. insAt：选区落在公式内 === */
  log('');
  log('=== 6. 选区落在公式内：同样不新增 $ ===');
  {
    const ta = doc.getElementById('in');
    const TMPL = '$\\left| x \\right|$';
    ta.value = '设' + TMPL + '成立';
    const a = 1 + TMPL.indexOf('x');            /* 选中里面那个 x */
    ta.selectionStart = a; ta.selectionEnd = a + 1;
    ev('insAt(' + JSON.stringify(TMPL) + ')');
    ok((ta.value.match(/\$/g) || []).length === 2,
      '仍然只有 2 个 $（实际 ' + (ta.value.match(/\$/g) || []).length + ' 个）');
    ok(ta.value === '设$\\left| \\left| x \\right| \\right|$成立',
      '选中的 x 被换成了模板的"肉"（实际 ' + JSON.stringify(ta.value) + '）');
  }

  /* === 7. 面板里没有 {} 的模板都能找到占位字母 === */
  log('');
  log('=== 7. 公式模板插入后的光标落点 ===');
  {
    const ta = doc.getElementById('in');
    const tmpls = JSON.parse(ev('JSON.stringify(SYMS.filter(function(g){return g.k==="tmpl"})[0].tm.map(function(x){return x[1]}))') || '[]');
    ok(tmpls.length > 20, '公式模板一共 ' + tmpls.length + ' 个');
    /* 关键不变量：任何模板插进空输入框，都只能有 2 个 $（绝不会凭空多出一对） */
    const badCount = tmpls.filter(t => {
      ta.value = ''; ta.selectionStart = ta.selectionEnd = 0;
      ev('insAt(' + JSON.stringify(t) + ')');
      return (ta.value.match(/\$/g) || []).length !== 2;
    });
    ok(badCount.length === 0, '每个模板插进来都只有 2 个 $（有问题：' + JSON.stringify(badCount) + '）');
    /* 落点：有 {} 的被插进 {} 里；没 {} 但找得到孤立的占位字母 → 选中它；
       两样都没有（推论符号 / 常用希腊，本来就是一串符号）→ 落在公式之后 */
    const badCaret = tmpls.filter(t => {
      ta.value = ''; ta.selectionStart = ta.selectionEnd = 0;
      ev('insAt(' + JSON.stringify(t) + ')');
      const inBody = ta.selectionStart > 0 && ta.selectionEnd < ta.value.length; /* 光标在 $ 之间 */
      return !inBody && ta.selectionStart !== ta.value.length;
    });
    ok(badCaret.length === 0, '没有落点诡异的模板（有问题：' + JSON.stringify(badCaret) + '）');
    /* 具体点名几个没有 {} 的：都应选中 1 个占位字母 */
    [['绝对值', '$\\left| x \\right|$'], ['范数', '$\\left\\| x \\right\\|$'],
     ['梯度', '$\\nabla f$'], ['无穷区间', '$[a,+\\infty)$'], ['属于', '$x\\in[a,b]$']].forEach(([name, t]) => {
      ta.value = ''; ta.selectionStart = ta.selectionEnd = 0;
      ev('insAt(' + JSON.stringify(t) + ')');
      ok(ta.selectionEnd - ta.selectionStart === 1,
        name + ' 插入后选中了 1 个占位字母（实际选 ' + (ta.selectionEnd - ta.selectionStart) + ' 个）');
    });
    /* 一串纯符号（没有占位字母）不该乱选 */
    ta.value = ''; ta.selectionStart = ta.selectionEnd = 0;
    const SYMLIST = '$\\because\\quad\\therefore\\quad\\Rightarrow$';
    ev('insAt(' + JSON.stringify(SYMLIST) + ')');
    ok(ta.value === SYMLIST, '「推论符号」原样插入，没被改动');
    ok(ta.selectionStart === ta.value.length, '落点在公式之后（这类模板后面就是接着写正文）');
  }

  /* === 7b. 推出 / 等价符号 === */
  log('');
  log('=== 7b. 面板里的「推出」与「等价」 ===');
  {
    const ta = doc.getElementById('in');
    const tmap = JSON.parse(ev('JSON.stringify(SYMS.filter(function(g){return g.k==="tmpl"})[0].tm)'));
    const names = tmap.map(x => x[0]);
    const get = n => (tmap.filter(x => x[0] === n)[0] || [])[1];
    ok(names.indexOf('推出') >= 0, '模板组里有「推出」');
    ok(names.indexOf('等价') >= 0, '模板组里有「等价」');
    ok(get('推出') === '$\\Rightarrow$', '「推出」插的是 \\Rightarrow（⟹）：' + JSON.stringify(get('推出')));
    ok(get('等价') === '$\\Leftrightarrow$', '「等价」插的是 \\Leftrightarrow（⟺）：' + JSON.stringify(get('等价')));

    ta.value = 'A'; ta.selectionStart = ta.selectionEnd = 1;
    ev('insAt(' + JSON.stringify(get('推出')) + ')');
    ok(ta.value === 'A' + get('推出'), '点一下插进来的是完整的 $…$：' + JSON.stringify(ta.value));
    ok((ta.value.match(/\$/g) || []).length === 2, '一对 $，不多不少');

    ev('__tex.length=0');
    ev('md(' + JSON.stringify(ta.value) + ')');
    const t = JSON.parse(ev('JSON.stringify(__tex)') || '[]');
    ok(t.length === 1 && t[0] === '\\Rightarrow', 'md() 把它当一段公式喂给 KaTeX：' + JSON.stringify(t));
  }

  /* === 8. 源码里确实用上了这两处新逻辑 === */
  log('');
  log('=== 8. 接线检查 ===');
  {
    ok(/function healNestedTex/.test(SRC()), '有 healNestedTex');
    ok(/s=healNestedTex\(s\)/.test(SRC()), 'md() 里确实调了它（而且在配对之前）');
    const mdSrc = SRC().slice(SRC().indexOf('function md(src)'), SRC().indexOf('function est('));
    ok(mdSrc.indexOf('healNestedTex') < mdSrc.indexOf('katex.renderToString'),
      '顺序对：先压平，再喂 KaTeX');
    ok(/function mathRanges/.test(SRC()), '有 mathRanges');
    ok(/const inMath=mathRanges\(s\)/.test(SRC()), 'insAt 里确实判断了插入点是否在公式内');
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
