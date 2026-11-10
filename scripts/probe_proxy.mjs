/* 课堂代理的前端↔后端契约探针（不需要真 key）。
   验的是四件事：① 本地页面能跨域打到 127.0.0.1:8787；② 设置页「测试代理」认得健康检查；
   ③ 查额度能拿到数字；④ 服务端没配 Key 时，前端拿到的是可读提示而不是一句生硬的 500。
   跑法：先起 gx-proxy（PORT=8787）与静态服务 8902，再起 Edge 调试端口，然后
     PROBE_PORT=9241 node scripts/probe_proxy.mjs */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.PROBE_PORT || 9241);
const URL0 = process.env.PROBE_URL || 'http://127.0.0.1:8902/index.html';
const PX = process.env.PROBE_PX || 'http://127.0.0.1:8787';
const INVITE = process.env.PROBE_INVITE || 'demo-invite';
const OUT = os.tmpdir();

const r = await (await fetch(`http://127.0.0.1:${PORT}/json/new?url=about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(r.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej });
let id = 0; const wait = new Map(); const errs = [];
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.text + ' ' + (m.params.exceptionDetails.exception?.description || ''));
  if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id) }
};
const send = (method, params = {}) => new Promise(res => { const i = ++id; wait.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) });
const ev = async x => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
  if (r.result?.exceptionDetails) return 'EXC:' + JSON.stringify(r.result.exceptionDetails).slice(0, 300);
  return r.result?.result?.value;
};
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const p = path.join(OUT, 'gx-proxy-' + name + '.png');
  fs.writeFileSync(p, Buffer.from(r.result.data, 'base64'));
  console.log('  截图 ' + p);
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: URL0 + '?t=' + Date.now() });
for (let i = 0; i < 80; i++) { await sleep(250); if (await ev('typeof PACKS!=="undefined"') === true) break }
await sleep(1200);

console.log('\n=== 1. 设置页填代理 ===');
await ev('goView("set")');
await sleep(300);
await ev(`document.getElementById('pxurl').value=${JSON.stringify(PX)};document.getElementById('pxinv').value=${JSON.stringify(INVITE)};`);
await ev(`document.getElementById('pxsave').click()`);
await sleep(300);
console.log('  页面 origin:', await ev('location.origin'));
console.log('  已保存的代理:', await ev('localStorage.getItem("gx.proxy")'));
console.log('  proxyOn():', await ev('typeof proxyOn==="function"?proxyOn():"?"'));

console.log('\n=== 2. 测试代理（打 /api/health） ===');
await ev(`document.getElementById('pxtest').click()`);
await sleep(1200);
console.log('  提示:', await ev('document.getElementById("pxtst").textContent'));
console.log('  样式:', await ev('document.getElementById("pxtst").className'));
await shot('settings');

console.log('\n=== 3. 查剩余额度（打 /api/me/quota） ===');
await ev(`document.getElementById('pxquota').click()`);
await sleep(1200);
console.log('  提示:', await ev('document.getElementById("pxtst").textContent'));
await shot('quota');

console.log('\n=== 4. 无 Key 时的错误映射 ===');
console.log('  原始 500 体:', await ev(`(async function(){
  var r=await fetch(${JSON.stringify(PX)}+'/api/chat',{method:'POST',
    headers:{'Content-Type':'application/json','X-Invite-Code':${JSON.stringify(INVITE)}},
    body:JSON.stringify({model:'deepseek-flash',messages:[{role:'user',content:'hi'}],stream:true})});
  var j={};try{j=await r.json()}catch(e){}
  return r.status+' '+JSON.stringify(j)})()`));
console.log('  前端读成:', await ev(`(async function(){
  var r=await fetch(${JSON.stringify(PX)}+'/api/chat',{method:'POST',
    headers:{'Content-Type':'application/json','X-Invite-Code':${JSON.stringify(INVITE)}},
    body:JSON.stringify({model:'deepseek-flash',messages:[{role:'user',content:'hi'}],stream:true})});
  var j={};try{j=await r.json()}catch(e){}
  return pxErr(r.status,j,String(j.error||''));
})()`));

console.log('\n=== 5. 邀请码写错时的表现 ===');
console.log('  错误码:', await ev(`(async function(){
  var r=await fetch(${JSON.stringify(PX)}+'/api/me/quota',{headers:{'X-Invite-Code':'nope'}});
  var j={};try{j=await r.json()}catch(e){}
  return r.status+' '+JSON.stringify(j)})()`));

console.log('\nJS 异常:', errs.length ? errs.slice(0, 3).join('\n  ') : '无');
ws.close();
