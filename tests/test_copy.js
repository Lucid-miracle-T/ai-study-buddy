/* 为什么复制导师的公式会「前后不一样」
 *
 * KaTeX 默认 output:'htmlAndMathml'，一个公式在 DOM 里存两份：
 *   .katex-mathml  —— 给读屏软件用的 MathML，视觉上 clip 到 1px，但文字仍可被选中
 *   .katex-html    —— 真正画出来的那套 span
 * 复制时两套一起走，再加上 <annotation> 里的 LaTeX 原文，于是
 *   $f(x)=2x^{2}+3x-1$
 * 粘出来变成
 *   𝑓(𝑥)=2𝑥2+3𝑥−1f(x)=2x2+3x-1
 * 前半是数学斜体 Unicode、后半是摊平的上标，中间还夹一份源码 —— 用户看到的就是「前后不一样」。
 *
 * 修法：copy 时接管，碰到的公式换回它自己的 LaTeX 原文（$…$ / $$…$$）。
 * 这里用与真 KaTeX 同构的替身 DOM（真 KaTeX 的两个子块都带上），
 * 直接验 texCopyText() 给出的文本。
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

/* 与真 KaTeX 输出同构：.katex-mathml（含 annotation）+ .katex-html，块级再包 .katex-display */
function kx(tex, display) {
  const inner = '<span class="katex-mathml"><math><semantics><mrow>' + tex + '</mrow>'
    + '<annotation encoding="application/x-tex">' + tex + '</annotation></semantics></math></span>'
    + '<span class="katex-html" aria-hidden="true">' + tex + '</span>';
  return display
    ? '<span class="katex-display"><span class="katex">' + inner + '</span></span>'
    : '<span class="katex">' + inner + '</span>';
}

(async () => {
  const out = [], errors = [];
  const log = s => out.push(s);
  const ok = (c, m) => { log((c ? '✓ ' : '✗ ') + m); if (!c) errors.push(m); };
  const wait = ms => new Promise(r => setTimeout(r, ms));

  const vc = new VirtualConsole();
  const dom = new JSDOM(HTML(), {
    url: 'https://x.test/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      installIDB(win);
      win.katex = {
        version: 'test',
        renderToString(tex, opt) { return kx(String(tex), !!(opt && opt.displayMode)); }
      };
      win.confirm = () => true; win.alert = () => {}; win.open = () => null;
      win.fetch = () => Promise.reject(new Error('测试不联网'));
      win.URL.createObjectURL = () => 'blob:x'; win.URL.revokeObjectURL = () => {};
    }
  });
  const win = dom.window;
  const doc = win.document;
  const ev = c => win.eval(c);
  await wait(700);

  const TEXT = '设 $f(x)=2x^{2}+3x-1$，求 $f\'(x)$。\n\n$$f\'(x)=4x+3$$\n\n所以当 $x=1$ 时，$f\'(1)=7$。';

  /* 造一个和 .msg .body 同样结构的容器 */
  const box = doc.createElement('div');
  box.className = 'body';
  box.innerHTML = ev('md(' + JSON.stringify(TEXT) + ')');
  doc.body.appendChild(box);

  const pick = (node) => {
    const r = doc.createRange();
    r.selectNodeContents(node);
    win.__r = r;
    return ev('texCopyText({isCollapsed:false,rangeCount:1,getRangeAt:function(){return __r}})');
  };

  log('=== 1. 渲染出来的 DOM 确实有两套内容（这就是病灶）===');
  {
    const k = box.querySelector('.katex');
    ok(!!k, '公式渲染成了 .katex 节点');
    ok(!!k.querySelector('.katex-mathml'), '.katex-mathml 在（视觉裁掉、但文字可被选中）');
    ok(!!k.querySelector('.katex-html'), '.katex-html 也在');
    const ann = k.querySelector('annotation[encoding="application/x-tex"]');
    ok(!!ann, '<annotation> 里有 LaTeX 原文');
    ok(k.textContent.indexOf('f(x)=2x^{2}+3x-1') >= 0, 'textContent 里能同时读到源码与排版文本（复制失控的来源）');
  }

  log('');
  log('=== 2. 复制一条行内公式 → 得到 $…$ 原文 ===');
  {
    const k = box.querySelectorAll('.katex')[0];
    const got = pick(k);
    ok(got === '$f(x)=2x^{2}+3x-1$', '原样还回 LaTeX：' + JSON.stringify(got));
    ok(got.indexOf('\uD835') < 0, '不再有数学斜体 Unicode（𝑓 之类）');
  }

  log('');
  log('=== 3. 复制块级公式 → 得到 $$…$$ ===');
  {
    const kd = box.querySelector('.katex-display');
    ok(!!kd, '块级公式外层是 .katex-display');
    const got = pick(kd.querySelector('.katex'));
    ok(got === '$$f\'(x)=4x+3$$', '还回 $$…$$：' + JSON.stringify(got));
  }

  log('');
  log('=== 4. 复制整段消息：文字照旧，公式全部还原 ===');
  {
    const got = pick(box);
    ok(got.indexOf('$f(x)=2x^{2}+3x-1$') >= 0, '公式 1 还原');
    ok(got.indexOf("$f'(x)$") >= 0, '公式 2 还原');
    ok(got.indexOf('$$f\'(x)=4x+3$$') >= 0, '块级公式还原');
    ok(got.indexOf("$f'(1)=7$") >= 0, '公式 4 还原');
    ok(got.indexOf('设 ') >= 0 && got.indexOf('时，') > 0, '中文正文没被吃掉');
    ok(got.indexOf('\uD835') < 0, '整段里没有数学斜体 Unicode（𝑓/𝑥/′）');
    ok((got.match(/f\(x\)=2x\^\{2\}\+3x-1/g) || []).length === 1,
      '同一段源码只出现一次（原来是 mathml + annotation + html 三份叠着）');
    ok((got.match(/annotation/g) || []).length === 0, '没有把 <annotation> 标签本身带进去');
  }

  log('');
  log('=== 5. 只圈住公式的一部分 → 给整条，别粘出半个 \\frac ===');
  {
    const k = box.querySelectorAll('.katex')[0];
    const r = doc.createRange();
    const t = k.querySelector('.katex-html').firstChild;
    r.setStart(t, 0); r.setEnd(t, 2);
    win.__r = r;
    const got = ev('texCopyText({isCollapsed:false,rangeCount:1,getRangeAt:function(){return __r}})');
    ok(got === '$f(x)=2x^{2}+3x-1$', '只选了两个字符，也给整条公式：' + JSON.stringify(got));
  }

  log('');
  log('=== 6. 没碰到公式就绝不插手 ===');
  {
    const plain = doc.createElement('div');
    plain.className = 'body';
    plain.innerHTML = ev('md(' + JSON.stringify('第一段纯文字。\n\n第二段也没有公式。') + ')');
    doc.body.appendChild(plain);
    ok(pick(plain) === null, '纯文字返回 null（交给浏览器默认复制）');

    const r = doc.createRange();
    r.selectNodeContents(doc.body);
    win.__r = r;
    ok(ev('texCopyText({isCollapsed:true,rangeCount:1,getRangeAt:function(){return __r}})') === null,
      '没有选中内容（isCollapsed）时返回 null');
    ok(ev('texCopyText({isCollapsed:false,rangeCount:0,getRangeAt:function(){throw 1}})') === null,
      'rangeCount=0 时返回 null，不会抛异常');
  }

  log('');
  log('=== 7. copy 事件监听器已挂上，且在输入框里不抢活 ===');
  {
    /* 输入框里的复制：target 是 TEXTAREA，监听器必须直接放行 */
    const ta = doc.getElementById('in') || doc.createElement('textarea');
    if (!ta.id) { ta.id = 'in'; doc.body.appendChild(ta); }
    let touched = false;
    const e = new win.Event('copy', { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'clipboardData', {
      value: { setData() { touched = true; } }
    });
    ta.dispatchEvent(e);
    ok(touched === false, '输入框内复制时没有改写剪贴板');

    /* 正文里的复制：jsdom 的 Selection 支持有限，能跑通就验文本，跑不通只验没抛错 */
    const k = box.querySelectorAll('.katex')[0];
    const r = doc.createRange(); r.selectNodeContents(k);
    let got = null;
    const e2 = new win.Event('copy', { bubbles: true, cancelable: true });
    Object.defineProperty(e2, 'clipboardData', { value: { setData(n, v) { if (n === 'text/plain') got = v; } } });
    const sel = win.getSelection();
    sel.removeAllRanges(); sel.addRange(r);
    doc.dispatchEvent(e2);
    if (got != null) {
      ok(got === '$f(x)=2x^{2}+3x-1$', 'copy 事件里写进剪贴板的是 LaTeX 原文');
      ok(e2.defaultPrevented, '拦下了浏览器默认复制（否则两套内容又会一起走）');
    } else {
      log('· jsdom 的 Selection 不完整，事件层跳过（真浏览器的行为由 scripts/_tmp_copy.mjs 验）');
    }
  }

  log('');
  log('=== 8. 源码里确实有这套逻辑 ===');
  {
    const s = SRC();
    ok(/function texCopyText/.test(s), 'texCopyText 在');
    ok(/addEventListener\('copy'/.test(s), 'copy 监听器在');
    ok(/annotation\[encoding="application\\\/x-tex"\]/.test(s.replace(/\\\\/g, '\\')) || /application\/x-tex/.test(s),
      '按 annotation 取 LaTeX 原文');
    ok(/INPUT\|TEXTAREA/.test(s), '输入框里复制时直接放行');
  }

  console.log(out.join('\n'));
  if (errors.length) {
    console.log('\n--- 错误 ---');
    errors.forEach(e => console.log('  ✗ ' + e));
    console.log('\n共 ' + out.filter(l => /^[✓✗]/.test(l)).length + ' 条断言，失败 ' + errors.length + ' 条');
    process.exit(1);
  }
  console.log('\n共 ' + out.filter(l => /^[✓✗]/.test(l)).length + ' 条断言全部通过');
})();
