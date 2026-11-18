# TODO

## 未完成

| id | 状态 | 任务 | 指针 | 下一步 | 验收 |
|---|---|---|---|---|---|

## 已完成

### 2026-11-18 · 悬停打开 + 点击固定 + 面板避开状态卡

- 链/步骤：coding → 实现 / 测试
- 有效：卡片 hover 140ms 打开详情面板，移开 180ms 关闭；点击固定 / 收起，hover 打开后点击改为固定，不闪关；指针跨过卡片与面板间 8px 间隙仍保持打开。`positionPanel` 会读 `.dsh-status-card` / `.dsh-status-panel` 的重叠列，把面板抬到整叠卡片上方（实测面板底边与状态卡顶边 gap 8px，footer / 刷新不再被盖）；与 status 面板用 `dsh-dock-panel-open` 互斥。`npm test` 7/7 绿（新增 `node --check client.js`）；Playwright 真机验证 hover / 固定 / 离开 / 面板内移动 / Esc / 外部点击。
- 失败：无；入口 `npm test` 已跑（7/7）
- 环境 diff：`client.js` + `package.json` + `README.md` + `README.zh.md` + `TODO.md`

### 2026-11-15 · 工作回路 v1 + 分数峰段用例

- 链/步骤：coding → 测试 / closeout
- 有效：PROJECT.md 让入口、闸门、链可查；npm test 5/5；pre-push 仍绿
- 失败：无
- 环境 diff：`test/parsing.test.mjs`（+1 用例）+ `PROJECT.md` / `AGENTS.md` / `TODO.md`

### 2026-11-15 · 截断价格表不再抛异常

- 链/步骤：coding → bug-to-check / 测试
- 有效：rows.length 守卫；npm test 6/6；pre-push 仍绿
- 失败：红：e0bd7c5 + 新用例 → `not ok 3`，TypeError: Cannot read properties of undefined (reading 'slice')
- 环境 diff：`lib/index.js`（+1 守卫）+ `test/parsing.test.mjs`（+1 用例）
