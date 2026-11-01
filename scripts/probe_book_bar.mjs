/* 看一眼教材页那条说明栏：新加的「勾选记在第 N 节」会不会把原有文字挤坏。
   用法：先起 8902 静态服务与 Edge(9231)，再 node scripts/probe_book_bar.mjs */
const PORT = 9231, fs = await import('fs'), os = await import('os'), path = await import('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const tgt = list.find(t => t.type === 'page' && /^http/.test(t.url || '')) || list.find(t => t.type === 'page');
const ws = new WebSocket(tgt.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej });
let id = 0; const waiters = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id) } };
const send = (method, params = {}) => new Promise(res => { const i = ++id; waiters.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) });
const ev = async x => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
  const ex = r.result && r.result.exceptionDetails;
  if (ex) return 'EXC: ' + (ex.exception && (ex.exception.description || ex.exception.value) || '');
  return r.result && r.result.result ? r.result.result.value : undefined;
};
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: 'http://127.0.0.1:8902/index.html' });
await sleep(6000);
await ev(`goView('book')`); await sleep(600);
console.log('提示文本:', JSON.stringify(await ev(`(document.getElementById('bsess')||{}).textContent`)));
console.log('那条 bar 高度:', await ev(`(document.querySelector('#v-book .bar:nth-child(2)')||{getBoundingClientRect:()=>({})}).getBoundingClientRect().height`));
console.log('bar 是否换行:', await ev(`(function(){var b=document.querySelector('#v-book .bar:nth-child(2)');if(!b)return 'no bar';
  var r=b.getBoundingClientRect();return Math.round(r.height)>40?'换行了':'单行'})()`));
const s = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1280, height: 220, scale: 1 }, captureBeyondViewport: true });
const f = path.join(os.tmpdir(), 'book_bar.png');
fs.writeFileSync(f, Buffer.from(s.result.data, 'base64'));
console.log('截图 →', f);
ws.close();
