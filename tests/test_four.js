/* 四项新能力的回归测试：出处卡片 / 三个出口 / 错题本闭环 / 免费讲义
 *
 * 背景（2026-11-08）：对照《吴乐旻 · 内容蒸馏》L3 的缺口清单，
 *   ① 出处标注 + 绝不伪造页码   ② 减压阀 / 越界阀 / 结算边界
 *   ③ 错题本 + 复习闭环         ④ 自制免费讲义 + 分发入口
 *
 * 关键设计（别在后续改动里破坏）：
 *   - 出处标记 〔出处:…〕 在 md() 里走 %%C 占位符，与 KaTeX 的 %%M 同源，
 *     不能先过 marked/DOMPurify，否则 HTML 会被当文本吃掉
 *   - EXIT 放在 system prompt 最末 —— 本站约定「放最后＝优先级最高」，
 *     用户当场发出的节奏命令理应压过人格、纪律与本轮模式
 *   - 错题不是第二套数据结构，是 CD 里带 w:1 的一张卡：
 *     共用 6 档 Leitner、按课/节隔离、共用备份；显示筛选不能影响复习队列
 *   - 免费讲义是本站自编、随仓库分发，真教材正文仍被 .gitignore 排除
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

function boot(storage) {
  const vc = new VirtualConsole(); const errs = [];
  vc.on('jsdomError', e => {
    const m = e.message || String(e);
    if (/Not implemented: navigation/.test(m)) return;
    errs.push('jsdomError: ' + m);
  });
  const dom = new JSDOM(HTML(), {
    url: 'https://x.test/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      installIDB(win);
      win.confirm = () => true; win.alert = () => {}; win.open = () => null;
      win.fetch = () => Promise.reject(new Error('测试不联网'));
      win.URL.createObjectURL = () => 'blob:x'; win.URL.revokeObjectURL = () => {};
      Object.keys(storage || {}).forEach(k => win.localStorage.setItem(k, storage[k]));
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
  const doc = wnd.document;
  await wait(700);
  const ev = s => { try { return wnd.eval(s); } catch (e) { errors.push('eval: ' + e.message); return undefined; } };
  const q = s => doc.querySelector(s);
  const src = SRC();

  /* ============ 1. 出处卡片 + 绝不伪造页码 ============ */
  log('=== 1. 出处标注 / 绝不伪造页码 ===');
  {
    const sys = ev('sysMsg()') || '';
    ok(sys.indexOf('【出处与页码 · 绝不伪造】') >= 0, 'system prompt 含出处硬规则');
    ok(sys.indexOf('绝不编造精确页码') >= 0, '明令禁止编造页码 / 图号 / 习题号');
    ok(sys.indexOf('〔出处:分册名 · 章节标题〕') >= 0, '给出可解析的出处标记格式');
    ok(sys.indexOf('没把握就写') >= 0, '给不出确切位置时要求模糊定位');
    ok(sys.indexOf('【出处与页码') < sys.indexOf('【教材依据】'), '出处规则排在教材依据之前，先立规矩再给锚点');

    /* 渲染：走占位符，不被 marked/DOMPurify 吞掉 */
    const h = ev('md("由夹逼准则可得 〔出处:第1章_函数与极限.md · 极限存在准则〕 该极限为 1。")') || '';
    ok(/class="cite"/.test(h), '出处标记渲染成 .cite 卡片');
    ok(h.indexOf('%%C0%%') < 0, '占位符已还原，没漏 % 到页面上');
    ok(/data-cite="第1章_函数与极限.md · 极限存在准则"/.test(h), '卡片带上可核对的章节名');
    ok(h.indexOf('该极限为 1') >= 0, '正文没被出处替换吃掉');
    const h2 = ev('md("这一条我按通用知识讲 〔出处:本轮未带教材〕")') || '';
    ok(/class="cite off"/.test(h2), '「未带教材」标成不可点的灰卡，不假装能核对');
    ok((src.match(/%%C\(\\d\+\)%%/g) || []).length >= 1, '源码里确实是占位符方案，不是直接拼 HTML');

    /* 点击卡片 → 跳到教材页、目录筛到那一节 */
    ev('CH=[{id:"c.md#1",file:"c.md",level:2,title:"极限存在准则",txt:"夹逼准则原文"}]; COURSE="c.md"; CTX=[];');
    const chipHtml = ev('md("由夹逼准则 〔出处:c.md · 极限存在准则〕 可得")') || '';
    ev('document.getElementById("mw").innerHTML=' + JSON.stringify('<div class="msg"><div class="body">' + chipHtml + '</div></div>'));
    const real = q('#mw .cite');
    if (real) real.dispatchEvent(new wnd.MouseEvent('click', { bubbles: true }));
    await wait(60);
    ok((q('#bq') || {}).value === '极限存在准则', '点出处把教材目录筛到对应章节');
    ok(q('#v-book') && q('#v-book').classList.contains('on'), '自动切到教材页');
  }

  /* ============ 2. 三个出口 ============ */
  log('');
  log('=== 2. 减压阀 / 越界阀 / 结算边界 ===');
  {
    const sys = ev('sysMsg()') || '';
    ok(sys.indexOf('【节奏权归学习者 · 三个出口】') >= 0, 'system prompt 含三个出口');
    ok(sys.indexOf('减压阀') >= 0 && sys.indexOf('越界阀') >= 0 && sys.indexOf('结算边界') >= 0,
      '三个出口都在（讲不讲 / 展开不展开 / 结不结束）');
    ok(sys.indexOf('这一段的优先级高于上面所有教学规则与本轮模式') >= 0, '明示优先级高于本轮模式');
    ok(sys.indexOf('【本轮模式') < sys.indexOf('【节奏权归学习者'),
      '真的排在模式之后 —— 本站「放最后＝优先级最高」，不能嘴上说最高、位置却更低');
    ok(sys.indexOf('只对发出它的那一轮有效') >= 0, '节奏命令只管一轮，下一轮自动恢复追问');
    ok(sys.indexOf('「一次只问一个问题」约束的是你，不是我的提问权') >= 0, '越界阀把提问权还给学习者');
    ok(sys.indexOf('中途休息、闲聊、跑题') >= 0, '课间不算下课');
    ok(sys.indexOf('只有我明确结算了，才写一份简短小结') >= 0, '小结只在明确结算后写');

    /* UI：出口必须看得见、点得到 */
    const bar = q('#pacebar');
    ok(!!bar, '输入栏有节奏命令条');
    const cmds = bar ? Array.from(bar.querySelectorAll('[data-cmd]')).map(b => b.getAttribute('data-cmd')) : [];
    ok(cmds.length >= 7, '至少 7 条节奏命令（实际 ' + cmds.length + '）');
    ok(cmds.some(c => /直接讲/.test(c)) && cmds.some(c => /先做题/.test(c)), '含「直接讲」「先做题」');
    ok(cmds.some(c => /不要剧透/.test(c)), '含「不要剧透后面的内容」');
    ok(!!(bar && bar.querySelector('[data-act="settle"]')), '「今天结束 · 结算」是独立动作，判定权归用户');
    /* 源码里出现两次：一次是按钮定义，一次是事件绑定用的选择器；按钮只能有一个 */
    ok((src.match(/<button[^>]*data-act="settle"/g) || []).length === 1,
      '结算按钮只有一处，不会重复触发');

    /* 输入框已有草稿时不能冲掉 */
    const ta = q('#in');
    ta.value = '帮我看看这一步';
    const btn = bar.querySelector('[data-cmd]');
    btn.dispatchEvent(new wnd.MouseEvent('click', { bubbles: true }));
    ok(ta.value.indexOf('帮我看看这一步') >= 0, '点节奏命令保留用户已写的草稿');
    ok(ta.value.indexOf('直接讲') >= 0, '命令插在草稿前面');
    ok(ev('MS.length') === 0, '有草稿时只填入、不擅自发送（避免误触花 token）');
    ta.value = '';
  }

  /* ============ 3. 错题本 + 复习闭环 ============ */
  log('');
  log('=== 3. 错题本 / 复习闭环 ===');
  {
    /* 解析：只认【错点清单】区，讲解正文里的反例不收 */
    const txt = '先给结论：72 分。\n- 第一步少了定义域条件。\n\n【错点清单】\n'
      + '- 类型：定义域条件 | 错点：把 ln x 的定义域丢了 | 正确做法：先写 x>0\n'
      + '- 类型：符号错 | 错点：负号抄成了正号 | 正确做法：整体乘 -1\n'
      + '- 无';
    const ws = ev('parseWrong(' + JSON.stringify(txt) + ')') || [];
    ok(ws.length === 2, '清单里 2 条真错点，「- 无」不计入：' + ws.length);
    ok(ws[0].t === '定义域条件' && /ln x/.test(ws[0].q), '类型与错点解析正确');
    ok(/x>0/.test(ws[0].a), '正确做法解析正确（隔天再考当答案）');
    ok(ev('parseWrong("这里没有清单，只是一段讲解")').length === 0, '没有清单就不硬收');

    /* 入库：归属钉死、隔天到期、去重 */
    ev('CD=[]; COURSE="__local"; CURS="sA"; WF="all"; CARD_S="all"; REV_W=false;');
    const k = ev('addWrongs(parseWrong(' + JSON.stringify(txt) + '),"__local","sA","grade")');
    ok(k === 2, '入库 2 条：' + k);
    ok(ev('CD.every(function(c){return c.w===1&&c.c==="__local"&&c.s==="sA"})'), '带上错题标记并记对课/节');
    ok(ev('CD.every(function(c){return c.due-Date.now()>20*3600*1000})'), '首次到期是隔天，不是 5 分钟后');
    ok(ev('CD.length') === 2, '同一批重复批改不会越攒越多');
    ok(ev('addWrongs(parseWrong(' + JSON.stringify(txt) + '),"__local","sA","grade")') === 2,
      '再批改一次仍返回 2（是更新不是新增）');
    ok(ev('CD.length') === 2, '二次批改后总数仍是 2，档位被打回第 1 格');

    /* 显示筛选不能影响复习队列 */
    ok(ev('cardList().length') === 2, '默认视图看到 2 张');
    ev('WF="plain"');
    ok(ev('cardList().length') === 0, '切「只看普通闪卡」后列表为空');
    ok(ev('scopeCards().length') === 2, '但课/节范围里错题还在，不会从复习里消失');
    ev('WF="wrong"');
    ok(ev('cardList().length') === 2, '切「只看错题」又都回来了');
    ev('WF="all"');

    /* 复习：只复习错题 / 忘了就地升成错题 / 连对三次毕业 */
    ev('CD.push({id:"n1",q:"普通卡",a:"答",box:0,due:Date.now()-1000,rep:0,c:"__local",s:"sA"})');
    ev('CD.forEach(function(c){if(c.w)c.due=Date.now()-1000}); renderCards()');
    ok(ev('dueList().length') === 3, '普通卡与错题都进到期队列');
    ev('document.getElementById("revieww").click()');
    ok(ev('REV_W') === true, '「只复习错题」把这一轮的队列限定为错题');
    ok(ev('revQueue().length') === 2, '队列里只有 2 张错题：' + ev('revQueue().length'));
    ev('REV_W=false');
    ev('rev="n1"; grade(false)');
    const n1 = ev('CD.filter(function(c){return c.id==="n1"})[0]');
    ok(!!n1 && n1.w === 1, '复习点「忘了」→ 普通卡就地升成错题');
    ok(n1.t === '复习时想不起来', '记下错因类型');
    /* grade() 会自动把 rev 移到下一张，所以每次都把对象钉回 n1 */
    ev('["n1","n1","n1"].forEach(function(id){rev=id; grade(true)});');
    const n1b = ev('CD.filter(function(c){return c.id==="n1"})[0]');
    ok(n1b.w === 0 && n1b.grad === 1, '连对三次从错题本毕业，不再占复习队列');
    ok(ev('CD.filter(function(c){return c.w}).length') === 2, '毕业不影响别的错题');

    /* 手动记错题 + 备份自动带走 */
    ok(ev('typeof addWrongs') === 'function' && !!q('#neww'), '闪卡页有「记一条错题」入口');
    ok(ev('bkpKeys().indexOf("gx.cards")>=0') || ev('LS.g("cards",[]).length') === 3,
      '错题就存在 gx.cards 里，导出备份自动带走（不新增需同步的键）');
    ok(/错题 \d+/.test((q('#due') || {}).textContent || ''), '待复习标签里显示错题数：' + ((q('#due') || {}).textContent || ''));
  }

  /* ============ 4. 自制免费讲义 ============ */
  log('');
  log('=== 4. 内容供给 / 免费讲义 ===');
  {
    const freePath = path.join(ROOT, 'book', '示例', '导数与微分_精讲讲义.md');
    ok(fs.existsSync(freePath), '第二册自编讲义文件存在');
    const free = fs.readFileSync(freePath, 'utf8');
    ok(/MIT/.test(free) && /不是任何出版教材/.test(free), '文件头写明自编与许可，不碰教材版权');
    ok((free.match(/^##\s+.+$/gm) || []).length >= 5, '至少 5 讲，按 ## 切成可勾选的节');
    ok(!/摘自|引自|据.*教材第/.test(free), '正文没有「摘自某书」这类摘录声明');
    ok(ev('SAMPLE.files.length') === 2, '示例包纳入两册');
    ok(ev('packByKey("__sample").bk.indexOf("非出版物")>=0'), '课程教材名标注非出版物');
    ok(src.indexOf('for(const f of SAMPLE.files)') >= 0, '回退载入会遍历两册，不是只取 files[0]');
    ok(!!q('#ldfree') && !!q('#dlfree'), '教材页有「免费讲义」与「下载讲义」两个入口');
    ok((src.match(/\['reload','ldg','ldl','ldc'\]/g) || []).length === 1, '体验版隐藏列表没把免费入口一起收掉');
    ok(q('#ldfree').style.display !== 'none', '体验版之外免费入口可见');
    const gi = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
    ok(/!book\/示例\//.test(gi) && /book\/\*/.test(gi), '.gitignore 仍只放行示例目录，真教材正文不进公开仓库');
    const rd = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
    ok(/免费讲义/.test(rd) && /可自由复制/.test(rd), 'README 写清免费分发与内容供给的定位');
  }

  if (errs.length) { log('--- 页面报错 ---'); errs.forEach(e => log(e)); }
  console.log(out.join('\n'));
  if (errs.length || errors.length) {
    console.log('\n--- 错误 ---');
    (errors.length ? errors : errs).forEach(e => console.log('✗ ' + e));
    process.exit(errors.length || 1);
  }
  console.log('\n全部通过');
})();
