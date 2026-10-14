/* 真浏览器验证「拍题上传」与「每节导师」
   为什么必须用真浏览器：jsdom 没有布局引擎、没有 canvas、没有真实图像解码。
   这里要看的恰恰是这三样：
     · 输入区多了一个 📷 按钮之后，桌面与手机上会不会挤坏/换行
     · 一张 3000×2000 的真图，压缩出来是多少像素、多大体积、多久
     · 切节时顶栏那排导师高亮与 #pcur 文案有没有真的跟着换

   前置：先起静态服务（8902）与 headless Edge（9227）
     python -m http.server 8902 --bind 127.0.0.1
     msedge --headless=new --remote-debugging-port=9227 --remote-allow-origins=*
   用法：node scripts/probe_photo_sess.mjs */
const PORT = process.env.PROBE_PORT || 9227;
const APP = process.env.PROBE_URL || 'http://127.0.0.1:8902/index.html';
const fs = await import('fs');
const os = await import('os');
const path = await import('path');
/* 别写 /tmp —— Windows 上会被解析成 C:\tmp（不存在）。用系统临时目录。 */
const OUT = os.tmpdir();
const sleep = ms => new Promise(r => setTimeout(r, ms));

const bust = APP + (APP.includes('?') ? '&' : '?') + 't=' + Date.now();
const nt = await (await fetch(`http://127.0.0.1:${PORT}/json/new?url=${encodeURIComponent(bust)}`, { method: 'PUT' })).json();
console.log('开新标签页：' + nt.url);
const ws = new WebSocket(nt.webSocketDebuggerUrl);
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
  if (ex) return 'EXC: ' + ((ex.exception && (ex.exception.description || ex.exception.value)) || '');
  return r.result && r.result.result ? r.result.result.value : undefined;
};
const shot = async f => {
  const s = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(f, Buffer.from(s.result.data, 'base64'));
  console.log('  截图 → ' + f);
};
const viewport = (w, h, mobile) => send('Emulation.setDeviceMetricsOverride',
  { width: w, height: h, deviceScaleFactor: 1, mobile: !!mobile });

await send('Page.enable'); await send('Runtime.enable');
await viewport(1280, 900, false);
await send('Page.navigate', { url: bust });
await sleep(3200);

console.log('\n===== 1. 桌面 1280 宽：输入区有没有被新按钮挤坏 =====');
console.log(await ev(`(function(){
  function r(s){var e=document.querySelector(s);if(!e)return null;var b=e.getBoundingClientRect();
    return {x:Math.round(b.left),y:Math.round(b.top),w:Math.round(b.width),h:Math.round(b.height)}};
  var ta=r('#in'),ph=r('#photo'),mic=r('#mic'),sd=r('#send'),bar=r('#inbar');
  var sameLine=function(a,b){return Math.abs(a.y-b.y)<a.h/2};
  return JSON.stringify({
    inbar高:bar&&bar.h, 输入框:ta, 拍照:ph, 麦克风:mic, 发送:sd,
    一排:!!(ta&&ph&&mic&&sd&&sameLine(ta,ph)&&sameLine(ta,mic)&&sameLine(ta,sd)),
    输入框宽度够:ta&&ta.w>500,
    拍照按钮可见:ph&&ph.w>0&&ph.h>0&&ph.w<=80
  },null,0)})()`));
await shot(path.join(OUT,'photo_desktop.png'));

console.log('\n===== 2. 多行：缩略图出现后输入区是否还正常 =====');
console.log(await ev(`(function(){
  PEND='data:image/jpeg;base64,'+'A'.repeat(2000);imgThumb();
  var b=document.querySelector('#pendimg').getBoundingClientRect();
  var ta=document.querySelector('#in').getBoundingClientRect();
  var sd=document.querySelector('#send').getBoundingClientRect();
  return JSON.stringify({缩略图区高:Math.round(b.height),还在同一排:Math.abs(ta.top-sd.top)<ta.height/2,
    输入框没被压扁:ta.width>500});
})()`));
await shot(path.join(OUT,'photo_desktop_pend.png'));

console.log('\n===== 3. 手机 390 宽 =====');
await viewport(390, 780, true);
await sleep(700);
console.log(await ev(`(function(){
  function r(s){var e=document.querySelector(s);if(!e)return null;var b=e.getBoundingClientRect();
    return {x:Math.round(b.left),y:Math.round(b.top),w:Math.round(b.width),h:Math.round(b.height)}};
  var ta=r('#in'),ph=r('#photo'),mic=r('#mic'),sd=r('#send');
  var sameLine=function(a,b){return Math.abs(a.y-b.y)<Math.max(a.h,b.h)/2};
  return JSON.stringify({
    输入框:ta,拍照:ph,麦克风:mic,发送:sd,
    四个还在同一排:!!(ta&&ph&&mic&&sd&&sameLine(ta,ph)&&sameLine(ta,mic)&&sameLine(ta,sd)),
    没横向溢出:document.documentElement.scrollWidth<=document.documentElement.clientWidth,
    输入框还剩:ta&&ta.w
  })})()`));
await shot(path.join(OUT,'photo_mobile.png'));
await viewport(1280, 900, false);
await sleep(500);

console.log('\n===== 4. 真图压缩：3000×2000 的一张「题」 =====');
console.log(await ev(`(async function(){
  function mk(){
    var cv=document.createElement('canvas');cv.width=3000;cv.height=2000;
    var g=cv.getContext('2d');
    g.fillStyle='#f7f5f0';g.fillRect(0,0,3000,2000);
    g.fillStyle='#111';g.font='bold 150px serif';
    g.fillText('求极限 lim',120,420);
    g.fillText('x→0  (sin x)/x',120,640);
    g.font='96px serif';g.fillText('并说明依据',120,900);
    return new Promise(function(res){cv.toBlob(function(b){
      res(new File([b],'题.jpg',{type:'image/jpeg'}))},'image/jpeg',0.92)});
  }
  var f=await mk();
  var t0=performance.now();
  var out=await shrinkImg(f);
  var ms=Math.round(performance.now()-t0);
  var im=new Image();
  await new Promise(function(r){im.onload=r;im.src=out});
  return JSON.stringify({原图KB:Math.round(f.size/1024),压缩后KB:Math.round(out.length/1024),
    尺寸:im.naturalWidth+'×'+im.naturalHeight,前缀:out.slice(0,22),耗时ms:ms});
})()`));

console.log('\n===== 5. 走完整入口：伪造选中文件 → change → 缩略图 =====');
console.log(await ev(`(function(){
  var cv=document.createElement('canvas');cv.width=1600;cv.height=1200;
  var g=cv.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,1600,1200);
  g.fillStyle='#000';g.font='80px serif';g.fillText('选择题 3',80,200);
  window.__pending=null;
  cv.toBlob(function(b){
    var f=new File([b],'t.jpg',{type:'image/jpeg'});
    var inp=document.getElementById('imgf');
    Object.defineProperty(inp,'files',{value:[f],configurable:true});
    inp.dispatchEvent(new Event('change'));
  },'image/jpeg',0.9);
  return '已投递';
})()`));
await sleep(1200);
console.log('  结果：' + await ev(`JSON.stringify({
  PEND有了:!!PEND, 前缀:(PEND||'').slice(0,22),
  KB:PEND?Math.round(PEND.length/1024):0,
  缩略图显示:document.querySelector('#pendimg').style.display,
  缩略图里有img:!!document.querySelector('#pendimg img')
})`));
await shot(path.join(OUT,'photo_thumb.png'));

console.log('\n===== 6. 每节导师：切节换人 =====');
console.log('  造两节：' + await ev(`(function(){
  PEND=null;imgThumb();
  COURSE='__free';LS.s('course',COURSE);
  SESS=[{id:'pA',t:1,title:'极限',who:'cauchy'},{id:'pB',t:2,title:'导数',who:'newton'}];
  CURS='pA';saveSess();
  MS=[{r:'user',c:'开始',s:'pA'},{r:'a',c:'好',s:'pA'},{r:'user',c:'继续',s:'pB'},{r:'a',c:'嗯',s:'pB'}];saveMs();
  applySessWho();reloadMsgs();renderSTabs();
  return '已造好';
})()`));
await sleep(400);
const pillOn = `[].filter.call(document.querySelectorAll('#pbox .pill'),function(p){return p.className.indexOf('on')>=0}).map(function(p){return p.textContent}).join(',')`;
console.log('  第 1 节（柯西）：who=' + await ev('who') + ' 高亮=' + await ev(pillOn) + ' 文案=' + await ev('$("pcur").textContent'));
console.log('  气泡名字：' + await ev(`[].map.call(document.querySelectorAll('#mw .msg .who'),function(e){return e.textContent}).join(' | ')`));
await ev(`document.querySelectorAll('#stabs .stab[data-s]')[1].click()`);
await sleep(500);
console.log('  第 2 节（牛顿）：who=' + await ev('who') + ' 高亮=' + await ev(pillOn) + ' 文案=' + await ev('$("pcur").textContent'));
console.log('  气泡名字：' + await ev(`[].map.call(document.querySelectorAll('#mw .msg .who'),function(e){return e.textContent}).join(' | ')`));
console.log('  系统提示词是否牛顿的：' + await ev(`$("sys").value===getP('newton').p`));
await ev(`document.querySelectorAll('#stabs .stab[data-s]')[0].click()`);
await sleep(500);
console.log('  切回第 1 节：who=' + await ev('who') + ' 高亮=' + await ev(pillOn));
await shot(path.join(OUT,'photo_sess.png'));

console.log('\n===== 7. 符号面板里的推出/等价 =====');
await ev(`$('symtoggle').className='sm pri';SYMA=1;SYMT='tmpl';LS.s('syma',1);LS.s('symt','tmpl');renderSym();`);
await sleep(300);
console.log('  模板按钮：' + await ev(`[].map.call(document.querySelectorAll('#symgrids .symbtn'),function(b){return b.textContent}).join(' / ')`));

console.log('\n===== 异常 =====');
console.log(errs.length ? errs.join('\n') : '  无');
ws.close();
