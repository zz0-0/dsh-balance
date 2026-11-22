# 复审：跨零点峰时窗口

> 为什么需要：记录跨零点峰时窗口这次复审的两轴发现与验证命令，作者能闭环、后来人能复核。
> 消费者：作者（修复）；下一次复审 / 交接。
> 退场：findings 全部闭环后删（git 留历史）。
> 查重：这一次复审的独立记录，无同问题文档。

diff：`git diff HEAD`

## Standards

- [改] lib/index.js:99 — `parsePeakHours` 里把跨零点窗口的终点加 24，保持解析函数纯函数、不做 IO，符合本仓约定；无需再改 — 验证：`node --test test/parsing.test.mjs`
- [问] lib/index.js:182 — `isPeakTime` 现在有三个分支（end>24 / 普通 / 默认），要不要抽一个 `inWindow(hour, range)`？ — 验证：人工看 diff

## Spec

- [check] test/parsing.test.mjs — 跨零点已覆盖，但"终点正好 24:00"没测；下一个真实页面前补一条 — 验证：`node --test test/parsing.test.mjs`

## 作者回复

- 改：待作者。
- 问：待作者。
- check：待作者。

签字：未（未闭环）。