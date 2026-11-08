/* 随仓库附带的示例讲义：新环境开箱就有课可上
 *
 * 背景：教材正文（book/ 下的真教材）受版权保护，写在 .gitignore 里，
 *       所以从仓库 clone 下来的人、以及 GitHub Pages 体验版，
 *       打开时一份教材都取不到 —— 后台白打几十个 404，教材页空着，
 *       点「载入全部内置教材」还弹「教材文件没取到」，像站点坏了。
 *
 * 现在 book/示例/ 放一份自己写的示例讲义（无版权问题，随仓库分发），
 * 「一份真教材都没取到」时用它顶上。
 *
 * 本测试守的：
 *   1. SAMPLE 常量接进了课程归属（packOf / packByKey / allPacks），
 *      否则示例课会被当成「一本导入的单文件教材」，名字也不对
 *   2. 真教材全 404 时自动载入示例，课程标签里出现「示例讲义 · 极限与导数入门」
 *   3. 真教材取得到时**不**碰示例（主站不能多出一门用不上的示例课）
 *   4. 体验版（github.io）直接载示例，不再白抓那 9 个注定 404 的真教材
 *   5. 示例讲义本身能被正确分节（§ 标题 → 节）
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const HTML = () => fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
  .replace(/<script src="https:[^"]+"><\/script>/g, '');

/* 真实的示例讲义内容：既验证逻辑，也验证这份 md 本身能被分节 */
const SAMPLE_FILES = ['极限与导数入门.md', '导数与微分_精讲讲义.md'];
const SAMPLE_TEXT = {};
SAMPLE_FILES.forEach(f => {
  SAMPLE_TEXT[f] = fs.readFileSync(path.join(ROOT, 'book', '示例', f), 'utf8');
});
/* 两册合成一门免费讲义课：可勾选的节数是两册之和 */
const SAMPLE_SECTIONS = SAMPLE_FILES.reduce((n, f) =>
  n + (SAMPLE_TEXT[f].match(/^#{1,2}\s+.+$/gm) || []).length, 0);
const SAMPLE_SRC = SAMPLE_TEXT[SAMPLE_FILES[0]];

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

/* realBook: 真教材（book/ 下除示例以外）取不取得到 */
function boot(url, realBook) {
  const vc = new VirtualConsole(); const errs = [];
  vc.on('jsdomError', e => {
    const m = e.message || String(e);
    if (/Not implemented: navigation/.test(m)) return;
    errs.push('jsdomError: ' + m);
  });
  const calls = [];
  const dom = new JSDOM(HTML(), {
    url, runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      installIDB(win);
      win.confirm = () => true; win.alert = () => {}; win.open = () => null;
      win.URL.createObjectURL = () => 'blob:x'; win.URL.revokeObjectURL = () => {};
      win.fetch = function (u) {
        u = String(u); calls.push(u);
        const isSample = /book\/%E7%A4%BA%E4%BE%8B\//.test(u) || /book\/示例\//.test(u) || /示例/.test(decodeURIComponent(u));
        if (isSample) {
          const decoded = decodeURIComponent(u);
          const fn = SAMPLE_FILES.find(f => decoded.indexOf(encodeURIComponent(f)) >= 0 || decoded.indexOf(f) >= 0);
          return Promise.resolve({ ok: true, status: 200, text: async () => (fn ? SAMPLE_TEXT[fn] : SAMPLE_SRC) });
        }
        if (/video\//.test(u)) return Promise.resolve({ ok: false, status: 404, text: async () => '' });
        if (/book\//.test(u)) {
          if (!realBook) return Promise.resolve({ ok: false, status: 404, text: async () => '' });
          const name = decodeURIComponent(u.split('/').pop()).replace(/\.md$/, '');
          return Promise.resolve({ ok: true, status: 200, text: async () => '# ' + name + '\n\n正文。\n' });
        }
        return Promise.resolve({ ok: false, status: 404, text: async () => '' });
      };
    }
  });
  return { dom, calls, errs };
}

(async () => {
  const out = [], errors = [];
  const log = s => out.push(s);
  const ok = (c, m) => { log((c ? '✓ ' : '✗ ') + m); if (!c) errors.push(m); };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const mk = w => ({
    doc: w.document,
    ev: s => { try { return w.eval(s) } catch (e) { errors.push('eval: ' + e.message); return undefined } },
    J: s => JSON.parse(w.eval('JSON.stringify(' + s + ')')),
    tabs: () => [].slice.call(w.document.querySelector('#ctabs').children).map(t => t.textContent.trim())
  });

  /* ---------- 1. 常量接进了归属判定 ---------- */
  log('=== 1. SAMPLE 与课程归属 ===');
  {
    const b = boot('https://x.test/', true);
    await wait(900);
    const A = mk(b.dom.window);
    ok(A.ev('SAMPLE.key') === '__sample', 'SAMPLE 有独立的课程键：' + A.ev('SAMPLE.key'));
    ok(/免费讲义/.test(A.ev('SAMPLE.name') || ''), '课程名标明是免费讲义：' + A.ev('SAMPLE.name'));
    ok(A.ev('SAMPLE.files.length') === SAMPLE_FILES.length,
      '自制讲义共 ' + SAMPLE_FILES.length + ' 册：' + A.ev('SAMPLE.files.length'));
    ok(A.ev('SAMPLE.files.join("|")') === SAMPLE_FILES.join('|'), '两册文件名与仓库里的对得上');
    ok(A.ev('SAMPLE.sample') === true, '带 sample 标记（toast 与「要不要切换课程」靠它区分）');
    ok(A.ev('packOf("极限与导数入门.md").key') === '__sample',
      '示例文件归属到示例课（不然会变成一门「按文件名命名」的单文件课）：' + A.ev('packOf("极限与导数入门.md").key'));
    ok(A.ev('packOf("导数与微分_精讲讲义.md").key') === '__sample',
      '第二册同样归到这门课，不会拆成单文件课');
    ok(/免费讲义/.test(A.ev('packByKey("__sample").name') || ''), '按课程键反查得到名字');
    ok(A.ev('allPacks().length') === A.ev('PACKS.length') + 1, 'allPacks = 真教材包 + 示例');
    ok(A.ev('allPacks().filter(function(p){return p.key==="__sample"}).length') === 1, 'allPacks 里只有一份示例');
    ok(b.errs.length === 0, '没有崩' + (b.errs.length ? '：' + b.errs.join(' / ') : ''));
  }

  /* ---------- 2. 真教材全取不到 → 自动载入示例 ---------- */
  log('');
  log('=== 2. clone 下来（book/ 里没有真教材）===');
  {
    const b = boot('https://x.test/', false);
    const A = mk(b.dom.window);
    await wait(3200);              /* 留足启动那一轮 + 可能的重试 */
    ok(b.errs.length === 0, '没有崩' + (b.errs.length ? '：' + b.errs.join(' / ') : ''));
    ok(A.ev('CH.length') === SAMPLE_SECTIONS,
      '示例讲义被载进来了（' + SAMPLE_SECTIONS + ' 节）：' + A.ev('CH.length'));
    ok(A.ev('CH.every(function(c){return SAMPLE.files.indexOf(c.file)>=0})') === true, '进来的都是自制讲义那两册');
    ok(A.ev('SAMPLE.files.every(function(f){return CH.some(function(c){return c.file===f})})') === true,
      '两册都载到了，不是只放第一册');
    ok(A.ev('COURSE') === '__sample', '当前课程切到示例课：' + A.ev('COURSE'));
    ok(A.tabs().some(t => /免费讲义/.test(t)), '课程标签里有「免费讲义」：' + A.tabs().join(' | '));
    ok(/免费讲义/.test(A.ev('cname("__sample")') || ''), '课程名不是文件名');
    ok(A.ev('packOf("极限与导数入门.md").key') === '__sample', '示例课归属正确');

    /* 章节真的画出来了 */
    A.ev('goView("book")');
    await wait(80);
    /* 两册归成一门课：默认至少展开第一册，别让人打开教材页看见一片折叠的空白 */
    const first = A.doc.querySelectorAll('#blist .item').length;
    ok(first >= 4, '默认展开第一册，能直接看到章节（实际 ' + first + ' 节）');
    A.ev('SAMPLE.files.forEach(function(f){BOPEN[f]=true}); renderBook()');
    await wait(40);
    const items = A.doc.querySelectorAll('#blist .item').length;
    ok(items === SAMPLE_SECTIONS, '两册全展开共 ' + SAMPLE_SECTIONS + ' 个可勾选的章节，实际 ' + items);
    ok(!/还没有教材/.test(A.doc.querySelector('#blist').textContent || ''), '不再是「还没有教材」的空状态');
  }

  /* ---------- 3. 真教材取得到 → 不碰示例 ---------- */
  log('');
  log('=== 3. 正常部署（book/ 里有真教材）===');
  {
    const b = boot('https://x.test/', true);
    const A = mk(b.dom.window);
    await wait(3200);
    ok(b.errs.length === 0, '没有崩' + (b.errs.length ? '：' + b.errs.join(' / ') : ''));
    const n = A.ev('CH.length');
    ok(n > 0 && n !== SAMPLE_SECTIONS, '载入的是真教材而不是示例：' + n + ' 节');
    ok(A.ev('CH.some(function(c){return c.file==="极限与导数入门.md"})') === false, '示例讲义没被塞进来');
    ok(A.ev('COURSE') !== '__sample', '当前课程不是示例课：' + A.ev('COURSE'));
    ok(!A.tabs().some(t => /免费讲义/.test(t)), '课程标签里没有多余的「免费讲义」：' + A.tabs().join(' | '));
    ok(b.calls.filter(u => /示例/.test(decodeURIComponent(u))).length === 0, '连请求都没发过（示例完全没参与）');
  }

  /* ---------- 4. 体验版：直接载示例，不白抓真教材 ---------- */
  log('');
  log('=== 4. 体验版（github.io）===');
  {
    const b = boot('https://lucid-miracle-t.github.io/ai-study-buddy/', false);
    const A = mk(b.dom.window);
    await wait(3200);
    ok(b.errs.length === 0, '没有崩' + (b.errs.length ? '：' + b.errs.join(' / ') : ''));
    ok(A.ev('LITE') === true, 'LITE 判定为真');
    const realCalls = b.calls.filter(u => {
      const d = decodeURIComponent(u);
      return /book\//.test(d) && !/示例/.test(d);
    });
    ok(realCalls.length === 0, '没有去抓那 9 个注定 404 的真教材（实际发了 ' + realCalls.length + ' 个请求）');
    ok(A.ev('CH.length') === SAMPLE_SECTIONS, '体验版照样有两册讲义可上：' + A.ev('CH.length'));
    ok(A.ev('PACKS.length') === 1, '真教材包仍然只列一本（体验版裁剪没受影响）');
    ok(A.tabs().some(t => /免费讲义/.test(t)), '体验版课程标签里有免费讲义：' + A.tabs().join(' | '));
  }

  /* ---------- 4.5 主站主动点「免费讲义」 ----------
     主站本来就带真教材，这条路径不能再走「仓库没教材」的兜底文案；
     而且载完得切到这门课，否则书进了库、课程标签还停在高数，看起来像没反应。 */
  log('');
  log('=== 4.5 主站主动载入免费讲义 ===');
  {
    const b = boot('https://x.test/', true);
    const A = mk(b.dom.window);
    await wait(3200);
    ok(b.errs.length === 0, '没有崩' + (b.errs.length ? '：' + b.errs.join(' / ') : ''));
    const realN = A.ev('CH.length');
    ok(realN > 0 && !A.ev('CH.some(function(c){return SAMPLE.files.indexOf(c.file)>=0})'),
      '主站开局只有真教材，不会凭空多一门示例课');
    A.ev('window.__toasts=[]; window.toast=function(t){window.__toasts.push(String(t))}');
    A.doc.querySelector('#ldfree').click();
    await wait(1400);
    const toasts = A.J('window.__toasts');
    ok(A.ev('SAMPLE.files.every(function(f){return CH.some(function(c){return c.file===f})})') === true,
      '点「免费讲义」把两册都载进来了');
    ok(A.ev('COURSE') === '__sample', '载完自动切到自制免费讲义这门课');
    ok(A.ev('CH.length') > realN, '真教材没有被清掉（只是多了一门课）');
    ok(toasts.some(t => /已载入 2 册自制免费讲义/.test(t)),
      '提示说的是主动载入：' + JSON.stringify(toasts.slice(-3)));
    ok(!toasts.some(t => /仓库不带教材正文/.test(t)),
      '主站带真教材时，不再谎称「仓库不带教材正文」');
  }

  /* ---------- 5. 示例讲义本身的分节 ---------- */
  log('');
  log('=== 5. 示例讲义文件本身 ===');
  {
    ok(SAMPLE_SECTIONS >= 9, '两册合计至少 9 节可学（实际 ' + SAMPLE_SECTIONS + '）');
    SAMPLE_FILES.forEach(f => {
      const src = SAMPLE_TEXT[f];
      ok(!/^\s*>\s*摘自/m.test(src), f + '：不含任何「摘自某书」的摘录声明（是自写内容）');
      ok(/\$\$/.test(src), f + '：带独立公式块，能验证 KaTeX 渲染');
      ok((src.match(/^##\s+.+$/gm) || []).length >= 4, f + '：至少 4 讲，按 ## 分成可勾选的节');
    });
    ok(/MIT|可自由/.test(SAMPLE_TEXT[SAMPLE_FILES[1]]), '第二册写明可自由分发（内容供给的版权声明）');
  }

  console.log(out.join('\n'));
  console.log('');
  if (errors.length) { console.log('--- 失败 ' + errors.length + ' 条 ---'); errors.forEach(e => console.log('  · ' + e)); }
  else console.log('全部通过（' + (out.filter(l => l.startsWith('✓')).length) + ' 条）');
  process.exit(errors.length ? 1 : 0);
})();
