/* 真浏览器复核「空间 → 页面 → 操作」的信息架构改造
 * jsdom 没有布局引擎：位置条、全站地图浮层、抽屉分组是否真的排得下，只能看真 Edge。
 *
 * 前置：
 *   python -m http.server 8904 --bind 127.0.0.1 --directory <站点目录>
 *   msedge --headless=new --remote-debugging-port=9234 --remote-allow-origins=*
 * 用法：node scripts/probe_ia.mjs
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
  await sleep(1400);
  return { ev, shot, errs, close: () => ws.close() };
}

/* 灌一点教材和对话，让界面不是空壳；并收起向导（已开课状态） */
const SEED = `(function(){
  window.__idb=[];
  PACKS.forEach(function(p){p.files.forEach(function(f){window.__idb.push({id:f+'#1',file:f,title:'测试节',txt:'内容'})})});
  CH=window.__idb.slice(); updateCourses();
  markBegun(); closeLaunch();
  var k0=pKeys()[0];
  MS=[
    {r:'user',c:'这里的极限为什么能用等价无穷小替换？',t:Date.now()-20000},
    {r:'assistant',c:'先确认乘除关系：$\\\\lim_{x\\\\to 0}\\\\frac{\\\\sin x}{x}=1$。加减里直接替换会丢掉主项。',w:k0,t:Date.now()-10000}
  ];
  saveMs(); reloadMsgs(); renderCourseTree();
  return 'ok';
})()`;

const READ = `(function(){
  function b(sel){var e=document.querySelector(sel);if(!e)return null;
    var r=e.getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),right:Math.round(r.right),bottom:Math.round(r.bottom),
      vis:getComputedStyle(e).display!=='none'};}
  return {
    scrollW:document.documentElement.scrollWidth,innerW:window.innerWidth,
    crumb:b('#crumb'),guideopen:b('#guideopen'),nvcap:b('#nvcap'),gtabs:b('#gtabs'),nv:b('.nv'),
    mtabs:b('#mtabs'),mtabbar:b('#mtabbar'),msgs:b('#msgs'),
    bar1:b('#lbar1'),bar2:b('#lbar2'),bStart:b('#start'),bClose:b('#close'),bStop:b('#stop'),
    guide:b('#guide'),gdcard:b('.gd-card'),drawer:b('#drawer'),
    crumbText:(document.getElementById('crumb')||{}).textContent.replace(/\\s+/g,' ').trim(),
    capText:(document.getElementById('nvcap')||{}).textContent,
    groupHeaders:document.querySelectorAll('#drawer .nv .nvgh').length,
    drawerBtns:document.querySelectorAll('#drawer .nv button[data-v]').length,
    guideRows:document.querySelectorAll('#guide .gd-row').length,
    guideJumps:document.querySelectorAll('#guide [data-jump]').length,
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
    console.log('-- 首次打开：开课向导 + 引导入口 --');
    await dump('首访', P);
    await P.shot(OUT + '/gx-ia-' + cfg.tag + '-first.png');
    console.log('种子：' + await P.ev(SEED));
    await sleep(350);

    console.log('-- 课堂 / 位置条 --');
    const base = await dump('布局', P);
    await P.shot(OUT + '/gx-ia-' + cfg.tag + '-class.png');

    console.log('-- 全站地图 --');
    await P.ev("openGuide()");
    await sleep(250);
    const gd = await dump('地图', P);
    console.log('  卡片在视口内：' + (gd.gdcard && gd.gdcard.x >= 0 && gd.gdcard.right <= cfg.vw
      && gd.gdcard.y >= 0 && gd.gdcard.bottom <= cfg.vh));
    await P.shot(OUT + '/gx-ia-' + cfg.tag + '-guide.png');
    await P.ev("closeGuide()");

    console.log('-- 开课向导里的「? 使用指南」是否挤得下 --');
    await P.ev("goView('lesson');openLaunch()");
    await sleep(200);
    console.log('  ' + await P.ev(`(function(){
      var ids=['lhGuide','lhTheme','lhClose','lhStart'];
      return JSON.stringify(ids.map(function(id){
        var e=document.getElementById(id),r=e?e.getBoundingClientRect():null;
        return {id:id,vis:!!e&&getComputedStyle(e).display!=='none',
          x:r?Math.round(r.x):null,right:r?Math.round(r.right):null,w:r?Math.round(r.width):null};
      }));
    })()`));
    await P.shot(OUT + '/gx-ia-' + cfg.tag + '-launch.png');
    await P.ev("closeLaunch();hideNotStarted();goView('lesson')");

    console.log('-- 工具条：收起态一排、展开态第二排回来 --');
    console.log('  ' + await P.ev(`(function(){
      function b(s){var e=document.querySelector(s);if(!e)return null;
        var r=e.getBoundingClientRect();return {vis:getComputedStyle(e).display!=='none',
          x:Math.round(r.x),y:Math.round(r.y),right:Math.round(r.right),bottom:Math.round(r.bottom)};}
      var o={collapsed:{bar1:b('#lbar1'),bar2:b('#lbar2'),stop:b('#stop')}};
      document.getElementById('lexpand').click();
      o.expanded={bar1:b('#lbar1'),bar2:b('#lbar2'),stop:b('#stop'),
        gen:b('#gen'),exp2:b('#exp2'),clr:b('#clr')};
      document.getElementById('lexpand').click();
      o.back={bar2:b('#lbar2')};
      return JSON.stringify(o);
    })()`));
    await P.ev("goView('lesson')");
    await sleep(150);
    await P.shot(OUT + '/gx-ia-' + cfg.tag + '-class.png');

    if (cfg.mobile) {
      console.log('-- 抽屉（全站地图）--');
      await P.ev("openDrawer()");
      await sleep(250);
      await dump('抽屉', P);
      await P.shot(OUT + '/gx-ia-' + cfg.tag + '-drawer.png');
      await P.ev("closeDrawer()");
    } else {
      console.log('-- 切到设置：位置条应显示 生态 › 设置 --');
      await P.ev("goView('set')");
      await sleep(200);
      const st = await dump('设置', P);
      console.log('  ' + st.crumbText);
      await P.shot(OUT + '/gx-ia-' + cfg.tag + '-set.png');
    }

    console.log('横向溢出：' + (base.scrollW > base.innerW ? '有 ' + base.scrollW + '>' + base.innerW : '无'));
    console.log('JS 异常：' + (P.errs.length ? JSON.stringify(P.errs.slice(0, 5)) : '无'));
    P.close();
    await sleep(200);
  }
}
await run();
