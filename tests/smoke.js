const fs = require('fs');
const { JSDOM, VirtualConsole } = require('jsdom');

const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8')
  .replace(/<script src="https:\/\/[^"]+"><\/script>/g, '');

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', e => errors.push('jsdomError: ' + (e.message || e)));
vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')));

function installIDB(win) {
  const store = new Map();
  win.indexedDB = {
    open() {
      const req = {};
      const db = {
        objectStoreNames: { contains: () => true },
        createObjectStore() { return {} },
        transaction() {
          const os = {
            put: o => { store.set(o.id, o); return {} },
            getAll() { return { result: [...store.values()] } },
            delete: id => { store.delete(id); return {} },
            clear() { store.clear(); return {} }
          };
          const t = { objectStore: () => os };
          setTimeout(() => { if (t.oncomplete) t.oncomplete(); }, 0);
          return t;
        }
      };
      setTimeout(() => {
        req.result = db;
        if (req.onsuccess) req.onsuccess({ target: { result: db } });
      }, 0);
      return req;
    }
  };
}

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'http://localhost/',
  virtualConsole: vc,
  beforeParse(win) { installIDB(win); win.confirm = () => true; win.alert = () => {}; }
});
const w = dom.window;

setTimeout(() => {
  const q = s => w.document.querySelectorAll(s).length;
  console.log('--- 初始化检查 ---');
  console.log('导航按钮        ', q('.nv button'));
  console.log('人格 pill(课堂)', q('#pbox .pill'));
  console.log('人格 pill(设置)', q('#pbox2 .pill'));
  console.log('服务商选项      ', q('#prov option'));
  console.log('系统提示词长度  ', (w.document.getElementById('sys').value || '').length);
  console.log('教学规则长度    ', (w.document.getElementById('meth').value || '').length);
  console.log('开场消息        ', q('#mw .msg'));
  console.log('底部状态        ', (w.document.getElementById('foot').textContent || '').trim().slice(0, 30));

  try {
    // 载入一本假教材，验证解析与目录树
    const src = '# 第二章 导数与微分\n\n正文 $a^2+b^2=c^2$。\n\n## 第五节 函数的微分\n\n这里讲 dy。\n\n## 习题2-5\n\n题目若干。\n';
    w.eval('window.__done=false; addFile("测试书.md",' + JSON.stringify(src) + ').then(function(){window.__done=true})');
  } catch (e) { errors.push('addFile: ' + e.message); }

  setTimeout(() => {
    try {
      console.log('\n--- 教材渲染 ---');
      console.log('章节条目        ', q('#blist .item'));
      console.log('分组数          ', q('#blist .grp'));
      console.log('右下统计        ', w.document.getElementById('bstat').textContent);
      // 点第一节
      const it = w.document.querySelectorAll('#blist .item')[0];
      it.click();
      console.log('reader 是否渲染 ', w.document.getElementById('rw').innerHTML.length > 50);
      console.log('状态下拉        ', !!w.document.getElementById('prsel'));

      // 切页
      ['book', 'card', 'prog', 'set', 'lesson'].forEach(v => {
        w.document.querySelector('[data-v="' + v + '"]').click();
        process.stdout.write(v + '→' + w.document.querySelector('section.view.on').id + '  ');
      });
      console.log('');

      // 闪卡流程
      w.eval("addCards([{q:'测试 $\\\\frac{1}{2}$ 是多少',a:'一半'}]);");
      w.eval("rev=CD[0].id; revBack=false; renderCards();");
      console.log('\n--- 闪卡 ---');
      console.log('渲染面数        ', q('#car .face'), '| 列表卡片', q('#clist .crow'));
      w.eval("rev=CD[0].id; revBack=false; grade(true)");
      console.log('记得后 box      ', w.eval('CD[0].box'), '| 下次间隔(分)', w.eval('Math.round((CD[0].due-Date.now())/60000)'));
      w.eval("rev=CD[0].id; revBack=false; grade(false)");
      console.log('忘了后 box      ', w.eval('CD[0].box'), '| 下次间隔(分)', w.eval('Math.round((CD[0].due-Date.now())/60000)'));
      w.eval("for(var i=0;i<3;i++){rev=CD[0].id;grade(true)}");
      console.log('连答对3次 box   ', w.eval('CD[0].box'), '| 下次间隔(天)', w.eval('(CD[0].due-Date.now())/86400000|0'));

      // 课程切换 / 节奏 / 教材名
      w.eval("PA='slow';");
      const s = w.eval('sysMsg()');
      console.log('\n--- 节奏与教材 ---');
      console.log('课程下拉选项      ', q('#course option'), '| 当前值', w.eval('COURSE'));
      console.log('节奏选项          ', q('#pace option'));
      console.log('sysMsg 含节奏     ', s.indexOf('节奏 · 慢') >= 0);
      console.log('sysMsg 含教材名   ', s.indexOf('第八版') >= 0);
      console.log('structure 转标题  ', w.eval("structure('第一章 函数与极限\\n这里是正文内容测试\\n1.2 数列的极限\\n正文再一行').split('#').length-1"), '个 # 标题');
      const beforeEs = w.eval("MS=[{r:'user',c:'这门课的问题'}]; saveMs(); MS.length");
      const other = w.eval("COURSE='__free'; MS=LS.g(msKey(),[]); MS.length");
      const back = w.eval("COURSE='测试书.md'; MS=LS.g(msKey(),[]); MS.length");
      console.log('会话隔离 本课程/自由/切回', beforeEs, other, back);

      // ---------- 符号面板 ----------
      console.log('\n--- 符号面板 ---');
      console.log('默认展开 tab 数   ', q('#symtabs .symbtn'));
      console.log('默认组按钮数      ', q('#symgrids .symgrid.on .symbtn'));
      const tabs = w.document.querySelectorAll('#symtabs .symbtn');
      tabs[1].click();
      console.log('切希腊字母组      ', q('#symgrids .symgrid.on .symbtn'), '个');
      tabs[2].click();
      console.log('切公式模板组      ', q('#symgrids .symgrid.on .symbtn'), '个');
      const ta = w.document.getElementById('in');
      ta.focus(); ta.value = ''; ta.setSelectionRange(0, 0);
      w.document.querySelectorAll('#symgrids .symgrid.on .symbtn')[0].click();
      console.log('插入分式内容      ', JSON.stringify(ta.value));
      console.log('光标是否落在{}内  ', ta.selectionStart === ta.value.indexOf('{') + 1);
      ta.value = ''; ta.setSelectionRange(0, 0);
      w.document.getElementById('symtoggle').click();
      console.log('折叠后 tabs       ', JSON.stringify(w.document.getElementById('symtabs').style.display));
      w.document.getElementById('symtoggle').click();
      console.log('再展开 tabs       ', JSON.stringify(w.document.getElementById('symtabs').style.display));
      ta.value = 'abc'; ta.setSelectionRange(0, 3);
      ta.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'm', ctrlKey: true, bubbles: true, cancelable: true }));
      console.log('Ctrl+M 包裹选中   ', JSON.stringify(ta.value));
      ta.value = ''; ta.setSelectionRange(0, 0);

      // ---------- 人设 ----------
      console.log('\n--- 人设 ---');
      console.log('可选人设          ', q('#pbox .pill'), '个：', w.eval("pKeys().map(function(k){return getP(k).n}).join(' ')"));
      const pl = w.document.querySelectorAll('#pbox .pill');
      pl[w.eval("pKeys().indexOf('aemeath')")].click();
      console.log('切到爱弥斯        ', w.eval('who'), '| sys 含名:', w.eval("$('sys').value.indexOf('爱弥斯')>=0"), '|', w.document.getElementById('pcur').textContent);
      w.eval("$('mpn').value='测试导师';$('mpp').value='你是测试导师，负责测试。';$('mpk').value='';");
      w.document.getElementById('mpsave').click();
      console.log('新增自定义后      ', q('#pbox .pill'), '个 | 当前:', w.eval('who'), '| 列表:', q('#myplist .chip'));
      const chipX = w.document.querySelector('#myplist .chip b');
      chipX.click();
      console.log('删除自定义后      ', q('#pbox .pill'), '个 | 当前回退:', w.eval('who'));

      // 进度页统计
      w.document.querySelector('[data-v="prog"]').click();
      console.log('\n--- 进度 ---');
      console.log('表格行数        ', q('#ptable tr'), '| 指标卡', q('#statc .statc'));
    } catch (e) { errors.push('运行时: ' + e.message + '\n' + e.stack); }

    console.log('\n--- 错误 ---');
    console.log(errors.length ? errors.join('\n') : '无');
    process.exit(errors.length ? 1 : 0);
  }, 500);
}, 300);
