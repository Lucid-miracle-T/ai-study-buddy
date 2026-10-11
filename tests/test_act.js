/* 导师的动作/神态描写（*推了推眼镜*）
 *
 * 背景：用户提议「导师在对话里可以加一些动作、神态描写，用浅一些的字体颜色、
 * 大小也不一样，以便区分」。
 *
 * 约定（实现依赖它，所以必须被测试守住）：
 *   单星号 *…* 只用来写旁白，强调一律用 **双星号**。
 *   于是渲染时可以把 marked 产出的 <em> 直接当成旁白，不需要额外语法。
 *
 * 断言：
 *   1. 默认「自然」；设置页有开关，默认选中「自然」，三档 off/mid/rich
 *   2. system prompt 里注入了动作描写的授权与纪律（含「单星号只留给旁白」）
 *   3. md() 把 *旁白* 渲染成 .act 的 span，行内/独立成段两种版式都对
 *   4. **加粗** 仍是 <strong>，不会被误当成旁白
 *   5. KaTeX 的 HTML 不被误伤（旁白替换发生在占位符还原之前）
 *   6. 关掉之后 prompt 里不再有旁白授权
 *   7. 选择存得住；非法值回落
 *   8. 朗读时旁白被整段丢掉（旁白是给眼睛看的，不该被念出来）
 *   9. .act 的样式确实更浅、更小
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

/* 最小 markdown 替身：只实现本应用用到的 **加粗**、*旁白*、段落，行为对齐 marked */
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
  const q = s => doc.querySelector(s);

  /* 让导师有课程上下文 */
  ev('CH=[{id:"c.md#1",file:"c.md",title:"行列式",txt:"x"}]; COURSE="c.md"; LS.s("course",COURSE);');

  /* === 1. 默认与开关 === */
  log('=== 1. 默认「自然」+ 设置页开关 ===');
  ok(ev('ACT') === 'mid', '默认 ACT = mid（实际 ' + ev('ACT') + '）');
  {
    const sel = q('#act');
    ok(!!sel, '设置页有「导师的动作与神态描写」开关');
    ok(sel && sel.value === 'mid', '开关默认选中「自然」，实际 ' + (sel && sel.value));
    const opts = sel ? [...sel.options].map(o => o.value).join(',') : '';
    ok(opts === 'off,mid,rich', '三档 off/mid/rich，实际 ' + opts);
  }

  /* === 2. prompt 里的授权与纪律 === */
  log('');
  log('=== 2. 注入模型的旁白纪律 ===');
  {
    const sys = ev('sysMsg()') || '';
    ok(sys.indexOf('【动作与神态 · 自然】') >= 0, 'prompt 含【动作与神态 · 自然】');
    ok(sys.indexOf('*推了推眼镜*') >= 0, '给了例子，模型知道该写成什么样');
    ok(sys.indexOf('单星号只留给旁白') >= 0, '写明「单星号只留给旁白」——渲染依赖这条约定');
    ok(sys.indexOf('**这样**') >= 0, '强调改用双星号，避免和旁白抢语法');
    ok(sys.indexOf('丰富') < 0, '自然档不出现「丰富」档文案');
    /* 旁白纪律排在模式之前：模式优先级最高，不该被风格段挤到后面 */
    ok(sys.indexOf('【动作与神态') < sys.indexOf('【本轮模式'), '旁白纪律在模式段之前');
  }

  /* === 3. 渲染：行内与独立成段 === */
  log('');
  log('=== 3. 渲染成浅色小字 ===');
  {
    ev(MD_STUB);
    const inline = ev('md("*推了推眼镜* 你说的这个「很小」，具体小于多少？")') || '';
    ok(inline.indexOf('<span class="act">推了推眼镜</span>') >= 0, '行内旁白换成 .act 的 span');
    ok(inline.indexOf('<em>') < 0, '不再残留 <em>');
    const block = ev('md("*停了一下，把草稿纸转过来*")') || '';
    ok(block.indexOf('<p class="actp">') >= 0, '独立成段的旁白走 .actp 竖线版式');
    /* DOM 里真的挂上了 */
    ev('addMsg("assistant","*推了推眼镜* 再想想。")');
    ok(!!doc.querySelector('#mw .msg .body .act'), 'DOM 里能查到 .act 元素');
    ok(doc.querySelector('#mw .msg .body .act').textContent === '推了推眼镜', '旁白文字完整');
    /* 自己写的旁白同样处理（用户消息也走同一个 md） */
    ev('addMsg("user","*叹气* 我真的不会")');
    ok(!!doc.querySelector('#mw .msg.me .body .act'), '用户自己写的旁白也按同样规则显示');
  }

  /* === 4. 加粗不受影响 === */
  log('');
  log('=== 4. **加粗** 不被误判成旁白 ===');
  {
    const t = ev('md("**注意**：这里对 $x$ 求导")') || '';
    ok(t.indexOf('<strong>注意</strong>') >= 0, '加粗仍是 <strong>');
    ok(t.indexOf('class="act"') < 0, '加粗不会被套上 .act 样式');
  }

  /* === 5. KaTeX 不被误伤 === */
  log('');
  log('=== 5. 公式渲染的 HTML 不被误伤 ===');
  {
    /* 旁白替换发生在 %%M 占位符还原之前，因此公式产出的 HTML 里即使有 <em> 也不该被改 */
    ev('window.katex={renderToString:function(){return \'<span class="katex"><em class="k">x</em></span>\'}}');
    const t = ev('md("设 $x$ 为未知量 *点了点头*")') || '';
    ok(t.indexOf('<em class="k">x</em>') >= 0, '公式自带的 <em> 原样保留');
    ok(t.indexOf('<span class="act">点了点头</span>') >= 0, '公式旁边的旁白照常处理');
    ev('window.katex=undefined');
  }

  /* === 6. 关掉 === */
  log('');
  log('=== 6. 切到「关闭」 ===');
  {
    const sel = q('#act');
    sel.value = 'off';
    sel.dispatchEvent(new wnd.Event('change'));
    await wait(30);
    ok(ev('ACT') === 'off', 'ACT 变为 off');
    ok(ev('LS.g("act")') === 'off', '选择已写入 localStorage');
    const sys = ev('sysMsg()') || '';
    ok(sys.indexOf('不要写任何动作、神态或场景旁白') >= 0, 'prompt 改成禁止写旁白');
    ok(sys.indexOf('单星号只留给旁白') < 0, '关闭后不再授予旁白语法');
  }

  /* === 7. 存得住 + 非法值回落 === */
  log('');
  log('=== 7. 设置持久化 ===');
  {
    const b = boot({ 'gx.act': '"rich"' });
    await wait(700);
    ok(b.wnd.eval('ACT') === 'rich', '重开页面后仍是「丰富」');
    ok(b.wnd.document.getElementById('act').value === 'rich', '开关回显为 rich');
    ok((b.wnd.eval('sysMsg()') || '').indexOf('【动作与神态 · 丰富】') >= 0, 'prompt 用上丰富档文案');
    const c = boot({ 'gx.act': '"垃圾"' });
    await wait(700);
    ok(c.wnd.eval('ACT') === 'mid', '存储里是非法值时回落到 mid');
  }

  /* === 8. 朗读时丢掉旁白 === */
  log('');
  log('=== 8. 旁白不被念出来 ===');
  {
    const t = ev('speechText("*推了推眼镜* 你说的「很小」，具体小于多少？")') || '';
    ok(t.indexOf('推了推眼镜') < 0, '旁白从朗读文本里剔除');
    ok(t.indexOf('具体小于多少') >= 0, '对白照旧朗读');
    /* 加粗仍要念出来（原来是去标记留文字） */
    const t2 = ev('speechText("**注意**这一条")') || '';
    ok(t2.indexOf('注意') >= 0, '加粗的文字仍然朗读');
  }

  /* === 9. 样式确实更浅更小 === */
  log('');
  log('=== 9. 旁白样式与对白有区分 ===');
  {
    const src = SRC();
    const rule = (src.match(/\.msg \.body \.act\{[^}]*\}/) || [''])[0];
    ok(/color:var\(--tx3\)/.test(rule), '.act 用最浅的那档正文色 --tx3');
    ok(/font-size:\.9em/.test(rule), '.act 字号小于正文（.9em）');
    ok(!!doc.querySelector('#mw .msg .body .act'), '样式类名与 DOM 对得上');
    /* 目录里别把 --tx3 改没了（它比正文色浅，是这套区分的基础） */
    ok(/--tx3:#888780/.test(src), '--tx3 仍是最浅的正文灰');
  }

  log('');
  if (errs.length) errors.push(...errs);
  console.log(out.join('\n'));
  console.log('');
  if (errors.length) { console.log('失败 ' + errors.length + ' 项：'); errors.forEach(e => console.log('  ✗ ' + e)); process.exit(1); }
  console.log('全部通过');
  process.exit(0);
})();
