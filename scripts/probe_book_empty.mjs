/* 真浏览器验收「教材取不到时不再是死空地」：
   掐断 book/*.md → 空状态里应该有能点的「载入全部内置教材」→ 放开网络点它 → 目录回来。
   用法：node scripts/probe_book_empty.mjs   （默认测 8902；PROBE_URL=… 可换） */
const URL_ = process.env.PROBE_URL || 'http://127.0.0.1:8902/index.html';
const PORT = process.env.PROBE_PORT || 9225;
const fs = await import('fs');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const tgt = list.find(t => t.type === 'page' && /^http/.test(t.url || ''));
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
const shot = async f => { const s = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(f, Buffer.from(s.result.data, 'base64')); console.log('  截图 → ' + f) };

await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: URL_ });
await sleep(6000);
await ev('(async function(){try{localStorage.clear();await new Promise(function(res){var r=indexedDB.deleteDatabase("gxbook");r.onsuccess=r.onerror=r.onblocked=function(){res()}});return 1}catch(e){return 0}})()');

console.log('=== 1. 掐断 book/*.md，刷新（模拟部署空档/网络抽风）===');
await send('Network.setBlockedURLs', { urls: ['*book/*'] });
await send('Page.reload', { ignoreCache: true });
await sleep(9000);
console.log('  CH.length:', await ev('CH.length'), '（应为 0）');
await ev('goView("book")'); await sleep(700);
console.log('  目录文案:', JSON.stringify(await ev('document.querySelector("#blist").textContent.slice(0,90)')));
console.log('  空状态里有可点的载入按钮:', await ev('!!document.querySelector("#ldempty")'));
console.log('  这个按钮点得中吗:', await ev(`(function(){var b=document.querySelector('#ldempty');if(!b)return '没有按钮';
  var r=b.getBoundingClientRect();var t=document.elementFromPoint(Math.round(r.left+r.width/2),Math.round(r.top+r.height/2));
  return t===b?'✓ 就是它':(b.contains(t)?'△ 子元素':'✗ 被挡住')})()`));
await shot('preview-教材空白.png');

console.log('\n=== 2. 网络恢复，点那个按钮（不再需要刷新）===');
await send('Network.setBlockedURLs', { urls: [] });
await ev('document.querySelector("#ldempty").click()');
await sleep(6000);
console.log('  CH.length:', await ev('CH.length'));
console.log('  课程组/分册:', await ev('document.querySelectorAll("#blist .cgrp").length+" / "+document.querySelectorAll("#blist .grp").length'));
console.log('  bstat:', await ev('document.querySelector("#bstat").textContent'));
console.log('  提示条:', JSON.stringify(await ev('(document.querySelector("#toast")||{}).textContent||""')));
await shot('preview-教材已恢复.png');

console.log('\n=== 3. 恢复后照常能点：展开分册 → 打开一节 ===');
await ev(`(function(){var h=document.querySelector('#blist .grp h3');if(h)h.click()})()`); await sleep(700);
console.log('  分册数:', await ev('document.querySelectorAll("#blist .grp").length'), ' 章节条目:', await ev('document.querySelectorAll("#blist .item").length'));
await ev(`(function(){var it=document.querySelector('#blist .item');if(it)it.click()})()`); await sleep(700);
console.log('  curCh:', await ev('typeof curCh!=="undefined"?curCh:"?"'), ' 阅读区字数:', await ev('((document.querySelector("#rw")||{}).textContent||"").length'));
ws.close();
