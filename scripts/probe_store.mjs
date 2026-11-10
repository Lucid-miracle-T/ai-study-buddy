/* 真浏览器复核「书城 / 书架」：卡片排版、目录展开、手机单列、无横向溢出
 *
 * 前置：
 *   python -m http.server 8904 --bind 127.0.0.1 --directory <站点目录>
 *   msedge --headless=new --remote-debugging-port=9234 --remote-allow-origins=*
 * 用法：node scripts/probe_store.mjs
 */
const PORT = process.env.PROBE_PORT || 9234;
const URL = process.env.PROBE_URL || 'http://127.0.0.1:8904/index.html';
const fs = await import('fs');
const os = await import('os');
const OUT = os.tmpdir();
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function open(url, vw, vh, mobile) {
  const bust = url + (url.includes('?') ? '&' : '?') + 't=' + Date.now();
  const nt = await (await fetch(`http://127.0.0.1:${PORT}/json/new?url=${encodeURIComponent(bust)}`, { method: 'PUT' })).json();
  const ws = new WebSocket(nt.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej });
  let id = 0; const waiters = new Map(); const errs = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      errs.push((d.exception && (d.exception.description || d.exception.value)) || d.text);
    }
    if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id); }
  };
  const send = (method, params = {}) => new Promise(res => {
    const i = ++id; waiters.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
  });
  const ev = async x => {
    const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
    const ex = r.result && r.result.exceptionDetails;
    if (ex) return 'EXC: ' + ((ex.exception && (ex.exception.description || ex.exception.value)) || '');
    return r.result && r.result.result ? r.result.result.value : undefined;
  };
  const shot = async f => {
    const s = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(f, Buffer.from(s.result.data, 'base64'));
    console.log('  截图 → ' + f);
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: vw, height: vh, deviceScaleFactor: 1, mobile: !!mobile });
  await send('Page.navigate', { url: bust });
  for (let i = 0; i < 60; i++) { await sleep(250); if (await ev('typeof LITE!=="undefined"') === true) break; }
  await sleep(1600);
  return { ev, shot, errs, close: () => ws.close() };
}

/* 把书架清空再进书城：看的是「一本都没加入」时的第一屏 */
const SEED = `(function(){
  try{CH=[];CD=[];}catch(e){}
  try{updateCourses()}catch(e){}
  closeLaunch(); markBegun();
  goView('store');
  return 'ok';
})()`;

const READ = `(function(){
  function box(e){var r=e.getBoundingClientRect();
    return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),bottom:Math.round(r.bottom)};}
  var cards=[].slice.call(document.querySelectorAll('#stlist .stcard'));
  var over=cards.map(function(c){
    var bad=[];
    ['.stt','.stsub','.stmeta','.stabout','.sttoc'].forEach(function(s){
      var e=c.querySelector(s); if(!e)return;
      if(e.scrollWidth>e.clientWidth+1&&getComputedStyle(e).overflow!=='visible')bad.push(s);
    });
    return bad.join(',');
  }).filter(Boolean);
  return {
    scrollW:document.documentElement.scrollWidth, innerW:window.innerWidth,
    count:cards.length,
    first:cards[0]?box(cards[0]):null,
    second:cards[1]?box(cards[1]):null,
    cols:cards[0]&&cards[1]?(cards[1].y===cards[0].y?'同排':'换行'):'?',
    badge:document.querySelectorAll('#stlist .stbadge').length,
    addBtns:document.querySelectorAll('#stlist .stadd').length,
    tocHidden:document.querySelectorAll('#stlist .sttoc[hidden]').length,
    over:over,
    cnt:document.getElementById('stcnt')?document.getElementById('stcnt').textContent:'',
    crumb:document.getElementById('cbCur')?document.getElementById('cbCur').textContent:'',
    tag:(function(){var e=document.getElementById('stcnt');if(!e)return null;
      return {w:Math.round(e.getBoundingClientRect().width),sw:e.scrollWidth,clip:e.scrollWidth>e.clientWidth+1};})()
  };
})()`;

const cfgs = [
  { tag: 'desktop', vw: 1280, vh: 800, mobile: false },
  { tag: 'mobile', vw: 390, vh: 844, mobile: true }
];
for (const cfg of cfgs) {
  console.log('=== ' + cfg.tag + ' ' + cfg.vw + 'x' + cfg.vh + ' ===');
  const P = await open(URL, cfg.vw, cfg.vh, cfg.mobile);
  console.log('  种子：' + await P.ev(SEED));
  await sleep(400);
  const r = await P.ev(READ);
  console.log('  布局：' + JSON.stringify(r));
  await P.shot(OUT + '/gx-store-' + cfg.tag + '.png');
  /* 展开第一张卡片的目录，看会不会把卡片撑爆 / 溢出屏幕 */
  await P.ev("document.querySelectorAll('#stlist .sttocb')[0].click()");
  await sleep(250);
  const r2 = await P.ev("(function(){var t=document.querySelector('#stlist .sttoc');var b=t.getBoundingClientRect();return {hidden:t.hidden,h:Math.round(b.height),bottom:Math.round(b.bottom),vs:document.documentElement.scrollWidth>window.innerWidth}})()");
  console.log('  目录展开：' + JSON.stringify(r2));
  await P.shot(OUT + '/gx-store-' + cfg.tag + '-toc.png');
  console.log('  JS 异常：' + (P.errs.length ? P.errs.slice(0, 3).join(' | ') : '无'));
  P.close();
}
