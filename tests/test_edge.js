/* 数据边界测试：喂各种畸形 / 恶意输入，看渲染与解析会不会崩或漏。
 * 覆盖：md() 转义与 XSS、未闭合 $、niceTex 畸形、parseFile / parseCards / learnImport
 *       的空与畸形输入、闪卡 Leitner 边界、进度空数据、cname 未知课程。
 */
const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

function installIDB(win) {
  const dbs = new Map();
  win.indexedDB = {
    open(name) {
      if (!dbs.has(name)) dbs.set(name, new Map());
      const store = dbs.get(name);
      const req = {};
      const db = {
        objectStoreNames: { contains: () => true },
        createObjectStore() { return {} },
        transaction() {
          const os = {
            put: o => { store.set(o.id, o); return {} },
            getAll: () => ({ result: [...store.values()] }),
            delete: id => { store.delete(id); return {} },
            clear: () => { store.clear(); return {} }
          };
          const t = { objectStore: () => os };
          setTimeout(() => { if (t.oncomplete) t.oncomplete(); }, 0);
          return t;
        }
      };
      setTimeout(() => {
        req.result = db;
        if (req.onsuccess) req.onsuccess({ target: { result: db } });
      }, 0);
      return req;
    }
  };
}

(async () => {
  const out = [], errors = [];
  const log = s => out.push(s);
  const ok = (c, m) => { log((c ? '✓ ' : '✗ ') + m); if (!c) errors.push(m); };
  const wait = ms => new Promise(r => setTimeout(r, ms));

  const vc = new VirtualConsole();
  vc.on('jsdomError', e => {
    const m = e.message || String(e);
    if (/Not implemented: navigation/.test(m)) return;
    errors.push('jsdomError: ' + m);
  });

  const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8')
    .replace(/<script src="https:\/\/[^"]+"><\/script>/g, '');
  const dom = new JSDOM(html, {
    url: 'https://x.test/', runScripts: 'dangerously', pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(win) {
      installIDB(win);
      win.confirm = () => true;
      win.alert = () => {};
      win.open = () => null;
      win.fetch = () => Promise.reject(new Error('no net'));
      win.URL.createObjectURL = () => 'blob:mock';
      win.URL.revokeObjectURL = () => {};
    }
  });
  const wnd = dom.window, doc = wnd.document;
  await wait(600);

  const ev = s => { try { return wnd.eval(s); } catch (e) { errors.push('eval(' + s.slice(0, 30) + '): ' + e.message); return undefined; } };

  /* === 1. md() 转义与 XSS === */
  log('=== 1. md() 转义与 XSS ===');
  {
    /* 无 marked/DOMPurify 时走 esc 兜底：绝不能出现可执行标签 */
    const r = ev('md("<img src=x onerror=alert(1)>")') || '';
    ok(r.indexOf('<img') < 0, '无库兜底：恶意 <img> 被转义（实际: ' + r.slice(0, 50) + '）');
    ok(r.indexOf('&lt;img') >= 0 || r.indexOf('onerror') < 0, '不含可执行 onerror');
    const r2 = ev('md("<script>alert(1)</script>")') || '';
    ok(r2.indexOf('<script') < 0, '<script> 被转义');
    const r3 = ev('md("a & b < c > d \\"e\\"")') || '';
    ok(r3.indexOf('&amp;') >= 0 && r3.indexOf('&lt;') >= 0 && r3.indexOf('&gt;') >= 0, '& < > 都被转义');
  }

  /* === 1b. markdown 渲染必须 marked + DOMPurify 同时就位 === */
  log('');
  log('=== 1b. marked/DOMPurify 双就位要求 ===');
  {
    ok(typeof ev('loadAlt') === 'function', 'loadAlt 备用源加载器已定义');
    ok(ev('Array.isArray(MD_SRC)&&MD_SRC.length>=3'), 'marked 配了 ≥3 个备用源');
    ok(ev('Array.isArray(DP_SRC)&&DP_SRC.length>=3'), 'DOMPurify 配了 ≥3 个备用源');

    /* marked 有、DOMPurify 无 → 必须降级，不能把 marked 产出的 HTML 原样注入 */
    ev('window.marked={parse:function(s){return s}}; window.DOMPurify=undefined;');
    const unsafe = ev('md("<img src=x onerror=alert(1)>")') || '';
    ok(unsafe.indexOf('<img') < 0, '只有 marked 没 DOMPurify → 降级纯文本（实际: ' + unsafe.slice(0, 40) + '）');

    /* 两者都缺 → 降级 */
    ev('window.marked=undefined; window.DOMPurify=undefined;');
    const none = ev('md("<b>x</b>")') || '';
    ok(none.indexOf('<b>') < 0, '两者都缺 → 降级为纯文本');

    /* 两者都在 → 走 marked + sanitize 路径 */
    ev('window.marked={parse:function(s){return "<i>"+s+"</i>"}}; window.DOMPurify={sanitize:function(h){return "SAN["+h+"]"}};');
    const both = ev('md("hi")') || '';
    ok(both.indexOf('SAN[') >= 0, '两者就位时走 marked+DOMPurify 路径');
    /* 收尾，别影响后面的用例 */
    ev('window.marked=undefined; window.DOMPurify=undefined;');
  }

  /* === 2. md() 畸形公式不崩 === */
  log('');
  log('=== 2. md() 畸形公式 ===');
  {
    /* 下面是模型真实可能输出的畸形片段 */
    const cases = [
      '价格 $100 和 $200',      /* 单个 $ 未闭合 */
      '$x',                    /* 只开不合 */
      '$$',                    /* 空块 */
      '$$$$',                  /* 空块×2 */
      '$$a',                   /* 块未闭合 */
      '\\frac{a}{b}',           /* 无 $ 包裹的裸命令 */
      '$\\frac{1}{$',           /* 括号不配对 */
      '$$\\int_0^\\infty$$',
      '文本 $x$ 和 $$y$$ 混排',
      '\\[x^2\\]',              /* \[ \] 形式 */
      '\\(x\\)'                 /* \( \) 形式 */
    ];
    for (const s of cases) {
      const r = ev('md(' + JSON.stringify(s) + ')');
      ok(typeof r === 'string', 'md(' + JSON.stringify(s.slice(0, 20)) + ') 返回字符串，未崩');
    }
  }

  /* === 3. niceTex 畸形 === */
  log('');
  log('=== 3. niceTex 畸形输入 ===');
  {
    /* 注意：这里用单反斜杠，即模型真实输出的样子 */
    const cases = ['\\frac{a}{b}', '\\sqrt{2}', '\\alpha+\\beta', '\\\\', '\\unknowncmd', '{{{{', '___', '^^^'];
    const expect = { '\\frac{a}{b}': '(a)/(b)', '\\sqrt{2}': '√(2)', '\\alpha+\\beta': 'α+β' };
    for (const s of cases) {
      const r = ev('niceTex(' + JSON.stringify(s) + ')');
      const note = expect[s] !== undefined ? (r === expect[s] ? ' ✓' : ' ✗ 期望 ' + expect[s]) : '';
      ok(typeof r === 'string' && (expect[s] === undefined || r === expect[s]),
        'niceTex(' + s + ') → ' + JSON.stringify(String(r).slice(0, 20)) + note);
    }
  }

  /* === 4. parseFile 边界 === */
  log('');
  log('=== 4. parseFile 边界 ===');
  {
    ok((ev('parseFile("e.md","").length') || 0) === 0, '空字符串 → 0 节');
    ok((ev('parseFile("e.md","# 只有标题").length') || 0) === 0, '只有标题无正文 → 0 节（被过滤）');
    ok((ev('parseFile("e.md","# 标题\\n正文").length') || 0) === 1, '标题+正文 → 1 节');
    /* 代码围栏内的 # 不应被当标题 */
    const n = ev('parseFile("e.md","# 真标题\\n```\\n# 假标题\\n```\\n正文").length') || 0;
    ok(n === 1, '围栏内的 # 不算标题（实际 ' + n + ' 节）');
    /* 超长标题不应崩 */
    const big = 'x'.repeat(5000);
    const r = ev('parseFile("e.md",' + JSON.stringify('# ' + big + '\n正文') + ').length');
    ok(r === 1, '超长标题不崩');
    /* CRLF */
    ok((ev('parseFile("e.md","# 标题\\r\\n正文").length') || 0) === 1, 'CRLF 换行正确解析');
  }

  /* === 5. parseCards / learnImport 边界 === */
  log('');
  log('=== 5. 卡片导入解析 ===');
  {
    ok((ev('parseCards("").length') || 0) === 0, '空串 → 0 卡');
    ok((ev('parseCards("Q: 问题\\nA: 答案").length') || 0) === 1, 'Q/A 格式 → 1 卡');
    ok((ev('parseCards("没有格式的文本").length') || 0) === 0, '无格式文本 → 0 卡');
    ok((ev('learnImport("").length') || 0) === 0, 'learnImport 空串 → 0 卡');
    ok((ev('learnImport("问题：1+1\\n答案：2").length') || 0) === 1, 'learnImport 中文格式 → 1 卡');
  }

  /* === 6. 闪卡 Leitner 边界 === */
  log('');
  log('=== 6. 闪卡 Leitner 边界 ===');
  {
    ev('CD=[]; LS.s("cards",CD); rev=null;');
    /* 无卡时 grade 不崩 */
    ev('grade(true)');
    ok(true, '无卡时 grade() 不崩');
    /* 正常评分推进格数 */
    ev('CD=[{id:"k1",q:"q",a:"a",c:"__free",box:0,due:0,rep:0}]; LS.s("cards",CD); rev="k1"; grade(true);');
    const box1 = ev('CD[0].box');
    ok(box1 === 1, '记得 → 格数 0→1（实际 ' + box1 + '）');
    /* 连点到顶格不越界 */
    ev('for(let i=0;i<20;i++){rev="k1";grade(true)}');
    const boxTop = ev('CD[0].box');
    ok(boxTop <= 5, '连点记得不越界（实际第 ' + boxTop + ' 格）');
    /* 忘了回落到 0 */
    ev('rev="k1"; grade(false)');
    ok(ev('CD[0].box') === 0, '忘了 → 回落第 0 格');
    /* 评分后 due 被推到未来 */
    ok((ev('CD[0].due') || 0) > Date.now(), '评分后 due 推到将来');
  }

  /* === 7. 进度 / 课程名 空数据 === */
  log('');
  log('=== 7. 进度与课程名 ===');
  {
    ev('PR={}; renderProg();');
    ok(true, '空进度 renderProg() 不崩');
    ok(ev('cname("__free")') === '自由问答', 'cname(__free) 正确');
    ok((ev('cname("奇怪的名字.md")') || '').indexOf('.md') < 0, 'cname 去掉 .md 扩展名');
    ok(typeof ev('cname(undefined)') === 'string', 'cname(undefined) 不崩');
    ok(typeof ev('cname("")') === 'string', 'cname("") 不崩');
  }

  /* === 8. 教材摘录 / ctxText 空上下文 === */
  log('');
  log('=== 8. 空上下文的系统提示 ===');
  {
    ev('COURSE="__free"; CTX=[]; MS=[];');
    const t = ev('sysMsg()') || '';
    ok(t.length > 0, '无教材时 sysMsg 仍非空');
    ok(t.indexOf('undefined') < 0, 'sysMsg 不含 undefined');
    const ct = ev('ctxText()');
    ok(typeof ct === 'string', 'ctxText() 空上下文返回字符串');
  }

  log('');
  log('--- 错误 ---');
  log(errors.length ? errors.join('\n') : '无');
  console.log(out.join('\n'));
  process.exit(errors.length ? 1 : 0);
})();
