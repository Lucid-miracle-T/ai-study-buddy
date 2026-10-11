/* 闪卡的两件事：
 *
 * 1（用户报的 bug）「列表里显示 $x^2$ 源码」——闪卡复习面的公式一直是渲染的，
 *   但下面那一串卡片列表用的是 esc(q.slice(0,90))，公式原样当文本显示，
 *   看起来就像「闪卡的公式渲染坏了」。
 *
 * 2（顺带修的）截断切在公式中间——90 字刚好落在 $$...$$ 里时，剩半截 LaTeX；
 *   万一哪天直接拿它去渲染就是一堆乱码。所以截断要先看公式区间。
 *
 * 断言：列表里出公式、源码不出现、超长不切在公式里、整条是公式时不至于只剩一个「…」、
 * 卡片正反面照旧渲染、XSS 仍被拦。
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

function installIDB(win) {
  const m = new Map();
  win.indexedDB = {
    open(n) {
      if (!m.has(n)) m.set(n, new Map());
      const s = m.get(n);
      const r = {};
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

const CARDS = [
  { id: 'k1', q: '行内公式：设 $A$ 为 $n$ 阶方阵，则 $|A^T|=|A|$。', a: '转置不变：$|A^{T}|=|A|$', box: 0, due: 0, c: '__free' },
  { id: 'k2', q: '独立公式：$$\\int_0^1 x^2\\,dx=\\frac{1}{3}$$', a: '$$\\sum_{k=1}^{n}k$$', box: 0, due: 0, c: '__free' },
  { id: 'k3', q: '很长的一段题干，说了一堆话之后才出现公式：$$\\lambda_1 x_1+\\lambda_2 x_2+\\lambda_3 x_3+\\lambda_4 x_4+\\lambda_5 x_5$$', a: '短', box: 0, due: 0, c: '__free' },
  { id: 'k4', q: '$$\\lambda_1 x_1+\\lambda_2 x_2+\\lambda_3 x_3+\\lambda_4 x_4+\\lambda_5 x_5=\\mu y$$', a: '整条就是公式', box: 0, due: 0, c: '__free' },
  { id: 'k5', q: '普通文字卡，没有任何公式但也很长很长很长很长很长很长很长很长很长很长很长很长很长很长很长', a: '答', box: 0, due: 0, c: '__free' }
];

(async () => {
  const vc = new VirtualConsole();
  const errors = [], out = [];
  const log = s => out.push(s);
  const ok = (c, m) => { log((c ? '✓ ' : '✗ ') + m); if (!c) errors.push(m) };
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
      win.fetch = () => Promise.reject(new Error('测试不联网'));
      win.URL.createObjectURL = () => 'blob:x'; win.URL.revokeObjectURL = () => {};
      win.localStorage.setItem('gx.cards', JSON.stringify(CARDS));
      /* 真站里 KaTeX 是从 CDN 加载的；这里给个同位替身，好验证「渲染过」这件事 */
      win.katex = { renderToString: (t, o) => '<span class="katex" data-tex="' + String(t).replace(/"/g, '&quot;') + '"></span>' };
    }
  });
  const wnd = dom.window, doc = wnd.document;
  await wait(800);
  const ev = s => { try { return wnd.eval(s) } catch (e) { errors.push('eval: ' + e.message); return undefined } };
  const rows = () => [...doc.querySelectorAll('#clist .crow')];

  log('=== 1. 列表里的公式要渲染，不是甩源码 ===');
  ev('renderCards()');
  await wait(30);
  ok(rows().length === 5, '5 张卡都在列表里（实际 ' + rows().length + '）');
  const first = rows()[0];
  /* 问题面 3 个（$A$、$n$、$|A^T|=|A|$）+ 答案面 1 个 = 4 */
  ok(first.querySelectorAll('.katex').length === 4, '第一张卡的公式都渲染了（实际 ' + first.querySelectorAll('.katex').length + '）');
  ok(first.textContent.indexOf('$A$') < 0 && first.textContent.indexOf('|A^T|') < 0, '不再出现 $A$ 这样的源码');
  ok(first.textContent.indexOf('行内公式') >= 0, '中文照常显示');

  log('=== 2. 独立公式（$$…$$）在列表里也渲染 ===');
  ok(rows()[1].querySelectorAll('.katex').length === 2, '第二张卡问题面 + 答案面各渲染一个（实际 ' + rows()[1].querySelectorAll('.katex').length + '）');

  log('=== 3. 长公式截断不切在 $…$ 中间 ===');
  const q3 = rows()[2].querySelector('.q').textContent;
  ok(q3.indexOf('很长的一段题干') >= 0, '题干保留');
  ok(q3.indexOf('…') >= 0, '标了省略号');
  ok(rows()[2].querySelectorAll('.katex').length === 0, '半截公式没有被拿去渲染（切掉了，而不是渲染成乱码）');

  log('=== 4. 整条都是公式时，不至于只剩一个「…」 ===');
  const k4 = rows()[3].querySelector('.q');
  const tex4 = [...k4.querySelectorAll('.katex')].map(e => e.getAttribute('data-tex')).join('');
  ok(k4.textContent.indexOf('…') < 0 || tex4.length > 0, '给了内容而不是空壳（原文 ' + JSON.stringify(k4.textContent) + '）');
  ok(tex4.indexOf('lambda_1') >= 0, '长公式原样保留');

  log('=== 5. clipTex 的边界 ===');
  ok(ev('clipTex("$$a+b$$ 尾巴",12)') === '$$a+b$$ 尾巴', '不超长时原样返回');
  ok(ev('clipTex("普通的一句话没有任何公式",6)') === '普通的一句话…', '纯文字按字数截');
  ok(ev('clipTex("前面的话 $x^2+y^2=z^2$ 后面的话",20)').indexOf('$x^2+y^2=z^2$') >= 0, '截断点不在公式里时，公式完整保留');
  ok(ev('clipTex("$x^2$ 与 $y^2$ 都不要切断",10)').indexOf('$x^2$') >= 0, '完整的小公式整个保留');
  const longTex = ev('clipTex("开场白开场白$$\\\\lambda_1 x_1+\\\\lambda_2 x_2+\\\\lambda_3 x_3+\\\\lambda_4 x_4+\\\\lambda_5 x_5+\\\\lambda_6 x_6+\\\\lambda_7 x_7+\\\\lambda_8 x_8$$",20)');
  ok(String(longTex).indexOf('$$') < 0, '超长的块级公式宁可不摘要，也不切一半（结果 ' + JSON.stringify(longTex) + '）');

  log('=== 6. 复习面照旧，且 XSS 仍被拦 ===');
  ev('rev="k1";revBack=true;renderCards()');
  await wait(20);
  ok(doc.querySelector('#car').querySelectorAll('.katex').length === 4, '复习面公式照常渲染（实际 ' + doc.querySelector('#car').querySelectorAll('.katex').length + '）');
  const evil = '"><img src=x onerror=alert(1)>';
  ok(ev('titleHtml(' + JSON.stringify(evil) + ')').indexOf('<img') < 0, '列表渲染不产生可执行标签');
  ev('rev=null;revBack=false;renderCards()');

  log('');
  log(errors.length ? ('--- 失败 ' + errors.length + ' ---') : '全部通过');
  console.log(out.join('\n'));
  if (errors.length) { console.log(errors.map(e => '  ✗ ' + e).join('\n')); process.exit(1) }
})().catch(e => { console.error('崩了：', e); process.exit(1) });
