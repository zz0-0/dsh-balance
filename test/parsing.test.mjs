import assert from 'node:assert/strict'
import test from 'node:test'
import { parsePricingPage, parsePeakHours } from '../lib/index.js'

const PRICING_HTML = `<table>
<tr><td></td><td>deepseek-flash</td><td>deepseek-v4-pro</td></tr>
<tr><td>价格(百万tokens)</td><td>0.02</td><td>0.15</td></tr>
<tr><td>高峰</td><td>0.04</td><td>0.3</td></tr>
<tr><td>未命中</td><td>1</td><td>4.5</td></tr>
<tr><td>高峰</td><td>2</td><td>9</td></tr>
<tr><td>输出</td><td>4</td><td>13.5</td></tr>
<tr><td>高峰</td><td>8</td><td>27</td></tr>
</table>`

test('parses the CNY pricing table', () => {
  const pricing = parsePricingPage(PRICING_HTML, 'CNY')
  assert.ok(pricing)
  assert.deepEqual(pricing['deepseek-flash'], {
    hit: [0.02, 0.04],
    miss: [1, 2],
    out: [4, 8],
  })
  assert.deepEqual(pricing['deepseek-v4-pro'], {
    hit: [0.15, 0.3],
    miss: [4.5, 9],
    out: [13.5, 27],
  })
})

test('rejects a page without the pricing marker or table', () => {
  assert.equal(parsePricingPage('<p>no prices here</p>', 'CNY'), null)
})

test('rejects a truncated pricing table', () => {
  const html = `<table>
<tr><td></td><td>deepseek-flash</td></tr>
<tr><td>价格(百万tokens)</td><td>0.02</td></tr>
</table>`
  assert.equal(parsePricingPage(html, 'CNY'), null)
})

test('parses Beijing peak-hour ranges', () => {
  const ranges = parsePeakHours('<p>北京时间 9:00-12:00、14:00-18:00 为高峰时段</p>')
  assert.deepEqual(ranges, [[9, 12], [14, 18]])
})

test('rejects a page without a peak-hour sentence', () => {
  assert.equal(parsePeakHours('<p>nothing</p>'), null)
})

test('parses fractional peak-hour ranges', () => {
  const ranges = parsePeakHours('<p>北京时间 9:30-12:00、14:00-18:30 为高峰时段</p>')
  assert.deepEqual(ranges, [[9.5, 12], [14, 18.5]])
})

test('parses a peak window that crosses midnight', () => {
  const ranges = parsePeakHours('<p>北京时间 22:00-02:00 为高峰时段</p>')
  assert.deepEqual(ranges, [[22, 26]])
})

test('keeps a peak window ending at 24:00 as a same-day window', () => {
  const ranges = parsePeakHours('<p>北京时间 22:00-24:00 为高峰时段</p>')
  assert.deepEqual(ranges, [[22, 24]])
})
