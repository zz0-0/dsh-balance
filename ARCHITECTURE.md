# dsh-balance-plugin · architecture

> DSH web plugin：真实余额 + 峰谷价窗口 + 会话 / 工作区成本估算。`README.md` 是人读入口；这里放不变量、块和账本规则。

## 不变量

- 价格表从官方页面抓，不硬编码；缓存 6 小时。解析失败保留旧缓存，面板标 `缓存/默认`。
- 峰时：北京工作日 **09:00–12:00 / 14:00–18:00**；周末谷时；节假日日历默认不抓，只有 `DSH_BALANCE_HOLIDAYS=1` 才发第三方请求。
- 账本 `~/.dsh/.dsh-balance-costs.json` 只追加：每条记 `lastSeq`、`pricingVersions`、`calendarVersions`；再次扫描只算 `seq > lastSeq`，已记花费不重算。
- 币种：成本同时存 CNY / USD；显示主币种 = API 返回的最大非零余额（CNY 平手优先）；只有 USD 时用 USD 价格表和 `$`。
- `granted` 到期：API 只报未过期总额；面板保留该行（空时 `0`）并链到 Billing。
- API key 只在 host；浏览器永远拿不到。

## 块

| Half | File | Role |
|---|---|---|
| Host | `lib/index.js` | 解析 `DEEPSEEK_API_KEY`、查 `/user/balance`、读会话事件、维护账本、抓价格 / 节假日、提供 `GET /dsh-balance/data` 和 `GET /dsh-balance/client.js` |
| Browser | `client.js` | 注入 DSH 首页：侧栏 footer 的余额 chip、详情面板、会话 / 工作区成本徽章 |

Bundle：`package.json` 的 `dsh.bundle.patch = ./cordis.patch.yml` 把 `dsh-balance` 插进 web profile。

## 缓存

都在 `~/.dsh/`（或 `$DSH_HOME`）：

- `.dsh-balance-costs.json` — 成本账本
- `.dsh-balance-pricing.json` — 当前价格表和峰时
- `.dsh-balance-pricing-history.json` — 每次价格变化的快照
- `.dsh-balance-holidays.json` — 节假日日历（只在 opt-in 时）

## 边界

- 不在浏览器放 key；浏览器只访问本地 DSH server。
- 不重算已记花费；价格变化只影响新事件。
- 没有 `DSH_BALANCE_HOLIDAYS=1` 时不发节假日请求。
- UI 落点是侧栏 footer 里设置上方单独的一行（22px chip / 26px 行高）。footer 的
  action 行已被 Cordis 占用（42px 满宽），所以不挤进那一行；chip 不自己定位浮层，
  行高、位置和 rail 收起都交给 shell 布局，只有详情面板用 fixed 定位。
- 两个读数插件共用同一行：余额在左、服务状态在右，格式都是「状态点 + 标签 + 主值
  （+ 次值）」；余额的次值是倒计时，时段由点的颜色表达（绿=谷价、琥珀=高峰），
  面板摘要行才写出 `谷价` / `高峰` 字样。字体继承侧栏，字号用
  `--dsh-content-font-size-secondary`。
- 左右内边距 7px，让 chip 文字和设置行同一列（20px 起）；列表行因层级缩进更深
  （会话 32px / 工作区名 42px），这是层级本身的效果，footer 不跟随。
- 详情面板的块序固定为：标题 + 更新时间 + 关闭 → 状态摘要（点 + 主值 + 次值）→
  分隔线 → 明细网格（可多段）→ 页脚（官方来源链接在左、动作在右）→ 说明文字。
- 旧 ai 的 `start` / `closeout` 已退休，不引用。
