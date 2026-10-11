/* 「该请谁教你」：按要学的内容 + 你现在的状态，推荐一位导师
 *
 * 用户原话：「能根据要学的内容，推荐一位导师」
 *
 * 设计边界（本测试守的就是这些）：
 *   · 推荐的不是「谁教哪一科」——所有人格都与学科无关（见设置页那段说明）——
 *     而是「这块内容吃的是什么」：吃定义？吃图形？吃适用条件？吃物理意义？
 *     叠加「你现在的状态」：基础不牢？怕假懂？学过忘了？逻辑链跟丢？
 *   · 纯本地规则，不耗 token —— 没配 API 也得能用
 *   · 自定义人设不参与：它没有可打分的标签，硬推等于瞎猜
 *   · 没信号就说没信号，不为推荐而推荐
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

(async () => {
  const vc = new VirtualConsole();
  const errors = [], out = [];
  const log = s => out.push(s);
  const ok = (c, m) => { log((c ? '✓ ' : '✗ ') + m); if (!c) errors.push(m); };
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
      win.fetch = () => Promise.resolve({
        ok: true, status: 200, statusText: 'OK', json: async () => ({}),
        body: { getReader() { return { read() { return new Promise(() => {}) } } } }
      });
      win.URL.createObjectURL = () => 'blob:x'; win.URL.revokeObjectURL = () => {};
    }
  });
  const wnd = dom.window, doc = wnd.document;
  await wait(800);
  const ev = s => { try { return wnd.eval(s) } catch (e) { errors.push('eval: ' + e.message); return undefined } };
  const J = s => JSON.parse(ev('JSON.stringify(' + s + ')'));
  const feed = (txt, states) => ev('$("rq").value=' + JSON.stringify(txt) + ';RSEL=' + JSON.stringify(states || []) + ';renderRout()');
  const rank = (txt, states) => { feed(txt, states); return J('rRank(rRec().sc)') };
  const top = (txt, states) => { const r = rank(txt, states); return (r && r[0]) || '' };
  const rtext = () => ev('$("rout").textContent');

  /* ---------- 1. 界面与入口 ---------- */
  log('=== 1. 界面与入口 ===');
  ok(!!doc.querySelector('#reccard'), '设置页有「该请谁教你」卡片');
  ok(!!doc.querySelector('#rq') && !!doc.querySelector('#rst') && !!doc.querySelector('#rgo'), '有输入框、状态条、推荐按钮');
  ok(!!doc.querySelector('#rgo2'), '上课页顶部也有「推荐导师」入口');
  ok(ev('$("rq").value.length>0'), '内容框按当前章节预填（' + ev('$("rq").value') + '）');
  ok(doc.querySelectorAll('#rst .pill').length === ev('RSTATE.length'), '状态标签全渲染出来（' + ev('RSTATE.length') + ' 个）');

  /* ---------- 2. 内容决定人选 ---------- */
  log('=== 2. 内容的性质决定人选 ===');
  ok(top('定积分的定义、可积的充要条件与一个反例') === 'cauchy', '吃定义与条件 → 柯西（' + top('定积分的定义、可积的充要条件与一个反例') + '）');
  ok(top('定积分的几何应用：旋转体的体积和弧长') === 'leibniz', '吃图形 → 莱布尼茨（' + top('定积分的几何应用：旋转体的体积和弧长') + '）');
  ok(top('微分方程在 RC 电路中的应用，时间常数的物理意义') === 'newton', '吃物理与工程 → 牛顿（' + top('微分方程在 RC 电路中的应用，时间常数的物理意义') + '）');
  ok(top('比较判别法的适用条件，什么时候会失效') === 'xiangliyao', '吃适用条件 → 相里要（' + top('比较判别法的适用条件，什么时候会失效') + '）');
  ok(top('矩阵的初等变换与线性方程组同解，解的结构怎么推导') === 'changli', '吃推理链 → 长离（' + top('矩阵的初等变换与线性方程组同解，解的结构怎么推导') + '）');
  ok(top('自定义类型和类型转换的区别，为什么运算符有优先级') === 'verina', '吃概念辨析 → 维里奈（' + top('自定义类型和类型转换的区别，为什么运算符有优先级') + '）');

  /* ---------- 3. 状态叠加 ---------- */
  log('=== 3. 你现在的状态也参与 ===');
  const iAe = ev('RSTATE.findIndex(function(x){return x.p==="aemeath"})');
  const iSh = ev('RSTATE.findIndex(function(x){return x.p==="shorekeeper"})');
  const iCa = ev('RSTATE.findIndex(function(x){return x.p==="cauchy"})');
  const iEx = ev('RSTATE.findIndex(function(x){return x.mo==="exam"})');
  const iFa = ev('RSTATE.findIndex(function(x){return x.pace==="fast"})');
  ok(top('', [iAe]) === 'aemeath', '只勾「怕自己假装懂了」→ 爱弥斯');
  ok(top('', [iSh]) === 'shorekeeper', '只勾「学过一遍忘了」→ 守岸人');
  ok(top('', [iCa]) === 'cauchy', '只勾「想被问住」→ 柯西');
  ok(top('', [iAe, iSh]) === 'aemeath', '两个都勾时按权重与固定顺序定夺');
  ok(top('定积分的几何应用：旋转体体积', [iSh]) === 'shorekeeper', '内容与状态打架时 —— 你亲手勾的状态更重（几何 4.5 vs 忘了 6.0）');
  ok(top('定积分的几何应用：旋转体体积', [ev('RSTATE.findIndex(function(x){return x.p==="leibniz"})')]) === 'leibniz',
    '状态和内容指向同一个人时，分数叠加，更稳');

  /* ---------- 4. 内容里顺口写的困境也算信号 ---------- */
  log('=== 4. 内容里写的困境也是信号 ===');
  ok(top('极限的定义，但我其实一直是假装懂了') === 'aemeath', '「极限 + 其实假装懂了」→ 爱弥斯，而不是柯西（' + top('极限的定义，但我其实一直是假装懂了') + '）');
  ok(top('线性代数，学过一遍现在全忘了，想捡起来') === 'shorekeeper', '「学过一遍忘了想捡起来」→ 守岸人（' + top('线性代数，学过一遍现在全忘了，想捡起来') + '）');
  ok(top('矩阵，前面的基础不牢，底子有漏洞') === 'verina', '「基础不牢」→ 维里奈（' + top('矩阵，前面的基础不牢，底子有漏洞') + '）');
  ok(top('行列式太抽象，想象不出来') === 'leibniz', '「太抽象想象不出来」→ 莱布尼茨（' + top('行列式太抽象，想象不出来') + '）');

  /* ---------- 5. 没有信号就不硬推 ---------- */
  log('=== 5. 没有信号就说没有 ===');
  const empty = rank('', []);
  ok(empty.length === 0, '空输入、零状态 → 候选为空');
  ok(rtext().indexOf('还没读出什么信号') >= 0, '界面上直接说没信号，不硬凑一个');
  ok(ev('$("rout").querySelector("[data-rk]")') === undefined || !ev('$("rout").querySelector("[data-rk]")'), '这时不出现「用 TA 上课」按钮');

  /* ---------- 6. 搭配的模式与节奏 ---------- */
  log('=== 6. 顺带建议模式与节奏 ===');
  feed('', [iEx]);
  ok(rtext().indexOf('考试视角') >= 0, '勾「想知道会怎么考」→ 建议切「考试视角」模式');
  feed('', [iFa]);
  ok(rtext().indexOf('节奏：快') >= 0, '勾「只想快点过一遍」→ 建议把节奏调快');
  ok(J('rRec().pace').fast > 0, '节奏推荐确实落到了 fast 上');

  /* ---------- 7. 一键应用 ---------- */
  log('=== 7. 一键应用 ===');
  ev('who="cauchy";MODEK="teach";PA="mid";LS.s("who","cauchy");LS.s("mode","teach");LS.s("pace","mid");');
  feed('定积分的几何应用：旋转体的体积和弧长', []);
  const first = doc.querySelector('#rout [data-rk]');
  ok(first && first.dataset.rk === 'leibniz', '主推按钮指向莱布尼茨');
  first.onclick();
  await wait(20);
  ok(ev('who') === 'leibniz', '点了之后当前导师换成莱布尼茨');
  ok(ev('LS.g("who")') === 'leibniz', '换人结果已落盘（刷新后还在）');
  ok(ev('$("sys").value') === ev('getP("leibniz").p'), '提示词框跟着换成人格自己的（没被上一位的改动串台）');
  ok(ev('$("v-lesson").classList.contains("on")'), '「用 TA 上课」直接跳到上课页');

  log('=== 8. 只换人 / 备选 ===');
  ev('goView("set")');
  feed('矩阵的初等变换与线性方程组同解', []);
  const only = doc.querySelectorAll('#rout [data-rk]')[1];
  ok(!!only && only.dataset.go === undefined, '第二个按钮是「只换人」（不带跳转）');
  only.onclick();
  await wait(20);
  ok(ev('who') === 'changli', '点「只换人」→ 换成长离');
  ok(ev('$("v-set").classList.contains("on")'), '「只换人」不会把人踢出设置页');
  ok(doc.querySelectorAll('#rout .rcitem').length === 0, '只有一个信号命中时，不硬凑备选');
  feed('定积分的几何应用：旋转体的体积和弧长，还有物理意义和单位', []);
  const mini = doc.querySelectorAll('#rout .rcitem');
  ok(mini.length > 0, '两个信号命中时就给出「也说得通」的备选（' + mini.length + ' 个）');
  ok(mini[0] && mini[0].dataset.go === undefined, '备选点了只换人、不跳页');
  mini[0].onclick();
  await wait(20);
  ok(ev('who') === 'newton', '点备选后换到备选那一位（' + ev('who') + '）');
  ok(ev('rRank(rRec().sc).length') <= ev('PORDER.length'), '备选不会超过内置人格总数');

  /* ---------- 9. 模式与节奏一并应用 ---------- */
  log('=== 9. 模式与节奏一并应用 ===');
  ev('MODEK="teach";PA="mid";LS.s("mode","teach");LS.s("pace","mid");');
  feed('定积分怎么考，期末常出什么题型', [iEx]);
  doc.querySelector('#rout [data-rk]').onclick();
  await wait(20);
  ok(ev('MODEK') === 'exam', '推荐里带了模式 → 一并切到考试视角');
  ok(ev('LS.g("mode")') === 'exam', '模式已落盘');
  feed('随便什么', [iFa]);
  doc.querySelector('#rout [data-rk]').onclick();
  await wait(20);
  ok(ev('PA') === 'fast', '推荐里带了节奏 → 一并调快');
  ok(ev('$("pace").value') === 'fast', '顶部那个节奏下拉也同步了');

  /* ---------- 10. 自定义人设不参与 ---------- */
  log('=== 10. 自定义人设不参与推荐 ===');
  ev('MYP.zz={n:"测试角色",p:"随便写点什么"};');
  feed('定积分的定义与充要条件', []);
  ok(ev('rRank(rRec().sc).every(function(k){return !!PERSONA[k]})'), '候选里只有内置人格');
  ok(ev('rRank(rRec().sc).indexOf("zz")') < 0, '自定义人设不会因为“没有标签”被硬塞进来');
  ok(ev('pKeys().indexOf("zz")') > 0, '但它照旧出现在上面那排人格里，能手动选');
  ev('delete MYP.zz;');

  /* ---------- 11. 名额上限与排序稳定 ---------- */
  log('=== 11. 排序与上限 ===');
  const r1 = [].concat(rank('定积分的几何应用：旋转体体积、弧长，还有物理应用和单位', []));
  const r2 = [].concat(rank('定积分的几何应用：旋转体体积、弧长，还有物理应用和单位', []));
  ok(r1.join(',') === r2.join(','), '同样的输入推同样的人（顺序稳定，不抖）');
  ok(r1.length <= ev('PORDER.length'), '候选数不超过内置人格数');
  feed('定积分', []);
  ok(doc.querySelectorAll('#rout [data-rk]').length <= 3, '界面上最多 1 位主推 + 2 位备选');
  ok(ev('rHit("定积分的定义", "定义 积分 不存在")') === 2, '关键词命中按「词」去重计数');
  ok(ev('rHit("aaaaaaaaaa", "a")') === 1, '同一个词出现多次只算一次');

  /* ---------- 12. 预填与重填 ---------- */
  log('=== 12. 预填与重填 ===');
  ev('goView("set")');
  ok(ev('$("rq").value').length > 0, '进设置页内容框不空着');
  ev('$("rq").value="我自己写的内容"');
  ev('goView("lesson");goView("set")');
  ok(ev('$("rq").value') === '我自己写的内容', '自己写过的内容不会被自动预填冲掉');
  ev('$("rfill").onclick()');
  ok(ev('$("rq").value') !== '我自己写的内容' && ev('$("rq").value').length > 0,
    '点「用当前章节填」才重新按章节覆盖');
  ok(ev('rAuto().length') > 0, '预填文本来自当前节名/勾选章节/课程名');
  const v1 = ev('$("rq").value');
  ev('goView("lesson");goView("set")');
  ok(ev('$("rq").value') === v1, '反复进出设置页，自动填的内容不叠加、不抖动');
  ok(ev('fillRq(false)') === undefined && ev('$("rq").value') === v1, '再填一次也还是同一句（自动填的值可以被安全刷新）');

  log('');
  log(errors.length ? ('--- 失败 ' + errors.length + ' ---') : '全部通过');
  console.log(out.join('\n'));
  if (errors.length) { console.log(errors.map(e => '  ✗ ' + e).join('\n')); process.exit(1) }
})().catch(e => { console.error('崩了：', e); process.exit(1) });
