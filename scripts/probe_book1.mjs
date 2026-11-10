/* 真浏览器复核「原创讲义真的能读」：书城加入 → 书架打开 → 阅读器渲染
 * 关注三件事：公式是否真渲染成 KaTeX、自测答案是否折叠、有没有横向溢出。
 *
 * 前置：python -m http.server 8906 --bind 127.0.0.1 --directory <站点目录>
 *       msedge --headless=new --remote-debugging-port=9234 --remote-allow-origins=*
 * 用法：node scripts/probe_book1.mjs
 */
const PORT = process.env.PROBE_PORT || 9234;
const URL = process.env.PROBE_URL || 'http://127.0.0.1:8906/index.html';
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
  for (let i = 0; i < 60; i++) { await sleep(250); if (await ev('typeof PACKS!=="undefined"') === true) break; }
  await sleep(1800);
  return { ev, shot, errs, close: () => ws.close() };
}

const STATUS = `(function(){
  function t(sel){var e=document.querySelector(sel);return e?e.textContent.replace(/\\s+/g,' ').trim().slice(0,70):null;}
  return {
    view:document.body.dataset.view,
    packs:PACKS.map(function(p){return p.key}).join(','),
    cards:document.querySelectorAll('#stlist .stcard').length,
    stcnt:t('#stcnt'),
    blistItems:document.querySelectorAll('#blist [data-f],#blist li,#blist .ch').length,
    blistHtml:(document.getElementById('blist')||{innerHTML:''}).innerHTML.slice(0,260),
    crumb:t('#crumb'),
    katex:document.querySelectorAll('#rw .katex').length,
    katexErr:document.querySelectorAll('#rw .katex-error').length,
    details:document.querySelectorAll('#rw details').length,
    detailsOpen:document.querySelectorAll('#rw details[open]').length,
    tables:document.querySelectorAll('#rw table').length,
    h2:document.querySelectorAll('#rw h2').length,
    h3:document.querySelectorAll('#rw h3').length,
    rawDollar:(document.querySelector('#rw')||{textContent:''}).textContent.indexOf('$$')>=0,
    rwHead:t('#rw h2')||t('#rw'),
    overflow:document.documentElement.scrollWidth>window.innerWidth+1,
    scrollW:document.documentElement.scrollWidth,innerW:window.innerWidth
  };
})()`;

async function run() {
  for (const cfg of [{ vw: 1280, vh: 900, mobile: false, tag: 'desktop' },
                     { vw: 390, vh: 844, mobile: true, tag: 'mobile' }]) {
    console.log('\n========== ' + cfg.tag + ' ' + cfg.vw + 'x' + cfg.vh + ' ==========');
    let P = await open(URL, cfg.vw, cfg.vh, cfg.mobile);

    /* 清掉本机残留的教材库：探针要测「第一次加入」的完整路径，
       库里若有旧正文（比如改稿前存的），会让人误判渲染结果。
       清完必须重开一个页面（reload 会销毁执行上下文，之后的 ev 会一直挂着）。 */
    /* 逐条删而不是 deleteDatabase：后者在页面还连着库时会 blocked，promise 永不落地。 */
    const cleared = await P.ev(`(async function(){
      var a=await IDB.all();
      for(var i=0;i<a.length;i++)await IDB.del(a[i].id);
      CH=await IDB.all(); renderBook(); return a.length;
    })()`);
    console.log('  清掉旧正文 ' + cleared + ' 条');

    /* 1. 书城 */
    await P.ev("goView('store')");
    await sleep(600);
    console.log('书城 ' + JSON.stringify(await P.ev(STATUS)));
    await P.shot(OUT + '/gx-b1-' + cfg.tag + '-store.png');

    /* 2. 加入书架（点原创那本的「加入书架」） */
    const r = await P.ev(`(function(){
      var b=document.querySelector('#stlist .stadd[data-k="__origin"]');
      if(!b)return 'no-btn';
      b.click(); return 'clicked';
    })()`);
    console.log('  点加入书架：' + r);
    await sleep(3000);
    console.log('加入后 ' + JSON.stringify(await P.ev(STATUS)));
    await P.shot(OUT + '/gx-b1-' + cfg.tag + '-shelf.png');

    /* 3. 切到这本书、进书架页、打开第一章（用站内 openCh，等价于点目录里的节） */
    await P.ev("switchCourse('__origin'); goView('book')");
    await sleep(900);
    const opened = await P.ev(`(function(){
      /* 取第一节（不是章首）：公式、表格、折叠答案都在这里，最有代表性 */
      var c=CH.filter(function(x){return x.file==='第1章 函数与极限.md'})[1];
      if(!c)return 'no-ch; CH='+CH.length;
      openCh(c); return 'opened:'+c.file+' 节名='+c.title;
    })()`);
    console.log('  打开第一章：' + opened);
    await sleep(1200);

    const s3 = await P.ev(STATUS);
    console.log('阅读器 ' + JSON.stringify(s3));
    await P.shot(OUT + '/gx-b1-' + cfg.tag + '-read.png');

    /* 4. 滚到正文中段（表 + 公式 + details 都在这儿） */
    await P.ev("var w=document.getElementById('reader');if(w)w.scrollTop=Math.round(w.scrollHeight*0.42)");
    await sleep(400);
    await P.shot(OUT + '/gx-b1-' + cfg.tag + '-mid.png');

    /* 5. 展开一个自测答案，看折叠是否真能用 */
    const det = await P.ev(`(function(){
      var d=document.querySelector('#rw details');
      if(!d)return 'no-details';
      var before=d.open; d.querySelector('summary').click();
      return 'toggled:'+before+'->'+d.open;
    })()`);
    console.log('  折叠：' + det);
    await sleep(300);

    /* 6. JS 异常 */
    console.log('  JS 异常：' + (P.errs.length ? P.errs.slice(0, 3).join(' | ') : '无'));
    P.close();
  }
}
run().catch(e => { console.error('探针失败：', e); process.exit(1) });
