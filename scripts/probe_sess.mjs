/* 真浏览器验证「课程 → 节」：切节、新开节、老数据迁移、闪卡按节筛选、截图。
   用法：先起 8899 静态服务与 Edge(9225)，再 node scripts/probe_sess.mjs */
const PORT = 9225, fs = await import('fs');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const tgt = list.find(t => t.type === 'page' && /^http/.test(t.url || ''));
const ws = new WebSocket(tgt.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej });
let id = 0; const waiters = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && waiters.has(m.id)) { waiters.get(m.id)(m); waiters.delete(m.id) } };
const send = (method, params = {}) => new Promise(res => { const i = ++id; waiters.set(i, res); ws.send(JSON.stringify({ id: i, method, params })) });
const ev = async x => {
  const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true });
  if (r.result && r.result.exceptionDetails) return 'EXC: ' + (r.result.exceptionDetails.exception && r.result.exceptionDetails.exception.description || '');
  return r.result && r.result.result ? r.result.result.value : undefined;
};
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: 'http://127.0.0.1:8899/index.html' });
await sleep(3000);

/* 种一份「升级前」的老数据：消息没有 s 字段、没有 sess. 键 */
console.log('种数据:', await ev(`(function(){try{
  localStorage.clear(); return 'cleared';
}catch(e){return 'EXC '+e.message}})()`));
await send('Page.navigate', { url: 'http://127.0.0.1:8899/index.html' });
await sleep(2500);
console.log('老数据注入:', await ev(`(function(){try{
  localStorage.setItem('gx.msgs.__free',JSON.stringify([
    {r:'user',c:'老对话一：极限是什么'},
    {r:'a',c:'老回答一'},
    {r:'user',c:'老对话二'},
    {r:'a',c:'老回答二'}]));
  localStorage.setItem('gx.cards',JSON.stringify([
    {id:'c1',q:'第一张卡 $x^2$',a:'答',box:0,due:0,c:'__free'},
    {id:'c2',q:'第二张卡',a:'答',box:0,due:0,c:'__free'}]));
  return 'ok';
}catch(e){return 'EXC '+e.message}})()`));
await send('Page.reload'); await sleep(3000);

console.log('\n【升级后：老数据落在第一节】');
console.log('节数:', await ev(`SESS.length`), ' 当前节:', await ev(`CURS===SESS[0].id?'第一节':'不是第一节'`));
console.log('节条上的节:', await ev(`[].map.call(document.querySelectorAll('#stabs .stab[data-s]'),function(b){return b.textContent}).join(' | ')`));
console.log('对话区消息数:', await ev(`document.querySelectorAll('#mw .msg').length`));
console.log('老对话还在:', await ev(`document.querySelector('#mw').textContent.indexOf('老对话一')>=0`));

/* 造第二节：模拟「开始今天的一课」后新开一节并聊两句 */
console.log('\n【新开第二节】');
console.log(await ev(`(function(){try{
  newSess(true);
  const s=CURS;
  MS.push({r:'user',c:'这一节问行列式怎么算',s:s});
  MS.push({r:'a',c:'这一节的回答',s:s});
  saveMs();reloadMsgs();renderSTabs();renderCards();
  return '新节='+s+' 总节数='+SESS.length;
}catch(e){return 'EXC '+e.message}})()`));
console.log('节条:', await ev(`[].map.call(document.querySelectorAll('#stabs .stab'),function(b){return b.textContent}).join(' | ')`));
console.log('对话区只显示第二节:', await ev(`(function(){var t=document.querySelector('#mw').textContent;return JSON.stringify(t.slice(0,40))})()`));
console.log('第一节的内容没混进来:', await ev(`document.querySelector('#mw').textContent.indexOf('老对话一')<0`));

/* 切回第一节 */
console.log('\n【切回第一节】');
console.log(await ev(`(function(){try{
  var b=document.querySelectorAll('#stabs .stab[data-s]')[0];b.click();return 'clicked';
}catch(e){return 'EXC '+e.message}})()`));
await sleep(500);
console.log('对话区:', await ev(`(function(){var t=document.querySelector('#mw').textContent;return t.indexOf('老对话一')>=0?'看到第一节的老对话':'没看到（'+t.slice(0,30)+'）'})()`));

/* 发一条消息，看它落在哪一节（不真调接口，只看 pack 的构造） */
console.log('\n【上下文只含本节】');
console.log(await ev(`(function(){try{
  var pack=[{role:'system',content:'x'}];
  MS.forEach(function(m){if(sid(m)!==CURS)return;pack.push({role:m.r==='user'?'user':'assistant',content:m.c})});
  return '当前节='+sessLabel(CURS)+' 条数='+pack.length+' 含老对话='+(JSON.stringify(pack).indexOf('老对话')>=0);
}catch(e){return 'EXC '+e.message}})()`));

/* 闪卡按节筛选 */
console.log('\n【闪卡按节】');
console.log('选项:', await ev(`[].map.call(document.querySelectorAll('#cse option'),function(o){return o.value+':'+o.textContent}).join(' | ')`));
console.log('加一张第二节的卡:', await ev(`(function(){try{
  var s=SESS[1].id,back=CURS;CURS=s;addCards([{q:'第二节的卡',a:'答'}]);CURS=back;return 'ok'}catch(e){return 'EXC '+e.message}})()`));
console.log('全部节:', await ev(`(function(){CARD_S='all';renderCards();return document.getElementById('due').textContent})()`));
console.log('只看第一节:', await ev(`(function(){CARD_S=SESS[0].id;renderCards();return document.getElementById('due').textContent+' / 列表 '+document.querySelectorAll('#clist .crow').length+' 行'})()`));
console.log('只看第二节:', await ev(`(function(){CARD_S=SESS[1].id;renderCards();return document.getElementById('due').textContent+' / 列表 '+document.querySelectorAll('#clist .crow').length+' 行'})()`));

const shot = await send('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync('C:/Users/35343/Desktop/学习资料/高数/高数网站/preview-节.png', Buffer.from(shot.result.data, 'base64'));
console.log('\n截图已保存');
ws.close();
