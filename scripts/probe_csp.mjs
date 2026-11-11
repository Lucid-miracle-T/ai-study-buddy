/* 真浏览器验证 CSP 与 SRI（jsdom 不执行 CSP，也不校验 integrity，必须用真浏览器）
   前置：
     python -m http.server 8906 --bind 127.0.0.1 --directory <部署目录>
     msedge --headless=new --remote-debugging-port=9234 --remote-allow-origins=* --user-data-dir=<临时目录>
   用法：PROBE_PORT=9234 PROBE_URL=http://127.0.0.1:8906/index.html node scripts/probe_csp.mjs */
const PORT = process.env.PROBE_PORT || 9234;
const URL = process.env.PROBE_URL || 'http://127.0.0.1:8906/index.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const nt = await (await fetch(`http://127.0.0.1:${PORT}/json/new?url=about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(nt.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej });
let id = 0; const waiters = new Map(); const logs = []; const exs = [];
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.method === 'Log.entryAdded') {
    const en = m.params.entry;
    if (en.level === 'error') logs.push('[log] ' + en.text);
  }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    logs.push('[console] ' + m.params.args.map(a => a.value || a.description || '').join(' '));
  }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    exs.push((d.exception && (d.exception.description || d.exception.value)) || d.text);
  }
  if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); }
};
const send = (method, params = {}) => new Promise(res => {
  const i = ++id; waiters.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
});
const ev = async x => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
  const ex = r.result && r.result.exceptionDetails;
  if (ex) return 'EXC: ' + ((ex.exception && (ex.exception.description || ex.exception.value)) || '');
  return r.result && r.result.result ? r.result.result.value : undefined;
};

await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
await send('Page.navigate', { url: URL + (URL.includes('?') ? '&' : '?') + 't=' + Date.now() });
for (let i = 0; i < 60; i++) { await sleep(250); if (await ev('typeof LITE!=="undefined"') === true) break; }
await sleep(3000);

const info = JSON.parse(await ev(`JSON.stringify({
  metaCSP: !!document.querySelector('meta[http-equiv="Content-Security-Policy"]'),
  sri: [].map.call(document.querySelectorAll('script[src^="https:"]'), function (s) {
    return { host: s.src.replace(/^https:\\/\\//, '').split('/')[0], integrity: !!s.getAttribute('integrity'), crossorigin: s.getAttribute('crossorigin') };
  }),
  libs: { marked: !!window.marked, katex: !!window.katex, dompurify: !!window.DOMPurify },
  katexRender: (function () { try { return katex.renderToString('x^2').indexOf('katex') >= 0; } catch (e) { return 'ERR:' + e.message; } })(),
  katexCss: [].some.call(document.styleSheets, function (s) { return s.href && s.href.indexOf('katex') >= 0; })
})`));
const violations = logs.filter(x => /Content Security Policy|Refused to/i.test(x));
console.log(JSON.stringify(info, null, 2));
console.log('\nCSP 违规：' + (violations.length ? '\n  ' + violations.join('\n  ') : '无'));
console.log('JS 异常：' + (exs.length ? exs.join(' | ') : '无'));
ws.close();
const bad = violations.length || exs.length || !info.metaCSP ||
  !info.libs.marked || !info.libs.katex || !info.libs.dompurify || !info.katexRender || !info.katexCss ||
  info.sri.some(s => !s.integrity || !s.crossorigin);
process.exit(bad ? 1 : 0);
