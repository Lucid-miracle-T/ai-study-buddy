# -*- coding: utf-8 -*-
"""分析 C语言程序设计现代方法.md 的标题结构，判断怎么切分章节。"""
import re, sys, collections

path = sys.argv[1] if len(sys.argv) > 1 else "book/C语言/第1章 C语言概述.md"
src = open(path, encoding="utf-8", errors="replace").read()
lines = src.split("\n")
print("总行数", len(lines), "总字符", len(src))

fence = False
lvl = collections.Counter()
h1 = []          # (# 标题, 行号, 是否在围栏内)
for i, l in enumerate(lines, 1):
    if l.lstrip().startswith("```"):
        fence = not fence
        continue
    m = re.match(r"^(#{1,6})\s+(.+?)\s*$", l)
    if m:
        lvl[len(m.group(1))] += 1
        if len(m.group(1)) == 1 and len(h1) < 400:
            h1.append((m.group(2)[:44], i, fence))

print("各级标题数:", dict(sorted(lvl.items())))

nch = [h for h in h1 if re.match(r"^第\d+章", h[0])]
print("\n『第N章』一级标题数:", len(nch), " 在围栏内:", sum(1 for h in nch if h[2]))
print("前 6 章:", nch[:6])
print("后 4 章:", nch[-4:])

其他 = [h for h in h1 if not re.match(r"^第\d+章", h[0])]
print("\n非『第N章』的一级标题（前 40）:")
for t, ln, f in 其他[:40]:
    print("   ", ln, ("[围栏]" if f else "      "), t)

# 最后一章之后的 ## 二级标题（判断章尾是否混入附录）
last = nch[-1][1] if nch else 0
sub = []
fence = False
for i, l in enumerate(lines, 1):
    if i < last:
        if l.lstrip().startswith("```"):
            fence = not fence
        continue
    if l.lstrip().startswith("```"):
        fence = not fence
        continue
    m = re.match(r"^##\s+(.+?)\s*$", l)
    if m and not fence:
        sub.append((m.group(1)[:44], i))
print("\n末章(第%s章, 从第%d行)内的二级标题数:" % (nch[-1][0][1:3], last), len(sub))
for t, ln in sub[:12]:
    print("   ", ln, t)
