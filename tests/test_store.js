/* 2026-11-10 书城 / 书架专项回归
 *   1) 术语：界面上的「课程 / 教材」改成「书架」，新增「书城」这个页面
 *   2) 书城卡片：书名、一句定位、体量、前置、简介、标签、看目录、加入书架
 *   3) 目录：点开才拉（只列册名，不提前下载正文）
 *   4) 加入书架：真的把 md 抓进 IndexedDB，落一行「已加入书架」，卡片翻成「已在书架」
 *   5) 没取到正文时说清是「站点没带这本」，不谎称网络问题
 *   6) 老契约不回归：PACKS / COURSE / gx.msgs.* 一个都没改名
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
/* 一本能被 parseFile 认出来的最小 md：一个一级标题 + 一节正文 */
const BOOK_MD = '# 第一章 测试章\n\n这是正文，含行内公式 $x^2$。\n\n## 第一节 测试节\n\n'
  + '定义 1 设 $x>0$，则 $\\ln x$ 单调递增。\n\n例题 求 $\\lim_{x\\to 0}\\frac{\\sin x}{x}$。\n';

function boot(opts) {
  opts = opts || {};
  const vc = new VirtualConsole(); const errs = [];
  vc.on('jsdomError', e => {
    const s = e.message || String(e);
    if (/Not implemented: navigation/.test(s)) return;
    errs.push('jsdomError: ' + s);
  });
  const dom = new JSDOM(HTML(), {
    url: 'https://x.test/',
    runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      installIDB(win);
      win.confirm = () => true; win.alert = () => {}; win.open = () => null;
      /* 默认断网：启动时不会自动载入任何一本，书城应当是「一本都没加入」的样子 */
      win.fetch = () => Promise.reject(new Error('测试不联网'));
      win.URL.createObjectURL = () => 'blob:x'; win.URL.revokeObjectURL = () => {};
    }
  });
  return { wnd: dom.window, errs };
}
function online(win) {
  win.fetch = u => Promise.resolve({
    ok: true, status: 200,
    text: () => Promise.resolve(BOOK_MD)
  });
}

(async () => {
  const out = [], errors = [];
  const log = s => out.push(s);
  const ok = (c, m) => { log((c ? 'OK  ' : 'BAD ') + m); if (!c) errors.push(m); };
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const src = SRC();

  /* ============ 1. 源码：术语与入口 ============ */
  log('=== 1. 术语：课程 / 教材 → 书架，新增书城 ===');
  {
    ok(/<section class="view" id="v-store">/.test(src), '书城是独立的一页（#v-store）');
    ok(/<button class="on" data-v="lesson"[^>]*>上课<\/button>\s*<button data-v="book"[^>]*>书架<\/button>/.test(src),
      '导航里「教材」已改名「书架」');
    ok(/data-v="store"[^>]*>书城<\/button>/.test(src), '导航里新增「书城」');
    ok(!/>教材<\/button>/.test(src), '界面上不再有「教材」这个按钮');
    ok(src.indexOf('id="gtabs"') < src.indexOf('data-v="store"'), '书城落在空间标签之后（仍属「学习」）');
    /* 内部键名一个都不能动：动了老用户的记录就全断了 */
    ['LOCAL_KEY', 'LOCAL_KEY2', 'LOCAL_KEY3', "msgs.'+COURSE", "'course'"].forEach(k =>
      ok(src.indexOf(k) >= 0, '内部键名保持原样：' + k));
  }

  /* ============ 2. 卡片 ============ */
  log('');
  log('=== 2. 书城卡片：简介 / 体量 / 前置 / 标签 / 目录 / 加入 ===');
  let A;
  {
    A = boot(); const d = A.wnd.document;
    await wait(2600);          /* 等启动那次兜底重试也跑完，别和它抢 toast */
    A.wnd.goView('store');
    const q = s => d.querySelector(s), qa = s => [...d.querySelectorAll(s)];
    ok(d.body.dataset.view === 'store', '切到书城');
    const cards = qa('#stlist .stcard');
    ok(cards.length === 8, '八张卡片：三本教材 + 原创讲义 + 两册免费讲义 + 三本即将上架（实际 ' + cards.length + '）');
    const c0 = cards[0];
    ok(!!c0.querySelector('.stt') && !!c0.querySelector('.stsub'), '卡片有书名和一句定位');
    ok(!!c0.querySelector('.stmeta') && /册/.test(c0.querySelector('.stmeta').textContent), '卡片标了体量（几册）');
    ok(/前置/.test(c0.querySelector('.stmeta').textContent), '卡片标了前置要求');
    ok(!!c0.querySelector('.stabout') && c0.querySelector('.stabout').textContent.length > 30,
      '卡片有简介（不是一句空话）');
    ok(qa('#stlist .sttags span').length >= 8, '每本都有 3 个标签');
    ok(qa('#stlist .sttocb').length === 5 && qa('#stlist .stadd').length === 5,
      '五张卡片都能「看目录」「加入书架」');
    ok(qa('#stlist .sttoc[hidden]').length === 5, '目录默认收起（不占屏，也不提前下载正文）');
    ok(/\d+ 本 · 书架里有 0/.test(q('#stcnt').textContent), '右上角统计：书架里有 0 本');
  }

  /* ============ 2b. 品类与状态 ============ */
  log('');
  log('=== 2b. 品类（kind）与状态（state）分开：可筛 / 可连载 / 可占位 ===');
  {
    const d = A.wnd.document;
    const q = s => d.querySelector(s), qa = s => [...d.querySelectorAll(s)];
    const chips = () => qa('#stkbar .stkc');
    const names = chips().map(c => c.textContent);
    ok(chips().length === 7, '筛选条是「全部 + 六个品类」（实际 ' + chips().length + '）');
    ok(names.some(t => /考前突击/.test(t)) && names.some(t => /考研拔高/.test(t)),
      '品类含「考前突击」「考研拔高」：' + names.join(' / '));
    ok(/^全部 8/.test(names[0]), '「全部」带总数：' + names[0]);
    const zero = chips().filter(c => c.disabled);
    ok(zero.length === 1 && /题库 0/.test(zero[0].textContent),
      '题库 0 本：显示但禁用，点不进空品类（实际 ' + zero.length + ' 个禁用）');
    ok(qa('#stlist .sttags .sk').length === 8, '每张卡都标了品类（实际 ' + qa('#stlist .sttags .sk').length + '）');
    ok(qa('#stlist .ststate.ser').length === 1 && /连载中 · 2\/7 章/.test(q('#stlist .ststate.ser').textContent),
      '原创讲义标「连载中 · 2/7 章」：' + (q('#stlist .ststate.ser') ? q('#stlist .ststate.ser').textContent : '无'));
    ok(qa('#stlist .stcard.soon').length === 3, '三本即将上架（实际 ' + qa('#stlist .stcard.soon').length + '）');
    ok(qa('#stlist .stcard.soon button[disabled]').length === 3, '即将上架的书按钮禁用');
    ok(qa('#stlist .stcard.soon .sttocb').length === 0, '没有正文的书不显示「看目录」');
    ok(qa('#stlist .stcard.soon .stadd').length === 0, '没有正文的书不显示「加入书架」');
    chips().filter(c => /考研拔高/.test(c.textContent))[0].click();
    ok(qa('#stlist .stcard').length === 1, '筛「考研拔高」只剩 1 张（实际 ' + qa('#stlist .stcard').length + '）');
    ok(qa('#stlist .stcard.soon').length === 1, '留下的正是即将上架那张');
    ok(chips().filter(c => c.classList.contains('on'))[0].textContent.indexOf('考研拔高') >= 0, '选中的 chip 高亮');
    chips()[0].click();
    ok(qa('#stlist .stcard').length === 8, '点回「全部」恢复 8 张');
  }

  /* ============ 3. 看目录 ============ */
  log('');
  log('=== 3. 看目录：点开才展开，列的是册名 ===');
  {
    const d = A.wnd.document;
    const qa = s => [...d.querySelectorAll(s)];
    const btn = qa('#stlist .sttocb')[0];
    btn.click();
    const toc = qa('#stlist .sttoc')[0];
    ok(toc.hidden === false, '点「看目录」展开');
    const rows = [...toc.querySelectorAll('div')];
    ok(rows.length === 9, '高数是 9 册（实际 ' + rows.length + '）');
    ok(/第1章/.test(rows[0].textContent.replace(/_/g, ' ')), '册名可读：' + rows[0].textContent.trim());
    ok(btn.textContent === '收起目录', '按钮翻成「收起目录」');
    btn.click();
    ok(toc.hidden === true, '再点收起');
  }

  /* ============ 4. 加入书架 ============ */
  log('');
  log('=== 4. 加入书架：真的入库 + 一行「已加入书架」 ===');
  {
    const w = A.wnd, d = w.document;
    const q = s => d.querySelector(s), qa = s => [...d.querySelectorAll(s)];
    online(w);                       /* 网络恢复 */
    const btn = qa('#stlist .stadd')[0];
    const k = btn.dataset.k;
    btn.click();
    await wait(1200);
    ok(w.eval('CH.length') > 0, '正文进了 IndexedDB（' + w.eval('CH.length') + ' 节）');
    ok(w.eval('onShelf("' + k + '")') === true, 'onShelf 认这本书已在书架');
    ok(q('#toast') && q('#toast').textContent === '已加入书架', '落一行小字「已加入书架」');
    ok(qa('#stlist .stbadge').length === 1, '卡片上出现「已在书架」角标');
    ok(qa('#stlist .stadd').length === 4, '这张卡片的按钮变成了「去书架读」（剩 4 张未加入）');
    ok(d.body.dataset.view === 'book', '书架本来是空的：加入后直接送到「书架」');
    ok(/书架里有 1/.test(q('#stcnt').textContent), '统计跟着变：书架里有 1 本');
  }

  /* ============ 5. 取不到正文时的说法 ============ */
  log('');
  log('=== 5. 站点没带这本书：别谎称网络问题 ===');
  {
    const B = boot(); const d = B.wnd.document;
    await wait(2600);
    B.wnd.goView('store');
    const qa = s => [...d.querySelectorAll(s)];
    qa('#stlist .stadd')[1].click();     /* fetch 仍是不联网 */
    await wait(700);
    const t = d.querySelector('#toast');
    ok(t && /没取到这本书的正文/.test(t.textContent), '提示说的是「没取到这本书」，不是「网络不好」：' + (t ? t.textContent : ''));
    ok(qa('#stlist .stbadge').length === 0, '没加进去就不该有角标');
  }

  /* ============ 6. 书架页的去书城入口 ============ */
  log('');
  log('=== 6. 书架 ⇄ 书城 互相可达 ===');
  {
    const B = boot(); const d = B.wnd.document;
    await wait(2600);
    B.wnd.goView('book');
    d.querySelector('#gostore').click();
    ok(d.body.dataset.view === 'store', '书架页的「▦ 去书城」能切过去');
    /* 书城里的「导入自己的书」走的是同一个 #file，不该另写一套解析 */
    ok(!!d.querySelector('#stpick') && !!d.querySelector('#file'), '书城的「导入自己的书」复用同一个文件输入');
    /* 位置条跟着认这一页 */
    ok(d.querySelector('#cbCur').textContent === '书城', '位置条显示「学习 › 书城」');
    ok(d.querySelector('#nvcap').textContent.indexOf('书城') >= 0, '空间说明里列出书城');
  }

  /* ============ 7. 无 JS 异常 ============ */
  log('');
  log('=== 7. 全程无 JS 异常 ===');
  ok(A.errs.length === 0, '桌面流程无 JS 异常：' + A.errs.slice(0, 3).join(' | '));

  console.log(out.join('\n'));
  if (errors.length) { console.log('\n失败 ' + errors.length + ' 条：\n- ' + errors.join('\n- ')); process.exit(1); }
  console.log('\nALL PASS');
})();
