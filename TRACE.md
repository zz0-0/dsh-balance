# TRACE

## 2026-11-15 · 工作回路 v1 + 分数峰段用例

- 链/步骤：coding → 测试 / closeout
- 有效：PROJECT.md 让入口、闸门、链可查；npm test 5/5；pre-push 仍绿
- 失败：无
- 环境 diff：test/parsing.test.mjs（+1 用例）+ PROJECT.md / AGENTS.md / TRACE.md

## 2026-11-15 · 截断价格表不再抛异常

- 链/步骤：coding → bug-to-check / 测试
- 有效：rows.length 守卫；npm test 6/6；pre-push 仍绿
- 失败：红：e0bd7c5 + 新用例 → `not ok 3`，TypeError: Cannot read properties of undefined (reading 'slice')
- 环境 diff：lib/index.js（+1 守卫）+ test/parsing.test.mjs（+1 用例）
