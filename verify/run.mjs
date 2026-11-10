/**
 * 讲义校验：把「质量」变成能跑的东西。
 *
 * 用法：
 *   node verify/run.mjs            # 全量校验
 *   node verify/run.mjs 第1章       # 只校验某一章
 *
 * 五类检查（对应 docs/讲义体例.md 第五、八节）：
 *   1. KaTeX 真渲染，一个 ParseError 都不许有
 *   2. 禁令词：显然 / 易证 / 同理可得 / 如图可见 / 前面讲过
 *   3. 每节七段齐全、顺序不乱
 *   4. 知识点覆盖：清单里的关键词必须出现在正文
 *   5. 数值例题复算：verify/<章>.json 里每条都重算一遍
 *
 * 退出码：0 全绿；1 有失败项。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

/* KaTeX 装在工具链目录里（站内不放 node_modules）。ESM 不认 NODE_PATH，
   所以用 createRequire 从那个目录解析；也可用 KATEX_DIR 覆盖。 */
const KATEX_DIR = process.env.KATEX_DIR
  || 'C:/Users/35343/.workbuddy/binaries/node/workspace/';
const katex = createRequire(KATEX_DIR)('katex');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BOOK = path.join(ROOT, 'store', '变化与累积-一元微积分');

let bad = 0;
const log = (s) => console.log(s);
const ok = (cond, msg, detail) => {
  if (cond) { log('  ✓ ' + msg); }
  else { bad++; log('  ✗ ' + msg + (detail ? '\n      → ' + detail : '')); }
};

/* ---------- 0. 找到要校验的章 ---------- */
const only = process.argv[2] || '';
const chapters = fs.readdirSync(BOOK)
  .filter(f => f.endsWith('.md') && !f.startsWith('_'))
  .filter(f => !only || f.includes(only))
  .sort();

if (!chapters.length) { log('没找到章节文件'); process.exit(1); }

/* ---------- 每节必须的七段 ---------- */
const SEGS = [
  ['一、要解决什么', /^###\s*一、要解决什么/m],
  ['二、读这一节需要', /^###\s*二、读这一节需要/m],
  ['三、先讲直觉', /^###\s*三、先讲直觉/m],
  ['四、正式定义', /^###\s*四、正式定义/m],
  ['五、例题', /^###\s*五、例题/m],
  ['六、常见错误', /^###\s*六、常见错误/m],
  ['七、自测', /^###\s*七、自测/m],
];

/* ---------- 禁令词 ---------- */
const BANNED = [
  ['显然', /显然/],
  ['易证', /易证/],
  ['同理可得', /同理可得/],
  ['如图可见', /如图可见/],
  ['前面讲过（不指出具体位置）', /前面讲过(?!\s*§)/],
];

/* ---------- 知识点覆盖：每节必须出现的关键词 ---------- */
const COVER = {
  '第一节': [
    '映射', '单射', '满射', '双射', '逆映射', '复合映射', '定义域', '值域',
    '有界性', '单调', '奇偶', '周期', '反函数', '复合函数',
    '幂函数', '指数函数', '对数函数', '反三角', '初等函数', '分段函数',
  ],
  '第二节': [
    'varepsilon', '正整数', '唯一性', '有界', '保号', '子列', '收敛', '发散', '放大', '误差',
  ],
  '第三节': [
    'varepsilon', 'delta', '去心邻域', '左极限', '右极限', '局部有界', '局部保号', '海涅',
  ],
  '第四节': [
    '无穷小', '无穷大', '未定式', '四则运算', '有界函数', '复合函数',
  ],
  '第五节': [
    '夹逼', '单调有界', 'sin', 'e', '弧度', '未定式',
  ],
  '第六节': [
    '高阶', '同阶', '等价', '阶', '替换', '抵消', 'o(',
  ],
  '第七节': [
    '连续', '左连续', '右连续', '间断点', '可去', '跳跃', '无穷间断', '振荡',
    '闭区间', '有界', '最大值', '零点定理', '介值定理', '一致连续',
  ],
};

/* ---------- 1. 逐章校验 ---------- */
for (const file of chapters) {
  const full = path.join(BOOK, file);
  const src = fs.readFileSync(full, 'utf8');
  const cjk = (src.match(/[\u4e00-\u9fa5]/g) || []).length;
  const secs = src.split(/^## /m).slice(1).map(s => '## ' + s);

  log('');
  log('══ ' + file + ' ══');
  log(`  中文字数 ${cjk}，共 ${secs.length} 个二级小节`);

  /* -- 1.1 KaTeX 渲染 -- */
  log('');
  log('【1】公式渲染');
  const inline = src.match(/\$\$[\s\S]+?\$\$/g) || [];
  const single = (src.replace(/\$\$[\s\S]+?\$\$/g, '') .match(/\$[^$\n]+?\$/g) || []);
  let texBad = 0;
  const texErr = [];
  for (const [arr, display] of [[inline, true], [single, false]]) {
    for (const raw of arr) {
      const body = display ? raw.slice(2, -2) : raw.slice(1, -1);
      try { katex.renderToString(body, { displayMode: display, throwOnError: true }); }
      catch (e) { texBad++; if (texErr.length < 6) texErr.push(body.slice(0, 70) + ' → ' + e.message.slice(0, 90)); }
    }
  }
  ok(texBad === 0, `KaTeX 渲染 ${inline.length + single.length} 个公式，全部通过`,
    texErr.join('\n      '));

  /* -- 1.2 禁令词 -- */
  log('');
  log('【2】写法禁令');
  for (const [name, re] of BANNED) {
    const hits = [...src.matchAll(new RegExp(re.source, 'gm'))]
      .map(m => {
        const line = src.slice(0, m.index).split('\n').length;
        const ctx = src.split('\n')[line - 1] || '';
        return `第 ${line} 行：${ctx.trim().slice(0, 60)}`;
      });
    ok(hits.length === 0, `没有「${name}」`, hits.slice(0, 3).join('\n      '));
  }

  /* -- 1.3 七段齐全 -- */
  log('');
  log('【3】每节七段');
  const teaching = secs.filter(s => /^## 第[一二三四五六七八九十]+节/.test(s));
  ok(teaching.length > 0, `找到 ${teaching.length} 节正文`);
  for (const sec of teaching) {
    const title = sec.split('\n')[0].replace(/^## /, '').slice(0, 22);
    const miss = SEGS.filter(([, re]) => !re.test(sec)).map(([n]) => n);
    ok(miss.length === 0, `${title} 七段齐全`, '缺：' + miss.join('、'));

    /* 每节至少 1 例题、2 错误、3 自测 */
    const exn = (sec.match(/^\*\*例 /gm) || []).length;
    const errn = (sec.match(/^\*\*错误 \d/gm) || []).length;
    const detn = (sec.match(/<details>/g) || []).length;
    ok(exn >= 1, `　例题 ${exn} 个（≥1）`);
    ok(errn >= 2, `　错误 ${errn} 条（≥2）`);
    ok(detn >= 3, `　自测折叠答案 ${detn} 个（≥3）`);
  }

  /* -- 1.4 知识点覆盖 -- */
  log('');
  log('【4】知识点覆盖');
  for (const [secKey, words] of Object.entries(COVER)) {
    const sec = teaching.find(s => s.startsWith('## ' + secKey));
    if (!sec) { ok(false, `找不到「${secKey}」`); continue; }
    const miss = words.filter(w => !sec.includes(w));
    ok(miss.length === 0, `${secKey} 覆盖 ${words.length} 个关键词`, '缺：' + miss.join('、'));
  }

  /* -- 1.5 术语表与 details 格式 -- */
  log('');
  log('【5】结构完整性');
  const tables = teaching.map(s => /### 本节术语表/.test(s));
  ok(tables.every(Boolean), '每节都有术语表');
  const badDet = [...src.matchAll(/<details>(?!<summary>)/g)].length;
  ok(badDet === 0, 'details 都带 summary（否则折叠块没有标题）');
  const unbalanced = (src.match(/<details>/g) || []).length !== (src.match(/<\/details>/g) || []).length;
  ok(!unbalanced, 'details 标签成对');
  ok(/^## 章末/m.test(src), '章末「如果只记三件事」存在');

  /* -- 1.6 数值复算 -- */
  log('');
  log('【6】数值例题复算');
  const vf = path.join(ROOT, 'verify', file.replace(/\.md$/, '.json'));
  if (!fs.existsSync(vf)) {
    ok(false, '缺少复算用例文件', path.basename(vf));
  } else {
    const cases = JSON.parse(fs.readFileSync(vf, 'utf8'));
    let pass = 0, fail = [];
    for (const c of cases) {
      let got;
      try { got = Number(new Function('x', 'return ' + c.expr)(c.x)); }
      catch (e) { fail.push(`${c.id} 表达式无法求值：${e.message}`); continue; }
      if (!Number.isFinite(got)) { fail.push(`${c.id} 算得非有限值`); continue; }
      /* le 模式：只验「不大于某个界」（用于放大/缩小方向的检查） */
      if (c.le !== undefined) {
        if (got <= c.le) pass++;
        else fail.push(`${c.id} ${c.desc}\n        x=${c.x} 算得 ${got}，应 ≤ ${c.le}`);
        continue;
      }
      const want = c.want;
      const rel = Math.abs(got - want) / Math.max(1, Math.abs(want));
      if (rel > (c.tol || 1e-6)) {
        fail.push(`${c.id} ${c.desc}\n        x=${c.x} 算得 ${got}，期望 ${want}，相对误差 ${rel.toExponential(2)}`);
      } else pass++;
    }
    ok(fail.length === 0, `${cases.length} 条用例全部复算通过（容差 1e-6）`, fail.slice(0, 4).join('\n      '));
  }
}

log('');
log(bad === 0 ? '═══ 全部通过 ═══' : `═══ ${bad} 项未通过 ═══`);
process.exit(bad === 0 ? 0 : 1);
