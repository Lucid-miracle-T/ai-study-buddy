/* 字体缺字（方框）——「导师出错了？」
 *
 * 背景：用户贴了一张截图，导师回复的第一行是「□ = 2 对：……」，问「导师出错了？」
 * 数学验算过后，那一步没有算错；方框是渲染问题：
 *   模型没有把变量写进 $...$，而是直接吐了 Unicode 的「数学样式字母」（𝑘 𝐦 𝒙），
 *   中文系统字体里普遍没有这些字形，浏览器只能画一个空方框。
 *
 * 修法两层：
 *   A 源头——system prompt 里禁止直接输出这类字符
 *   B 兜底——md() 入口把能映射的归一化成 ASCII；归一化后仍可疑的标成 .noglyph
 *
 * 断言：
 *   1. normGlyph 把数学样式字母/上下标/全角字母数字还原成 ASCII
 *   2. 不能误伤：中文标点、希腊字母、× − ≤ ∞ ① 一律不动（NFKD 对整串做会拆掉「，」）
 *   3. 零宽字符与变体选择符被清掉
 *   4. md() 端到端：𝑘 = 2 对 → k = 2 对
 *   5. 归一化之后仍缺字的（私用区等）标成 .noglyph 并带码位提示
 *   6. 普通文案与 emoji 不会被标
 *   7. prompt 里有禁令
 *   8. HTML 结构不被破坏（不插进标签内部）
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

const MD_STUB = 'window.marked={parse:function(s){return String(s).split(/\\n{2,}/).map(function(p){' +
  'var t=p.replace(/&/g,"&amp;").replace(/</g,"&lt;")' +
  '.replace(/\\*\\*([^*]+)\\*\\*/g,"<strong>$1</strong>")' +
  '.replace(/\\*([^*]+)\\*/g,"<em>$1</em>");' +
  'return "<p>"+t.replace(/\\n/g,"<br>")+"</p>"}).join("")}};' +
  'window.DOMPurify={sanitize:function(h){return h}};';

(async () => {
  const out = [], errors = [];
  const log = s => out.push(s);
  const ok = (c, m) => { log((c ? '✓ ' : '✗ ') + m); if (!c) errors.push(m); };
  const wait = ms => new Promise(r => setTimeout(r, ms));

  const { wnd, errs } = boot();
  const doc = wnd.document;
  await wait(700);
  const ev = s => { try { return wnd.eval(s); } catch (e) { errors.push('eval: ' + e.message); return undefined; } };

  /* === 1. 归一化 === */
  log('=== 1. 数学样式字母 / 上下标 / 全角 → ASCII ===');
  {
    const cases = [
      ['\u{1D458}', 'k', '数学斜体 k'],
      ['\u{1D426}', 'm', '数学粗体 m'],
      ['\u{1D499}', 'x', '数学手写体 x'],
      ['\u{1D400}', 'A', '数学粗体 A'],
      ['\u{1D7CF}', '1', '数学粗体 1'],
      ['\u2080', '0', '下标 0'],
      ['\u00B2', '2', '上标 2'],
      ['\uFF58', 'x', '全角 x'],
      ['\uFF21', 'A', '全角 A'],
      ['\uFF10', '0', '全角 0']
    ];
    cases.forEach(function (c) {
      const got = ev('normGlyph("' + c[0] + '")');
      ok(got === c[1], c[2] + ' → ' + c[1] + '（实际 ' + JSON.stringify(got) + '）');
    });
    /* 用户截图里的那一行 */
    const line = ev('normGlyph("\u{1D458} = 2 对：第 1 行减第 2 行的 2 倍。")');
    ok(line === 'k = 2 对：第 1 行减第 2 行的 2 倍。', '截图那一行还原成 “k = 2 对：……”（实际 ' + line + '）');
  }

  /* === 2. 不能误伤 === */
  log('');
  log('=== 2. 中文标点 / 希腊字母 / 常用数学符号一律不动 ===');
  {
    /* 「，」的全角逗号 NFKD 会拆成半角——这正是不能对整串做 NFKD 的原因 */
    ok(ev('normGlyph("，")') === '，', '全角逗号「，」保持全角（NFKD 拆整串会把它变成「,」）');
    ok(ev('normGlyph("（测试）。")') === '（测试）。', '全角括号与句号不动');
    ['α', 'ε', 'δ', 'λ', '×', '÷', '±', '−', '≤', '≥', '≠', '∞', '∑', '∫', '→', '①', '□']
      .forEach(function (c) {
        ok(ev('normGlyph("' + c + '")') === c, '「' + c + '」不动');
      });
    ok(ev('normGlyph("你好，世界")') === '你好，世界', '纯中文原样通过');
    ok(ev('normGlyph("$x^2 + \\\\alpha$")') === '$x^2 + \\alpha$', 'LaTeX 源码原样通过');
  }

  /* === 3. 零宽字符 === */
  log('');
  log('=== 3. 零宽字符与变体选择符 ===');
  {
    ok(ev('normGlyph("a\\u200Bb")') === 'ab', '零宽空格被清掉');
    ok(ev('normGlyph("\\uFEFF你好")') === '你好', 'BOM 被清掉');
    ok(ev('normGlyph("✅\\uFE0F")') === '✅', 'emoji 的变体选择符被清掉，emoji 本身保留');
    ok(ev('normGlyph("a\\u00ADb")') === 'ab', '软连字符被清掉');
  }

  /* === 4. md 端到端 === */
  log('');
  log('=== 4. md() 端到端 ===');
  {
    ev(MD_STUB);
    const t = ev('md("\\u{1D458} = 2 对：第 1 行减第 2 行的 2 倍。")') || '';
    ok(t.indexOf('k = 2 对') >= 0, '渲染结果里方框变成了 k');
    ok(t.indexOf('\u{1D458}') < 0, '不再有数学样式字母');
    const t2 = ev('md("$a_1$ 与 b\\u2082 都对")') || '';
    ok(t2.indexOf('b2') >= 0, '正文里的下标 ₂ 归一化成 2');
    ok(t2.indexOf('a_1') >= 0, '写在 $...$ 里的下标写法原样保留（归一化不碰 LaTeX 源码）');
    const t3 = ev('md("**注意**：𝑥 是变量")') || '';
    ok(t3.indexOf('<strong>注意</strong>') >= 0, '加粗不受影响');
    ok(t3.indexOf('x 是变量') >= 0, '混在加粗旁的数学字母也归一化');
  }

  /* === 5. 归一化之后仍缺字 → 标注 === */
  log('');
  log('=== 5. 剩下显示不出来的字符会被标出来 ===');
  {
    const t = ev('md("前\uE000后")') || '';
    ok(t.indexOf('class="noglyph"') >= 0, '私用区字符被标成 .noglyph');
    ok(t.indexOf('U+E000') >= 0, '提示里带码位 U+E000');
    ok(t.indexOf('前') >= 0 && t.indexOf('后') >= 0, '前后文字照常保留');
    /* 只处理标签之间的文本，不把 span 插进既有标签里 */
    const t2 = ev('md("**粗** 与 \\uE001")') || '';
    ok(t2.indexOf('<strong>粗</strong>') >= 0, '既有标签 <strong> 完整无损');
    const inner = (t2.match(/class="noglyph"[^>]*>([\s\S]*?)<\/span>/) || [])[1];
    ok(inner === '\uE001', 'span 里就是那个字符本身，不多不少');
    ok(/^<p><strong>粗<\/strong> 与 <span class="noglyph" title="[^"]+">[\s\S]*<\/span><\/p>$/.test(t2),
      '结构没被破坏：span 只出现在文本里（实际 ' + JSON.stringify(t2) + '）');
    const cnt = (t2.match(/class="noglyph"/g) || []).length;
    ok(cnt === 1, '只标一次，没有重复包裹');
    /* source 里有样式规则 */
    ok(/\.noglyph\{border-bottom:1px dotted/.test(SRC()), '有 .noglyph 的样式规则');
  }

  /* === 6. 不误标 === */
  log('');
  log('=== 6. 正常文案不会被标 ===');
  {
    ['你好，世界。', 'ε-δ 定义：∀ε>0, ∃δ>0', 'a ≤ b 且 c ≠ d', '🙂 ok', '𝒙 已归一化成 x']
      .forEach(function (s) {
        const t = ev('md(' + JSON.stringify(s) + ')') || '';
        /* '𝒙' 那条归一化后没有可疑字符，同样不该标 */
        ok(t.indexOf('noglyph') < 0, '不标：' + s);
      });
  }

  /* === 7. prompt 禁令 === */
  log('');
  log('=== 7. 从源头禁止 ===');
  {
    ev('CH=[];COURSE="__free";');
    const sys = ev('sysMsg()') || '';
    ok(sys.indexOf('数学样式的 Unicode 字母') >= 0, 'prompt 禁止直接输出数学样式字母');
    ok(sys.indexOf('空方框') >= 0, '说明了后果（会变成空方框）');
    ok(sys.indexOf('上下标字符') >= 0, 'prompt 禁止上下标字符');
    ok(sys.indexOf('AI 专属') < 0, '没混进别的文案');
  }

  log('');
  if (errs.length) errors.push(...errs);
  console.log(out.join('\n'));
  console.log('');
  if (errors.length) { console.log('失败 ' + errors.length + ' 项：'); errors.forEach(e => console.log('  ✗ ' + e)); process.exit(1); }
  console.log('全部通过');
  process.exit(0);
})();
