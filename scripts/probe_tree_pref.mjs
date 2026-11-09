/* 真浏览器验证「左侧课程树 + 课堂偏好 + 群聊多会话 + 手机对标外壳」
 * jsdom 没有布局引擎，横向溢出 / 悬浮面板越界 / 对话区占比都只能靠真 Edge 看。
 *
 * 前置：
 *   python -m http.server 8904 --bind 127.0.0.1 --directory <站点目录>
 *   msedge --headless=new --remote-debugging-port=9234 --remote-allow-origins=*
 * 用法：node scripts/probe_tree_pref.mjs
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
  await sleep(1500);
  return { ev, shot, errs, close: () => ws.close() };
}

/* 把三门教材灌进 CH（不依赖 book/*.md 是否 200），并造一段对话，让界面不是空壳 */
const SEED = `(function(){
  window.__idb=[];
  PACKS.forEach(function(p){p.files.forEach(function(f){window.__idb.push({id:f+'#1',file:f,title:'测试节',txt:'内容'})})});
  CH=window.__idb.slice(); updateCourses();
  markBegun(); closeLaunch();
  var k0=pKeys()[0];
  MS=[
    {r:'user',c:'这里的极限为什么能用等价无穷小替换？',t:Date.now()-20000},
    {r:'assistant',c:'先确认乘除关系：$\\\\lim_{x\\\\to 0}\\\\frac{\\\\sin x}{x}=1$。加减里直接替换会丢掉主项，这一步最容易错。',w:k0,t:Date.now()-10000}
  ];
  saveMs(); reloadMsgs(); renderCourseTree();
  return JSON.stringify({courses:visibleCourses().map(function(g){return cname(g.k)}),tree:document.querySelectorAll('#ctree .ct-crs').length});
})()`;

const READ = `(function(){
  function b(sel){var e=document.querySelector(sel);if(!e)return null;
    var r=e.getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),bottom:Math.round(r.bottom),right:Math.round(r.right),
      vis:getComputedStyle(e).display!=='none'};}
  return {
    scrollW:document.documentElement.scrollWidth,
    innerW:window.innerWidth,
    tree:b('#ctree'), treeRows:document.querySelectorAll('#ctree .ct-crs').length,
    treeSess:document.querySelectorAll('#ctree .ct-s[data-s]').length,
    ctabs:b('#ctabs'), stabs:b('#stabs'),
    nav:b('#nav'), topbar:b('#topbar'), mtabs:b('#mtabs'), msgs:b('#msgs'),
    inbar:b('#inbar'), mcaps:b('#mcaps'), mtabbar:b('#mtabbar'), mfab:b('#mfab'),
    prefpanel:b('#prefpanel'), prefopen:b('#prefopen'), pacebar:b('#pacebar'),
    chs:b('#chatsessions'), chatbar:b('#chatbar'),
    notstarted:b('#notstarted'), launch:b('#launch'),
    chatlog:b('#chatlog'),
    msgPct:Math.round((b('#msgs')?b('#msgs').h:0)/window.innerHeight*100)
  };
})()`;

async function dump(label, P) {
  const r = await P.ev(READ);
  console.log(label + ' ' + JSON.stringify(r));
  return r;
}

async function run() {
  for (const cfg of [{ vw: 1280, vh: 800, mobile: false, tag: 'desktop' },
                     { vw: 390, vh: 844, mobile: true, tag: 'mobile' }]) {
    console.log('\n========== ' + cfg.tag + ' ' + cfg.vw + 'x' + cfg.vh + ' ==========');
    const P = await open(URL, cfg.vw, cfg.vh, cfg.mobile);
    console.log('种子：' + await P.ev(SEED));
    await sleep(400);

    console.log('-- 课堂 / 左侧树 --');
    const base = await dump('布局', P);
    console.log('  课程树节点 ' + base.treeRows + ' / 展开的节 ' + base.treeSess
      + ' / 顶部标签条高度 ' + (base.ctabs ? base.ctabs.h : '-') + ',' + (base.stabs ? base.stabs.h : '-'));
    await P.shot(OUT + '/gx-tp-' + cfg.tag + '-class.png');

    console.log('-- 课堂偏好面板 --');
    await P.ev("openPref();document.getElementById('preftxt').value='多用生活中的例子，每次只问一个问题。';prefMeter()");
    await sleep(250);
    const pref = await dump('偏好', P);
    console.log('  面板在视口内：' + (pref.prefpanel && pref.prefpanel.x >= 0 && pref.prefpanel.right <= cfg.vw
      && pref.prefpanel.y >= 0 && pref.prefpanel.bottom <= cfg.vh));
    await P.shot(OUT + '/gx-tp-' + cfg.tag + '-pref.png');
    await P.ev('closePref()');

    console.log('-- 群聊多会话 --');
    await P.ev("goView('chat');newChat();renderChat()");
    await sleep(250);
    await dump('群聊', P);
    await P.shot(OUT + '/gx-tp-' + cfg.tag + '-chat.png');

    console.log('-- 手机 Ω 符号浮层 --');
    if (cfg.mobile) {
      await P.ev("document.getElementById('notstarted').hidden=true;document.getElementById('mfSym').click()");
      await sleep(250);
      console.log('  ' + await P.ev(`(function(){
        var bs=document.querySelectorAll('#symgrids .symbtn');
        var g=document.querySelector('#symgrids .symgrid.on')||document.querySelector('#symgrids .symgrid');
        var r=g?g.getBoundingClientRect():null;
        return JSON.stringify({view:document.body.dataset.view,buttons:bs.length,
          visible:!!g&&getComputedStyle(g).display!=='none',
          rect:r?{x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)}:null});
      })()`));
      await P.shot(OUT + '/gx-tp-' + cfg.tag + '-sym.png');
    }

    console.log('-- 向导 ✕ 退出到未开课空态 --');
    await P.ev("goView('lesson');newSess(true);openLaunch();document.getElementById('lhClose').click()");
    await sleep(200);
    const ns = await dump('空态', P);
    console.log('  空态可见：' + (ns.notstarted && ns.notstarted.vis) + ' / 向导隐藏：' + (ns.launch && !ns.launch.vis));
    await P.shot(OUT + '/gx-tp-' + cfg.tag + '-empty.png');

    console.log('JS 异常：' + (P.errs.length ? JSON.stringify(P.errs.slice(0, 5)) : '无'));
    P.close();
    await sleep(200);
  }
}
await run();
