import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const CACHE_FILE = path.join(DSH_HOME, '.dsh-balance-costs.json')
const PRICING_CACHE_FILE = path.join(DSH_HOME, '.dsh-balance-pricing.json')
const PRICING_HISTORY_FILE = path.join(DSH_HOME, '.dsh-balance-pricing-history.json')
const HOLIDAY_CACHE_FILE = path.join(DSH_HOME, '.dsh-balance-holidays.json')
const CLIENT_FILE = path.join(PACKAGE_ROOT, 'client.js')

const BALANCE_URL = 'https://api.deepseek.com/user/balance'
const PRICING_CNY_URL = 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing'
const PRICING_USD_URL = 'https://api-docs.deepseek.com/quick_start/pricing'
const HOLIDAY_URL = 'https://api.apihubs.cn/holiday/get'

const BALANCE_TTL_MS = 30_000
const BALANCE_ERROR_TTL_MS = 15_000
const PRICING_TTL_MS = 6 * 3600_000
const HOLIDAY_TTL_MS = 30 * 86400_000

// Fallbacks are used only while the official pages/API are unreachable on a
// cold start. Once fetched, the cache is the source of truth.
const DEFAULT_PRICING = {
  CNY: {
    'deepseek-flash': { hit: [0.02, 0.04], miss: [1, 2], out: [4, 8] },
    'deepseek-v4-pro': { hit: [0.15, 0.3], miss: [4.5, 9], out: [13.5, 27] },
  },
  USD: {
    'deepseek-flash': { hit: [0.003, 0.006], miss: [0.15, 0.3], out: [0.6, 1.2] },
    'deepseek-v4-pro': { hit: [0.022, 0.044], miss: [0.66, 1.32], out: [1.98, 3.96] },
  },
}

const DEFAULT_PEAK_HOURS = [[9, 12], [14, 18]]
const WEEKEND_VALLEY_FROM_SEC = Math.floor(Date.UTC(2026, 7, 22, 16, 0, 0) / 1000)

function stripTags(html) {
  return String(html)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(?:amp|lt|gt|quot|#39);/g, (m) => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" }[m]))
    .replace(/\s+/g, ' ')
    .trim()
}

function parsePricingPage(html, currency) {
  const marker = currency === 'CNY' ? '百万tokens' : '1M INPUT TOKENS'
  const markerAt = html.indexOf(marker)
  if (markerAt < 0) return null
  const tableStart = html.lastIndexOf('<table', markerAt)
  const tableEnd = html.indexOf('</table>', markerAt)
  if (tableStart < 0 || tableEnd < 0) return null
  const table = html.slice(tableStart, tableEnd)
  const rows = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) =>
    [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => stripTags(c[1])),
  )
  const pricingRow = rows.findIndex((row) => row[0] && (row[0].startsWith('价格') || row[0].startsWith('PRICING')))
  if (pricingRow < 0) return null
  let modelNames = (rows[0] || [])
    .slice(1)
    .map((cell) => cell.replace(/\([^)]*\)/g, '').trim())
    .filter((cell) => /deepseek/i.test(cell))
  if (!modelNames.length) modelNames = ['deepseek-flash', 'deepseek-v4-pro']
  const modelCount = modelNames.length
  const nums = (row) =>
    row.slice(-modelCount).map((cell) => {
      const match = cell.replace(/,/g, '').match(/([0-9]+(?:\.[0-9]+)?)/)
      return match ? Number(match[1]) : NaN
    })
  const hitOff = nums(rows[pricingRow])
  const hitPeak = nums(rows[pricingRow + 1])
  const missOff = nums(rows[pricingRow + 2])
  const missPeak = nums(rows[pricingRow + 3])
  const outOff = nums(rows[pricingRow + 4])
  const outPeak = nums(rows[pricingRow + 5])
  const all = [...hitOff, ...hitPeak, ...missOff, ...missPeak, ...outOff, ...outPeak]
  if (all.length !== modelCount * 6 || all.some((n) => !Number.isFinite(n) || n < 0)) return null
  const pricing = {}
  modelNames.forEach((model, index) => {
    pricing[model] = {
      hit: [hitOff[index], hitPeak[index]],
      miss: [missOff[index], missPeak[index]],
      out: [outOff[index], outPeak[index]],
    }
  })
  return pricing
}

function parsePeakHours(html) {
  const text = stripTags(html)
  const peakAt = text.indexOf('为高峰时段')
  if (peakAt < 0) return null
  const start = text.lastIndexOf('北京时间', peakAt)
  if (start < 0) return null
  const segment = text.slice(start, peakAt)
  const ranges = [...segment.matchAll(/(\d{1,2}):(\d{2})\s*[-–—]\s*(\d{1,2}):(\d{2})/g)]
    .map((m) => [Number(m[1]) + Number(m[2]) / 60, Number(m[3]) + Number(m[4]) / 60])
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a)
  return ranges.length ? ranges : null
}

function loadJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function saveJson(file, value) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(value), 'utf8')
  } catch {}
}

const pricingCache = loadJson(PRICING_CACHE_FILE)
const holidayCache = loadJson(HOLIDAY_CACHE_FILE)
const costCache = loadJson(CACHE_FILE)

const state = {
  sessions: (costCache && costCache.sessions) || {},
  scanDone: false,
  scanInFlight: false,
  costCurrency: (costCache && costCache.currency) || 'CNY',
  legacyCurrency: (costCache && costCache.currency) || 'CNY',
  pricing: (pricingCache && pricingCache.pricing) || DEFAULT_PRICING,
  pricingAt: (pricingCache && pricingCache.fetchedAt) || 0,
  pricingSource: (pricingCache && pricingCache.source) || 'default',
  peakHours: (pricingCache && pricingCache.peakHours) || DEFAULT_PEAK_HOURS,
  peakHoursSource: (pricingCache && pricingCache.peakHoursSource) || 'default',
  holidays: (holidayCache && holidayCache.days) || {},
  holidaysAt: (holidayCache && holidayCache.fetchedAt) || 0,
  holidaysSource: (holidayCache && holidayCache.source) || 'default',
  balance: null,
  balanceAt: 0,
}

// Migrate the v1 single-currency ledger shape to explicit per-currency cost
// buckets. Existing recorded amounts are preserved as-is; they are never
// repriced when a newer DeepSeek price list arrives.
for (const entry of Object.values(state.sessions)) {
  if (!entry || typeof entry !== 'object') continue
  if (!entry.costs || typeof entry.costs !== 'object') {
    entry.costs = { [state.legacyCurrency]: Number(entry.cost) || 0 }
  }
  if (!Number.isFinite(Number(entry.lastSeq))) entry.lastSeq = -1
  if (!Number.isFinite(Number(entry.tokens))) entry.tokens = 0
  if (!Array.isArray(entry.pricingVersions)) entry.pricingVersions = []
  if (!Array.isArray(entry.calendarVersions)) entry.calendarVersions = []
  if (!entry.pricingVersions.length && (Number(entry.cost) || 0) > 0) entry.pricingVersions.push('legacy')
  if (!entry.calendarVersions.length && (Number(entry.cost) || 0) > 0) entry.calendarVersions.push('legacy')
  entry.cost = Number(entry.costs[state.costCurrency]) || 0
}

function priceFor(model, currency = state.costCurrency) {
  const table = state.pricing[currency] || state.pricing.CNY || DEFAULT_PRICING.CNY
  const m = String(model || '').toLowerCase()
  for (const key of Object.keys(table)) {
    if (key === '_default') continue
    if (m.indexOf(key) !== -1) return table[key]
  }
  return table['deepseek-flash'] || table._default || table[Object.keys(table)[0]] || DEFAULT_PRICING.CNY['deepseek-flash']
}

function isPeakTime(timeSec) {
  const n = Number(timeSec)
  if (!Number.isFinite(n)) return false
  const bj = new Date(n * 1000 + 8 * 3600 * 1000)
  const dow = bj.getUTCDay()
  if (n >= WEEKEND_VALLEY_FROM_SEC && (dow === 0 || dow === 6)) return false
  const dateKey = bj.toISOString().slice(0, 10)
  if (state.holidays[dateKey] === 2) return false
  const hour = bj.getUTCHours() + bj.getUTCMinutes() / 60
  for (const [start, end] of (state.peakHours || DEFAULT_PEAK_HOURS)) {
    if (hour >= start && hour < end) return true
  }
  return false
}

function nextPeakChangeAt(timeSec) {
  const n = Number(timeSec)
  if (!Number.isFinite(n)) return null
  const current = isPeakTime(n)
  const day0 = Math.floor((n + 8 * 3600) / 86400) * 86400
  const edges = [...new Set([0, ...(state.peakHours || DEFAULT_PEAK_HOURS).flat()])]
    .filter((edge) => edge >= 0 && edge < 24)
    .sort((a, b) => a - b)
  for (let d = 0; d <= 12; d += 1) {
    for (const edge of edges) {
      const candidate = day0 + d * 86400 + edge * 3600 - 8 * 3600
      if (candidate <= n + 1) continue
      if (isPeakTime(candidate) !== current) return candidate
    }
  }
  return null
}

function peakInfo(nowMs = Date.now()) {
  const nowSec = Math.floor(nowMs / 1000)
  const next = nextPeakChangeAt(nowSec)
  const isPeak = isPeakTime(nowSec)
  return {
    isPeak,
    label: isPeak ? '高峰' : '谷价',
    nextLabel: isPeak ? '转谷价' : '转高峰',
    now: nowMs,
    nextChangeAt: next === null ? null : next * 1000,
    timezone: 'Asia/Shanghai',
    hours: state.peakHours || DEFAULT_PEAK_HOURS,
    hoursSource: state.peakHoursSource,
    holidaySource: state.holidaysSource,
  }
}

function usageTokens(usage) {
  const input = Number(usage && usage.inputTokens) || 0
  const cache = Number(usage && usage.cacheReadTokens) || 0
  const output = Number(usage && usage.outputTokens) || 0
  return { input, cache, output, total: input + cache + output }
}

function costOfUsage(usage, model, timeMs, currency = state.costCurrency) {
  const p = priceFor(model, currency)
  const idx = isPeakTime(Math.floor(Number(timeMs || Date.now()) / 1000)) ? 1 : 0
  const t = usageTokens(usage)
  return (t.cache / 1e6) * p.hit[idx] + (t.input / 1e6) * p.miss[idx] + (t.output / 1e6) * p.out[idx]
}

function ensureSession(sessionOrId) {
  const raw = typeof sessionOrId === 'string' ? sessionOrId : (sessionOrId && sessionOrId.id)
  const id = String(raw || '')
  if (!id) return null
  let entry = state.sessions[id]
  if (!entry) {
    entry = state.sessions[id] = {
      id,
      title: '',
      cwd: '',
      costs: {},
      cost: 0,
      tokens: 0,
      lastSeq: -1,
      pricingVersions: [],
      calendarVersions: [],
      updatedAt: 0,
    }
  }
  if (!entry.costs || typeof entry.costs !== 'object') entry.costs = {}
  if (!Array.isArray(entry.pricingVersions)) entry.pricingVersions = []
  if (!Array.isArray(entry.calendarVersions)) entry.calendarVersions = []
  return entry
}

/**
 * Freeze one usage event's cost in both currencies. The current price list is
 * only used for events recorded now; a later refresh never rewrites these
 * numbers. The version stamps let you audit which fetched price list and
 * holiday calendar were used.
 */
function addCost(entry, usage, model, timeMs) {
  const at = Number(timeMs) || Date.now()
  const cny = costOfUsage(usage, model, at, 'CNY')
  const usd = costOfUsage(usage, model, at, 'USD')
  entry.costs.CNY = (Number(entry.costs.CNY) || 0) + cny
  entry.costs.USD = (Number(entry.costs.USD) || 0) + usd
  entry.tokens = (Number(entry.tokens) || 0) + usageTokens(usage).total
  entry.cost = Number(entry.costs[state.costCurrency]) || 0
  entry.updatedAt = Date.now()
  if (state.pricingAt && !entry.pricingVersions.includes(state.pricingAt)) entry.pricingVersions.push(state.pricingAt)
  if (state.holidaysAt && !entry.calendarVersions.includes(state.holidaysAt)) entry.calendarVersions.push(state.holidaysAt)
  return cny
}

let saveTimer = null
function saveNow() {
  saveJson(CACHE_FILE, {
    version: 2,
    currency: state.costCurrency,
    pricingAt: state.pricingAt || null,
    holidaysAt: state.holidaysAt || null,
    sessions: state.sessions,
  })
}
function saveSoon() {
  if (saveTimer !== null) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    saveNow()
  }, 800)
}

function applyEvent(session, event) {
  const entry = ensureSession(session)
  if (!entry || !event || typeof event !== 'object') return
  const seq = Number(event.seq)
  if (Number.isFinite(seq) && seq <= entry.lastSeq) return
  if (Number.isFinite(seq)) entry.lastSeq = seq
  const header = session && session.header
  if (header && typeof header.cwd === 'string' && header.cwd) entry.cwd = header.cwd
  else if (session && typeof session.cwd === 'string' && session.cwd) entry.cwd = session.cwd
  if (event.type === 'session/title') {
    const title = event.data && event.data.title
    if (typeof title === 'string' && title) entry.title = title
  }
  if (event.type === 'assistant/message') {
    const data = event.data || {}
    const usage = data.usage
    if (usage && typeof usage === 'object') {
      const model = data.message && data.message.source ? data.message.source.model : ''
      addCost(entry, usage, model, event.time || Date.now())
    }
  }
  saveSoon()
}

function savePricingHistory() {
  const history = loadJson(PRICING_HISTORY_FILE)
  const entries = Array.isArray(history && history.entries) ? history.entries : []
  const snapshot = JSON.stringify({ pricing: state.pricing, peakHours: state.peakHours })
  const last = entries[entries.length - 1]
  if (!last || JSON.stringify({ pricing: last.pricing, peakHours: last.peakHours }) !== snapshot) {
    entries.push({
      fetchedAt: state.pricingAt,
      source: state.pricingSource,
      pricing: state.pricing,
      peakHours: state.peakHours,
      peakHoursSource: state.peakHoursSource,
    })
    while (entries.length > 200) entries.shift()
    saveJson(PRICING_HISTORY_FILE, { version: 1, entries })
  }
}

let pricingRefreshing = false
async function refreshPricing() {
  if (pricingRefreshing) return false
  pricingRefreshing = true
  try {
    const [cnyRes, usdRes] = await Promise.all([
      fetch(PRICING_CNY_URL, { signal: AbortSignal.timeout(10_000) }),
      fetch(PRICING_USD_URL, { signal: AbortSignal.timeout(10_000) }),
    ])
    const cnyHtml = cnyRes.ok ? await cnyRes.text() : ''
    const usdHtml = usdRes.ok ? await usdRes.text() : ''
    const cny = cnyHtml ? parsePricingPage(cnyHtml, 'CNY') : null
    const usd = usdHtml ? parsePricingPage(usdHtml, 'USD') : null
    const hours = cnyHtml ? parsePeakHours(cnyHtml) : null
    if (cny) state.pricing.CNY = cny
    if (usd) state.pricing.USD = usd
    if (hours) {
      state.peakHours = hours
      state.peakHoursSource = 'official'
    }
    if (cny || usd) {
      state.pricingAt = Date.now()
      state.pricingSource = cny && usd ? 'official' : 'partial'
      saveJson(PRICING_CACHE_FILE, {
        version: 1,
        fetchedAt: state.pricingAt,
        source: state.pricingSource,
        peakHours: state.peakHours,
        peakHoursSource: state.peakHoursSource,
        pricing: state.pricing,
      })
      savePricingHistory()
      console.log(`[dsh-balance] pricing refreshed (CNY=${Boolean(cny)}, USD=${Boolean(usd)})`)
      return true
    }
  } catch (err) {
    console.warn(`[dsh-balance] pricing refresh failed: ${err && err.message ? err.message : err}`)
  } finally {
    pricingRefreshing = false
  }
  return false
}

let holidayRefreshing = false
async function refreshHolidays() {
  if (holidayRefreshing) return false
  holidayRefreshing = true
  const now = new Date()
  const years = [now.getFullYear(), now.getFullYear() + 1]
  const days = { ...state.holidays }
  let fetched = false
  for (const year of years) {
    try {
      const res = await fetch(`${HOLIDAY_URL}?year=${year}&size=500`, { signal: AbortSignal.timeout(10_000) })
      if (!res.ok) continue
      const json = await res.json()
      const list = json && json.data && Array.isArray(json.data.list) ? json.data.list : []
      for (const item of list) {
        const raw = String(item.date || '')
        if (!/^\d{8}$/.test(raw)) continue
        const key = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
        const workday = Number(item.workday)
        if (workday === 1 || workday === 2) days[key] = workday
      }
      fetched = true
    } catch (err) {
      console.warn(`[dsh-balance] holiday refresh ${year} failed: ${err && err.message ? err.message : err}`)
    }
  }
  if (fetched) {
    state.holidays = days
    state.holidaysAt = Date.now()
    state.holidaysSource = 'official'
    saveJson(HOLIDAY_CACHE_FILE, {
      version: 1,
      fetchedAt: state.holidaysAt,
      source: state.holidaysSource,
      days: state.holidays,
    })
    console.log(`[dsh-balance] holiday calendar refreshed (${Object.keys(days).length} days)`)
    holidayRefreshing = false
    return true
  }
  holidayRefreshing = false
  return false
}

async function scanHistory(ctx) {
  const started = Date.now()
  try {
    const list = await ctx.sessionQuery.listSessions()
    for (const record of list) {
      const id = record && record.header ? record.header.id : (record && record.id)
      if (!id) continue
      try {
        const { session, events } = await ctx.sessionQuery.readSession(id)
        const entry = ensureSession(id)
        if (!entry) continue
        entry.cwd = (session && session.cwd) || (record && record.header && record.header.cwd) || entry.cwd || ''
        const startSeq = Number.isFinite(Number(entry.lastSeq)) ? Number(entry.lastSeq) : -1

        // A ledger created before per-currency buckets (or by an account whose
        // balance was in the other currency) may lack the bucket we now show.
        // Fill only the missing bucket, at today's price list, without touching
        // any already recorded amount.
        if (startSeq >= 0) {
          const missingCurrencies = ['CNY', 'USD'].filter((currency) => entry.costs[currency] === undefined)
          if (missingCurrencies.length) {
            const sums = { CNY: 0, USD: 0 }
            for (const event of events || []) {
              if (event.type !== 'assistant/message') continue
              const data = event.data || {}
              const usage = data.usage
              if (!usage || typeof usage !== 'object') continue
              const model = data.message && data.message.source ? data.message.source.model : ''
              for (const currency of missingCurrencies) {
                sums[currency] += costOfUsage(usage, model, event.time || Date.now(), currency)
              }
            }
            for (const currency of missingCurrencies) entry.costs[currency] = sums[currency]
            entry.migratedCostsAt = Date.now()
            if (state.pricingAt && !entry.pricingVersions.includes(state.pricingAt)) entry.pricingVersions.push(state.pricingAt)
          }
        }

        for (const event of events || []) {
          // Titles are cheap and always safe to refresh.
          if (event.type === 'session/title') {
            const title = event.data && event.data.title
            if (typeof title === 'string' && title) entry.title = title
          }
          const seq = Number(event.seq)
          // Never recompute a previously recorded event. This is the whole
          // point of the ledger: a later DeepSeek price-list change must not
          // rewrite what was already spent.
          if (Number.isFinite(seq) && seq <= startSeq) continue
          if (event.type === 'assistant/message') {
            const data = event.data || {}
            const usage = data.usage
            if (usage && typeof usage === 'object') {
              const model = data.message && data.message.source ? data.message.source.model : ''
              addCost(entry, usage, model, event.time || Date.now())
            }
          }
          if (Number.isFinite(seq) && seq > entry.lastSeq) entry.lastSeq = seq
        }
        entry.cost = Number(entry.costs[state.costCurrency]) || 0
        entry.updatedAt = Date.now()
      } catch (err) {
        console.warn(`[dsh-balance] could not read session ${id}: ${err && err.message ? err.message : err}`)
      }
    }
    saveNow()
    console.log(`[dsh-balance] scanned ${list.length} sessions in ${Date.now() - started}ms (${state.costCurrency})`)
  } catch (err) {
    console.warn(`[dsh-balance] history scan failed: ${err && err.message ? err.message : err}`)
  }
}

async function rescan(ctx) {
  if (state.scanInFlight) return
  state.scanInFlight = true
  state.scanDone = false
  try {
    await scanHistory(ctx)
  } finally {
    state.scanDone = true
    state.scanInFlight = false
    saveNow()
  }
}

async function fetchBalance(ctx, force) {
  const now = Date.now()
  if (!force && state.balance && now - state.balanceAt < (state.balance.ok ? BALANCE_TTL_MS : BALANCE_ERROR_TTL_MS)) {
    return state.balance
  }
  let result
  try {
    const cred = await ctx.credentials.resolve('DEEPSEEK_API_KEY')
    const key = cred && typeof cred === 'object' ? cred.value : cred
    if (!key) {
      result = { ok: false, error: 'DEEPSEEK_API_KEY is not configured' }
    } else {
      const res = await fetch(BALANCE_URL, {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) {
        const body = await res.text().catch(() => '')
        result = { ok: false, status: res.status, error: body.slice(0, 200) || `HTTP ${res.status}` }
      } else {
        const json = await res.json()
        const infos = Array.isArray(json.balance_infos) ? json.balance_infos : []
        const balances = infos.map((info) => ({
          currency: String(info.currency || 'CNY').toUpperCase(),
          total: Number(info.total_balance) || 0,
          granted: Number(info.granted_balance) || 0,
          toppedUp: Number(info.topped_up_balance) || 0,
        }))
        const nonZero = balances.filter((b) =>
          Math.abs(b.total) > 0.000000001 || Math.abs(b.granted) > 0.000000001 || Math.abs(b.toppedUp) > 0.000000001,
        )
        const primary = nonZero.slice().sort((a, b) => {
          const diff = Math.abs(b.total) - Math.abs(a.total)
          if (diff !== 0) return diff
          return a.currency === 'CNY' ? -1 : 1
        })[0] || balances.find((b) => b.currency === 'CNY') || balances[0]
        if (!primary) {
          result = { ok: false, error: 'balance response has no balance_infos' }
        } else {
          result = {
            ok: true,
            available: json.is_available !== false,
            balances,
            currency: primary.currency,
            total: primary.total,
            granted: primary.granted,
            toppedUp: primary.toppedUp,
            fetchedAt: now,
          }
        }
      }
    }
  } catch (err) {
    result = { ok: false, error: err && err.message ? err.message : String(err) }
  }
  state.balance = result
  state.balanceAt = now
  return result
}

function workspaceCosts(ctx) {
  let list = []
  try {
    list = ctx.workspaceRegistry.list()
  } catch (err) {
    console.warn(`[dsh-balance] workspace registry unavailable: ${err && err.message ? err.message : err}`)
    return []
  }
  return list.map((ws) => {
    const ids = Array.isArray(ws.sessionIds) ? ws.sessionIds : []
    let cost = 0
    let tokens = 0
    for (const id of ids) {
      const entry = state.sessions[id]
      if (!entry) continue
      cost += Number(entry.costs && entry.costs[state.costCurrency]) || 0
      tokens += Number(entry.tokens) || 0
    }
    return {
      id: String(ws.id || ws.workspaceId || ''),
      path: ws.path || '',
      title: ws.title || (ws.path ? path.basename(ws.path) : ''),
      cost,
      tokens,
      sessionCount: ids.length,
    }
  })
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(JSON.stringify(payload))
}

function denied(ctx, req, res) {
  let connection
  try {
    connection = ctx.get('connection')
  } catch {}
  if (!connection || typeof connection.requestRejection !== 'function') return false
  let code
  try {
    code = connection.requestRejection(req)
  } catch {
    code = 403
  }
  if (code === undefined || code === null || code === false) return false
  res.writeHead(typeof code === 'number' ? code : 403, { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end('forbidden\n')
  return true
}

export const name = 'dsh-balance'
export const inject = ['webServer', 'credentials', 'sessionQuery', 'workspaceRegistry']
export { peakInfo, isPeakTime, costOfUsage }

export async function apply(ctx, _config) {
  const disposers = []
  const pendingEvents = []

  ctx.on('session/event', (session, event) => {
    if (!state.scanDone) {
      pendingEvents.push([session, event])
      return
    }
    applyEvent(session, event)
  })

  const registerRoute = (route) => {
    const inner = route.handler
    const disposer = ctx.webServer.register({
      ...route,
      handler: async (req, res) => {
        if (denied(ctx, req, res)) return
        try {
          await inner(req, res)
        } catch (err) {
          sendJson(res, 500, { ok: false, error: err && err.message ? err.message : String(err) })
        }
      },
    })
    if (typeof disposer === 'function') disposers.push(disposer)
    return disposer
  }

  registerRoute({
    kind: 'exact',
    path: '/dsh-balance/data',
    handler: async (req, res) => {
      let force = false
      try {
        const url = new URL(req.url || '/dsh-balance/data', 'http://127.0.0.1')
        force = url.searchParams.get('force') === '1'
      } catch {}
      const balance = await fetchBalance(ctx, force)
      if (balance.ok && balance.currency && balance.currency !== state.costCurrency) {
        // The ledger already stores both currencies. Switching the display
        // currency must not reprice history; just pick the other bucket.
        state.costCurrency = balance.currency
        for (const entry of Object.values(state.sessions)) {
          entry.cost = Number(entry.costs && entry.costs[state.costCurrency]) || 0
        }
      }
      // A new price list or holiday calendar applies only to events recorded
      // from now on. Never rescan/reprice the ledger here.
      if (Date.now() - state.pricingAt > PRICING_TTL_MS) void refreshPricing()
      if (Date.now() - state.holidaysAt > HOLIDAY_TTL_MS) void refreshHolidays()

      const sessions = {}
      for (const [id, entry] of Object.entries(state.sessions)) {
        sessions[id] = {
          ...entry,
          cost: Number(entry.costs && entry.costs[state.costCurrency]) || 0,
          costCurrency: state.costCurrency,
        }
      }
      sendJson(res, 200, {
        ok: true,
        scanDone: state.scanDone,
        costCurrency: state.costCurrency,
        balance,
        peak: peakInfo(),
        pricing: {
          currency: state.costCurrency,
          fetchedAt: state.pricingAt || null,
          source: state.pricingSource,
          peakHours: state.peakHours,
          peakHoursSource: state.peakHoursSource,
        },
        holidays: {
          fetchedAt: state.holidaysAt || null,
          source: state.holidaysSource,
        },
        sessions,
        workspaces: workspaceCosts(ctx),
        generatedAt: Date.now(),
      })
    },
  })

  registerRoute({
    kind: 'exact',
    path: '/dsh-balance/client.js',
    handler: async (_req, res) => {
      try {
        const js = fs.readFileSync(CLIENT_FILE, 'utf8')
        res.writeHead(200, {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Cache-Control': 'no-store',
        })
        res.end(js)
      } catch (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        res.end(`client.js unavailable: ${err && err.message ? err.message : err}\n`)
      }
    },
  })

  const tap = ctx.webServer.tapIndex((html) => {
    if (typeof html !== 'string' || html.indexOf('/dsh-balance/client.js') !== -1) return html
    const tag = '<script defer src="/dsh-balance/client.js?v=5"></script>'
    return html.indexOf('</body>') !== -1 ? html.replace('</body>', `${tag}</body>`) : html + tag
  })
  if (typeof tap === 'function') disposers.push(tap)

  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => {
      for (const dispose of disposers) {
        try {
          dispose()
        } catch {}
      }
    })
  }

  const balance = await fetchBalance(ctx, true)
  state.costCurrency = balance.ok && balance.currency ? balance.currency : (state.pricing.CNY ? 'CNY' : 'USD')

  const jobs = []
  if (!state.pricingAt || Date.now() - state.pricingAt > PRICING_TTL_MS) jobs.push(refreshPricing())
  if (!state.holidaysAt || Date.now() - state.holidaysAt > HOLIDAY_TTL_MS) jobs.push(refreshHolidays())
  if (jobs.length) await Promise.allSettled(jobs)

  await rescan(ctx)
  for (const [session, event] of pendingEvents.splice(0)) applyEvent(session, event)
  saveNow()
  console.log(`[dsh-balance] ready (${Object.keys(state.sessions).length} sessions, ${state.costCurrency})`)
}
