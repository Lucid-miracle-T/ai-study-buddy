/* 二分定位：#rw 的横向溢出到底由哪个元素贡献
 * 做法：把候选节点临时 display:none，看 rw.scrollWidth 是否落回版心宽 —— 落回去的
 * 那个子树就是真凶，再往里递归。比"找最宽元素"可靠：MathML 副本、被 clip 的绝对定位
 * 元素都会骗过宽度筛选。
 * 用法：IDX=5 node scripts/probe_bisect.mjs
 */
const PORT = process.env.PROBE_PORT || 9234;
const URL = process.env.PROBE_URL || 'http://127.0.0.1:8906/index.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const IDX = Number(process.env.IDX || 5);
const VW = Number(process.env.VW || 390);

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
  await sleep(2000);
  return { ev, close: () => ws.close() };
}

const P = await open(URL, VW, 844, true);
const r = await P.ev(`(function(){
  var rw=document.getElementById('rw');
  var c=CH.filter(function(x){return x.file==='第1章 函数与极限.md'})[${IDX}];
  openCh(c);
  return new Promise(function(done){setTimeout(function(){
    var base=rw.scrollWidth, cw=rw.clientWidth, path=[];
    if(base<=cw+1){return done({base:base,cw:cw,path:['（没有溢出）']})}
    var cur=rw;
    for(var depth=0;depth<6;depth++){
      var kids=Array.prototype.slice.call(cur.children), found=null;
      for(var i=0;i<kids.length;i++){
        var k=kids[i], old=k.style.display;
        k.style.display='none';
        var now=rw.scrollWidth;
        k.style.display=old;
        if(now<=cw+1){found=k;break}
      }
      if(!found){path.push('（在 '+cur.tagName.toLowerCase()+' 这一层没能单独摘出来：溢出由多个兄弟共同造成）');break}
      var rc=found.getBoundingClientRect(), cs=getComputedStyle(found);
      path.push(found.tagName.toLowerCase()+(found.className?'.'+String(found.className).split(' ')[0]:'')
        +' w='+Math.round(rc.width)+' disp='+cs.display+' ovx='+cs.overflowX
        +' :: '+(found.textContent||'').replace(/\\s+/g,' ').slice(0,50));
      cur=found;
      if(!cur.children.length)break;
    }
    done({base:base,cw:cw,path:path});
  },1400)});
})()`);
console.log('base=' + r.base + ' 版心=' + r.cw);
for (const p of r.path) console.log('  → ' + p);
P.close();
