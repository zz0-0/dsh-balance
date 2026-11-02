# dsh-balance

A DeepSeek Harness plugin for:

- live DeepSeek account balance
- current peak/off-peak pricing window, next switch time, timezone, and countdown
- estimated cost on every conversation row
- estimated total cost on every project/workspace row
- estimated cost for the current conversation in the composer status line
- optional automatic browser notification when the peak/off-peak window switches
  (only if notification permission was already granted for the dsh site)

![screenshot](./screenshot.png)

## Install

```bash
dsh plugin --profile web add link:/home/zz/Project/dsh/dsh-balance-plugin
systemctl --user restart dsh-web
```

Remove:

```bash
dsh plugin --profile web remove dsh-balance
systemctl --user restart dsh-web
```

## What is dynamic

Nothing price-related is hardcoded as the source of truth. On startup and every
6 hours the host fetches both official DeepSeek pricing pages:

| Currency | Page |
|---|---|
| CNY | `https://api-docs.deepseek.com/zh-cn/quick_start/pricing` |
| USD | `https://api-docs.deepseek.com/quick_start/pricing` |

The parser reads the model pricing table dynamically, including the model
columns, cache-hit/cache-miss/output prices, and the peak-hour windows from the
Chinese page footnote. If a page changes shape and parsing fails, the previous
cache is kept.

The holiday calendar is fetched from:

```
https://api.apihubs.cn/holiday/get?year=YYYY&size=500
```

for the current and next year, and cached for 30 days. Peak is Beijing
weekday 09:00-12:00 and 14:00-18:00; weekends are always off-peak; a
weekday marked as a public holiday is off-peak. A make-up weekend is still a
weekend, so it is off-peak.

Cache files:

- `~/.dsh/.dsh-balance-pricing.json` — current price table
- `~/.dsh/.dsh-balance-pricing-history.json` — one entry per changed price snapshot
- `~/.dsh/.dsh-balance-holidays.json` — current holiday calendar

## The ledger and “do not reprice old spend”

The cost ledger is:

```
~/.dsh/.dsh-balance-costs.json
```

Each session entry stores:

- `costs.CNY` and `costs.USD`
- `tokens`
- `lastSeq` — the last event already recorded
- `pricingVersions` — price snapshots used for its recorded events
- `calendarVersions` — holiday calendars used for its recorded events

When a session is scanned again, only events with `seq > lastSeq` are priced.
Already-recorded events are never recalculated. Changing the DeepSeek price
list or holiday calendar therefore affects only **new** events. A restart or
price refresh cannot rewrite what was already spent.

This was tested by replacing the cached CNY price with an absurd value and
restarting: the recorded Bevy/Vital costs stayed unchanged.

The numbers on badges are estimates from token usage at the price table in
effect when the event was recorded. The floating balance is the real account
balance from `/user/balance`.

## Currency

`/user/balance` can return multiple `balance_infos`. The plugin stores costs in
both CNY and USD, then displays the bucket for the primary account currency:
the **largest non-zero balance** returned by the API (CNY wins a tie). If both
currencies have a positive balance, the card shows both while estimates use the
larger one. A USD-only account uses the USD pricing table and `$` badges.

## UI

- **Main-page card** (fixed to the bottom-right corner of the window, on the
  scrollbar side, independent of the composer's position): balance, current
  window (`高峰`/`谷价`), remaining time, next switch time with the local zone
  abbreviation, plus a refresh button and a chevron. If both CNY and USD
  balances are positive, both are shown stacked. Because it is anchored to the
  window rather than to the text box, it stays at the bottom in the
  no-conversation/hero state too, where the composer is vertically centered.
  Only when the composer actually occupies the bottom-right corner (a wide
  composer on a narrow window) does the card lift just above it.
- **Click to expand**: clicking the card opens an inline detail section in the
  same card (not a hover tooltip and not a dialog) with per-currency
  topped-up/granted breakdown, Beijing/local time, peak hours, next switch,
  price-table source, and the ledger path. The card keeps the same 172 px width
  and the same bottom-right anchor; it only grows upward. Click again to
  collapse. The `⟳` button refreshes. There is no bell/notification button:
  clicking the card never sends a notification.
- **Conversation row**: `≈¥…` estimate from the ledger.
- **Workspace row**: sum of its conversations.
- **Composer status line**: the same per-conversation estimate, next to the
  built-in turns/tokens pills.
- **Notifications**: there is no in-app notification button. If notification
  permission is already granted for the dsh site (browser site settings), the
  browser notifies on peak/off-peak switches while the dsh tab is open. A fully
  closed browser cannot receive these notifications. Clicking the card only
  expands/collapses the detail section and never sends a test notification.
- The sidebar footer (including the original “更多 / More” button) is not
  modified.
- Card and notification language follow the dsh UI language (`<html lang>`):
  Chinese when dsh is `zh-*`, English otherwise. The language is re-read on
  every render, so switching dsh language also switches the plugin text.

## Files

| File | Role |
|---|---|
| `package.json` | DSH bundle metadata |
| `cordis.patch.yml` | Inserts the plugin into the web profile |
| `lib/index.js` | Host: balance, pricing, holidays, ledger, `/dsh-balance/data`, client injection |
| `client.js` | Browser: main-page card, row badges, composer cost, notifications |

## Editing

- `client.js` is served with `Cache-Control: no-store`: edit, then hard-refresh
  the browser.
- `lib/index.js` is host-side: edit, then
  `systemctl --user restart dsh-web`.
- The plugin is installed as a local link; no reinstall is needed after edits.

## UI hooks

The browser side does not patch React. It uses the stable attributes the
workspace sidebar already exposes:

- `[data-row-key="session:<sessionId>"]`
- `[data-row-key="workspace:<workspaceId>"]`
- `[data-composer-card]` to keep the window-anchored card off the composer
  when the composer reaches the bottom-right corner
- `[data-slot="conversation.composer.dock"]` for the per-conversation cost pill
- `[data-composer-stat="activity|usage"]` as style samples

Badges are re-added by a `MutationObserver` if React re-renders a row.
