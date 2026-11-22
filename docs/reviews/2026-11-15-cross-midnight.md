<!--
kind: review
-->

# 复审：跨零点峰时窗口

diff：`git diff HEAD`

## Standards

- [改] lib/index.js:99 — `parsePeakHours` 里把跨零点窗口的终点加 24，保持解析函数纯函数、不做 IO，符合本仓约定；无需再改 — 验证：`node --test test/parsing.test.mjs`
- [问] lib/index.js:182 — `isPeakTime` 现在有三个分支（end>24 / 普通 / 默认），要不要抽一个 `inWindow(hour, range)`？ — 验证：人工看 diff

## Spec

- [check] test/parsing.test.mjs — 跨零点已覆盖，但"终点正好 24:00"没测；下一个真实页面前补一条 — 验证：`node --test test/parsing.test.mjs`
