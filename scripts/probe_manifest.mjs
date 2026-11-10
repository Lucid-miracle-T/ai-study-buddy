/* book.json 的真机验证：卡片文案、目录三段布局、窄屏不挤。
   跑法：PROBE_PORT=9243 node scripts/probe_manifest.mjs */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.PROBE_PORT || 9243);
const URL0 = process.env.PROBE_URL || 'http://127.0.0.1:8906/index.html';
const OUT = os.tmpdir();

const r = await (await fetch(`http://127.0.0.1:${PORT}/json/new?url=about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(r.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej });
let id = 0; const wait = new Map(); const errs = [];
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.text);
  if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id) }
};
const send = (m, p = {}) => new Promise(res => { const i = ++id; wait.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })) });
const ev = async x => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) return 'EXC:' + JSON.stringify(r.result.exceptionDetails).slice(0, 200);
  return r.result?.result?.value;
};
const shot = async n => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const p = path.join(OUT, 'gx-manifest-' + n + '.png');
  fs.writeFileSync(p, Buffer.from(r.result.data, 'base64'));
  console.log('  截图 ' + p);
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

await send('Page.enable'); await send('Runtime.enable');

async function open(w, h, mobile) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: !!mobile });
  await send('Page.navigate', { url: URL0 + '?t=' + Date.now() });
  for (let i = 0; i < 80; i++) { await sleep(250); if (await ev('typeof PACKS!=="undefined"') === true) break }
  await sleep(1800);
}

console.log('\n=== 1. 桌面 1280 ===');
await open(1280, 900, false);
console.log('  manifest 读到了:', await ev('!!MANIFEST'));
console.log('  ORIGIN.files:', await ev('JSON.stringify(ORIGIN.files)'));
await ev('goView("store")');
await sleep(500);
console.log('  卡片副标题:', await ev(`(function(){var c=[].filter.call(document.querySelectorAll('.stcard'),function(x){return x.dataset.k==='__origin'})[0];
  return c?c.querySelector('.stsub').textContent:'无'})()`));
console.log('  进度徽标:', await ev(`(function(){var c=[].filter.call(document.querySelectorAll('.stcard'),function(x){return x.dataset.k==='__origin'})[0];
  var s=c&&c.querySelector('.ststate.ser');return s?s.textContent:'无'})()`));
await ev(`(function(){var c=[].filter.call(document.querySelectorAll('.stcard'),function(x){return x.dataset.k==='__origin'})[0];
  c.querySelector('.sttocb').click();return 1})()`);
await sleep(200);
console.log('  目录行数:', await ev(`document.querySelectorAll('.stcard[data-k="__origin"] .sttoc > div').length`));
console.log('  第一行文字:', await ev(`(function(){var d=document.querySelector('.stcard[data-k="__origin"] .sttoc > div');return d?d.textContent:'无'})()`));
console.log('  右侧体量是否被截:', await ev(`(function(){var d=document.querySelector('.stcard[data-k="__origin"] .sttoc > div');if(!d)return '无';
  var tu=d.querySelector('.tu');if(!tu)return '没有 .tu';
  var a=tu.getBoundingClientRect(),b=d.getBoundingClientRect();
  return 'tu 右边缘 '+Math.round(a.right)+' / 行右边缘 '+Math.round(b.right)+'（'+((a.right<=b.right+1)?'在内':'溢出')+'）'})()`));
await shot('desktop');

console.log('\n=== 2. 手机 390 ===');
await open(390, 844, true);
await ev('goView("store")');
await sleep(500);
await ev(`(function(){var c=[].filter.call(document.querySelectorAll('.stcard'),function(x){return x.dataset.k==='__origin'})[0];
  if(c)c.querySelector('.sttocb').click();return 1})()`);
await sleep(200);
console.log('  目录行是否溢出卡片:', await ev(`(function(){var c=document.querySelector('.stcard[data-k="__origin"]');var d=c.querySelector('.sttoc > div');
  if(!d)return '无';var a=d.getBoundingClientRect(),b=c.getBoundingClientRect();
  return '行 '+Math.round(a.right)+' / 卡片 '+Math.round(b.right)+'（'+((a.right<=b.right+1)?'在内':'溢出')+'）'})()`));
console.log('  整页横向溢出:', await ev('document.documentElement.scrollWidth - document.documentElement.clientWidth'));
await ev(`(function(){var c=document.querySelector('.stcard[data-k="__origin"]');c.scrollIntoView({block:'center'});return 1})()`);
await sleep(300);
await shot('mobile');

console.log('\nJS 异常:', errs.length ? errs.slice(0, 3).join(' | ') : '无');
ws.close();
