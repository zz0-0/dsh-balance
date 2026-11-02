(function () {
  if (window.__dshBalanceInstalled) return
  window.__dshBalanceInstalled = true

  // Remove UI left by earlier builds (the sidebar-footer experiment, the old
  // floating card, and the previous inline detail section) so a reload
  // restores the original sidebar styling.
  try {
    document.querySelectorAll(
      '#dsh-balance-floating, .dsh-balance-popover:not(.dsh-balance-card), .dsh-balance-panel, [data-slot="sidebar"] [data-dsh-balance-overview]',
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

  // The card and its panel use the app's own menu-surface tokens, so they
  // follow the theme, radius, elevation and type settings like a native
  // popover instead of looking like a separate widget. Every token has a
  // Canvas fallback so an older/renamed token cannot make the UI disappear.
  var css = document.createElement('style')
  css.textContent = [
    '.dsh-balance-popover{position:fixed;z-index:950;box-sizing:border-box;display:flex;flex-direction:column;gap:2px;width:172px;padding:8px 10px;border-radius:var(--dsw-radius-lg,12px);font-family:var(--dsw-font-family,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif);font-size:12px;line-height:18px;font-weight:400;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary,CanvasText);background:var(--dsw-specific-menu,color-mix(in srgb,Canvas 96%,transparent));--dsw-elevation-stroke-color:var(--dsw-alias-border-l1,color-mix(in srgb,CanvasText 14%,transparent));box-shadow:var(--dsw-elevation-prominent,0 10px 34px rgba(0,0,0,.18));backdrop-filter:var(--dsw-menu-backdrop-filter,blur(10px));user-select:none;cursor:pointer;transition:background .12s ease}',
    '.dsh-balance-popover:hover{--dsw-elevation-stroke-color:var(--dsw-alias-border-l2,color-mix(in srgb,CanvasText 20%,transparent))}',
    '.dsh-balance-popover .dsh-balance-head{display:flex;align-items:flex-start;gap:6px;min-width:0}',
    '.dsh-balance-popover .dsh-balance-label{color:var(--dsw-alias-label-tertiary,CanvasText);font-size:12px;line-height:18px}',
    '.dsh-balance-popover .dsh-balance-amount{display:flex;flex-direction:column;min-width:0;color:var(--dsw-alias-label-primary,CanvasText);font-size:12px;line-height:18px;font-weight:500}',
    '.dsh-balance-popover .dsh-balance-amount-line{white-space:nowrap}',
    '.dsh-balance-popover .dsh-balance-chevron{margin-left:auto;color:var(--dsw-alias-label-tertiary,CanvasText);font-size:10px;line-height:18px;opacity:.7;transition:transform .15s ease}',
    '.dsh-balance-card[aria-expanded="true"] .dsh-balance-chevron{transform:rotate(180deg)}',
    '.dsh-balance-popover .dsh-balance-line{display:flex;align-items:center;gap:5px;min-width:0}',
    '.dsh-balance-popover .dsh-balance-dot{display:inline-block;width:6px;height:6px;flex:0 0 auto;border-radius:50%;background:var(--dsw-alias-state-success-primary,#3fb950);vertical-align:middle}',
    '.dsh-balance-popover .dsh-balance-dot.peak{background:var(--dsw-alias-state-warn-primary,#e6a23c)}',
    '.dsh-balance-popover .dsh-balance-window{color:var(--dsw-alias-label-secondary,CanvasText);font-weight:500;white-space:nowrap}',
    '.dsh-balance-popover .dsh-balance-remain{margin-left:auto;color:var(--dsw-alias-label-tertiary,CanvasText);font-size:11px;line-height:16px;white-space:nowrap}',
    '.dsh-balance-popover .dsh-balance-next{color:var(--dsw-alias-label-caption,var(--dsw-alias-label-tertiary,CanvasText));font-size:11px;line-height:16px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.dsh-balance-panel{position:fixed;z-index:1100;box-sizing:border-box;display:flex;flex-direction:column;width:min(400px,calc(100vw - 24px));max-height:calc(100vh - 24px);overflow:auto;padding:16px;border:0;border-radius:var(--dsw-radius-lg,12px);font-family:var(--dsw-font-family,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif);font-size:12px;line-height:18px;font-weight:400;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary,CanvasText);background:var(--dsw-specific-menu,color-mix(in srgb,Canvas 96%,transparent));--dsw-elevation-stroke-color:var(--dsw-alias-border-l1,color-mix(in srgb,CanvasText 14%,transparent));box-shadow:var(--dsw-elevation-prominent,0 10px 34px rgba(0,0,0,.18));backdrop-filter:var(--dsw-menu-backdrop-filter,blur(10px));text-align:left;white-space:normal;user-select:text}',
    '.dsh-balance-panel[hidden]{display:none}',
    '.dsh-balance-panel-head{display:flex;align-items:flex-start;gap:16px}',
    '.dsh-balance-panel-title{display:inline-flex;align-items:center;gap:6px;min-width:0;color:var(--dsw-alias-label-primary,CanvasText);font-weight:500}',
    '.dsh-balance-panel-title svg{flex:none;width:14px;height:14px}',
    '.dsh-balance-panel-total{margin-left:auto;color:var(--dsw-alias-label-primary,CanvasText);font-weight:500;white-space:nowrap}',
    '.dsh-balance-panel-subhead{display:flex;align-items:center;gap:5px;margin-top:2px;color:var(--dsw-alias-label-tertiary,CanvasText);font-size:11px;line-height:16px}',
    '.dsh-balance-panel-subhead .dsh-balance-remain{margin-left:auto}',
    '.dsh-balance-panel-rule{margin:8px 0 10px;border-top:.5px solid var(--dsw-alias-border-l2,color-mix(in srgb,CanvasText 12%,transparent))}',
    '.dsh-balance-panel-grid{display:grid;grid-template-columns:minmax(76px,auto) minmax(0,1fr);gap:6px 16px;margin:0;padding:0}',
    '.dsh-balance-panel-grid dt,.dsh-balance-panel-grid dd{min-width:0;margin:0;font-size:12px;line-height:18px;font-weight:400}',
    '.dsh-balance-panel-grid dt{color:var(--dsw-alias-label-tertiary,CanvasText);overflow-wrap:anywhere}',
    '.dsh-balance-panel-grid dd{color:var(--dsw-alias-label-secondary,CanvasText);text-align:right;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}',
    '.dsh-balance-panel-grid dd[data-warn="true"]{color:var(--dsw-alias-state-error-primary,#d5484a)}',
    '.dsh-balance-panel-foot{display:flex;align-items:center;gap:8px;margin-top:10px;padding-top:8px;border-top:.5px solid var(--dsw-alias-border-l2,color-mix(in srgb,CanvasText 12%,transparent));color:var(--dsw-alias-label-tertiary,CanvasText);font-size:11px;line-height:16px}',
    '.dsh-balance-panel-refresh{display:inline-flex;align-items:center;justify-content:center;flex:none;width:20px;height:20px;margin-left:auto;padding:0;border:0;border-radius:24px;background:transparent;color:var(--dsw-alias-label-tertiary,CanvasText);font-size:13px;line-height:1;cursor:pointer}',
    '.dsh-balance-panel-refresh:hover{color:var(--dsw-alias-label-secondary,CanvasText);background:var(--dsw-alias-interactive-bg-hover)}',
    '.dsh-balance-panel-refresh[data-spin="true"]{animation:dsh-balance-spin .8s linear infinite}',
    '@keyframes dsh-balance-spin{to{transform:rotate(360deg)}}',
    '.dsh-balance-panel-note{margin:8px 0 0;color:var(--dsw-alias-label-caption,var(--dsw-alias-label-tertiary,CanvasText));font-size:11px;line-height:16px}',
    '.dsh-balance-badge{flex:0 0 auto;margin-left:6px;margin-right:2px;padding:1px 6px;border-radius:var(--dsw-radius-sm,8px);font-family:var(--dsw-font-family,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif);font-size:11px;line-height:16px;font-weight:400;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary,CanvasText);background:var(--dsw-alias-interactive-bg-hover,color-mix(in srgb,CanvasText 7%,transparent));pointer-events:none;white-space:nowrap}',
    '.dsh-balance-badge[data-zero="1"]{opacity:.45}',
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
  var overviewPanel = null
  var panelOpen = false
  var CARD_WIDTH = 172
  var CARD_EDGE = 12
  var CARD_GAP = 8
  var PANEL_GAP = 8
  var PANEL_MARGIN = 12

  function walletIcon() {
    return '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="3.5" width="12" height="9.5" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M2.2 6.4h11.6" fill="none" stroke="currentColor" stroke-width="1.2"/><circle cx="11.2" cy="9.6" r="1" fill="currentColor"/></svg>'
  }

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
    card.setAttribute('aria-haspopup', 'dialog')
    card.setAttribute('aria-expanded', 'false')
    card.innerHTML = [
      '<div class="dsh-balance-head">',
      '  <span class="dsh-balance-label"></span>',
      '  <span class="dsh-balance-amount"></span>',
      '  <span class="dsh-balance-chevron" aria-hidden="true">▾</span>',
      '</div>',
      '<div class="dsh-balance-line">',
      '  <span class="dsh-balance-dot"></span>',
      '  <span class="dsh-balance-window">…</span>',
      '  <span class="dsh-balance-remain"></span>',
      '</div>',
      '<div class="dsh-balance-next"></div>',
    ].join('')
    card.addEventListener('click', function () { setPanelOpen(!panelOpen) })
    card.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        setPanelOpen(!panelOpen)
      }
    })
    document.body.appendChild(card)
    overviewPill = card
    return card
  }

  function ensureOverviewPanel() {
    if (overviewPanel && overviewPanel.isConnected) return overviewPanel
    var panel = document.createElement('div')
    panel.className = 'dsh-balance-panel'
    panel.setAttribute('data-dsh-balance-panel', '1')
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-hidden', 'true')
    panel.hidden = true
    panel.innerHTML = [
      '<div class="dsh-balance-panel-head">',
      '  <span class="dsh-balance-panel-title">' + walletIcon() + '<span class="dsh-balance-panel-title-text"></span></span>',
      '  <span class="dsh-balance-panel-total"></span>',
      '</div>',
      '<div class="dsh-balance-panel-subhead">',
      '  <span class="dsh-balance-dot"></span>',
      '  <span class="dsh-balance-window"></span>',
      '  <span class="dsh-balance-remain"></span>',
      '</div>',
      '<div class="dsh-balance-panel-rule"></div>',
      '<dl class="dsh-balance-panel-grid dsh-balance-panel-balances"></dl>',
      '<div class="dsh-balance-panel-rule"></div>',
      '<dl class="dsh-balance-panel-grid dsh-balance-panel-time"></dl>',
      '<div class="dsh-balance-panel-rule"></div>',
      '<dl class="dsh-balance-panel-grid dsh-balance-panel-meta"></dl>',
      '<div class="dsh-balance-panel-foot">',
      '  <span class="dsh-balance-panel-updated"></span>',
      '  <button class="dsh-balance-panel-refresh" type="button">⟳</button>',
      '</div>',
      '<p class="dsh-balance-panel-note"></p>',
    ].join('')
    panel.__dshRefs = {
      title: panel.querySelector('.dsh-balance-panel-title-text'),
      total: panel.querySelector('.dsh-balance-panel-total'),
      dot: panel.querySelector('.dsh-balance-panel-subhead .dsh-balance-dot'),
      window: panel.querySelector('.dsh-balance-panel-subhead .dsh-balance-window'),
      remain: panel.querySelector('.dsh-balance-panel-subhead .dsh-balance-remain'),
      balances: panel.querySelector('.dsh-balance-panel-balances'),
      time: panel.querySelector('.dsh-balance-panel-time'),
      meta: panel.querySelector('.dsh-balance-panel-meta'),
      updated: panel.querySelector('.dsh-balance-panel-updated'),
      note: panel.querySelector('.dsh-balance-panel-note'),
      refresh: panel.querySelector('.dsh-balance-panel-refresh'),
    }
    panel.__dshRefs.refresh.addEventListener('click', function (event) {
      event.stopPropagation()
      fetchData(true)
    })
    document.body.appendChild(panel)
    overviewPanel = panel
    return panel
  }

  function setPanelOpen(open) {
    var card = ensureOverviewPill()
    var panel = ensureOverviewPanel()
    panelOpen = open
    card.setAttribute('aria-expanded', open ? 'true' : 'false')
    if (!open) {
      panel.hidden = true
      panel.setAttribute('aria-hidden', 'true')
      panel.style.visibility = ''
      return
    }
    panel.hidden = false
    panel.setAttribute('aria-hidden', 'false')
    // Measure and place while invisible so the panel never flashes at 0,0.
    panel.style.visibility = 'hidden'
    updateOverview()
    positionPanel()
    panel.style.visibility = 'visible'
  }

  // The composer card and its status row (built-in stats, the token-saver
  // strip, other plugins' readings) are separate boxes; the row may also be a
  // `display:contents` slot whose own rect is empty. Return the real boxes so
  // the card can stay clear of whichever one reaches the bottom-right corner.
  function composerChromeRects() {
    var rects = []
    var input = document.querySelector('[data-composer-input]')
    var composer = input ? input.closest('[data-composer-card]') : null
    if (!composer && input) composer = input
    if (!composer) composer = document.querySelector('[data-composer-card]')
    if (composer) {
      var composerRect = composer.getBoundingClientRect()
      if (composerRect.width > 0) rects.push(composerRect)
    }
    var dock = document.querySelector('[data-slot="conversation.composer.dock"]')
    if (dock) {
      var dockRect = dock.getBoundingClientRect()
      if (dockRect.width > 0) rects.push(dockRect)
      for (var i = 0; i < dock.children.length; i += 1) {
        var childRect = dock.children[i].getBoundingClientRect()
        if (childRect.width > 0) rects.push(childRect)
      }
    }
    return rects
  }

  function positionOverview() {
    var card = overviewPill
    if (!card || !card.isConnected) return
    card.style.width = CARD_WIDTH + 'px'

    // The card is a window-level status box, not part of the composer: it
    // hugs the bottom-right corner of the viewport. It only moves when the
    // composer or its per-conversation status row actually occupies that
    // corner — then it sits just above the whole chrome strip, so it never
    // covers another plugin's reading. In the hero state the composer is
    // vertically centered, so the card stays at the bottom of the window
    // instead of following the input.
    var right = CARD_EDGE
    var bottom = CARD_EDGE
    var cardLeft = window.innerWidth - right - CARD_WIDTH
    var cardRight = window.innerWidth - right
    var cardHeight = card.offsetHeight || 0

    var rects = composerChromeRects()
    for (var i = 0; i < rects.length; i += 1) {
      var rect = rects[i]
      var cardTop = window.innerHeight - bottom - cardHeight
      var overlapsHorizontally = rect.right + CARD_GAP > cardLeft && rect.left - CARD_GAP < cardRight
      var overlapsVertically = rect.bottom + CARD_GAP > cardTop && rect.top - CARD_GAP < window.innerHeight - bottom
      if (overlapsHorizontally && overlapsVertically) {
        bottom = Math.max(bottom, window.innerHeight - rect.top + CARD_GAP)
      }
    }

    card.style.left = 'auto'
    card.style.right = right + 'px'
    card.style.bottom = bottom + 'px'
  }

  function positionPanel() {
    var card = overviewPill
    var panel = overviewPanel
    if (!card || !panel || panel.hidden || !panel.isConnected) return
    var anchor = card.getBoundingClientRect()
    var width = panel.offsetWidth
    var height = panel.offsetHeight
    var vw = window.innerWidth
    var vh = window.innerHeight
    // Right edges line up with the card, then clamp to the viewport so the
    // panel never leaves the screen when the card was lifted off the corner.
    var left = Math.min(
      Math.max(PANEL_MARGIN, anchor.right - width),
      Math.max(PANEL_MARGIN, vw - width - PANEL_MARGIN),
    )
    var top = anchor.top - height - PANEL_GAP
    if (top < PANEL_MARGIN) top = Math.min(anchor.bottom + PANEL_GAP, vh - height - PANEL_MARGIN)
    panel.style.left = Math.round(left) + 'px'
    panel.style.top = Math.round(Math.max(PANEL_MARGIN, top)) + 'px'
  }

  function fillGrid(el, rows) {
    if (!el) return
    var sig = JSON.stringify(rows)
    if (el.__dshBalanceSig === sig) return
    el.__dshBalanceSig = sig
    el.textContent = ''
    for (var i = 0; i < rows.length; i += 1) {
      var dt = document.createElement('dt')
      dt.textContent = rows[i][0]
      var dd = document.createElement('dd')
      dd.textContent = rows[i][1]
      if (rows[i][2] === 'warn') dd.setAttribute('data-warn', 'true')
      el.appendChild(dt)
      el.appendChild(dd)
    }
  }

  function updatePanel(balance, peak) {
    var panel = ensureOverviewPanel()
    var r = panel.__dshRefs
    setText(r.title, t('余额', 'Balance'))
    setText(r.total, balance.ok ? balance.text : '—')

    if (peak) {
      r.dot.className = 'dsh-balance-dot' + (peak.peak.isPeak ? ' peak' : '')
      setText(r.window, peak.windowLabel)
      setText(r.remain, peak.nextAt ? t('剩 ', 'left ') + formatRemaining(peak.remainMs) : '')
    } else {
      r.dot.className = 'dsh-balance-dot'
      setText(r.window, state.error ? t('连接失败', 'Connection failed') : '…')
      setText(r.remain, '')
    }

    var balanceRows = []
    if (balance.ok && balance.balances.length) {
      var multi = balance.balances.length > 1
      for (var i = 0; i < balance.balances.length; i += 1) {
        var b = balance.balances[i]
        var suffix = multi ? ' · ' + b.currency : ''
        balanceRows.push([t('账户余额', 'Account balance') + suffix, money(b.total, b.currency)])
        balanceRows.push([t('充值余额', 'Topped up') + suffix, money(b.toppedUp, b.currency)])
        balanceRows.push([t('赠送余额', 'Granted') + suffix, money(b.granted, b.currency)])
      }
    } else {
      balanceRows.push([t('账户余额', 'Account balance'), balance.error || t('不可用', 'Unavailable'), 'warn'])
    }
    fillGrid(r.balances, balanceRows)

    var timeRows = []
    if (peak) {
      timeRows.push([t('下次切换', 'Next switch'), peak.nextAt
        ? peak.localNext + ' ' + peak.nextLabel + ' · ' + (zoneName(peak.nextAt, peak.zone) || peak.zone)
        : t('未知', 'Unknown')])
      timeRows.push([t('北京切换', 'Beijing switch'), peak.nextAt ? peak.beijingNext + ' ' + peak.nextLabel : '—'])
      timeRows.push([t('当前时间', 'Now'), t('本地 ', 'local ') + peak.localNow + ' · ' + t('北京 ', 'Beijing ') + peak.beijingNow])
      timeRows.push([t('高峰时段', 'Peak hours'), peak.hoursText || '—'])
    } else if (state.error) {
      timeRows.push([t('状态', 'Status'), state.error, 'warn'])
    }
    fillGrid(r.time, timeRows)

    var pricing = state.data && state.data.pricing
    var sourceText = pricing
      ? (pricing.source === 'official' ? t('官方', 'official') : t('缓存/默认', 'cache/default'))
      : '—'
    if (pricing && pricing.fetchedAt) sourceText += ' · ' + localTime(pricing.fetchedAt)
    fillGrid(r.meta, [
      [t('价格来源', 'Price source'), sourceText],
      [t('账本', 'Ledger'), '~/.dsh/.dsh-balance-costs.json'],
    ])

    var balanceMs = state.data && state.data.balance && state.data.balance.fetchedAt
    setText(r.updated, balanceMs
      ? t('更新于 ', 'Updated ') + localTime(balanceMs)
      : (state.error ? t('更新失败', 'Update failed') : t('尚未更新', 'Not updated yet')))
    setText(r.note, t(
      '余额来自 DeepSeek 账户接口；价格与时段每 6 小时从官方定价页刷新。',
      'Balance from the DeepSeek account API; pricing and windows refresh from the official page every 6 hours.',
    ))
    var hint = t('刷新余额与时段', 'Refresh balance and window')
    if (r.refresh.title !== hint) r.refresh.title = hint
    if (r.refresh.getAttribute('aria-label') !== hint) r.refresh.setAttribute('aria-label', hint)
    r.refresh.setAttribute('data-spin', state.loading ? 'true' : 'false')
    var panelLabel = t('余额详情', 'Balance details')
    if (panel.getAttribute('aria-label') !== panelLabel) panel.setAttribute('aria-label', panelLabel)
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
        for (var i = 0; i < balance.balances.length; i += 1) {
          var line = document.createElement('span')
          line.className = 'dsh-balance-amount-line'
          line.textContent = money(balance.balances[i].total, balance.balances[i].currency)
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

    updatePanel(balance, peak)

    var hint = t('点击查看余额详情', 'Click for balance details')
    if (el.title !== hint) el.title = hint
    if (el.getAttribute('aria-label') !== hint) el.setAttribute('aria-label', hint)
    el.setAttribute('aria-expanded', panelOpen ? 'true' : 'false')
    positionOverview()
    if (panelOpen) positionPanel()
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

  function paint() {
    updateOverview()
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
    var refreshButton = overviewPanel && overviewPanel.__dshRefs && overviewPanel.__dshRefs.refresh
    if (refreshButton) refreshButton.setAttribute('data-spin', 'true')
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
      .finally(function () {
        state.loading = false
        if (refreshButton) refreshButton.setAttribute('data-spin', 'false')
      })
  }

  document.addEventListener('pointerdown', function (event) {
    if (!panelOpen) return
    var panel = overviewPanel
    var card = overviewPill
    if (!panel || !card) return
    if (panel.contains(event.target) || card.contains(event.target)) return
    setPanelOpen(false)
  }, true)
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape' || !panelOpen) return
    setPanelOpen(false)
    if (overviewPill) overviewPill.focus()
  })

  var observer = new MutationObserver(schedulePaint)
  observer.observe(document.documentElement, { childList: true, subtree: true })
  window.addEventListener('focus', function () { fetchData(false) })
  window.addEventListener('resize', function () {
    positionOverview()
    if (panelOpen) positionPanel()
  })
  setInterval(function () { fetchData(false) }, POLL_MS)
  setInterval(paint, 3000)
  paint()
  fetchData(false)
})()
