/* 一次跑完 tests/ 下的全部测试，按退出码汇总。
 *
 * 为什么需要它：测试没有统一结尾 —— 有的印「全部通过」、有的印「--- 错误 ---」，
 * 所以判成败只能看退出码，不能 grep 输出。挨个手敲几十条命令不现实，
 * 尤其是刚 clone 下来想确认「我这环境跑得起来吗」的时候。
 *
 *   npm test          （= node tests/run_all.js）
 *   node tests/run_all.js
 *
 * 需要先装依赖：npm install
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const dir = __dirname;
const files = fs.readdirSync(dir)
  .filter(f => /^(test_.+|smoke)\.js$/.test(f))
  .sort();

if (!files.length) { console.log('没找到测试文件'); process.exit(1); }

const failed = [];
let pass = 0;
const t0 = Date.now();

console.log('跑 ' + files.length + ' 套测试（每套约 1-3 秒）\n');

for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(dir, f)], { encoding: 'utf8' });
  if (r.status === 0) {
    pass++;
    process.stdout.write('  ✓ ' + f + '\n');
  } else {
    failed.push({ f, out: (r.stdout || '') + (r.stderr || '') });
    process.stdout.write('  ✗ ' + f + '\n');
  }
}

console.log('\n' + pass + '/' + files.length + ' 通过，用时 ' + ((Date.now() - t0) / 1000).toFixed(1) + ' 秒');

if (failed.length) {
  console.log('\n--- 失败的 ' + failed.length + ' 套 ---');
  for (const { f, out } of failed) {
    const tail = out.trim().split('\n').filter(l => l.startsWith('✗') || /错误|失败|Error/.test(l)).slice(0, 6);
    console.log('\n### ' + f);
    console.log(tail.length ? tail.join('\n') : out.trim().split('\n').slice(-8).join('\n'));
  }
  process.exit(1);
}
console.log('全部通过');
