/* 直接对线上地址做体检：教材能不能载入、空状态有没有自救按钮、目录能不能点开
   用法：先起 Edge(9225)，再 node scripts/probe_live.mjs */
const PORT = 9225;
const URL_LIVE = process.env.PROBE_URL || 'https://gaoshu-xuexi.app.workbuddy.host/index.html';
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
const realClick = async (sel, idx) => {
  const j = await ev(`(function(){var es=document.querySelectorAll('${sel}');var el=es[${idx}];if(!el)return '';
    el.scrollIntoView({block:'center'});var r=el.getBoundingClientRect();
    return JSON.stringify({x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)})})()`);
  if (!j) return false;
  const p = JSON.parse(j);
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  return true;
};

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

console.log('打开线上：' + URL_LIVE);
await send('Page.navigate', { url: URL_LIVE });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await ev(`typeof CH==='object' && typeof autoLoad==='function'`) === true) break; await sleep(500) }
console.log('  页面就绪:', await ev(`typeof CH==='object'`));

/* 清空存储 + 教材库，模拟"全新/坏掉"的浏览器，看新版能否自愈 */
await ev(`(async function(){try{localStorage.clear();
  if(window.indexedDB){var dbs=await indexedDB.databases();for(var d of dbs){if(d.name)indexedDB.deleteDatabase(d.name)}}
  return 'cleared'}catch(e){return 'EXC '+e.message}})()`);
await send('Page.reload', { ignoreCache: true });
await sleep(3000);
for (let i = 0; i < 40; i++) { if (await ev(`typeof CH==='object'`) === true) break; await sleep(500) }

console.log('\n【1. 清空后重开 → 教材应自动载入】');
/* 轮询到总量稳定，别抢在下载中途报数 */
let prev = -1;
for (let i = 0; i < 40; i++) {
  const n = await ev('CH.length');
  if (n === prev && n > 0) break;
  prev = n;
  await sleep(1000);
}
console.log('  CH 节数:', await ev('CH.length'), '（本地应为 494）');
console.log('  课程组:', await ev(`document.querySelectorAll('#blist .cgrp').length`), '/ 分册:', await ev(`document.querySelectorAll('#blist .grp').length`), '（本地应为 3 / 46）');

console.log('\n【2. 教材页目录】');
await ev(`document.querySelector('[data-v="book"]').click()`);
await sleep(700);
console.log('  课程组:', await ev(`document.querySelectorAll('#blist .cgrp').length`));
console.log('  分册:', await ev(`document.querySelectorAll('#blist .grp').length`));
console.log('  空状态在不在:', await ev(`!!document.querySelector('#blist .empty')`));
await shot('preview-线上教材.png');

console.log('\n【3. 真实鼠标点开第一本分册、第一节】');
console.log('  点分册:', await realClick('#blist .grp', 0));
await sleep(500);
console.log('  展开后条目数:', await ev(`document.querySelectorAll('#blist .item').length`));
console.log('  点第一节:', await realClick('#blist .item', 0));
await sleep(700);
console.log('  阅读区字数:', await ev(`document.querySelector('#reader')?document.querySelector('#reader').textContent.length:'（无 #reader）'`));
await shot('preview-线上教材2.png');

console.log('\n【4. 异常】', errs.length ? errs.slice(0, 5) : '无');

ws.close();
console.log('\n完成。');
