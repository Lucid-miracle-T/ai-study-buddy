/* 给「拆薄重排」后的第 1 章拍两张：手机上的章首（目录表 + 阅读路线）与一个单元的开头。
 * 只用来人眼确认版式，不做断言（断言在 probe_book1_all.mjs 里）。
 * 前置：python -m http.server 8920 + Edge --remote-debugging-port=9240
 * 用法：PROBE_PORT=9240 PROBE_URL=http://127.0.0.1:8920/index.html node scripts/probe_shot.mjs
 */
const PORT = process.env.PROBE_PORT || 9240;
const URL = process.env.PROBE_URL || 'http://127.0.0.1:8920/index.html';
const fs = await import('fs');
const os = await import('os');
const OUT = os.tmpdir();
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function open(url, vw, vh, mobile) {
  const bust = url + (url.includes('?') ? '&' : '?') + 't=' + Date.now();
  const nt = await (await fetch(`http://127.0.0.1:${PORT}/json/new?url=${encodeURIComponent(bust)}`, { method: 'PUT' })).json();
  const ws = new WebSocket(nt.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej });
  let id = 0; const waiters = new Map();
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); }
  };
  const send = (method, params = {}) => new Promise(res => {
    const i = ++id; waiters.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
  });
  const ev = async x => {
    const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: vw, height: vh, deviceScaleFactor: 1, mobile });
  await send('Page.navigate', { url: bust });
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    if (await ev('typeof PACKS!=="undefined"') === true) break;
  }
  await sleep(1200);
  return { send, ev, ws, close: () => { try { ws.close() } catch (e) {} } };
}

async function shot(P, file) {
  const s = await P.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(file, Buffer.from(s.result.data, 'base64'));
  console.log('截图 ' + file);
}

const VW = Number(process.env.VW || 390);
const P = await open(URL, VW, 844, true);

/* 正文在 IndexedDB 里是「加入书架」那一刻的快照，改了 md 必须清掉重加。
   逐条删，不用 deleteDatabase —— 后者会把页面上的库连接弄坏，之后一直「打开超时」。 */
const added = await P.ev(`(async function(){
  var a=await IDB.all();
  for(var i=0;i<a.length;i++){ if(String(a[i].id).indexOf('第1章 函数与极限')>=0) await IDB.del(a[i].id); }
  CH=await IDB.all(); renderBook();
  goView('store');
  var b=document.querySelector('#stlist .stadd[data-k="__origin"]');
  if(!b)return 'no-btn';
  b.click(); return 'reimported';
})()`);
console.log('教材库：' + added);
await sleep(3600);

const n = await P.ev(`(function(){var a=CH.filter(function(x){return x.file==='第1章 函数与极限.md'});return a.length})()`);
console.log('切节数：' + n);

await P.ev(`goView('book')`);
await sleep(400);
await P.ev(`openCh(CH.filter(function(x){return x.file==='第1章 函数与极限.md'})[0])`);
await sleep(1800);
/* 手机上书架页是「上面目录树 + 下面阅读器」，树占 40vh。看正文先收起目录（等价于点「目录」按钮） */
await P.ev(`(function(){var b=document.getElementById('btoc');if(b)b.click();return 1})()`);
await sleep(500);
await shot(P, OUT + '/gx-b15-toc.png');

const info = await P.ev(`(function(){
  var rw=document.getElementById('rw');
  var t=rw.querySelector('table');
  return {rwW:rw.clientWidth,rwSW:rw.scrollWidth,
    tableW:t?t.clientWidth:0,tableSW:t?t.scrollWidth:0,
    rows:t?t.querySelectorAll('tbody tr').length:0};
})()`);
console.log(JSON.stringify(info));

await P.ev(`(function(){document.getElementById('reader').scrollTop=700;return 1})()`);
await sleep(300);
await shot(P, OUT + '/gx-b15-route.png');

await P.ev(`openCh(CH.filter(function(x){return x.file==='第1章 函数与极限.md'})[1])`);
await sleep(1800);
await shot(P, OUT + '/gx-b15-u1.png');

P.close();
