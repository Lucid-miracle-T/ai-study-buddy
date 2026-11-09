/* 两件事的专项回归（2026-11-09）
 *
 * 1) 手机「Ω 特殊符号」点不出来：
 *    手机默认 SYMA=0，renderSym() 早期 return 导致点 Ω 只切了 CSS 类、
 *    #symgrids 里一个按钮都没有。现在 symVisible() 把 symopen 也算「要看符号」，
 *    展开时补渲染、收起时清空；SYMA 偏好本身不动。
 *
 * 2) 用户要求：伙伴和节奏在课中不可更改，下节课可重新选择。
 *    - 「课中」＝向导里点过「开始上课 →」（写进 s.beg），或这一节有用户发的话
 *      （老数据兼容；系统开场白不算）
 *    - 锁：伙伴药丸 / 节奏下拉 / 向导大卡 / 推荐伙伴，点了只提示、不改状态
 *    - 模式（这一轮干什么）不锁，随时可改
 *    - 节奏也按节存（s.pace），且不再覆盖全局 gx.pace，
 *      否则老节回落的是「下一节刚选的值」，切回去就串了
 *    - 课中向导出现「开新的一节 →」，新节未开课 → 自动解锁并重新摆出向导
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const HTML = () => fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')
  .replace(/<script src="https:[^"]+"><\/script>/g, '');

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

function boot(opts) {
  opts = opts || {};
  const vc = new VirtualConsole(); const errs = [];
  vc.on('jsdomError', e => {
    const m = e.message || String(e);
    if (/Not implemented: navigation/.test(m)) return;
    errs.push('jsdomError: ' + m);
  });
  const dom = new JSDOM(HTML(), {
    url: opts.url || 'https://x.test/',
    runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      installIDB(win);
      if (opts.width !== undefined) {
        Object.defineProperty(win, 'innerWidth', { value: opts.width, configurable: true, writable: true });
      }
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
  const ok = (c, m) => { log((c ? '✓ ' : '✗ ') + m); if (!c) errors.push(m); };
  const wait = ms => new Promise(r => setTimeout(r, ms));

  /* ==================== 1. 手机符号面板 ==================== */
  log('=== 1. 手机 390px：Ω 特殊符号点得出来 ===');
  {
    const { wnd, errs } = boot({ width: 390 });
    const doc = wnd.document;
    await wait(850);
    const ev = s => { try { return wnd.eval(s); } catch (e) { errors.push('eval: ' + e.message); return undefined; } };
    const q = s => doc.querySelector(s);
    const qa = s => Array.from(doc.querySelectorAll(s));
    const nBtn = () => qa('#symgrids .symbtn').length;

    ok(doc.body.classList.contains('mobile'), '手机抽屉生效（同一份页面按宽度分流）');
    ok(ev('SYMA') === 0, '手机默认 SYMA=0（不常驻摊开几十个按钮）');
    ok(nBtn() === 0 && q('#symtabs').style.display === 'none', '初始符号内容确实收着');

    q('#symtoggle').click();
    await wait(30);
    ok(doc.body.classList.contains('symopen'), '点 Ω 加上 symopen');
    ok(nBtn() >= 20, '展开后真的渲染出符号按钮（实际 ' + nBtn() + ' 个）');
    ok(qa('#symtabs .symbtn').length >= 2, '分类按钮也渲染出来了');
    ok(q('#symtabs').style.display === 'flex', '分类栏不再被内联 display:none 藏住');
    ok(ev('SYMA') === 0, '没有顺手改掉用户的「进入页面时符号面板」偏好');
    ok(q('#symtoggle').className.indexOf('pri') >= 0, 'Ω 按钮高亮表示已展开');

    const tabs = qa('#symtabs .symbtn');
    const before = qa('#symgrids .symbtn').map(b => b.textContent).join('');
    if (tabs[1]) tabs[1].click();
    await wait(30);
    const after = qa('#symgrids .symbtn').map(b => b.textContent).join('');
    ok(before !== after && nBtn() > 0, '切分类会换一组符号（不是死面板）');

    q('#in').value = '';
    const sb = qa('#symgrids .symbtn')[0];
    if (sb) sb.click();
    ok(q('#in').value.length > 0, '点符号能插进输入框：' + JSON.stringify(q('#in').value));

    q('#symtoggle').click();
    await wait(30);
    ok(!doc.body.classList.contains('symopen') && nBtn() === 0, '再点一次收起并清空，不留一层空壳');
    ok(errs.length === 0, '手机符号面板没有 JS 异常：' + errs.join(' | '));
    wnd.close();
  }

  log('');
  log('=== 2. 桌面：SYMA 偏好与「⋯ 更多」老习惯不变 ===');
  {
    const { wnd, errs } = boot({ width: 1024 });
    const doc = wnd.document;
    await wait(850);
    const ev = s => { try { return wnd.eval(s); } catch (e) { errors.push('eval: ' + e.message); return undefined; } };
    const q = s => doc.querySelector(s);
    const qa = s => Array.from(doc.querySelectorAll(s));

    ok(ev('SYMA') === 1, '桌面默认 SYMA=1');
    ok(qa('#symgrids .symbtn').length >= 20, '桌面启动就有符号按钮');
    q('#symtoggle').click();
    await wait(30);
    ok(doc.body.classList.contains('symopen') && ev('SYMA') === 1,
      '简洁外壳下点 Ω 只切符号抽屉，不动 SYMA 偏好');
    q('#lexpand').click();
    await wait(20);
    ok(doc.body.classList.contains('expand'), '「⋯ 更多」展开完整工具栏');
    q('#symtoggle').click();
    await wait(30);
    ok(ev('SYMA') === 0 && qa('#symgrids .symbtn').length === 0,
      '完整工具栏下 Ω 仍按老习惯切换 SYMA 并收起');
    q('#symtoggle').click();
    await wait(30);
    ok(ev('SYMA') === 1 && qa('#symgrids .symbtn').length >= 20, '再点恢复展开');
    ok(errs.length === 0, '桌面符号面板没有 JS 异常：' + errs.join(' | '));
    wnd.close();
  }

  /* ==================== 3. 课中锁定 / 下节重选 ==================== */
  log('');
  log('=== 3. 课中锁定：伙伴、节奏改不动 ===');
  {
    const { wnd, errs } = boot({ width: 1024 });
    const doc = wnd.document;
    await wait(850);
    const ev = s => { try { return wnd.eval(s); } catch (e) { errors.push('eval: ' + e.message); return undefined; } };
    const q = s => doc.querySelector(s);
    const qa = s => Array.from(doc.querySelectorAll(s));
    const toastText = () => (q('#toast') || {}).textContent || '';
    const changePace = v => {
      const p = q('#pace'); p.value = v;
      p.dispatchEvent(new wnd.Event('change', { bubbles: true }));
    };
    const oldId = ev('CURS');

    /* --- 未开课：两个都能改，且写回当前节 --- */
    const pills = qa('#pbox .pill');
    const other = pills.filter(p => p.className.indexOf('on') < 0)[0];
    ok(!!other && ev('cfgLocked()') === false, '新节还没有我发的话 → 未锁定');
    other.click(); await wait(30);
    ok(ev('who') !== 'cauchy', '未开课时伙伴可以换');
    ok(ev('sessOf(CURS).who') === ev('who'), '换伙伴仍写回当前这一节');
    changePace('slow'); await wait(30);
    ok(ev('PA') === 'slow' && ev('sessOf(CURS).pace') === 'slow', '未开课时节奏可以换，并按节记录');
    ok(ev('LS.g("pace","mid")') === 'mid', '改节奏不再覆盖全局 gx.pace（老节回落值不被污染）');

    /* --- 制造一条「我发的话」＝课中 --- */
    ev('MS=[{r:"user",c:"开始",s:CURS}];saveMs();syncLockUI();');
    await wait(30);
    ok(ev('startedSess()') === true && ev('cfgLocked()') === true, '本节有用户发言 → 判定为课中');
    ok(doc.body.classList.contains('cfglock'), '锁定态同步到 body（药丸与下拉看起来不可点）');
    const who1 = ev('who'), pace1 = ev('PA');

    const other2 = qa('#pbox .pill').filter(p => p.textContent !== ev('getP(who).n'))[0];
    if (other2) other2.click();
    await wait(30);
    ok(ev('who') === who1 && ev('sessOf(CURS).who') === who1, '课中点别的伙伴药丸 → 人和节都不变');
    ok(/已经开课/.test(toastText()), '给出「开新的一节可重选」的提示：' + toastText().slice(0, 40));

    changePace('fast');
    await wait(30);
    ok(ev('PA') === pace1 && q('#pace').value === pace1, '课中改节奏 → PA 不变、下拉回弹到原值');
    ok(ev('sessOf(CURS).pace') === pace1, '节上记的节奏也没被改');
    ok(/已经开课/.test(toastText()), '节奏也有同样的提示');

    ev('renderLaunch()');
    ok(q('#launch').classList.contains('locked'), '课中打开的向导带 locked 态');
    ok(q('#lhNext') && q('#lhNext').hidden === false, '向导里出现「开新的一节 →」');
    ok(/开新的一节/.test(q('.lh-note').textContent), '向导说明写清「下节课可重新选」');
    ok(/已经开课/.test(toastText()) || /本节已锁定/.test(q('#lhStatus').textContent),
      '状态栏也标明本节已锁定');

    const lc = qa('#lhWho .lh-card').filter(c => c.className.indexOf('on') < 0)[0];
    if (lc) lc.click();
    const lo = qa('#lhPace .lh-opt').filter(c => c.className.indexOf('on') < 0)[0];
    if (lo) lo.click();
    ev('applyRec("cauchy")');
    await wait(30);
    ok(ev('who') === who1 && ev('PA') === pace1, '向导大卡 / 推荐伙伴同样改不动');

    const modeOther = qa('#mbox .pill').filter(p => p.className.indexOf('on') < 0)[0];
    if (modeOther) modeOther.click();
    await wait(30);
    ok(ev('MODEK') !== 'teach', '模式（这一轮做什么）不在锁定范围内，仍可随时改');

    /* --- 开新的一节 → 解锁、可重新选 --- */
    q('#lhNext').click();
    await wait(60);
    const newId = ev('CURS');
    ok(newId !== oldId && ev('SESS.length') === 2, '点「开新的一节」真的新建了一节');
    ok(ev('cfgLocked()') === false && !doc.body.classList.contains('cfglock'), '新节没有我的发言 → 自动解锁');
    ok(!q('#launch').classList.contains('locked') && q('#lhNext').hidden === true,
      '向导随即变回可选状态，「开新的一节」按钮收起');

    const np = qa('#pbox .pill').filter(p => p.textContent !== ev('getP(who).n'))[0];
    if (np) np.click();
    await wait(30);
    ok(ev('sessOf(CURS).who') === ev('who'), '新节可以重新选伙伴，写进新节');
    ok(ev('sessOf("' + oldId + '").who') === who1, '上一节的伙伴没被带跑');
    changePace('fast');
    await wait(30);
    ok(ev('PA') === 'fast' && ev('sessOf(CURS).pace') === 'fast', '新节可以重新选节奏');

    ev('switchSess("' + oldId + '")');
    await wait(50);
    ok(ev('PA') === pace1 && q('#pace').value === pace1, '切回上一节：节奏回到那一节自己的值');
    ok(ev('who') === who1, '切回上一节：伙伴也回到那一节自己的值');
    ok(ev('cfgLocked()') === true, '上一节仍是课中、仍锁定');
    ev('switchSess("' + newId + '")');
    await wait(50);
    ok(ev('PA') === 'fast', '再切回新节：节奏仍是新选的 fast');

    ok(ev('sessPace("__none__")') === ev('LS.g("pace","mid")'),
      '老节（没有 pace 字段）仍回落全局，升级不改写历史');
    ok(errs.length === 0, '锁定流程没有 JS 异常：' + errs.join(' | '));
    wnd.close();
  }

  log('');
  log('=== 4. 体验版（LITE）同样生效 ===');
  {
    const { wnd, errs } = boot({ width: 390, url: 'https://x.github.io/' });
    const doc = wnd.document;
    await wait(850);
    const ev = s => { try { return wnd.eval(s); } catch (e) { errors.push('eval: ' + e.message); return undefined; } };
    const q = s => doc.querySelector(s);
    const qa = s => Array.from(doc.querySelectorAll(s));

    ok(ev('LITE') === true, 'github.io 判定为体验版');
    ok(qa('#lhWho .lh-card').length === 3, '体验版仍只给前三位伙伴');
    q('#symtoggle').click();
    await wait(30);
    ok(qa('#symgrids .symbtn').length >= 20, '体验版手机也能点出符号面板');
    ev('MS=[{r:"user",c:"开始",s:CURS}];saveMs();syncLockUI();renderLaunch();');
    await wait(30);
    ok(ev('cfgLocked()') === true && q('#launch').classList.contains('locked'),
      '体验版课中同样锁定');
    ok(errs.length === 0, '体验版没有 JS 异常：' + errs.join(' | '));
    wnd.close();
  }

  console.log(out.join('\n'));
  console.log('\n--- 异常 ---\n  ' + (errors.length ? errors.join('\n  ') : '无'));
  if (errors.length) { console.log('\n失败 ' + errors.length + ' 条'); process.exit(1); }
  console.log('\n全部通过');
})();
