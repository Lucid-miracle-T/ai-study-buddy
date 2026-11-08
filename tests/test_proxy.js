/* 课堂代理前端接入（第 2 周）的回归测试
 *
 * 背景：站点原本是纯 BYOK（自己填 Key 直连模型）。第 2 周在不重写业务的前提下
 * 加一条可选链路：填齐「代理地址 + 邀请码」→ 走 gx-proxy 的 /api/chat，
 * 服务端持 DeepSeek 的 Key；没填代理 → 原来的 BYOK 一字不变。两条路共存。
 *
 * 别在后续改动里破坏：
 *   - 代理是绝对 URL（前端在静态托管、后端在另一个域名，相对路径会打回自己）
 *   - 鉴权头是 X-Invite-Code，不是 Authorization（后端 CORS 只放行前者，
 *     且用户的 API Key 绝不能发给代理）
 *   - 走代理时 SSE 解析、消息写回、闪卡逻辑沿用同一段代码，不做第二套
 *   - 402/401/429 等错误必须保留刚发出的提问：原 catch 会 MS.pop()，
 *     额度用完不该表现成「消息消失」
 *   - 邀请码与 API Key 都不进导出备份
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const SRC = () => fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const HTML = () => SRC().replace(/<script src="https:[^"]+"><\/script>/g, '');
const wait = ms => new Promise(r => setTimeout(r, ms));

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

function sse(frames) {
  let i = 0;
  return {
    ok: true, status: 200, statusText: 'OK',
    body: {
      getReader() {
        return {
          read() {
            if (i >= frames.length) return Promise.resolve({ done: true });
            return Promise.resolve({ done: false, value: new TextEncoder().encode(frames[i++]) });
          },
          releaseLock() {}
        };
      }
    }
  };
}
const F_OK = [
  'data: {"choices":[{"delta":{"content":"先看"}}]}\n\n',
  'data: {"choices":[{"delta":{"content":"定义"}}]}\n\n',
  'data: [DONE]\n\n'
];
function errRes(code, obj) {
  return { ok: false, status: code, statusText: 'E', json: async () => obj };
}
function okRes(obj) {
  return { ok: true, status: 200, statusText: 'OK', json: async () => obj };
}

function boot(preset, opts) {
  const vc = new VirtualConsole(); const errs = [];
  vc.on('jsdomError', e => {
    const m = e.message || String(e);
    if (/Not implemented: navigation/.test(m)) return;
    errs.push('jsdomError: ' + m);
  });
  let impl = () => Promise.reject(new Error('测试不联网'));
  const dom = new JSDOM(HTML(), {
    url: (opts && opts.url) || 'https://x.test/',
    runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(win) {
      installIDB(win);
      win.confirm = () => true; win.alert = () => {}; win.open = () => null;
      win.TextEncoder = TextEncoder; win.TextDecoder = TextDecoder;
      win.fetch = (...a) => impl(...a);
      win.URL.createObjectURL = () => 'blob:x'; win.URL.revokeObjectURL = () => {};
      Object.keys(preset || {}).forEach(k => win.localStorage.setItem(k, preset[k]));
    }
  });
  return { wnd: dom.window, errs, setFetch: f => { impl = f; } };
}

const CFG = { prov: 'deepseek', base: 'https://api.test/v1', model: 'm-test', key: 'sk-test-secret' };
const PX = { url: 'https://px.test/', invite: 'inv-123' };

async function ready(b) {
  await wait(650);
  const w = b.wnd;
  w.eval('CH=[{id:"c.md#1",file:"c.md",title:"极限",txt:"x"}]; COURSE="c.md"; LS.s("course",COURSE); MS=[]; saveMs();');
  return w;
}

(async () => {
  const out = [], errors = [];
  const log = s => out.push(s);
  const ok = (c, m) => { log((c ? '✓ ' : '✗ ') + m); if (!c) errors.push(m); };
  const src = SRC();

  /* ============ 1. 没填代理：BYOK 一字不变 ============ */
  log('=== 1. 默认仍是 BYOK，行为不变 ===');
  {
    const b = boot({ 'gx.cfg': JSON.stringify(CFG) });
    const w = await ready(b), d = w.document;
    ok(w.eval('proxyOn()') === false, '全新用户 proxyOn() = false');
    ok(w.eval('PX.url') === '' && w.eval('PX.invite') === '', '代理地址与邀请码默认都是空');
    ['pxurl', 'pxinv', 'pxsave', 'pxtest', 'pxquota', 'pxtst'].forEach(id => {
      ok(!!d.getElementById(id), '设置页有 #' + id);
    });
    let cap = null;
    b.setFetch(async (url, init) => {
      cap = { url, headers: init.headers, body: JSON.parse(init.body) };
      return sse(F_OK);
    });
    await w.eval('ask("求导")');
    ok(cap && cap.url === 'https://api.test/v1/chat/completions', '仍打自己的 /chat/completions（实际 ' + (cap && cap.url) + '）');
    ok(cap && cap.headers.Authorization === 'Bearer sk-test-secret', '仍带自己的 API Key');
    ok(cap && !cap.headers['X-Invite-Code'], '不带代理的头');
    ok(cap && cap.body.model === 'm-test' && cap.body.base === undefined, 'body 用设置页的 model、没有 base 字段');
    ok(w.eval('MS.length') === 2 && w.eval('MS[1].c') === '先看定义', 'SSE 透传正常，回答写回消息');
    ok(w.eval('MS[0].c') === '求导', '提问也在消息里');

    /* BYOK 出错仍按老规矩撤掉提问 —— 别把代理的新行为误加到老路径 */
    b.setFetch(async () => errRes(500, { error: { message: 'boom' } }));
    w.eval('MS=[];saveMs()');
    await w.eval('ask("再问一次")');
    ok(w.eval('MS.length') === 0, 'BYOK 出错时仍会撤掉刚发的提问（老行为不变）');
    if (b.errs.length) errors.push(...b.errs);
  }

  /* ============ 2. 设置页保存 ============ */
  log('');
  log('=== 2. 设置页保存与回落 ===');
  {
    const b = boot({ 'gx.cfg': JSON.stringify(CFG) });
    const w = await ready(b), d = w.document;
    d.getElementById('pxurl').value = 'https://px.test/';
    d.getElementById('pxinv').value = 'inv-123';
    d.getElementById('pxsave').click();
    await wait(30);
    ok(w.eval('proxyOn()') === true, '两栏填齐后 proxyOn() = true');
    ok(w.eval('LS.g("proxy").url') === 'https://px.test/', '地址存进 gx.proxy');
    ok(w.eval('LS.g("proxy").invite') === 'inv-123', '邀请码存进 gx.proxy');
    d.getElementById('pxurl').value = '';
    d.getElementById('pxsave').click();
    ok(w.eval('proxyOn()') === false, '清空地址并保存后回落到 BYOK');
    d.getElementById('pxurl').value = 'https://px.test/';
    d.getElementById('pxinv').value = '';
    d.getElementById('pxsave').click();
    ok(w.eval('proxyOn()') === false, '只有地址没有邀请码不算启用（避免半吊子 401）');
    if (b.errs.length) errors.push(...b.errs);
  }

  /* ============ 3. 走代理的请求形态 ============ */
  log('');
  log('=== 3. 代理分支：绝对 URL / 头 / body ===');
  {
    const b = boot({ 'gx.cfg': JSON.stringify(CFG), 'gx.proxy': JSON.stringify(PX) });
    const w = await ready(b), d = w.document;
    ok(w.eval('proxyOn()') === true, '预设了代理，重开页面仍然生效');
    ok(d.getElementById('pxurl').value === 'https://px.test/', '地址回显到输入框');
    ok(d.getElementById('pxinv').value === 'inv-123', '邀请码回显到输入框');
    /* 走代理时不要求自己填 Key：把三栏清空 */
    d.getElementById('key').value = ''; d.getElementById('base').value = '';
    let cap = null;
    b.setFetch(async (url, init) => {
      cap = { url, headers: init.headers, raw: init.body, body: JSON.parse(init.body) };
      return sse(F_OK);
    });
    await w.eval('ask("求导")');
    ok(cap && cap.url === 'https://px.test/api/chat', '打的是绝对地址 /api/chat（实际 ' + (cap && cap.url) + '）');
    ok(cap && cap.headers['X-Invite-Code'] === 'inv-123', '鉴权头是 X-Invite-Code');
    ok(cap && cap.headers.Authorization === undefined, '**没有 Authorization**，自己的 Key 不会发给代理');
    ok(cap && cap.raw.indexOf('sk-test-secret') < 0, '请求体里也没有任何 Key 残留');
    ok(cap && cap.body.model === 'deepseek-flash', 'model 固定为服务端持 Key 的 deepseek-flash');
    ok(cap && cap.body.base === 'https://api.deepseek.com/v1', 'base 固定为 DeepSeek 官方端点');
    ok(cap && Array.isArray(cap.body.messages) && cap.body.messages[0].role === 'system', 'messages 结构不变，仍带 system');
    ok(w.eval('MS.length') === 2 && w.eval('MS[1].c') === '先看定义', '代理 SSE 沿用同一段解析，回答照常写回');
    if (b.errs.length) errors.push(...b.errs);
  }

  /* ============ 4. 错误语义：不吞提问 ============ */
  log('');
  log('=== 4. 402 / 401 / 429 等错误保留提问 ===');
  {
    const b = boot({ 'gx.cfg': JSON.stringify(CFG), 'gx.proxy': JSON.stringify(PX) });
    const w = await ready(b), d = w.document;
    const cases = [
      [402, { error: 'QUOTA_EXCEEDED', free: 100, used: 100 }, '额度用完'],
      [401, { error: 'INVALID_INVITE' }, '邀请码不对'],
      [429, { error: 'RATE_LIMITED', retryAfter: 60 }, '问得太快'],
      [403, { error: 'ORIGIN_NOT_ALLOWED' }, '允许列表'],
      [502, { error: 'UPSTREAM_UNREACHABLE' }, '代理连不上模型服务'],
      [500, { error: 'NO_UPSTREAM_KEY' }, '还没配模型 Key']
    ];
    for (const [code, obj, word] of cases) {
      b.setFetch(async () => errRes(code, obj));
      w.eval('MS=[];saveMs()');
      await w.eval('ask("第' + code + '问")');
      const ms = w.eval('MS.length'), last = w.eval('MS.length?MS[MS.length-1].c:""');
      const bubble = d.getElementById('mw').innerHTML;
      ok(ms === 1 && last === '第' + code + '问', code + '：提问没被 MS.pop() 撤掉（实际 ' + ms + ' 条）');
      ok(bubble.indexOf(word) >= 0, code + '：气泡给出中文可操作提示「' + word + '」');
    }
    b.setFetch(async () => { throw new Error('Failed to fetch'); });
    w.eval('MS=[];saveMs()');
    await w.eval('ask("断网问")');
    ok(w.eval('MS.length') === 1, '代理连不上时提问也保留');
    ok(d.getElementById('mw').innerHTML.indexOf('连不上课堂代理') >= 0, '连不上时提示检查 HTTPS / 清空代理');
    if (b.errs.length) errors.push(...b.errs);
  }

  /* ============ 5. 测试代理 / 查额度按钮 ============ */
  log('');
  log('=== 5. 测试代理与查剩余额度 ===');
  {
    const b = boot({ 'gx.cfg': JSON.stringify(CFG), 'gx.proxy': JSON.stringify(PX) });
    const w = await ready(b), d = w.document;
    const calls = [];
    b.setFetch(async (url, init) => {
      calls.push({ url, headers: (init && init.headers) || {} });
      if (/\/api\/health$/.test(url)) return okRes({ ok: true, upstreamConfigured: true, invites: 1 });
      if (/\/api\/me\/quota$/.test(url)) return okRes({ free: 1000000, used: 3000, left: 997000 });
      return okRes({});
    });
    d.getElementById('pxtest').click(); await wait(40);
    ok(calls.length === 1 && /\/api\/health$/.test(calls[0].url), '「测试代理」打 /api/health');
    ok(d.getElementById('pxtst').textContent.indexOf('已配 Key') >= 0, '健康检查成功时显示服务端已配 Key');
    d.getElementById('pxquota').click(); await wait(40);
    ok(calls.length === 2 && /\/api\/me\/quota$/.test(calls[1].url), '「查剩余额度」打 /api/me/quota');
    ok(calls[1].headers['X-Invite-Code'] === 'inv-123', '额度查询带邀请码头');
    ok(calls[1].headers.Authorization === undefined, '额度查询也不带自己的 Key');
    ok(d.getElementById('pxtst').textContent.indexOf('997,000') >= 0, '显示剩余 token（实际 ' + d.getElementById('pxtst').textContent + '）');
    b.setFetch(async () => errRes(401, { error: 'INVALID_INVITE' }));
    d.getElementById('pxquota').click(); await wait(40);
    ok(d.getElementById('pxtst').textContent.indexOf('邀请码不对') >= 0, '额度接口 401 给出明确提示');
    if (b.errs.length) errors.push(...b.errs);
  }

  /* ============ 6. 凭证不进备份 ============ */
  log('');
  log('=== 6. 导出/恢复不含邀请码，也不漏 API Key ===');
  {
    const b = boot({ 'gx.cfg': JSON.stringify(CFG), 'gx.proxy': JSON.stringify(PX) });
    const w = await ready(b), d = w.document;
    w.eval('LS.s("msgs.c.md",[{r:"user",c:"一道题"}]);');
    let dumped = null; w.dl = (n, t) => { dumped = t; };
    d.getElementById('expall').click(); await wait(40);
    let j = null; try { j = JSON.parse(dumped); } catch (e) {}
    ok(!!j && !!j.data['gx.cfg'], '备份仍带接口配置');
    ok(j && j.data['gx.proxy'] === undefined, '**gx.proxy 整键不进备份**（地址与邀请码都不带）');
    ok(j && j.data['gx.cfg'].indexOf('sk-test-secret') < 0, '**gx.cfg 里的 API Key 被剥掉**（修掉原有的漏出）');
    ok(JSON.stringify(j.data).indexOf('inv-123') < 0, '整份备份里搜不到邀请码');
    ok(JSON.stringify(j.data).indexOf('sk-test-secret') < 0, '整份备份里搜不到 API Key');

    /* 恶意备份想塞凭证进来也不接受；恢复时本机 Key 不被冲掉 */
    const input = d.getElementById('impf');
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [{ text: async () => JSON.stringify({
        app: 'ai-study-buddy', ver: 1, at: 'x',
        data: {
          'gx.proxy': JSON.stringify({ url: 'https://evil.test', invite: 'evil-code' }),
          'gx.cfg': JSON.stringify({ prov: 'zhipu', base: 'x', model: 'y' }),
          'gx.msgs.c.md': JSON.stringify([{ r: 'user', c: '备份里的对话' }])
        }
      }) }]
    });
    input.dispatchEvent(new w.Event('change'));
    await wait(160);
    ok(w.eval('LS.g("proxy").invite') === 'inv-123', '恢复不会用备份里的邀请码覆盖本机');
    ok(w.eval('LS.g("proxy").url') === 'https://px.test/', '恢复不会用备份里的地址覆盖本机');
    ok(w.eval('LS.g("cfg").key') === 'sk-test-secret', '恢复不会把本机 API Key 冲掉');
    ok(w.eval('LS.g("msgs.c.md")[0].c') === '备份里的对话', '普通记录照常恢复');
    if (b.errs.length) errors.push(...b.errs);
  }

  /* ============ 7. 花费显示与老数据兼容 ============ */
  log('');
  log('=== 7. 花费显示与非法配置回落 ===');
  {
    const b = boot({ 'gx.cfg': JSON.stringify(CFG), 'gx.proxy': JSON.stringify(PX) });
    const w = await ready(b);
    w.eval('updTok()');
    ok(w.document.getElementById('tok').textContent.indexOf('约 ¥') < 0, '走代理时不再按自己的单价估「约 ¥x」');
    w.eval('PR=PR||{}; renderProg()');
    ok(w.document.getElementById('statc').innerHTML.indexOf('代理代付') >= 0, '进度页标注「代理代付 · 不计个人费用」');
    if (b.errs.length) errors.push(...b.errs);
  }
  for (const bad of ['"垃圾"', 'null', '[]']) {
    const b = boot({ 'gx.cfg': JSON.stringify(CFG), 'gx.proxy': bad });
    const w = await ready(b);
    ok(w.eval('proxyOn()') === false, 'gx.proxy 是 ' + bad + ' 时安全回落到 BYOK');
    if (b.errs.length) errors.push(...b.errs);
  }

  /* ============ 8. 静态约束 ============ */
  log('');
  log('=== 8. 源码级约束 ===');
  ok(src.indexOf('!proxyOn()&&(!$(\'key\').value.trim()') >= 0 || src.indexOf('if(!proxyOn()&&(!$(\'key\').value.trim()') >= 0,
    '编辑重发的接口校验也放行了代理');
  ok(src.indexOf("const PX_BASE='https://api.deepseek.com/v1'") >= 0, '代理上游常量写死在前端，不随用户设置页漂移');
  const al = (src.match(/function applyLite\(\)\{[\s\S]*?\n\}/) || [''])[0];
  ok(!!al && al.indexOf('pxurl') < 0 && al.indexOf('pxinv') < 0, 'applyLite 没把代理卡片一起隐藏（体验版也能用）');
  ok(src.indexOf('/api/chat') >= 0 && src.indexOf('X-Invite-Code') >= 0, '绝对端点与自定义头都在');

  log('');
  if (errors.length) { console.log(out.join('\n')); console.log(''); console.log('失败 ' + errors.length + ' 项：'); errors.forEach(e => console.log('  ✗ ' + e)); process.exit(1); }
  console.log(out.join('\n'));
  console.log('');
  console.log('全部通过');
  process.exit(0);
})();
