/* 诊断：手机版心里哪些表格需要横向滚动（表格自己滚，不算破版，但体验要评估）
 * 用法：node scripts/probe_tables.mjs
 */
const PORT = process.env.PROBE_PORT || 9234;
const URL = process.env.PROBE_URL || 'http://127.0.0.1:8906/index.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function open(url, vw, vh, mobile) {
  const bust = url + (url.includes('?') ? '&' : '?') + 't=' + Date.now();
  const nt = await (await fetch(`http://127.0.0.1:${PORT}/json/new?url=${encodeURIComponent(bust)}`, { method: 'PUT' })).json();
  const ws = new WebSocket(nt.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej });
  let id = 0; const waiters = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); } };
  const send = (method, params = {}) => new Promise(res => { const i = ++id; waiters.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async x => {
    const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
    const ex = r.result && r.result.exceptionDetails;
    if (ex) return 'EXC: ' + ((ex.exception && (ex.exception.description || ex.exception.value)) || '');
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: vw, height: vh, deviceScaleFactor: 1, mobile: !!mobile });
  await send('Page.navigate', { url: bust });
  for (let i = 0; i < 60; i++) { await sleep(250); if (await ev('typeof PACKS!=="undefined"') === true) break; }
  await sleep(1800);
  return { ev, close: () => ws.close() };
}

const VW = Number(process.env.VW || 390);
const P = await open(URL, VW, 844, true);
/* 教材正文存在 IndexedDB 里，是「加入书架」那一刻的快照：改了 md 不重导，
   量到的还是旧内容。这里先清空再重新加入，保证量的是磁盘上的最新稿。 */
const refreshed = await P.ev(`(async function(){
  var a=await IDB.all();
  for(var i=0;i<a.length;i++)await IDB.del(a[i].id);
  CH=[]; renderBook(); goView('store');
  await new Promise(function(r){setTimeout(r,400)});
  var b=document.querySelector('#stlist .stadd[data-k="__origin"]');
  if(!b)return 'no-btn';
  b.click(); return 'readded:'+a.length;
})()`);
console.log('清空并重导：' + refreshed);
await sleep(3200);
await P.ev("switchCourse('__origin'); goView('book')");
await sleep(600);
const n = await P.ev(`CH.filter(function(x){return x.file==='第1章 函数与极限.md'}).length`);
for (let i = 0; i < n; i++) {
  const r = await P.ev(`(function(){
    var rw=document.getElementById('rw');
    var c=CH.filter(function(x){return x.file==='第1章 函数与极限.md'})[${i}];
    openCh(c);
    var out=[];
    rw.querySelectorAll('table').forEach(function(tb,k){
      if(tb.scrollWidth>tb.clientWidth+2){
        var h=Array.prototype.map.call(tb.querySelectorAll('th'),function(x){
          return x.textContent.replace(/\\s+/g,' ').trim()}).join('|');
        out.push({k:k,sw:tb.scrollWidth,cw:tb.clientWidth,cols:tb.querySelectorAll('th').length,h:h.slice(0,60)});
      }
    });
    return {sec:c.title,rwW:rw.clientWidth,n:rw.querySelectorAll('table').length,wide:out};
  })()`);
  console.log(`\n#${i} ${r.sec} ｜ 表 ${r.n} 张 ｜ 版心 ${r.rwW}`);
  for (const w of r.wide) console.log(`   表${w.k} 需滚 ${w.sw - w.cw}px（宽 ${w.sw}，${w.cols} 列）: ${w.h}`);
  if (!r.wide.length) console.log('   全部放得下');
}
P.close();
