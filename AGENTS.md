# dsh-balance-plugin

> DSH web plugin：真实余额 + 峰谷价窗口 + 会话 / 工作区成本估算。
> 根文档闭集：`AGENTS.md` / `README.md` / `ARCHITECTURE.md`；`DECISIONS: 无`。

## 入口

- 入口命令：`direnv exec . npm test`

## 闸门

- pre-push：`.githooks/pre-push`（新 clone 后 `git config core.hooksPath .githooks`）。

## 指针

- 人读入口：[README.md](README.md)
- 架构：[ARCHITECTURE.md](ARCHITECTURE.md)

## 不要

- 不把 API key 送进浏览器。
- 不重算已经记过的花费（只算 `seq > lastSeq`）。
- 没有 `DSH_BALANCE_HOLIDAYS=1` 时不发第三方请求。
- 不硬编码价格表。
