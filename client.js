(function () {
  if (window.__dshBalanceInstalled) return
  window.__dshBalanceInstalled = true

  // Remove UI left by earlier builds (the sidebar-footer experiment and the
  // old floating card) so a reload restores the original sidebar styling.
  try {
    document.querySelectorAll(
      '#dsh-balance-floating, .dsh-balance-popover:not(.dsh-balance-card), [data-slot="sidebar"] [data-dsh-balance-overview]',
    ).forEach(function (el) { el.remove() })
  } catch (err) {}

  var DATA_URL = '/dsh-balance/data'
  var POLL_MS = 15000
  var state = {
    data: null,
    loading: false,
    error: '',
    lastFetch: 0,
    lastObservedPeak: null,
    lastNotifiedSwitch: null,
    notifyTimer: null,
    expanded: false,
  }

  function isZh() {
    try {
      return /^zh/i.test(document.documentElement.lang || navigator.language || '')
    } catch (err) {
      return false
    }
  }

  function t(zh, en) {
    return isZh() ? zh : en
  }

  var css = document.createElement('style')
  css.textContent = [
    '.dsh-balance-popover{position:fixed;z-index:2147483000;display:flex;flex-direction:column;gap:3px;min-width:252px;max-width:340px;padding:10px 12px;border-radius:12px;font:500 11px/1.45 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;font-variant-numeric:tabular-nums;color:CanvasText;background:color-mix(in srgb,Canvas 95%,transparent);border:1px solid color-mix(in srgb,CanvasText 16%,transparent);box-shadow:0 10px 34px rgba(0,0,0,.2);user-select:none;backdrop-filter:blur(10px)}',
    '.dsh-balance-popover .dsh-balance-head{display:flex;align-items:flex-start;gap:6px}',
    '.dsh-balance-popover .dsh-balance-label{padding-top:3px;font-size:10px;opacity:.58}',
    '.dsh-balance-popover .dsh-balance-amount{display:flex;flex-direction:column;gap:0;font-size:13px;font-weight:650;line-height:1.35}',
    '.dsh-balance-popover .dsh-balance-amount-line{white-space:nowrap}',
    '.dsh-balance-popover .dsh-balance-chevron{margin-left:2px;border:0;background:transparent;color:inherit;opacity:.45;font-size:10px;line-height:1;padding:1px;cursor:pointer}',
    '.dsh-balance-popover .dsh-balance-refresh{margin-left:auto;border:0;background:transparent;color:inherit;opacity:.45;font-size:12px;line-height:1;padding:2px;cursor:pointer}',
    '.dsh-balance-popover .dsh-balance-refresh:hover,.dsh-balance-popover .dsh-balance-chevron:hover{opacity:1}',
    '.dsh-balance-popover .dsh-balance-line{display:flex;align-items:center;gap:6px;font-size:11px}',
    '.dsh-balance-popover .dsh-balance-sub{display:block;font-size:10px;opacity:.62;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.dsh-balance-popover .dsh-balance-window{font-weight:600}',
    '.dsh-balance-popover .dsh-balance-remain{opacity:.72}',
    '.dsh-balance-card{box-sizing:border-box;width:172px;min-width:0;max-width:172px;padding:8px 9px;font-size:10.5px;transition:width .15s ease;max-height:calc(100vh - 180px);overflow:auto}',
    '.dsh-balance-card .dsh-balance-sub{font-size:9.5px}',
    '.dsh-balance-card.expanded{width:172px;max-width:172px}',
    '.dsh-balance-details{display:block;margin-top:0;padding-top:0;border-top:0 solid color-mix(in srgb,CanvasText 12%,transparent);font-size:9px;line-height:1.45;white-space:normal;opacity:0;max-height:0;overflow:hidden;pointer-events:none;transition:max-height .2s ease,opacity .2s ease,margin-top .2s ease,padding-top .2s ease}',
    '.dsh-balance-card.expanded .dsh-balance-details{margin-top:6px;padding-top:6px;border-top:1px solid color-mix(in srgb,CanvasText 12%,transparent);opacity:.82;max-height:240px;overflow-y:auto;pointer-events:auto}',
    '.dsh-balance-detail-row{margin-top:2px;overflow-wrap:anywhere}',
    '.dsh-balance-detail-row b{font-weight:600;opacity:.7;margin-right:4px}',
    '.dsh-balance-detail-balances{margin-top:0}',
    '.dsh-balance-detail-balance{margin-top:1px}',
    '.dsh-balance-dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:#3fb950;flex:0 0 auto;vertical-align:middle}',
    '.dsh-balance-dot.peak{background:#e6a23c}',
    '.dsh-balance-badge{flex:0 0 auto;margin-left:6px;margin-right:2px;padding:1px 6px;border-radius:999px;font:500 10.5px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;font-variant-numeric:tabular-nums;color:color-mix(in srgb,CanvasText 62%,transparent);background:color-mix(in srgb,CanvasText 7%,transparent);pointer-events:none;white-space:nowrap;opacity:.9}',
    '.dsh-balance-badge[data-zero="1"]{opacity:.42}',
    '[data-composer-stat="cost"] ._6yHc5a_label{font-variant-numeric:tabular-nums}',
  ].join('')
  document.head.appendChild(css)

  function symbol(currency) {
    if (currency === 'USD') return '$'
    if (currency === 'CNY') return '¥'
    return currency ? currency + ' ' : ''
  }

  function money(n, currency) {
    var v = Number(n) || 0
    var s = symbol(currency)
    if (v >= 1) return s + v.toFixed(2)
    if (v >= 0.01) return s + v.toFixed(3)
    if (v > 0) return s + v.toFixed(4)
    return s + '0.00'
  }

  function estimated(n, currency) {
    return '≈' + money(n, currency)
  }

  function setText(el, text) {
    if (el && el.textContent !== text) el.textContent = text
  }

  function hourLabel(value) {
    var h = Math.floor(Number(value) || 0)
    var m = Math.round(((Number(value) || 0) - h) * 60)
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0')
  }

  function formatRemaining(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return t('现在', 'now')
    var mins = Math.ceil(ms / 60000)
    if (mins < 60) return t(mins + '分', mins + 'm')
    var h = Math.floor(mins / 60)
    var m = mins % 60
    if (h < 24) return t(h + '小时' + (m ? m + '分' : ''), h + 'h' + (m ? ' ' + m + 'm' : ''))
    var d = Math.floor(h / 24)
    var hh = h % 24
    return t(d + '天' + (hh ? hh + '小时' : ''), d + 'd' + (hh ? ' ' + hh + 'h' : ''))
  }

  function formatRemainingShort(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return t('现在', 'now')
    var mins = Math.ceil(ms / 60000)
    if (mins < 60) return mins + 'm'
    var h = Math.floor(mins / 60)
    var m = mins % 60
    if (h < 24) return h + 'h' + (m ? m + 'm' : '')
    var d = Math.floor(h / 24)
    var hh = h % 24
    return d + 'd' + (hh ? hh + 'h' : '')
  }

  function localZone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || ''
    } catch (err) {
      return ''
    }
  }

  function timeInZone(ms, zone) {
    if (!ms) return '—'
    try {
      return new Intl.DateTimeFormat('en-GB', {
        timeZone: zone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date(ms))
    } catch (err) {
      return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
  }

  function zoneName(ms, zone) {
    try {
      var parts = new Intl.DateTimeFormat('en-NZ', {
        timeZone: zone,
        timeZoneName: 'short',
      }).formatToParts(new Date(ms))
      var found = parts.find(function (p) { return p.type === 'timeZoneName' })
      return found ? found.value : ''
    } catch (err) {
      return ''
    }
  }

  function localTime(ms) {
    return timeInZone(ms, localZone() || undefined)
  }

  var overviewPill = null

  function balanceInfo() {
    var data = state.data
    if (!data || !data.balance || data.balance.ok !== true) {
      return {
        ok: false,
        text: t('余额?', 'Balance?'),
        parts: [],
        balances: [],
        error: (data && data.balance && data.balance.error) || t('余额未加载', 'Balance not loaded'),
      }
    }
    var all = Array.isArray(data.balance.balances) && data.balance.balances.length
      ? data.balance.balances
      : [{ currency: data.balance.currency, total: data.balance.total, granted: data.balance.granted, toppedUp: data.balance.toppedUp }]
    var visible = all.filter(function (b) {
      return Math.abs(Number(b.total) || 0) > 0.000000001 ||
        Math.abs(Number(b.granted) || 0) > 0.000000001 ||
        Math.abs(Number(b.toppedUp) || 0) > 0.000000001
    })
    if (!visible.length) visible = all.slice(0, 1)
    return {
      ok: true,
      text: visible.map(function (b) { return money(b.total, b.currency) }).join(' · '),
      parts: visible.map(function (b) {
        return t(
          money(b.total, b.currency) + '（充值 ' + money(b.toppedUp, b.currency) + ' + 赠金 ' + money(b.granted, b.currency) + '）',
          money(b.total, b.currency) + ' (topped up ' + money(b.toppedUp, b.currency) + ' + granted ' + money(b.granted, b.currency) + ')',
        )
      }),
      balances: visible,
      error: '',
    }
  }

  function peakInfoClient() {
    var data = state.data
    if (!data || !data.peak) return null
    var peak = data.peak
    var nextAt = Number(peak.nextChangeAt) || 0
    var remainMs = nextAt ? nextAt - Date.now() : 0
    var zone = localZone()
    return {
      peak: peak,
      nextAt: nextAt,
      remainMs: remainMs,
      zone: zone,
      windowLabel: peak.isPeak ? t('高峰', 'Peak') : t('谷价', 'Off-peak'),
      shortLabel: peak.isPeak ? t('峰', 'P') : t('谷', 'O'),
      nextLabel: peak.isPeak ? t('转谷价', '→ off-peak') : t('转高峰', '→ peak'),
      beijingNow: timeInZone(Date.now(), 'Asia/Shanghai'),
      beijingNext: timeInZone(nextAt, 'Asia/Shanghai'),
      localNow: localTime(Date.now()),
      localNext: nextAt ? localTime(nextAt) : '',
      hoursText: data.pricing && Array.isArray(data.pricing.peakHours)
        ? data.pricing.peakHours.map(function (range) { return hourLabel(range[0]) + '-' + hourLabel(range[1]) }).join(' / ') + t(' 北京', ' Beijing')
        : '',
    }
  }

  function ensureOverviewPill() {
    if (overviewPill && overviewPill.isConnected) return overviewPill
    var card = document.createElement('div')
    card.className = 'dsh-balance-popover dsh-balance-card'
    card.setAttribute('data-dsh-balance-overview', '1')
    card.setAttribute('role', 'button')
    card.setAttribute('tabindex', '0')
    card.setAttribute('aria-expanded', 'false')
    card.innerHTML = [
      '<div class="dsh-balance-head">',
      '  <span class="dsh-balance-label">' + t('余额', 'Balance') + '</span>',
      '  <span class="dsh-balance-amount"></span>',
      '  <span class="dsh-balance-chevron" aria-hidden="true">▾</span>',
      '  <button class="dsh-balance-refresh" type="button" title="' + t('刷新', 'Refresh') + '">⟳</button>',
      '</div>',
      '<div class="dsh-balance-line">',
      '  <span class="dsh-balance-dot"></span>',
      '  <span class="dsh-balance-window">…</span>',
      '  <span class="dsh-balance-remain"></span>',
      '</div>',
      '<div class="dsh-balance-sub dsh-balance-next"></div>',
      '<div class="dsh-balance-details">',
      '  <div class="dsh-balance-detail-balances"></div>',
      '  <div class="dsh-balance-detail-row dsh-balance-detail-window"></div>',
      '  <div class="dsh-balance-detail-row dsh-balance-detail-hours"></div>',
      '  <div class="dsh-balance-detail-row dsh-balance-detail-next"></div>',
      '  <div class="dsh-balance-detail-row dsh-balance-detail-price"></div>',
      '  <div class="dsh-balance-detail-row dsh-balance-detail-ledger"></div>',
      '</div>',
    ].join('')
    function toggle(event) {
      if (event && event.target && event.target.closest && event.target.closest('button')) return
      state.expanded = !state.expanded
      card.classList.toggle('expanded', state.expanded)
      card.setAttribute('aria-expanded', state.expanded ? 'true' : 'false')
      var chevron = card.querySelector('.dsh-balance-chevron')
      if (chevron) chevron.textContent = state.expanded ? '▴' : '▾'
      positionOverview()
    }
    card.addEventListener('click', toggle)
    card.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        toggle(event)
      }
    })
    card.querySelector('.dsh-balance-refresh').addEventListener('click', function (event) {
      event.stopPropagation()
      fetchData(true)
    })
    document.body.appendChild(card)
    overviewPill = card
    return card
  }

  function positionOverview() {
    var card = overviewPill
    if (!card || !card.isConnected) return
    var input = document.querySelector('[data-composer-input]')
    var composer = input ? input.closest('[data-composer-card]') : null
    if (!composer && input) composer = input
    if (!composer) composer = document.querySelector('[data-composer-card]')
    var rect = composer ? composer.getBoundingClientRect() : null
    if (!rect || rect.width === 0) {
      card.style.left = 'auto'
      card.style.right = '16px'
      card.style.bottom = '16px'
      return
    }
    var width = 172
    var space = window.innerWidth - rect.right - 12
    if (space >= width) {
      // Always anchored at the same bottom-right spot. Expanding only grows
      // the card upward; it never jumps above the composer or changes width.
      card.style.width = width + 'px'
      card.style.left = 'auto'
      card.style.right = '12px'
      card.style.bottom = Math.max(8, window.innerHeight - rect.bottom) + 'px'
    } else {
      card.style.width = width + 'px'
      card.style.left = Math.max(8, rect.right - width) + 'px'
      card.style.right = 'auto'
      card.style.bottom = Math.max(8, window.innerHeight - rect.top + 8) + 'px'
    }
  }

  function updateOverview() {
    var el = ensureOverviewPill()
    var balance = balanceInfo()
    var peak = peakInfoClient()
    setText(el.querySelector('.dsh-balance-label'), t('余额', 'Balance'))

    var amountEl = el.querySelector('.dsh-balance-amount')
    if (amountEl) {
      amountEl.textContent = ''
      if (balance.ok && balance.balances.length) {
        for (const b of balance.balances) {
          var line = document.createElement('span')
          line.className = 'dsh-balance-amount-line'
          line.textContent = money(b.total, b.currency)
          amountEl.appendChild(line)
        }
      } else {
        var fallback = document.createElement('span')
        fallback.className = 'dsh-balance-amount-line'
        fallback.textContent = balance.text
        amountEl.appendChild(fallback)
      }
    }

    var dot = el.querySelector('.dsh-balance-dot')
    var windowEl = el.querySelector('.dsh-balance-window')
    var remain = el.querySelector('.dsh-balance-remain')
    var next = el.querySelector('.dsh-balance-next')
    if (peak) {
      if (dot) dot.className = 'dsh-balance-dot' + (peak.peak.isPeak ? ' peak' : '')
      setText(windowEl, peak.windowLabel)
      setText(remain, peak.nextAt ? t('剩 ', 'left ') + formatRemaining(peak.remainMs) : '')
      setText(next, peak.nextAt
        ? peak.localNext + ' ' + peak.nextLabel + ' · ' + (zoneName(peak.nextAt, peak.zone) || peak.zone)
        : t('下一个切换点未知', 'Next switch unknown'))
    } else {
      if (dot) dot.className = 'dsh-balance-dot'
      setText(windowEl, state.error ? t('连接失败', 'Connection failed') : '…')
      setText(remain, '')
      setText(next, state.error || '')
    }

    // Expanded details are part of the card; no hover-only tooltip and no
    // modal dialog. Clicking the card toggles this section.
    var balancesEl = el.querySelector('.dsh-balance-detail-balances')
    if (balancesEl) {
      balancesEl.textContent = ''
      if (balance.ok && balance.balances.length) {
        for (const b of balance.balances) {
          var row = document.createElement('div')
          row.className = 'dsh-balance-detail-balance'
          row.textContent = t(
            money(b.total, b.currency) + '  充值 ' + money(b.toppedUp, b.currency) + ' + 赠金 ' + money(b.granted, b.currency),
            money(b.total, b.currency) + '  topped up ' + money(b.toppedUp, b.currency) + ' + granted ' + money(b.granted, b.currency),
          )
          balancesEl.appendChild(row)
        }
      } else {
        balancesEl.textContent = balance.error
      }
    }
    if (peak) {
      setText(el.querySelector('.dsh-balance-detail-window'),
        t('时段：', 'Window: ') + peak.windowLabel + ' · ' + t('北京 ', 'Beijing ') + peak.beijingNow +
        ' / ' + t('本地 ', 'local ') + peak.localNow)
      setText(el.querySelector('.dsh-balance-detail-hours'),
        peak.hoursText ? t('高峰：', 'Peak: ') + peak.hoursText : '')
      setText(el.querySelector('.dsh-balance-detail-next'),
        t('下次：', 'Next: ') + (peak.nextAt ? peak.localNext + ' ' + peak.nextLabel +
          ' · ' + (zoneName(peak.nextAt, peak.zone) || peak.zone) + t('（北京 ', ' (Beijing ') + peak.beijingNext + '）' : t('未知', 'unknown')))
      setText(el.querySelector('.dsh-balance-detail-price'),
        t('价格：', 'Price: ') +
          (state.data.pricing && state.data.pricing.source === 'official' ? t('官方', 'official') : t('缓存/默认', 'cache/default')) +
          (state.data.pricing && state.data.pricing.fetchedAt
            ? t(' · ', ' · ') + new Date(state.data.pricing.fetchedAt).toLocaleString(isZh() ? 'zh-CN' : 'en-GB') + t(' 更新', ' updated')
            : ''))
      setText(el.querySelector('.dsh-balance-detail-ledger'), t('账本：', 'Ledger: ') + '~/.dsh/.dsh-balance-costs.json')
    } else {
      setText(el.querySelector('.dsh-balance-detail-window'), state.error || '')
      setText(el.querySelector('.dsh-balance-detail-hours'), '')
      setText(el.querySelector('.dsh-balance-detail-next'), '')
      setText(el.querySelector('.dsh-balance-detail-price'), '')
      setText(el.querySelector('.dsh-balance-detail-ledger'), '')
    }

    var hint = state.expanded ? t('点击收起', 'Click to collapse') : t('点击展开详情', 'Click for details')
    if (el.title !== hint) el.title = hint
    if (el.getAttribute('aria-label') !== hint) el.setAttribute('aria-label', hint)
    el.classList.toggle('expanded', state.expanded)
    el.setAttribute('aria-expanded', state.expanded ? 'true' : 'false')
    var details = el.querySelector('.dsh-balance-details')
    if (details) details.setAttribute('aria-hidden', state.expanded ? 'false' : 'true')
    var chevron = el.querySelector('.dsh-balance-chevron')
    if (chevron) chevron.textContent = state.expanded ? '▴' : '▾'
    positionOverview()
  }

  function scheduleSwitchTimer(peak) {
    if (!peak || !peak.nextChangeAt) return
    if (state.notifyTimer !== null) clearTimeout(state.notifyTimer)
    var delay = peak.nextChangeAt - Date.now() + 1500
    if (delay <= 0 || delay > 2147483000) return
    state.notifyTimer = setTimeout(function () {
      state.notifyTimer = null
      var nextPeak = !peak.isPeak
      state.lastNotifiedSwitch = nextPeak
      notifySwitch(nextPeak)
      fetchData(true)
    }, delay)
  }

  function handlePeakData(peak) {
    if (!peak) return
    // A notification is raised either by the switch timer or by observing a
    // changed window in a fresh payload, never by a repaint of stale data.
    if (state.lastObservedPeak !== null && state.lastObservedPeak !== peak.isPeak) {
      if (state.lastNotifiedSwitch !== peak.isPeak) notifySwitch(peak.isPeak)
    }
    state.lastObservedPeak = peak.isPeak
    state.lastNotifiedSwitch = null
    scheduleSwitchTimer(peak)
  }

  function notifySwitch(isPeak) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return
    try {
      new Notification(t('DeepSeek 时段切换', 'DeepSeek price window'), {
        body: (isPeak ? t('已进入高峰时段', 'Peak pricing started') : t('已进入谷价时段', 'Off-peak pricing started')) +
          ' · ' + localTime(Date.now()) + ' ' + localZone(),
        tag: 'dsh-balance-peak',
      })
    } catch (err) {}
  }

  var badges = new WeakMap()
  function badgeFor(row) {
    var badge = badges.get(row)
    if (badge && badge.isConnected) return badge
    badge = document.createElement('span')
    badge.className = 'dsh-balance-badge'
    badge.setAttribute('data-dsh-balance-badge', '1')
    badges.set(row, badge)
    var time = row.querySelector(':scope > span[class*="time"]')
    var actions = row.querySelector(':scope > span[class*="rowActions"]')
    if (time) {
      row.insertBefore(badge, time)
    } else if (actions) {
      row.insertBefore(badge, actions)
      badge.style.marginLeft = 'auto'
    } else {
      row.appendChild(badge)
    }
    return badge
  }

  function paintRow(row, cost, title, currency) {
    if (cost === null || cost === undefined || !Number.isFinite(Number(cost))) return
    var badge = badgeFor(row)
    var value = Number(cost) || 0
    var text = estimated(value, currency)
    if (badge.textContent !== text) badge.textContent = text
    if (badge.dataset.zero !== (value === 0 ? '1' : '0')) badge.dataset.zero = value === 0 ? '1' : '0'
    if (badge.title !== title) badge.title = title
  }

  var dockState = { pill: null, sessionId: null }
  function ensureDockPill(dock) {
    if (dockState.pill && dockState.pill.isConnected) return dockState.pill
    var sample = dock.querySelector('[data-composer-stat="usage"]') || dock.querySelector('[data-composer-stat]')
    var pill = document.createElement('span')
    pill.setAttribute('data-composer-stat', 'cost')
    if (sample) pill.className = sample.className
    else pill.style.cssText = 'display:inline-flex;align-items:center;margin-left:2px;opacity:.85'
    var button = document.createElement('button')
    button.type = 'button'
    button.setAttribute('aria-label', t('本次对话估算成本', 'Estimated cost of this conversation'))
    if (sample) {
      var sampleButton = sample.querySelector('button')
      if (sampleButton) button.className = sampleButton.className
    } else {
      button.style.cssText = 'display:inline-flex;align-items:center;gap:4px;border:0;background:transparent;color:inherit;font:inherit;padding:0;cursor:default'
    }
    var label = document.createElement('span')
    if (sample) {
      var sampleLabel = sample.querySelector('button > span')
      if (sampleLabel) label.className = sampleLabel.className
    }
    label.textContent = '≈—'
    button.appendChild(label)
    pill.appendChild(button)
    dock.appendChild(pill)
    dockState.pill = pill
    return pill
  }

  function removeDockPill(dock) {
    var pill = dock && dock.querySelector('[data-composer-stat="cost"]')
    if (pill) pill.remove()
    dockState.pill = null
    dockState.sessionId = null
  }

  function paintDock() {
    var dock = document.querySelector('[data-slot="conversation.composer.dock"]')
    if (!dock) return
    var selected = document.querySelector('[data-row-key^="session:"][aria-selected="true"]')
    if (!selected || !state.data) {
      removeDockPill(dock)
      return
    }
    var sid = (selected.getAttribute('data-row-key') || '').slice('session:'.length)
    var entry = state.data.sessions && state.data.sessions[sid]
    if (!entry) {
      removeDockPill(dock)
      return
    }
    var pill = ensureDockPill(dock)
    var currency = state.data.costCurrency || state.data.balance && state.data.balance.currency || 'CNY'
    var text = estimated(entry.cost, currency)
    var label = pill.querySelector('button > span') || pill.querySelector('span')
    if (label && label.textContent !== text) label.textContent = text
    var title = (entry.title || sid) + ' · ' + money(entry.cost, currency) +
      (entry.tokens ? ' · ' + Number(entry.tokens).toLocaleString() + ' tokens' : '') +
      t('（估算，按记录时的价格）', ' (estimate at recorded price)')
    if (pill.title !== title) pill.title = title
    if (pill.getAttribute('aria-label') !== title) pill.setAttribute('aria-label', title)
    dockState.sessionId = sid
  }

  function paint() {
    updateOverview()
    paintDock()
    var data = state.data
    if (!data) return
    var currency = data.costCurrency || data.balance && data.balance.currency || 'CNY'
    var rows = document.querySelectorAll('[data-row-key]')
    for (var i = 0; i < rows.length; i += 1) {
      var row = rows[i]
      var key = row.getAttribute('data-row-key') || ''
      if (key.indexOf('session:') === 0) {
        var sid = key.slice('session:'.length)
        var entry = data.sessions && data.sessions[sid]
        if (!entry) continue
        paintRow(row, entry.cost, (entry.title || sid) + ' · ' + money(entry.cost, currency) +
          (entry.tokens ? ' · ' + Number(entry.tokens).toLocaleString() + ' tokens' : '') +
          t('（估算，已记录）', ' (estimate, recorded)'), currency)
      } else if (key.indexOf('workspace:') === 0) {
        var wid = key.slice('workspace:'.length)
        var ws = null
        for (var j = 0; j < (data.workspaces || []).length; j += 1) {
          if (data.workspaces[j].id === wid) { ws = data.workspaces[j]; break }
        }
        if (!ws) continue
        paintRow(row, ws.cost, (ws.title || ws.path || wid) + ' · ' + money(ws.cost, currency) +
          t(' · ' + ws.sessionCount + ' 个会话（估算，已记录）', ' · ' + ws.sessionCount + ' sessions (estimate, recorded)'), currency)
      }
    }
  }

  var scheduled = false
  function schedulePaint() {
    if (scheduled) return
    scheduled = true
    requestAnimationFrame(function () {
      scheduled = false
      paint()
    })
  }

  function fetchData(force) {
    if (state.loading) return
    state.loading = true
    var url = DATA_URL + (force ? '?force=1' : '')
    fetch(url, { cache: 'no-store' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status)
        return res.json()
      })
      .then(function (data) {
        if (!data || !data.ok) throw new Error((data && data.error) || 'invalid payload')
        state.data = data
        state.error = ''
        state.lastFetch = Date.now()
        handlePeakData(data.peak)
        paint()
      })
      .catch(function (err) {
        state.error = String((err && err.message) || err)
        updateOverview()
      })
      .finally(function () { state.loading = false })
  }

  var observer = new MutationObserver(schedulePaint)
  observer.observe(document.documentElement, { childList: true, subtree: true })
  window.addEventListener('focus', function () { fetchData(false) })
  setInterval(function () { fetchData(false) }, POLL_MS)
  setInterval(paint, 3000)
  paint()
  fetchData(false)
})()
