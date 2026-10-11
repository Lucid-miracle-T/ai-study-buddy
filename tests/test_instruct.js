/* 导师用词把方向带偏（「把某一行消成只剩一个非零元」其实是列上的消元）
 *
 * 背景：用户报「导师用词错了，导致我朝错方向想，得不到正确答案」。
 * 事实核对：那一句里的数学本身没算错（(2,1,3)−2(1,4,2)=(0,−7,−1) 是对的），
 * 错的是**术语与操作方向不一致**——让学生做的是一列上的消元，却说成「某一行」；
 * 而且用了「某一行」这种不点名的说法，学生只能照字面做。
 * 它事后「一处更正」了，但损失已经发生：学生顺着错方向想过一遍，还会以为是自己理解错了。
 *
 * 修法：在 system prompt 里加一条不随人格/模式变的硬要求【下指令前先自检】
 *   1. 点名具体对象（第 2 行 / 第 1 列），禁止「某一行」「某一列」这类不点名说法
 *   2. 术语与方向一致（行变换/列变换、按行展开/按列展开）
 *   3. 操作式发之前先自己验算一遍
 *   4. 发现说错时的正确姿势：先认「是我说错了，不是你做错了」，再作废错方向、指出重来点
 *
 * 断言：
 *   1. prompt 里有这一条，且四条要点齐全
 *   2. 位置在【本轮模式】之前（模式优先级最高，但这条是全局硬要求）
 *   3. 换人格、换模式、换节奏都还在（不随风格配置丢失）
 *   4. 明确写了「是我刚才说错了，不是你做错了」这句补救话术
 *   5. 明确禁用了「某一行」「某一列」这类不点名说法
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

function boot(preset) {
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
      if (preset) Object.keys(preset).forEach(k => win.localStorage.setItem(k, preset[k]));
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

  ev('CH=[{id:"c.md#1",file:"c.md",title:"行列式",txt:"x"}]; COURSE="c.md"; LS.s("course",COURSE);');

  /* === 1. 四条要点齐全 === */
  log('=== 1. 【下指令前先自检】四条要点 ===');
  {
    const sys = ev('sysMsg()') || '';
    ok(sys.indexOf('【下指令前先自检】') >= 0, 'prompt 含【下指令前先自检】');
    ok(sys.indexOf('点名具体对象') >= 0, '要点 1：点名具体对象');
    ok(sys.indexOf('禁止用「某一行」「某一列」') >= 0, '出现了「某一行」「某一列」的用例');
    ok(sys.indexOf('术语与方向必须一致') >= 0, '要点 2：术语与方向一致');
    ok(sys.indexOf('按行展开 / 按列展开') >= 0, '点明了行/列展开这对易混术语');
    ok(sys.indexOf('操作式要能直接验算') >= 0, '要点 3：操作式先自己验算');
    ok(sys.indexOf('算不出来就说明这句话还没想清') >= 0, '给了可执行的自检判据');
  }

  /* === 2. 说错之后怎么补救 === */
  log('');
  log('=== 2. 说错之后的补救话术 ===');
  {
    const sys = ev('sysMsg()') || '';
    ok(sys.indexOf('是我刚才说错了，不是你做错了') >= 0, '要求先认错，并明确「不是你做错了」');
    ok(sys.indexOf('不要只用「一处更正」轻轻带过') >= 0, '禁止用轻描淡写的更正敷衍过去');
    ok(sys.indexOf('作废') >= 0, '要求把按错方向做过的步骤作废');
    ok(sys.indexOf('从哪一步重来') >= 0, '要求指出从哪一步重来');
  }

  /* === 3. 位置：在模式段之前 === */
  log('');
  log('=== 3. 全局硬要求，排在模式之前 ===');
  {
    const sys = ev('sysMsg()') || '';
    ok(sys.indexOf('【下指令前先自检】') < sys.indexOf('【本轮模式'),
      '自检要求排在【本轮模式】之前');
    ok(sys.indexOf('【输出格式硬要求】') < sys.indexOf('【下指令前先自检】'),
      '排在输出格式要求之后（都属硬要求，前后相邻）');
  }

  /* === 4. 不随人格/模式/节奏丢失 === */
  log('');
  log('=== 4. 换人格、换模式、换节奏都还在 ===');
  {
    /* 一次扫完所有人格 × 模式 × 节奏 × 动作档，收集缺了这条要求的组合 */
    const miss = ev('(function(){'
      + 'var miss=[];'
      + 'var chk=function(tag){if((sysMsg()||"").indexOf("【下指令前先自检】")<0)miss.push(tag)};'
      + 'Object.keys(PERSONA).forEach(function(k){who=k;chk("人格:"+k)});'
      + 'who="cauchy";'
      + 'Object.keys(MODE).forEach(function(k){MODEK=k;chk("模式:"+k)});'
      + 'MODEK="teach";'
      + 'Object.keys(PACE).forEach(function(k){PA=k;chk("节奏:"+k)});'
      + 'PA="mid";'
      + 'Object.keys(ACTS).forEach(function(k){ACT=k;chk("动作:"+k)});'
      + 'ACT="mid";'
      + 'return miss.join(",");'
      + '})()');
    ok(miss === '', '8 人格 × 5 模式 × 3 节奏 × 3 动作档全都带上（缺：' + miss + '）');
    ok(ev('who') === 'cauchy' && ev('MODEK') === 'teach' && ev('PA') === 'mid' && ev('ACT') === 'mid',
      '扫描后状态已复位');
    /* 自定义人格（用户自己写的人设）也要带上——它走的是同一段拼装 */
    const b = boot({ 'gx.myp': JSON.stringify({ who: 'me_x', p: '你是测试用的自定义人格，只回一个字。' }) });
    await wait(700);
    const s2 = b.wnd.eval('sysMsg()') || '';
    ok(s2.indexOf('【下指令前先自检】') >= 0, '用户自定义人格同样带这条要求');
  }

  /* === 5. 不要把「不点名」误解成禁止一切概称 === */
  log('');
  log('=== 5. 文案本身没有自相矛盾 ===');
  {
    const sys = ev('sysMsg()') || '';
    ok(sys.indexOf('一句话里同时出现「行」和「列」时') >= 0, '要求自查行/列是否指同一对象');
    /* 别把「行」写成「列」——直接核对原句是否已从 prompt 其它地方被误删 */
    ok(sys.indexOf('数学式一律用 $行内$') >= 0, '输出格式那段没被挤掉');
    ok(sys.indexOf('【教材依据】') >= 0, '教材依据那段没被挤掉');
  }

  /* === 6. 源码层面：这段文案只出现一次，没复制粘贴成两份 === */
  log('');
  log('=== 6. 只有一份，别重复注入 ===');
  {
    const n = (SRC().match(/【下指令前先自检】/g) || []).length;
    ok(n === 1, '源码里只写了一份，实际 ' + n);
    const sys = ev('sysMsg()') || '';
    const cnt = (sys.match(/【下指令前先自检】/g) || []).length;
    ok(cnt === 1, 'prompt 里只注入一次，实际 ' + cnt);
  }

  log('');
  if (errs.length) errors.push(...errs);
  console.log(out.join('\n'));
  console.log('');
  if (errors.length) { console.log('失败 ' + errors.length + ' 项：'); errors.forEach(e => console.log('  ✗ ' + e)); process.exit(1); }
  console.log('全部通过');
  process.exit(0);
})();
