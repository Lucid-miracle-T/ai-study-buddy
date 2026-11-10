/* 真浏览器验证「聊天式头像 + 课余群聊」：jsdom 没有布局引擎，这一步不能省
 *
 * 前置：
 *   python -m http.server 8904 --bind 127.0.0.1 --directory <站点目录>
 *   msedge --headless=new --remote-debugging-port=9234 --remote-allow-origins=*
 * 用法：node scripts/probe_avatar.mjs
 */
const PORT = process.env.PROBE_PORT || 9234;
const URL = process.env.PROBE_URL || 'http://127.0.0.1:8904/index.html';
const fs = await import('fs');
const os = await import('os');
const OUT = os.tmpdir();
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* 一张自带的小头像（橙色底 + 白色人形），走 data: 是为了不依赖站点里的任何图片 */
const AV = 'data:image/svg+xml;base64,' + Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">' +
  '<rect width="64" height="64" fill="#E8734A"/>' +
  '<circle cx="32" cy="25" r="11" fill="#fff"/>' +
  '<path d="M11 60c0-12 9-20 21-20s21 8 21 20" fill="#fff"/></svg>'
).toString('base64');

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

/* 在页面里直接摆出「有名片 + 有对话 + 有群聊」的状态，不依赖真实接口 */
const SEED = `(function(){
  var av=${JSON.stringify(AV)};
  MECARD={name:'小林',av:av};LS.s('me',MECARD);
  var k0=pKeys()[0],k1=pKeys()[1]||k0;
  AVS={};AVS[k0]=av;LS.s('avatars',AVS);
  MS=[
    {r:'user',c:'这道题我想用洛必达，可以吗？',t:Date.now()-20000},
    {r:'assistant',c:'可以。先看 $\\\\lim_{x\\\\to 0}\\\\frac{\\\\sin x}{x}=1$，再确认分子分母都趋于 0。',w:k0,t:Date.now()-10000}
  ];
  saveMs();reloadMsgs();renderIdCard();
  GMEM=[k0,k1];saveMem();
  GCHAT=[
    {r:'user',c:'晚上好，今天想聊点轻松的',t:Date.now()-30000},
    {r:'a',w:k0,c:'好，那就从你今天最想问的一件事开始。',t:Date.now()-20000},
    {r:'a',w:k1,c:'我补一句：别一上来就挑最难的。',t:Date.now()-10000}
  ];
  saveChat();
  return JSON.stringify({k0:k0,k1:k1,k0name:getP(k0).n});
})()`;

const LAYOUT = `(function(){
  function b(sel){var e=document.querySelector(sel);if(!e)return null;
    var r=e.getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),bottom:Math.round(r.bottom),right:Math.round(r.right)};}
  var msgs=[].map.call(document.querySelectorAll('#mw .msg,#chatmw .msg'),function(m){
    var av=m.querySelector('.av'),col=m.querySelector('.mcol'),bd=m.querySelector('.body');
    return {me:m.classList.contains('me'),
      av:av?(av.querySelector('img')?'图':'字'+(av.textContent||'')):'-',
      avw:av?Math.round(av.getBoundingClientRect().width):0,
      colw:col?Math.round(col.getBoundingClientRect().width):0,
      colright:col?Math.round(col.getBoundingClientRect().right):0,
      bodyw:bd?Math.round(bd.getBoundingClientRect().width):0,
      name:(m.querySelector('.who')||{}).textContent||''};
  });
  var log=document.querySelector('#chatlog'),bar=document.querySelector('#chatbar');
  return JSON.stringify({
    view:document.body.dataset.view,
    vw:innerWidth,vh:innerHeight,
    docScrollW:document.documentElement.scrollWidth,
    chatOn:document.querySelector('#v-chat').classList.contains('on'),
    chatlog:b('#chatlog'),chatbar:b('#chatbar'),chsrow:b('#chsrow'),
    chatlogScrollW:log?log.scrollWidth:-1,chatlogClientW:log?log.clientWidth:-1,
    cards:document.querySelectorAll('#csWho .lh-card').length,
    cardsOn:document.querySelectorAll('#csWho .lh-card.on').length,
    msgs:msgs,
    barInView:bar?bar.getBoundingClientRect().bottom<=innerHeight+1:null
  },null,1);
})()`;

const CAP = `(function(){
  return JSON.stringify({
    count:(document.querySelector('#csCount')||{}).textContent||'',
    top:(document.querySelector('#dtSess')||{}).textContent||'',
    on:document.querySelectorAll('#csWho .lh-card.on').length,
    full:document.querySelectorAll('#csWho .lh-card.full').length,
    CHAT_MAX:(typeof CHAT_MAX!=='undefined'?CHAT_MAX:'?'),
    toast:(document.querySelector('#toast')||{}).textContent||''
  },null,1);
})()`;

const IDLAYOUT = `(function(){
  var row=document.querySelector('.idrow'),b=function(sel){var e=document.querySelector(sel);
    if(!e)return null;var r=e.getBoundingClientRect();return {x:Math.round(r.x),right:Math.round(r.right),w:Math.round(r.width),h:Math.round(r.height)};};
  return JSON.stringify({
    view:document.body.dataset.view,
    vw:innerWidth,docScrollW:document.documentElement.scrollWidth,
    setOn:document.querySelector('#v-set').classList.contains('on'),
    rowW:row?row.clientWidth:-1,rowScrollW:row?row.scrollWidth:-1,
    myav:b('#myav .av'),name:b('#myname'),up:b('#myavup'),clr:b('#myavclr'),
    avatars:document.querySelectorAll('#avlist .avitem').length,
    avlistW:(document.querySelector('#avlist')||{}).clientWidth||0,
    avlistScrollW:(document.querySelector('#avlist')||{}).scrollWidth||0
  },null,1);
})()`;

async function run() {
  for (const cfg of [
    { name: '桌面 1280×800', vw: 1280, vh: 800, mobile: false },
    { name: '手机 390×844', vw: 390, vh: 844, mobile: true }
  ]) {
    console.log('\n########## ' + cfg.name + ' ##########');
    const P = await open(URL, cfg.vw, cfg.vh, cfg.mobile);
    console.log('种子：' + await P.ev(SEED));

    await P.ev("closeLaunch();goView('lesson')");
    await sleep(350);
    console.log('--- 课堂（头像气泡）---');
    console.log(await P.ev(LAYOUT));
    await P.shot(OUT + '/gx-av-lesson-' + cfg.vw + '.png');

    await P.ev("goView('chat')");
    await sleep(350);
    console.log('--- 课余 · 群聊 ---');
    console.log(await P.ev(LAYOUT));
    await P.shot(OUT + '/gx-av-chat-' + cfg.vw + '.png');

    /* 人数上限：默认 2 位伙伴 → 加到 3 位（含我 4 人）→ 第 4 位该被拦下。
       注意这一步必须在「开始群聊」之前做 —— 开场之后成员就锁了，向导也不再出现 */
    console.log('--- 群聊人数上限（含我最多 4 人）---');
    console.log('初始：' + await P.ev(CAP));
    await P.ev("(function(){var c=document.querySelectorAll('#csWho .lh-card');if(c[2])c[2].click()})()");
    await sleep(200);
    console.log('加满 3 位伙伴后：' + await P.ev(CAP));
    await P.ev("(function(){var c=document.querySelectorAll('#csWho .lh-card');if(c[3])c[3].click()})()");
    await sleep(200);
    console.log('再点第 4 位（应被拦）：' + await P.ev(CAP));
    await P.shot(OUT + '/gx-av-cap-' + cfg.vw + '.png');

    await P.ev("goView('set')");
    await sleep(300);
    await P.ev("(function(){var e=document.querySelector('.idrow');if(e&&e.scrollIntoView)e.scrollIntoView({block:'center'})})()");
    await sleep(200);
    console.log('--- 设置 · 我的名片 ---');
    console.log(await P.ev(IDLAYOUT));
    await P.shot(OUT + '/gx-av-set-' + cfg.vw + '.png');

    console.log('JS 异常：' + (P.errs.length ? JSON.stringify(P.errs.slice(0, 5)) : '无'));
    P.close();
  }
}
run().catch(e => { console.error(e); process.exitCode = 1; });
