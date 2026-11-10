/* 群聊开场向导的真机探针。
   群里那条成员栏搬进了向导，所以要确认三件事：
   ① 点「群聊」第一眼是选人界面，不是空聊天；② 开聊后页面只剩一行会话条；
   ③ 手机上向导两列、主按钮整行，聊天页不溢出。
   跑法：先起静态服务，再起 Edge 调试端口，然后
     PROBE_PORT=9239 node scripts/probe_chat.mjs
   截图落在系统临时目录，文件名 gx-chat-*.png */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.PROBE_PORT || 9239);
const URL0 = process.env.PROBE_URL || 'http://127.0.0.1:8906/index.html';
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
  const p = path.join(OUT, 'gx-chat-' + name + '.png');
  fs.writeFileSync(p, Buffer.from(r.result.data, 'base64'));
  console.log('  截图 ' + p);
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const box = async sel => ev(`(function(){var e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;
  var r=e.getBoundingClientRect();return Math.round(r.width)+'x'+Math.round(r.height)})()`);

await send('Page.enable'); await send('Runtime.enable');

async function open(width, height, mobile) {
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: !!mobile });
  await send('Page.navigate', { url: URL0 + '?t=' + Date.now() });
  for (let i = 0; i < 80; i++) { await sleep(250); if (await ev('typeof PACKS!=="undefined"') === true) break }
  await sleep(1200);
  /* 全新用户：把群聊相关的键清掉，否则会带着上一轮的成员直接进聊天 */
  await ev(`(function(){['chat','chat.members','chat.sessions','chat.cur','chat.migrated'].forEach(function(k){
    localStorage.removeItem('gx.'+k)});
    Object.keys(localStorage).filter(function(k){return k.indexOf('gx.chat.log.')===0})
      .forEach(function(k){localStorage.removeItem(k)});return 1})()`);
  await send('Page.navigate', { url: URL0 + '?t=' + Date.now() + '&clean=1' });
  for (let i = 0; i < 80; i++) { await sleep(250); if (await ev('typeof PACKS!=="undefined"') === true) break }
  await sleep(1500);
}

console.log('\n=== 桌面 1280×900 ===');
await open(1280, 900, false);
await ev('goView("chat")');
await sleep(400);
console.log('  向导可见:', await ev('document.querySelector("#csetup").hidden === false'));
console.log('  已在聊天的成员栏:', await ev('!!document.querySelector("#chatmembers")'), '（应为 false）');
console.log('  向导卡片数:', await ev('document.querySelectorAll("#csWho .lh-card").length'));
console.log('  默认勾选:', await ev('document.querySelectorAll("#csWho .lh-card.on").length'));
await shot('desktop-setup');

await ev('document.getElementById("csName").value="线代答疑"');
await ev('document.getElementById("csStart").click()');
await sleep(500);
console.log('  开场后向导收起:', await ev('document.querySelector("#csetup").hidden === true'));
console.log('  会话条:', await box('#chsrow'), ' 消息区:', await box('#chatlog'));
console.log('  顶栏副标题:', await ev('document.getElementById("dtSess").textContent'));
console.log('  位置条右段:', await ev('document.getElementById("cbSess").textContent'));
await ev('document.getElementById("chatmore").click()');
await sleep(200);
console.log('  「⋯」菜单展开:', await ev('document.querySelector("#chatmenu").hidden === false'));
await shot('desktop-menu');
await ev('document.getElementById("chatmore").click()');
await sleep(150);
await shot('desktop-chat');

console.log('\n=== 手机 390×844 ===');
await open(390, 844, true);
await ev('goView("chat")');
await sleep(400);
console.log('  向导可见:', await ev('document.querySelector("#csetup").hidden === false'));
console.log('  卡片列数:', await ev(`(function(){var g=document.getElementById('csWho');
  var s=getComputedStyle(g);return s.gridTemplateColumns})()`));
console.log('  主按钮宽:', await box('#csStart'));
console.log('  整页溢出:', await ev('document.documentElement.scrollWidth - document.documentElement.clientWidth'));
await shot('mobile-setup');

await ev('document.getElementById("csStart").click()');
await sleep(500);
console.log('  开场后会话条:', await box('#chsrow'));
console.log('  消息区高度:', await box('#chatlog'));
console.log('  整页溢出:', await ev('document.documentElement.scrollWidth - document.documentElement.clientWidth'));
console.log('  输入框可见:', await ev(`(function(){var e=document.getElementById('chatin');
  var r=e.getBoundingClientRect();return r.top>0&&r.bottom<=window.innerHeight})()`));
await shot('mobile-chat');

console.log('\nJS 异常:', errs.length ? errs.slice(0, 3).join('\n  ') : '无');
ws.close();
