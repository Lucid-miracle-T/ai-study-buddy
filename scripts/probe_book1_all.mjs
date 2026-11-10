/* 逐节走完原创讲义第 1 章：9 个切节（章首 + 7 节 + 章末）+ 综合自测，
 * 每节都查：KaTeX 真渲染 / 有没有 katex-error / 有没有漏网的 $ 或 %%C 标记 /
 * 表格是否撑破版心 / 折叠块数量 / 4 列表格宽度 / 有没有横向溢出。
 *
 * 前置：python -m http.server 8906 --bind 127.0.0.1 --directory <站点目录>
 *       msedge --headless=new --remote-debugging-port=9234 --remote-allow-origins=*
 * 用法：node scripts/probe_book1_all.mjs
 */
const PORT = process.env.PROBE_PORT || 9234;
const URL = process.env.PROBE_URL || 'http://127.0.0.1:8906/index.html';
/* 探哪一章：默认第 1 章；PROBE_FILE="第2章 导数与微分.md" 可换章 */
const F = process.env.PROBE_FILE || '第1章 函数与极限.md';
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
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: vw, height: vh, deviceScaleFactor: 1, mobile: !!mobile });
  await send('Page.navigate', { url: bust });
  for (let i = 0; i < 60; i++) { await sleep(250); if (await ev('typeof PACKS!=="undefined"') === true) break; }
  await sleep(1800);
  return { ev, shot, errs, close: () => ws.close() };
}

/* 每节体检。表格「撑破版心」用 #rw 的滚动宽度对比 clientWidth 判断：
   我们给 #rw table 加了 display:block + overflow-x:auto，表格自己滚，版心不该滚。 */
const CHECK = `(function(){
  var rw=document.getElementById('rw');
  var t=function(s){var e=rw.querySelector(s);return e?e.textContent.replace(/\\s+/g,' ').trim():'';};
  var txt=rw.textContent;
  var badTables=0,maxTw=0;
  rw.querySelectorAll('table').forEach(function(tb){
    maxTw=Math.max(maxTw,tb.scrollWidth);
    var host=tb.parentElement;
    if(tb.scrollWidth>rw.clientWidth+2 && tb.scrollWidth>tb.clientWidth+2 && !tb.style.overflowX)badTables++;
  });
  return {
    title:(document.getElementById('rwt')||{}).textContent||t('h1'),
    katex:rw.querySelectorAll('.katex').length,
    katexErr:rw.querySelectorAll('.katex-error').length,
    details:rw.querySelectorAll('details').length,
    tables:rw.querySelectorAll('table').length,
    wideTables:badTables,
    maxTableW:maxTw,
    rwW:rw.clientWidth,
    h2:rw.querySelectorAll('h2').length,
    h3:rw.querySelectorAll('h3').length,
    h4:rw.querySelectorAll('h4').length,
    chars:txt.length,
    /* 漏网标记：块级 $$、行内 %%C、未闭合反引号代码块、markdown 星号旁白 */
    dollar:txt.indexOf(String.fromCharCode(36,36))>=0,
    cMark:(txt.match(/%%[CM]/g)||[]).length,
    fence:txt.indexOf(String.fromCharCode(96,96,96))>=0,
    docOverflow:document.documentElement.scrollWidth>window.innerWidth+1,
    docW:document.documentElement.scrollWidth,winW:window.innerWidth,
    rwOverflow:rw.scrollWidth>rw.clientWidth+2
  };
})()`;

async function run() {
  const only = process.env.PROBE_ONLY || '';
  /* 手机默认按 390 量；PROBE_VW=360 可以顺手把「最小常见宽度」也过一遍。
     360 是 iPhone SE / 老安卓的宽度，长行内公式最容易在这儿露馅。 */
  const mv = Number(process.env.PROBE_VW || 390);
  for (const cfg of [{ vw: 1280, vh: 900, mobile: false, tag: 'desktop' },
                     { vw: mv, vh: 844, mobile: true, tag: 'mobile' + mv }]) {
    console.log('\n========== ' + cfg.tag + ' ' + cfg.vw + 'x' + cfg.vh + ' ==========');
    const P = await open(URL, cfg.vw, cfg.vh, cfg.mobile);

    /* 正文在 IndexedDB 里是「加入书架」那一刻的快照：不清空重导，量到的是旧稿。
       逐条 IDB.del 而不是 deleteDatabase —— 页面还连着库时 delete 会 blocked，
       promise 永不落地，库连接就坏了。 */
    const added = await P.ev(`(async function(){
      var a=await IDB.all();
      for(var i=0;i<a.length;i++)await IDB.del(a[i].id);
      CH=[]; renderBook(); goView('store');
      await new Promise(function(r){setTimeout(r,400)});
      var b=document.querySelector('#stlist .stadd[data-k="__origin"]');
      if(!b)return 'no-btn';
      b.click(); return 'cleared:'+a.length;
    })()`);
    console.log('  教材库：' + added);
    await sleep(3200);

    await P.ev("switchCourse('__origin'); goView('book')");
    await sleep(900);

    const list = await P.ev(`CH.filter(function(x){return x.file===${JSON.stringify(F)}})
      .map(function(x,i){return i+'|'+x.title})`);
    console.log('  切节数：' + (Array.isArray(list) ? list.length : list));

    const n = Array.isArray(list) ? list.length : 0;
    const rows = [];
    for (let i = 0; i < n; i++) {
      const r = await P.ev(`(function(){var c=CH.filter(function(x){return x.file===${JSON.stringify(F)}})[${i}];
        if(!c)return 'no-ch';openCh(c);return c.title})()`);
      await sleep(i === 0 ? 1400 : 900);
      const s = await P.ev(CHECK);
      if (typeof s !== 'object' || s === null) { console.log('  [#' + i + '] 取值失败：' + s); continue; }
      const bad = [];
      if (s.katexErr) bad.push('公式报错 ' + s.katexErr);
      if (s.dollar) bad.push('漏网 $$');
      if (s.cMark) bad.push('漏网 %%C×' + s.cMark);
      if (s.fence) bad.push('漏网围栏');
      if (s.wideTables) bad.push('表格撑破 ' + s.wideTables);
      if (s.docOverflow) bad.push('页面横向溢出 ' + s.docW + '>' + s.winW);
      if (s.rwOverflow) bad.push('#rw 横向溢出');
      rows.push(s);
      console.log(`  [${i}] ${String(s.title).slice(0, 26)} | 公式 ${s.katex} | 表 ${s.tables} | 折叠 ${s.details} | ${s.chars} 字 | ` +
        (bad.length ? '✗ ' + bad.join('，') : '✓'));
      if (cfg.tag === 'desktop' && (!only || only === String(i))) {
        await P.shot(OUT + '/gx-b1-all-' + cfg.tag + '-' + i + '.png');
      }
    }

    const tot = rows.reduce((a, b) => ({ k: a.k + b.katex, t: a.t + b.tables, d: a.d + b.details, c: a.c + b.chars }),
      { k: 0, t: 0, d: 0, c: 0 });
    console.log(`  合计：公式 ${tot.k} ｜ 表 ${tot.t} ｜ 折叠 ${tot.d} ｜ ${tot.c} 字符`);
    console.log('  JS 异常：' + (P.errs.length ? P.errs.slice(0, 3).join(' | ') : '无'));
    P.close();
  }
}
run().catch(e => { console.error('探针失败：', e); process.exit(1) });
