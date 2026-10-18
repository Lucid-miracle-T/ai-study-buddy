/* 「25\,^\circ\mathrm{C}」为什么会变成红字
 *
 * 红字 = KaTeX 在 throwOnError:false 下的兜底：解析失败就把原文原样吐回来，
 *        颜色 #cc0000。md() 里两个 katex.renderToString 都是这么配的。
 *
 * 真凶不是 \^（那个能渲染），而是 **\, 紧跟 ^**：
 *   \, \; \: \! \quad \qquad 在 KaTeX 内部都是 internal 类型的「空隙」节点，
 *   不能当上标/下标的底。数字与温度符号之间加个细空格（25\,^\circ\mathrm{C}）
 *   是很自然的写法，却会抛 ParseError: Got group of unknown type: 'internal'。
 *
 * 修法：把「空隙紧跟 ^ 或 _」补一个空组 {} 当底 —— 25\,{}^\circ\mathrm{C}。
 *
 * 这里的断言分两层：
 *   1. fixTexBase() 是纯函数，直接看输入输出（含幂等、不误伤正常公式）
 *   2. 注入一个「捕获型」katex 替身，看 md() 真正交给 KaTeX 的字符串是什么
 *      —— jsdom 里的 KaTeX 是替身，不会真解析，所以只能验输入；
 *         真解析由 scripts/_tmp_red.mjs 在真浏览器 + 真 KaTeX 下验过。
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

(async () => {
  const out = [], errors = [];
  const log = s => out.push(s);
  const ok = (c, m) => { log((c ? '✓ ' : '✗ ') + m); if (!c) errors.push(m); };
  const wait = ms => new Promise(r => setTimeout(r, ms));

  /* 捕获型 KaTeX：记录每一次 renderToString 收到的 tex —— 这是「交给真 KaTeX 的东西」 */
  const captured = [];
  const vc = new VirtualConsole();
  const dom = new JSDOM(HTML(), {
    url: 'https://x.test/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      installIDB(win);
      win.katex = {
        version: 'test',
        renderToString(tex, opt) {
          captured.push({ tex: String(tex), display: !!(opt && opt.displayMode) });
          return '<span class="katex">' + String(tex) + '</span>';
        }
      };
      win.confirm = () => true; win.alert = () => {}; win.open = () => null;
      win.fetch = () => Promise.reject(new Error('测试不联网'));
      win.URL.createObjectURL = () => 'blob:x'; win.URL.revokeObjectURL = () => {};
    }
  });
  const win = dom.window;
  const ev = c => win.eval(c);
  await wait(700);

  log('=== 1. fixTexBase 是纯函数：输入什么、输出什么 ===');
  {
    const cases = [
      ['25\\,^\\circ\\mathrm{C}', '25\\,{}^\\circ\\mathrm{C}', '细空格 + 上标（截图里的写法）'],
      ['a\\,_b', 'a\\,{}_b', '细空格 + 下标（同一个坑）'],
      ['25\\quad^2', '25\\quad{}^2', 'quad 也是 internal 节点'],
      ['x\\!^-1', 'x\\!{}^-1', '负细空格 \\!'],
      ['25\\;^\\circ', '25\\;{}^\\circ', '中等空格 \\;'],
      ['x_{n}+a^2', 'x_{n}+a^2', '正常上下标不动'],
      ['25^\\circ\\mathrm{C}', '25^\\circ\\mathrm{C}', '本来就正常的写法不动'],
      ['25\\,{}^\\circ\\mathrm{C}', '25\\,{}^\\circ\\mathrm{C}', '已经修过的再跑一遍不变（幂等）']
    ];
    cases.forEach(([inp, want, why]) => {
      const got = ev('fixTexBase(' + JSON.stringify(inp) + ')');
      ok(got === want, why + '：' + JSON.stringify(inp) + ' → ' + JSON.stringify(got));
    });
  }

  log('');
  log('=== 2. md() 真正交给 KaTeX 的字符串 ===');
  {
    captured.length = 0;
    ev('md(' + JSON.stringify('就像"额定功率"是电机的属性，"在 $25\\,^\\circ\\mathrm{C}$ 下"只说清是在哪个工况') + ')');
    ok(captured.length === 1, '一段行内公式被提取出来（交给 KaTeX 1 次，实际 ' + captured.length + '）');
    ok(captured[0] && captured[0].tex === '25\\,{}^\\circ\\mathrm{C}',
      '交出去的是修好的写法：' + JSON.stringify(captured[0] && captured[0].tex));
    ok(captured[0] && captured[0].display === false, '按行内公式渲染（displayMode=false）');

    captured.length = 0;
    ev('md(' + JSON.stringify('$$25\\,^\\circ\\mathrm{C}$$') + ')');
    ok(captured[0] && captured[0].tex === '25\\,{}^\\circ\\mathrm{C}', '$$…$$ 块级公式同样被修');
    ok(captured[0] && captured[0].display === true, '按块级公式渲染（displayMode=true）');

    captured.length = 0;
    ev('md(' + JSON.stringify('$x_{n}+a^2$ 与 $\\frac{1}{2}$') + ')');
    ok(captured.length === 2, '两个正常公式都照常提取');
    ok(captured[0].tex === 'x_{n}+a^2', '正常公式原样交出去，没有被塞 {}：' + JSON.stringify(captured[0].tex));
    ok(captured[1].tex === '\\frac{1}{2}', '分式也没被动：' + JSON.stringify(captured[1].tex));
  }

  log('');
  log('=== 3. 源码里两处调用都过了一遍 fixTexBase ===');
  {
    const src = SRC();
    const calls = src.match(/katex\.renderToString\([^,]+/g) || [];
    ok(calls.length === 2, 'md() 里就两处 katex.renderToString（实际 ' + calls.length + '）');
    ok(calls.every(c => /fixTexBase\(p\)/.test(c)),
      '两处都写成 renderToString(fixTexBase(p), …)：' + JSON.stringify(calls));
    ok(/function fixTexBase\(t\)\{/.test(src), 'fixTexBase 在源码里定义着');
    ok(/internal 类型的节点/.test(src), '旁边写清了为什么（internal 节点不能当底）');
  }

  log('');
  log(errors.length ? ('失败 ' + errors.length + ' 条') : '全部通过');
  console.log(out.join('\n'));
  process.exit(errors.length ? 1 : 0);
})();
