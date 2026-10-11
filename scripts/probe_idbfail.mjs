/* 复现：让 IndexedDB 打不开（存储被禁 / 旧标签页占着 / 库坏了），
   看页面是不是就变成「教材页全空、未载入、连课程标签栏都没有」。
   用法：node scripts/probe_idbfail.mjs */
const PORT = 9225;
const URL_ = process.env.PROBE_URL || 'https://gaoshu-xuexi.app.workbuddy.host/';
const fs = await import('fs');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const tgt = list.find(t => t.type === 'page' && /^http/.test(t.url || ''));
const ws = new WebSocket(tgt.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej });
let id = 0; const waiters = new Map(); const errs = [];
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails; errs.push((d.exception && (d.exception.description || d.exception.value)) || d.text) }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push('[console] ' + m.params.args.map(a => a.value || a.description || '').join(' '));
  if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id) }
};
const send = (method, params = {}) => new Promise(res => { const i = ++id; waiters.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) });
const ev = async x => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
  const ex = r.result && r.result.exceptionDetails;
  if (ex) return 'EXC: ' + (ex.exception && (ex.exception.description || ex.exception.value) || '');
  return r.result && r.result.result ? r.result.result.value : undefined;
};
const shot = async f => { const s = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(f, Buffer.from(s.result.data, 'base64')); console.log('  截图 → ' + f) };

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1085, height: 560, deviceScaleFactor: 1, mobile: false });

/* 在页面脚本跑之前，把 indexedDB 弄坏 */
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
  try{ Object.defineProperty(window,'indexedDB',{ configurable:true, get:function(){ throw new Error('IndexedDB blocked (模拟存储被禁)'); } }); }catch(e){}
` });

console.log('打开线上（并把 IndexedDB 弄坏）：' + URL_);
await send('Page.navigate', { url: URL_ });
await sleep(5000);

console.log('\n【症状快照】');
console.log('  CH:', await ev('typeof CH'));
console.log('  #ctabs 子元素:', await ev(`document.querySelector('#ctabs').children.length`));
console.log('  #stabs 子元素:', await ev(`document.querySelector('#stabs').children.length`));
console.log('  #blist 子元素:', await ev(`document.querySelector('#blist').children.length`));
console.log('  #bstat 文案:', JSON.stringify(await ev(`document.querySelector('#bstat').textContent`)));

console.log('\n【模拟用户：点左边「教材」】');
await ev(`document.querySelector('[data-v="book"]').click()`);
await sleep(600);
console.log('          #blist 子元素:', await ev(`document.querySelector('#blist').children.length`));
console.log('          #bstat 文案:', JSON.stringify(await ev(`document.querySelector('#bstat').textContent`)));
await shot('C:/Users/35343/Desktop/学习资料/高数/高数网站/preview-复现空白.png');

console.log('\n【控制台异常】');
console.log(errs.length ? errs.slice(0, 4) : '（无）');

ws.close();
console.log('\n完成。');
