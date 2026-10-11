/* 真浏览器：模拟「勾选过章节的老用户」刷新，验证启动不再中断。
   用法：PROBE_URL=http://127.0.0.1:8902/index.html node scripts/probe_bootctx.mjs */
const PORT = process.env.PROBE_PORT || 9225;
const URL_ = process.env.PROBE_URL || 'http://127.0.0.1:8902/index.html';
const fs = await import('fs');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
/* 优先挑目标站点的那个标签页：9225 上可能还开着别的页 */
const host = new URL(URL_).host;
const pages = list.filter(t => t.type === 'page');
const tgt = pages.find(t => (t.url || '').includes(host))
  || pages.find(t => /^https?:/.test(t.url || ''))
  || pages.find(t => /^about:/.test(t.url || ''))
  || pages[0];
console.log('用这个标签页：' + tgt.url);
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

await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1085, height: 620, deviceScaleFactor: 1, mobile: false });

console.log('打开：' + URL_);
await send('Page.navigate', { url: URL_ });
await sleep(2500);
for (let i = 0; i < 40; i++) { if (await ev(`typeof CH==='object'`) === true) break; await sleep(400) }

/* 造一个「勾选过章节的老用户」 */
console.log(await ev(`(function(){try{
  localStorage.clear();
  localStorage.setItem('gx.course', JSON.stringify('__local'));
  localStorage.setItem('gx.ctx.__local', JSON.stringify(['第1章_函数与极限.md#0','第2章_导数与微分.md#3']));
  localStorage.setItem('gx.view', JSON.stringify('book'));
  return '已写入：课程=__local，勾选=2 节';
}catch(e){return 'EXC '+e.message}})()`));

console.log('\n刷新（模拟用户真的按下刷新）…');
await send('Page.reload', { ignoreCache: true });
await sleep(3000);
for (let i = 0; i < 60; i++) { if (await ev(`typeof CH==='object'`) === true) break; await sleep(400) }
/* 等教材读完 */
let prev = -1;
for (let i = 0; i < 40; i++) { const n = await ev('CH.length'); if (n === prev && n > 0) break; prev = n; await sleep(800) }

console.log('\n【结果】');
console.log('  CH 节数      :', await ev('CH.length'));
console.log('  课程标签栏   :', await ev(`document.querySelectorAll('#ctabs .ctab').length`));
console.log('  节条         :', await ev(`document.querySelectorAll('#stabs .stab').length`));
console.log('  教材目录组   :', await ev(`document.querySelectorAll('#blist .cgrp').length`));
console.log('  分册数       :', await ev(`document.querySelectorAll('#blist .grp').length`));
console.log('  bstat        :', JSON.stringify(await ev(`document.querySelector('#bstat').textContent`)));
console.log('  勾选仍在     :', await ev('(CTX||[]).length'));
console.log('  带到课堂 chip:', await ev(`document.querySelectorAll('#ctxchips .chip').length`));
console.log('  存储告警条   :', await ev(`!!document.querySelector('#storwarn')`));
console.log('  当前视图     :', await ev(`(document.querySelector('.nv button.on')||{}).textContent`));
await shot('C:/Users/35343/Desktop/学习资料/高数/高数网站/preview-教材恢复.png');

console.log('\n【异常】', errs.length ? errs.slice(0, 3) : '无');
ws.close();
console.log('完成。');
