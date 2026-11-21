(function () {
  if (window.__dshBalanceInstalled) return
  window.__dshBalanceInstalled = true

  // Remove UI left by earlier builds (the sidebar-footer experiment, the old
  // floating card, the previous inline detail section, and the footer chip) so
  // a reload restores the original sidebar styling.
  try {
    document.querySelectorAll(
      '#dsh-balance-floating, .dsh-balance-popover, .dsh-balance-panel, .dsh-balance-chip, [data-slot="sidebar"] [data-dsh-balance-overview]',
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
    // The overview is one text chip on its own 26px line in the sidebar footer,
    // directly above the Settings trigger. The footer's action row already has
    // the stock Cordis occupant (a 42px full-width flex item), so a second flex
    // child there would be squeezed to nothing; this line is a sibling of that
    // row inside the footer column instead. Nothing floats over the transcript
    // or the right-hand file panel, and `[data-sidebar-collapsed]` drops the
    // whole line in the 56px rail.
    // The chips share the footer's own column, not the list's indented text
// column: the Settings trigger's content starts at sidebar inline 8 + paint
// inset 3 + its padding 9 = 20px, and ends 12px from the right edge. The chip
// adds its own 5px inline padding, so the row pads 7px on each side. List rows
// sit deeper than this by their own nesting indent.
    '.dsh-footer-status-row{display:flex;flex:none;align-items:center;gap:8px;box-sizing:border-box;width:100%;min-width:0;overflow:hidden;height:26px;padding:0 7px}',
    '[data-sidebar-collapsed] .dsh-footer-status-row{display:none}',
    // Type follows the sidebar: the family is inherited (the button opts back
    // in), and the size rides the theme's secondary content size so it tracks
    // the user's font-size setting instead of pinning 11px.
    '.dsh-balance-chip{display:inline-flex;align-items:center;gap:5px;max-width:100%;min-width:0;overflow:hidden;flex:0 1 auto;height:22px;padding:0 5px;border:0;border-radius:var(--dsw-radius-sm,6px);background:transparent;font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:22px;font-weight:400;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary,CanvasText);white-space:nowrap;cursor:pointer;transition:background .12s ease}',
    '@media (hover:hover){.dsh-balance-chip:hover{background:var(--dsw-alias-interactive-bg-hover,color-mix(in srgb,CanvasText 7%,transparent))}}',
    '.dsh-balance-chip[aria-expanded="true"]{background:var(--dsw-alias-interactive-bg-hover,color-mix(in srgb,CanvasText 7%,transparent))}',
    '.dsh-balance-chip-label{color:var(--dsw-alias-label-tertiary,CanvasText)}',
    '.dsh-balance-chip .dsh-balance-remain::before{content:"·";margin-right:4px;opacity:.55}',
    '.dsh-balance-chip .dsh-balance-remain{min-width:0;overflow:hidden;text-overflow:ellipsis}',
    '.dsh-balance-chip-amount{color:var(--dsw-alias-label-primary,CanvasText);font-weight:500;white-space:nowrap}',
    '.dsh-balance-dot{display:inline-block;width:6px;height:6px;flex:0 0 auto;border-radius:50%;background:var(--dsw-alias-state-success-primary,#3fb950);vertical-align:middle}',
    '.dsh-balance-dot.peak{background:var(--dsw-alias-state-warn-primary,#e6a23c)}',
    '.dsh-balance-dot.unknown{background:currentColor;opacity:.35}',
    '.dsh-balance-window{color:var(--dsw-alias-label-secondary,CanvasText);font-weight:500;white-space:nowrap}',
    '.dsh-balance-remain{color:var(--dsw-alias-label-caption,var(--dsw-alias-label-tertiary,CanvasText));white-space:nowrap}',
    '.dsh-balance-panel{position:fixed;z-index:950;box-sizing:border-box;display:flex;flex-direction:column;width:min(400px,calc(100vw - 24px));max-height:calc(100vh - 24px);overflow:auto;padding:16px;border:0;border-radius:var(--dsw-radius-lg,12px);font-size:12px;line-height:18px;font-weight:400;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary,CanvasText);background:var(--dsw-specific-menu,color-mix(in srgb,Canvas 96%,transparent));--dsw-elevation-stroke-color:var(--dsw-alias-border-l1,color-mix(in srgb,CanvasText 14%,transparent));box-shadow:var(--dsw-elevation-prominent,0 10px 34px rgba(0,0,0,.18));backdrop-filter:var(--dsw-menu-backdrop-filter,blur(10px));text-align:left;white-space:normal;user-select:text}',
    '.dsh-balance-panel[hidden]{display:none}',
    '.dsh-balance-panel:focus{outline:none}',
    '.dsh-balance-panel-head{display:flex;align-items:flex-start;gap:8px}',
    '.dsh-balance-panel-title{display:inline-flex;align-items:center;gap:6px;flex:1;min-width:0;color:var(--dsw-alias-label-primary,CanvasText);font-weight:500}',
    '.dsh-balance-panel-title svg{flex:none;width:14px;height:14px}',
    '.dsh-balance-panel-updated{flex:none;color:var(--dsw-alias-label-tertiary,CanvasText);font-size:11px;line-height:16px;white-space:nowrap}',
    '.dsh-balance-panel-close{flex:none;margin-left:2px;border:0;background:transparent;color:var(--dsw-alias-label-tertiary,CanvasText);font-size:14px;line-height:1;padding:1px;cursor:pointer}',
    '.dsh-balance-panel-close:hover{color:var(--dsw-alias-label-secondary,CanvasText)}',
    '.dsh-balance-panel-summary{display:flex;align-items:center;gap:6px;margin-top:4px;color:var(--dsw-alias-label-tertiary,CanvasText)}',
    '.dsh-balance-panel-summary .dsh-balance-panel-total{color:var(--dsw-alias-label-primary,CanvasText);font-weight:500;white-space:nowrap}',
    '.dsh-balance-panel-summary .dsh-balance-remain{margin-left:auto}',
    '.dsh-balance-panel-rule{margin:8px 0 10px;border-top:.5px solid var(--dsw-alias-border-l2,color-mix(in srgb,CanvasText 12%,transparent))}',
    '.dsh-balance-panel-grid{display:grid;grid-template-columns:minmax(76px,auto) minmax(0,1fr);gap:6px 16px;margin:0;padding:0}',
    '.dsh-balance-panel-grid dt,.dsh-balance-panel-grid dd{min-width:0;margin:0;font-size:12px;line-height:18px;font-weight:400}',
    '.dsh-balance-panel-grid dt{color:var(--dsw-alias-label-tertiary,CanvasText);overflow-wrap:anywhere}',
    '.dsh-balance-panel-grid dd{color:var(--dsw-alias-label-secondary,CanvasText);text-align:right;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}',
    '.dsh-balance-panel-grid dd[data-warn="true"]{color:var(--dsw-alias-state-error-primary,#d5484a)}',
    '.dsh-balance-panel-grid dd a{color:var(--dsw-alias-link,CanvasText);text-decoration:none;white-space:nowrap}',
    '.dsh-balance-panel-grid dd a:hover{text-decoration:underline dotted var(--dsw-alias-link,CanvasText);text-underline-offset:2px}',
    '.dsh-balance-panel-foot{display:flex;align-items:center;gap:8px;margin-top:10px;padding-top:8px;border-top:.5px solid var(--dsw-alias-border-l2,color-mix(in srgb,CanvasText 12%,transparent));color:var(--dsw-alias-label-tertiary,CanvasText);font-size:11px;line-height:16px}',
    '.dsh-balance-panel-link{color:var(--dsw-alias-link,CanvasText);text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.dsh-balance-panel-link:hover{text-decoration:underline dotted;text-underline-offset:2px}',
    '.dsh-balance-panel-refresh{display:inline-flex;align-items:center;justify-content:center;flex:none;width:20px;height:20px;margin-left:auto;padding:0;border:0;border-radius:24px;background:transparent;color:var(--dsw-alias-label-tertiary,CanvasText);font-size:13px;line-height:1;cursor:pointer}',
    '.dsh-balance-panel-refresh:hover{color:var(--dsw-alias-label-secondary,CanvasText);background:var(--dsw-alias-interactive-bg-hover)}',
    '.dsh-balance-panel-refresh[data-spin="true"]{animation:dsh-balance-spin .8s linear infinite}',
    '@keyframes dsh-balance-spin{to{transform:rotate(360deg)}}',
    '.dsh-balance-panel-note{margin:8px 0 0;color:var(--dsw-alias-label-caption,var(--dsw-alias-label-tertiary,CanvasText));font-size:11px;line-height:16px}',
    '.dsh-balance-badge{flex:0 0 auto;margin-left:6px;margin-right:2px;padding:1px 6px;border-radius:var(--dsw-radius-sm,8px);font-size:11px;line-height:16px;font-weight:400;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary,CanvasText);background:var(--dsw-alias-interactive-bg-hover,color-mix(in srgb,CanvasText 7%,transparent));pointer-events:none;white-space:nowrap}',
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

  // The chip is one 22px line, so it uses a compact countdown ("5h59m"); the
  // panel keeps the localized long form.
  function formatCompactRemaining(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return ''
    var mins = Math.ceil(ms / 60000)
    if (mins < 60) return mins + 'm'
    var h = Math.floor(mins / 60)
    var m = mins % 60
    if (h < 24) return h + 'h' + (m ? m + 'm' : '')
    var d = Math.floor(h / 24)
    var hh = h % 24
    return d + 'd' + (hh ? hh + 'h' : '')
  }

  function localTime(ms) {
    return timeInZone(ms, localZone() || undefined)
  }

  var overviewChip = null
  var overviewPanel = null
  var panelOpen = false
  var panelPinned = false
  var hoverOpenTimer = 0
  var hoverCloseTimer = 0
  var PANEL_GAP = 8
  var PANEL_MARGIN = 12
  // Longer than the old card's 140ms: the footer chip is on the path to
  // Settings, and a passing pointer should not pop the detail panel.
  var HOVER_OPEN_MS = 400
  var HOVER_CLOSE_MS = 180
  var PANEL_EVENT = 'dsh-dock-panel-open'
  // The foot link points at the same official pricing page the host fetched
  // its table from (CNY and USD have separate pages).
  var PRICING_CNY_URL = 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing'
  var PRICING_USD_URL = 'https://api-docs.deepseek.com/quick_start/pricing'

  function canHover() {
    try {
      return window.matchMedia('(hover: hover)').matches
    } catch (err) {
      return true
    }
  }

  function clearHoverTimers() {
    if (hoverOpenTimer) clearTimeout(hoverOpenTimer)
    if (hoverCloseTimer) clearTimeout(hoverCloseTimer)
    hoverOpenTimer = 0
    hoverCloseTimer = 0
  }

  function announcePanelOpen() {
    try {
      window.dispatchEvent(new CustomEvent(PANEL_EVENT, { detail: { id: 'dsh-balance' } }))
    } catch (err) {}
  }

  /**
   * Hover opens the panel, click pins it. The delay covers the 8px gap
   * between the card and the panel, so moving the pointer from one to the
   * other does not close it. A pinned panel ignores pointerleave; a hovered
   * one closes after the pointer has been away for a moment.
   */
  function scheduleHoverOpen() {
    if (!canHover()) return
    clearHoverTimers()
    if (panelOpen) return
    hoverOpenTimer = setTimeout(function () {
      hoverOpenTimer = 0
      // A pointer that only passed over the chip must not open the panel after
      // it has left; without this check the pending open survives pointerleave.
      if (panelOpen || !overviewChip || !overviewChip.matches(':hover')) return
      panelPinned = false
      setPanelOpen(true)
    }, HOVER_OPEN_MS)
  }

  function scheduleHoverClose() {
    if (!canHover()) return
    // Always cancel a pending open: the footer chip sits on the way to
    // Settings, so a pass-through is the common case, not the exception.
    if (hoverOpenTimer) {
      clearTimeout(hoverOpenTimer)
      hoverOpenTimer = 0
    }
    if (!panelOpen || panelPinned) return
    if (hoverCloseTimer) clearTimeout(hoverCloseTimer)
    hoverCloseTimer = setTimeout(function () {
      hoverCloseTimer = 0
      if (panelOpen && !panelPinned) setPanelOpen(false)
    }, HOVER_CLOSE_MS)
  }

  function cancelHoverClose() {
    clearHoverTimers()
  }

  function togglePinned() {
    clearHoverTimers()
    if (panelOpen) {
      if (panelPinned) {
        setPanelOpen(false)
        return
      }
      // A hover-opened panel turns into a pinned one on click instead of
      // closing under the pointer that just arrived.
      panelPinned = true
      updateOverview()
      return
    }
    panelPinned = true
    setPanelOpen(true)
    // A click or keyboard activation moves into the dialog; hover-open does not
    // steal focus.
    if (overviewPanel) {
      try { overviewPanel.focus({ preventScroll: true }) } catch (err) {}
    }
  }

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

  // The footer column ends with the action row and then the Settings trigger.
  // This plugin inserts one full-width line between them, found from the
  // Settings slot anchor so no generated class name is involved. When the
  // sidebar remounts (mobile drawer, frame rebuild) the line goes with it, and
  // the paint loop re-creates the chip.
  function footerRow() {
    var settings = document.querySelector('[data-slot="sidebar.settings"]')
    var settingsArea = settings ? settings.parentElement : null
    var foot = settingsArea ? settingsArea.parentElement : null
    if (!foot) return null
    var row = foot.querySelector('[data-dsh-footer-status-row]')
    if (row) return row
    row = document.createElement('div')
    row.className = 'dsh-footer-status-row'
    row.setAttribute('data-dsh-footer-status-row', '1')
    foot.insertBefore(row, settingsArea)
    return row
  }

  function ensureOverviewChip() {
    if (overviewChip && overviewChip.isConnected) return overviewChip
    var row = footerRow()
    if (!row) return null
    var chip = document.createElement('button')
    chip.type = 'button'
    chip.className = 'dsh-balance-chip'
    chip.setAttribute('data-dsh-balance-overview', '1')
    chip.setAttribute('aria-haspopup', 'dialog')
    chip.setAttribute('aria-controls', 'dsh-balance-panel')
    chip.setAttribute('aria-expanded', 'false')
    chip.innerHTML = [
      '<span class="dsh-balance-dot"></span>',
      '<span class="dsh-balance-chip-label"></span>',
      '<span class="dsh-balance-chip-amount"></span>',
      '<span class="dsh-balance-remain"></span>',
    ].join('')
    // A <button> turns Enter/Space into a click itself; adding keydown here
    // would toggle twice.
    chip.addEventListener('click', function () { togglePinned() })
    // The chip sits on the way to Settings, so hover waits longer than the old
    // floating card did; a pointer passing through never opens a 400px panel.
    if (canHover()) {
      chip.addEventListener('pointerenter', scheduleHoverOpen)
      chip.addEventListener('pointerleave', scheduleHoverClose)
    }
    // Prepend so the balance reading stays left of another plugin's chip
    // (the status chip right-aligns itself with an auto margin).
    row.insertBefore(chip, row.firstChild)
    overviewChip = chip
    return chip
  }

  function ensureOverviewPanel() {
    if (overviewPanel && overviewPanel.isConnected) return overviewPanel
    var panel = document.createElement('div')
    panel.className = 'dsh-balance-panel'
    panel.setAttribute('id', 'dsh-balance-panel')
    panel.setAttribute('tabindex', '-1')
    panel.setAttribute('data-dsh-balance-panel', '1')
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-hidden', 'true')
    panel.hidden = true
    panel.innerHTML = [
      '<div class="dsh-balance-panel-head">',
      '  <span class="dsh-balance-panel-title">' + walletIcon() + '<span class="dsh-balance-panel-title-text"></span></span>',
      '  <span class="dsh-balance-panel-updated"></span>',
      '  <button class="dsh-balance-panel-close" type="button">×</button>',
      '</div>',
      '<div class="dsh-balance-panel-summary">',
      '  <span class="dsh-balance-dot"></span>',
      '  <span class="dsh-balance-panel-total"></span>',
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
      '  <a class="dsh-balance-panel-link" target="_blank" rel="noreferrer noopener"></a>',
      '  <button class="dsh-balance-panel-refresh" type="button">⟳</button>',
      '</div>',
      '<p class="dsh-balance-panel-note"></p>',
    ].join('')
    panel.__dshRefs = {
      title: panel.querySelector('.dsh-balance-panel-title-text'),
      total: panel.querySelector('.dsh-balance-panel-total'),
      dot: panel.querySelector('.dsh-balance-panel-summary .dsh-balance-dot'),
      window: panel.querySelector('.dsh-balance-panel-summary .dsh-balance-window'),
      remain: panel.querySelector('.dsh-balance-panel-summary .dsh-balance-remain'),
      balances: panel.querySelector('.dsh-balance-panel-balances'),
      time: panel.querySelector('.dsh-balance-panel-time'),
      meta: panel.querySelector('.dsh-balance-panel-meta'),
      updated: panel.querySelector('.dsh-balance-panel-updated'),
      close: panel.querySelector('.dsh-balance-panel-close'),
      link: panel.querySelector('.dsh-balance-panel-link'),
      note: panel.querySelector('.dsh-balance-panel-note'),
      refresh: panel.querySelector('.dsh-balance-panel-refresh'),
    }
    panel.__dshRefs.refresh.addEventListener('click', function (event) {
      event.stopPropagation()
      fetchData(true)
    })
    panel.__dshRefs.close.addEventListener('click', function (event) {
      event.stopPropagation()
      setPanelOpen(false)
      if (overviewChip && overviewChip.isConnected) overviewChip.focus()
    })
    if (canHover()) {
      panel.addEventListener('pointerenter', cancelHoverClose)
      panel.addEventListener('pointerleave', scheduleHoverClose)
    }
    document.body.appendChild(panel)
    overviewPanel = panel
    return panel
  }

  function setPanelOpen(open) {
    var chip = ensureOverviewChip()
    var panel = ensureOverviewPanel()
    clearHoverTimers()
    if (!chip) {
      // Without the sidebar footer (rail, drawer closed) there is nothing to
      // anchor to, so the panel stays closed.
      panelOpen = false
      panelPinned = false
      panel.hidden = true
      return
    }
    panelOpen = open
    chip.setAttribute('aria-expanded', open ? 'true' : 'false')
    if (!open) {
      // A panel that owned focus hands it back to the chip instead of letting
      // the focus vanish with the hidden dialog.
      var hadFocus = panel.contains(document.activeElement)
      panelPinned = false
      panel.hidden = true
      panel.setAttribute('aria-hidden', 'true')
      panel.style.visibility = ''
      if (hadFocus && overviewChip && overviewChip.isConnected) overviewChip.focus()
      updateOverview()
      return
    }
    announcePanelOpen()
    panel.hidden = false
    panel.setAttribute('aria-hidden', 'false')
    // Measure and place while invisible so the panel never flashes at 0,0.
    panel.style.visibility = 'hidden'
    updateOverview()
    positionPanel()
    panel.style.visibility = 'visible'
  }

  // The detail panel opens upward from the chip and clamps to the viewport. The
  // chip lives in the sidebar footer, so the panel never has to dodge the
  // conversation composer or the right-hand file panel: it appears over the
  // bottom-left corner only while it is open.
  function positionPanel() {
    var panel = overviewPanel
    if (!overviewChip || !overviewChip.isConnected || !panel || panel.hidden || !panel.isConnected) return
    var anchor = overviewChip.getBoundingClientRect()
    var width = panel.offsetWidth
    var height = panel.offsetHeight
    var vw = window.innerWidth
    var vh = window.innerHeight
    var left = Math.max(PANEL_MARGIN, Math.min(anchor.left, vw - width - PANEL_MARGIN))
    var top = anchor.top - PANEL_GAP - height
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
      var link = rows[i][3]
      if (link) {
        dd.appendChild(document.createTextNode(t('（', ' (')))
        var anchor = document.createElement('a')
        anchor.href = link.href
        anchor.target = '_blank'
        anchor.rel = 'noreferrer noopener'
        anchor.textContent = link.text
        dd.appendChild(anchor)
        dd.appendChild(document.createTextNode(t('）', ')')))
      }
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
      var grantedHintShown = false
      for (var i = 0; i < balance.balances.length; i += 1) {
        var b = balance.balances[i]
        var suffix = multi ? ' · ' + b.currency : ''
        var granted = Number(b.granted) || 0
        balanceRows.push([t('账户余额', 'Account balance') + suffix, money(b.total, b.currency)])
        balanceRows.push([t('充值余额', 'Topped up') + suffix, money(b.toppedUp, b.currency)])
        // The granted row stays visible at zero (the plugin's original shape);
        // only the expiry hint disappears, because there is nothing left to
        // expire. The official API exposes only the unexpired granted total,
        // so per-grant expiry dates are on the Billing page, not invented here.
        var grantedRow = [t('赠送余额', 'Granted') + suffix, money(granted, b.currency)]
        if (granted > 0.000000001 && !grantedHintShown) {
          grantedRow[3] = {
            text: t('有效期见账单页', 'expiry on Billing page'),
            href: 'https://platform.deepseek.com/transactions',
          }
          grantedHintShown = true
        }
        balanceRows.push(grantedRow)
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
    // Same foot layout as the status panel: official source on the left, the
    // refresh action on the right.
    var linkLabel = t('官方定价页 ↗', 'Official pricing ↗')
    if (r.link.textContent !== linkLabel) r.link.textContent = linkLabel
    var linkHref = pricing && pricing.currency === 'USD' ? PRICING_USD_URL : PRICING_CNY_URL
    if (r.link.getAttribute('href') !== linkHref) r.link.setAttribute('href', linkHref)
    var closeLabel = t('关闭', 'Close')
    if (r.close.getAttribute('aria-label') !== closeLabel) r.close.setAttribute('aria-label', closeLabel)
    var panelLabel = t('余额详情', 'Balance details')
    if (panel.getAttribute('aria-label') !== panelLabel) panel.setAttribute('aria-label', panelLabel)
  }

  function updateOverview() {
    var chip = ensureOverviewChip()
    if (!chip) {
      // The sidebar footer is gone (drawer closed, frame rebuilt): the anchor
      // no longer exists, so drop the panel instead of leaving it floating.
      if (panelOpen) {
        var focused = overviewPanel && overviewPanel.contains(document.activeElement)
        panelOpen = false
        panelPinned = false
        if (overviewPanel) {
          overviewPanel.hidden = true
          overviewPanel.setAttribute('aria-hidden', 'true')
        }
        if (focused && overviewChip && overviewChip.isConnected) overviewChip.focus()
      }
      return
    }
    var balance = balanceInfo()
    var peak = peakInfoClient()
    setText(chip.querySelector('.dsh-balance-chip-label'), t('余额', 'Balance'))
    setText(chip.querySelector('.dsh-balance-chip-amount'), balance.text)

    // The dot colour already says valley (green) or peak (amber); the chip
    // spends the remaining width on the countdown to the next switch. The
    // window word and the long countdown stay in the panel's summary line.
    var dot = chip.querySelector('.dsh-balance-dot')
    var remainEl = chip.querySelector('.dsh-balance-remain')
    if (peak) {
      if (dot) dot.className = 'dsh-balance-dot' + (peak.peak.isPeak ? ' peak' : '')
      setText(remainEl, peak.nextAt ? formatCompactRemaining(peak.remainMs) : '')
    } else {
      if (dot) dot.className = 'dsh-balance-dot unknown'
      setText(remainEl, state.error ? t('连接失败', 'Connection failed') : '…')
    }

    updatePanel(balance, peak)

    var hint = t('余额 ', 'Balance ') + balance.text
    if (peak) {
      hint += ' · ' + peak.windowLabel
      if (peak.nextAt) hint += ' ' + t('剩 ', 'left ') + formatRemaining(peak.remainMs)
      if (peak.nextAt) hint += ' · ' + peak.localNext + ' ' + peak.nextLabel
    } else if (state.error) {
      hint += ' · ' + state.error
    }
    hint += t('（悬停或点击查看详情）', ' (hover or click for details)')
    // No `title`: the chip opens its panel on hover, and a native tooltip would
    // pop up on top of it.
    if (chip.getAttribute('aria-label') !== hint) chip.setAttribute('aria-label', hint)
    chip.setAttribute('aria-expanded', panelOpen ? 'true' : 'false')
    // The rail hides the chip through CSS; a panel anchored to a box that no
    // longer has one would jump to the corner, so close it with the chip.
    if (panelOpen && chip.getClientRects().length === 0) {
      var chipHadFocus = overviewPanel && overviewPanel.contains(document.activeElement)
      panelOpen = false
      panelPinned = false
      if (overviewPanel) {
        overviewPanel.hidden = true
        overviewPanel.setAttribute('aria-hidden', 'true')
      }
      if (chipHadFocus) chip.focus()
      return
    }
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
    if (!panel || !overviewChip) return
    if (panel.contains(event.target) || overviewChip.contains(event.target)) return
    setPanelOpen(false)
  }, true)
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape' || !panelOpen) return
    setPanelOpen(false)
    if (overviewChip) overviewChip.focus()
  })

  window.addEventListener(PANEL_EVENT, function (event) {
    if (event && event.detail && event.detail.id === 'dsh-balance') return
    if (panelOpen) setPanelOpen(false)
  })
  var observer = new MutationObserver(schedulePaint)
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-sidebar-collapsed'],
  })
  window.addEventListener('focus', function () { fetchData(false) })
  window.addEventListener('resize', function () {
    if (panelOpen) positionPanel()
  })
  setInterval(function () { fetchData(false) }, POLL_MS)
  setInterval(paint, 3000)
  paint()
  fetchData(false)
})()
