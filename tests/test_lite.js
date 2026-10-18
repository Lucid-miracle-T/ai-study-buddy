/* GitHub Pages 上的「体验版」：同一份 index.html，按域名自动精简
 *
 * 背景：主站（自有域名）与 GitHub Pages 用的是同一个文件 —— 前者从本地目录部署，
 *       后者从仓库 main 根目录发布。于是可以靠 location.hostname 一份代码两套行为：
 *         github.io            → 体验版：高数一本教材、前三位导师、不内置网课内容
 *         自有域名 / 本地打开   → 全功能版
 *
 * 这里钉住的就是「体验版确实缩了、完整版一点没动」：
 *   1. 教材包 PACKS：体验版只剩第一本（高数八上），完整版仍是三本
 *   2. 导师 pKeys()：体验版只给前三位（柯西/莱布尼茨/牛顿），完整版八位
 *   3. 推荐导师 rRank()：不能推荐出界面上选不到的人（RTYPE 里硬编码了后六位）
 *   4. 内置网课 VBUILTIN：体验版为空
 *   5. DOM：仅线代 / 仅 C 语言 / 网课 三个入口收起；「导入教材」仍然留着
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

async function boot(url) {
  const vc = new VirtualConsole();
  const errs = [];
  vc.on('jsdomError', e => {
    const m = e.message || String(e);
    if (/Not implemented: navigation/.test(m)) return;
    errs.push('jsdomError: ' + m);
  });
  const dom = new JSDOM(HTML(), {
    url, runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      installIDB(win);
      win.confirm = () => true; win.alert = () => {}; win.open = () => null;
      win.fetch = () => Promise.reject(new Error('测试不联网'));
      win.URL.createObjectURL = () => 'blob:x'; win.URL.revokeObjectURL = () => {};
    }
  });
  await new Promise(r => setTimeout(r, 700));
  return { dom, doc: dom.window.document, ev: c => dom.window.eval(c), errs };
}

(async () => {
  const out = [], errors = [];
  const log = s => out.push(s);
  const ok = (c, m) => { log((c ? '✓ ' : '✗ ') + m); if (!c) errors.push(m); };

  /* ---------- A. 体验版：GitHub Pages 域名 ---------- */
  log('=== A. 体验版（lucid-miracle-t.github.io） ===');
  const A = await boot('https://lucid-miracle-t.github.io/ai-study-buddy/');
  {
    ok(A.ev('LITE') === true, 'LITE 判定为真（域名是 github.io）');

    const packs = A.ev('PACKS.map(function(p){return p.key}).join(",")');
    ok(packs === '__local', '教材包只剩第一本（高数八上）：' + packs);
    ok(A.ev('PACKS.length') === 1, 'PACKS 长度是 1，不是 3');

    const pk = A.ev('pKeys().join(",")');
    ok(pk === 'cauchy,leibniz,newton', '导师只剩前三位（柯西/莱布尼茨/牛顿）：' + pk);
    ok(A.ev('pKeys().length') === 3, 'pKeys 长度是 3，不是 8');
    ok(A.ev('Object.keys(PERSONA).length') === 8, 'PERSONA 本身没被删（后五位仍在源码里，只是不给用）');

    ok(A.ev('VBUILTIN.length') === 0, '不内置网课内容：VBUILTIN 为空');
    ok(A.ev('PORDER.join(",")') === 'cauchy,leibniz,newton', '推荐排序表也只剩前三位');

    /* 推荐：RTYPE / RSTATE / RKW 里硬编码了后六位，必须被 rRank 滤掉 */
    const ranked = A.ev('rRank({aemeath:9,shorekeeper:8,changli:7,cauchy:3})');
    ok(Array.isArray(ranked) && ranked.indexOf('aemeath') < 0 && ranked.indexOf('shorekeeper') < 0
      && ranked.indexOf('changli') < 0,
      '推荐不会给出界面上没有的导师：' + JSON.stringify(ranked));
    ok(ranked.length === 1 && ranked[0] === 'cauchy',
      '只剩下真正可用的那位（柯西），而且是分数最高的可见者：' + JSON.stringify(ranked));

    /* DOM 层：入口收起 */
    const d = A.doc;
    const ldl = d.querySelector('#ldl'), ldc = d.querySelector('#ldc');
    ok(ldl && ldl.style.display === 'none', '教材页「仅线代」已收起');
    ok(ldc && ldc.style.display === 'none', '教材页「仅 C 语言」已收起');
    const vid = d.querySelector('[data-v="vid"]');
    ok(vid && vid.style.display === 'none', '导航里的「网课」入口已收起');
    /* 体验版根本没有教材正文：book/ 在 .gitignore 里（版权），GitHub Pages 上全 404。
       这排「载入」按钮点了只会弹「教材文件没取到」，所以整体收起，只留「导入教材」。 */
    const rl = d.querySelector('#reload'), lg = d.querySelector('#ldg');
    ok(rl && rl.style.display === 'none', '「载入」按钮收起（正文不在仓库，点了必然 404）');
    ok(lg && lg.style.display === 'none', '「仅高数」也收起（同理，载不到）');
    ok(!!d.querySelector('#pickfile'), '「导入教材」仍然留着 —— 用户想自己加不该被拦');
    ok(!!d.querySelector('#vimp'), '「导入网课包」仍然留着');

    /* 别再白抓一轮：LITE 下 autoLoad 直接短路返回 0，不去请求那 9 个注定 404 的 md */
    const r = await A.ev('autoLoad(null)');
    ok(r === 0, '体验版载入函数直接短路（返回 0，指引导入），实际：' + JSON.stringify(r));

    /* 开场白不能再让人去点一个已经被收起的按钮 */
    const intro = d.querySelector('.msg .body');
    ok(intro && !/载入全部内置教材/.test(intro.textContent), '开场白里没有「载入全部内置教材」了');
    ok(intro && /导入教材/.test(intro.textContent), '开场白改指「导入教材」');
  }
  log('');
  log('--- 体验版异常 ---');
  if (A.errs.length) { A.errs.forEach(e => log('  ' + e)); errors.push(...A.errs); } else log('  无');

  /* ---------- B. 完整版：自有域名，一点没动 ---------- */
  log('');
  log('=== B. 完整版（自有域名 / 本地） ===');
  const B = await boot('https://gaoshu-xuexi.app.workbuddy.host/');
  {
    ok(B.ev('LITE') === false, 'LITE 判定为假（不是 github.io）');
    ok(B.ev('PACKS.length') === 3, '三本教材都在（高数 / 线代 / C 语言）：'
      + B.ev('PACKS.map(function(p){return p.key}).join(",")'));
    ok(B.ev('pKeys().length') === 8, '八位导师都在');
    ok(B.ev('VBUILTIN.length') === 3, '三个内置网课包都在');
    ok(B.ev('PORDER.length') === 8, '推荐排序表是完整的八位');

    const rk = B.ev('rRank({aemeath:9,cauchy:3})');
    ok(rk[0] === 'aemeath', '完整版照样能推荐出爱弥斯：' + JSON.stringify(rk));

    const d = B.doc;
    ok(d.querySelector('#ldl').style.display !== 'none', '「仅线代」没被藏起来');
    ok(d.querySelector('[data-v="vid"]').style.display !== 'none', '「网课」入口没被藏起来');
    ok(d.querySelector('#reload').textContent === '载入全部内置教材', '按钮文案照旧');
  }
  log('');
  log('--- 完整版异常 ---');
  if (B.errs.length) { B.errs.forEach(e => log('  ' + e)); errors.push(...B.errs); } else log('  无');

  /* ---------- C. 判定规则本身 ---------- */
  log('');
  log('=== C. 域名判定规则 ===');
  {
    const re = /\/(\^|\\.)github\\.io\$/i;
    void re;
    const src = SRC();
    ok(/const LITE=\/\(\^\|\\\.\)github\\\.io\$\/i\.test\(location\.hostname\)/.test(src),
      '判定就一条：hostname 以 github.io 结尾（含裸域名）');
    ok(!/workbuddy|localhost|127\.0\.0\.1/.test(src.match(/const LITE=[^\n]*/)[0]),
      '判定里没有写死自有域名 —— 换域名不用改代码');
  }

  log('');
  log(errors.length ? ('失败 ' + errors.length + ' 条') : '全部通过');
  console.log(out.join('\n'));
  process.exit(errors.length ? 1 : 0);
})();
