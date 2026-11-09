/* 真浏览器复现 / 验证：手机端「Ω 特殊符号」点得出来 + 课中伙伴节奏锁定
 *
 * 前置：
 *   python -m http.server 8904 --bind 127.0.0.1
 *   msedge --headless=new --remote-debugging-port=9234 --remote-allow-origins=*
 * 用法：node scripts/probe_sym.mjs
 */
const PORT = process.env.PROBE_PORT || 9234;
const URL = process.env.PROBE_URL || 'http://127.0.0.1:8904/index.html';
const fs = await import('fs');
const os = await import('os');
const path = await import('path');
const OUT = os.tmpdir();
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function open(url, vw, vh) {
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
  await send('Emulation.setDeviceMetricsOverride', { width: vw, height: vh, deviceScaleFactor: 1, mobile: true });
  /* 同一个 Edge profile 会共享 localStorage：不清理的话每跑一次就多攒几节，读数不可复现 */
  await send('Storage.clearDataForOrigin', { origin: new globalThis.URL(bust).origin, storageTypes: 'local_storage' });
  await send('Page.navigate', { url: bust });
  for (let i = 0; i < 60; i++) { await sleep(250); if (await ev('typeof LITE!=="undefined"') === true) break; }
  await sleep(1800);
  return { ev, shot, errs, close: () => ws.close() };
}

const SYM = `(function(){
  var g=document.querySelector('#symgrids'), t=document.querySelector('#symtabs');
  var grid=g?g.querySelector('.symgrid'):null;
  var r=grid?grid.getBoundingClientRect():null;
  return JSON.stringify({
    symopen:document.body.classList.contains('symopen'),
    SYMA:(typeof SYMA!=='undefined'?SYMA:'?'),
    符号按钮数:g?g.querySelectorAll('.symbtn').length:-1,
    分类按钮数:t?t.querySelectorAll('.symbtn').length:-1,
    分类栏:t?t.style.display:'-',
    网格显示:grid?getComputedStyle(grid).display:'-',
    网格高:r?Math.round(r.height):0,
    容器显示:g?getComputedStyle(g).display:'-',
    Ω文本:document.querySelector('#symtoggle').textContent,
    toast:(document.querySelector('#toast')||{}).textContent||''
  },null,1);
})()`;

async function run() {
  const M = await open(URL, 390, 844);
  console.log('########## 手机 390×844 ##########');
  /* 新节默认弹开课向导，它盖住课堂。先关掉，才测得到真实课堂里的符号浮层。 */
  await M.ev(`(function(){var b=document.querySelector('#lhClose');if(b)b.click();return 1})()`);
  await sleep(250);
  console.log('初始   ', await M.ev(SYM));
  await M.ev(`document.querySelector('#symtoggle').click()`);
  await sleep(350);
  console.log('点 Ω 后', await M.ev(SYM));
  await M.shot(path.join(OUT, 'gx_sym_open.png'));
  const first = await M.ev(`(function(){var b=document.querySelector('#symgrids .symbtn');if(!b)return 'NOBTN';b.click();return b.textContent})()`);
  console.log('点第一个符号 →', first, '输入框=', await M.ev(`document.querySelector('#in').value`));

  /* 课中：造一条「我发的话」，打开向导看锁定态与新增的「开新的一节」按钮 */
  await M.ev(`(function(){MS=[{r:'user',c:'开始',s:CURS}];saveMs();syncLockUI();openLaunch();return 1})()`);
  await sleep(300);
  console.log('课中向导', await M.ev(`(function(){
    function box(s){var e=document.querySelector(s);if(!e||e.hidden)return null;
      var r=e.getBoundingClientRect();return {y:Math.round(r.y),h:Math.round(r.h||r.height),w:Math.round(r.width)};}
    return JSON.stringify({locked:document.querySelector('#launch').classList.contains('locked'),
      cfglock:document.body.classList.contains('cfglock'),
      新节按钮:box('#lhNext'),主按钮:box('#lhStart'),状态标签:box('#lhStatus'),
      说明:document.querySelector('.lh-note').textContent.slice(0,40),
      伙伴卡透明度:getComputedStyle(document.querySelector('#lhWho .lh-card')).opacity,
      视口高:window.innerHeight},null,1);})()`));
  const whoBefore = await M.ev(`who`);
  await M.ev(`(function(){var c=document.querySelectorAll('#lhWho .lh-card');for(var i=0;i<c.length;i++){if(c[i].className.indexOf('on')<0){c[i].click();break}}return 1})()`);
  await sleep(200);
  console.log('课中点伙伴卡 → who 不变 =', (await M.ev(`who`)) === whoBefore,
    'toast=', await M.ev(`(document.querySelector('#toast')||{}).textContent||''`));
  const noToast = `(function(){var t=document.querySelector('#toast');if(t)t.style.display='none';return 1})()`;
  await M.ev(noToast);
  await M.shot(path.join(OUT, 'gx_lock_wizard.png'));

  /* 点「开新的一节」→ 解锁、能重选 */
  await M.ev(`document.querySelector('#lhNext').click()`);
  await sleep(400);
  console.log('开新节后', await M.ev(`(function(){return JSON.stringify({
    节数:SESS.length,锁定:cfgLocked(),locked:document.querySelector('#launch').classList.contains('locked'),
    新节按钮隐藏:document.querySelector('#lhNext').hidden,
    说明:document.querySelector('.lh-note').textContent.slice(0,40)},null,1)})()`));
  await M.ev(noToast);
  await M.shot(path.join(OUT, 'gx_lock_next.png'));
  console.log('JS 异常', M.errs.length ? M.errs.slice(0, 3) : '无');
  M.close();

  /* 桌面：课中锁定同样生效，且「⋯ 更多」展开后药丸/下拉仍看得见 */
  const D = await open(URL, 1280, 800);
  console.log('########## 桌面 1280×800 ##########');
  await D.ev(`(function(){var b=document.querySelector('#lhClose');if(b)b.click();
    document.querySelector('#lexpand').click();
    MS=[{r:'user',c:'开始',s:CURS}];saveMs();syncLockUI();return 1})()`);
  const desk = await D.ev(`(function(){var w=who,p=PA;
    var pills=document.querySelectorAll('#pbox .pill');
    for(var i=0;i<pills.length;i++){if(pills[i].className.indexOf('on')<0){pills[i].click();break}}
    var pe=document.querySelector('#pace');pe.value=(PA==='fast'?'slow':'fast');
    pe.dispatchEvent(new Event('change',{bubbles:true}));
    return JSON.stringify({锁定:cfgLocked(),body态:document.body.classList.contains('cfglock'),
      伙伴未变:who===w,节奏未变:PA===p,下拉回弹:pe.value===p,
      药丸可见:getComputedStyle(document.querySelector('#pbox')).display},null,1)})()`);
  console.log('桌面点击结果', desk);
  console.log('桌面锁定', await D.ev(`JSON.stringify({锁定:cfgLocked(),节数:SESS.length},null,1)`));
  console.log('桌面 JS 异常', D.errs.length ? D.errs.slice(0, 3) : '无');
  D.close();
}
await run();
