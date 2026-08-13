import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const pluginUrl = new URL('./plugin.js', import.meta.url)
const source = await readFile(pluginUrl, 'utf8')
const startMarker = '// TOKEN_METER_CORE_START'
const endMarker = '// TOKEN_METER_CORE_END'
const start = source.indexOf(startMarker)
const end = source.indexOf(endMarker)

assert.notEqual(start, -1, 'token-meter core start marker is missing')
assert.notEqual(end, -1, 'token-meter core end marker is missing')
assert.ok(end > start, 'token-meter core markers are out of order')

const coreSource = source.slice(start + startMarker.length, end)
const core = await import(`data:text/javascript;base64,${Buffer.from(coreSource).toString('base64')}`)
const {
  applyTextDelta,
  applyUsage,
  createMeterState,
  finishTurn,
  meterView,
  selectRuntime,
  startTurn,
  tickMeter
} = core

const usage = (input, output, calls = 1, model = 'test-model') => ({
  calls,
  input,
  model,
  output,
  reasoning: 0,
  total: input + output
})

// A long tool/API pause must not be mistaken for the end of a turn.
{
  let state = selectRuntime(createMeterState(), 'runtime-a')
  state = applyUsage(state, 'runtime-a', usage(100, 10), 1_000)
  state = startTurn(state, 'runtime-a', 2_000)
  state = applyUsage(state, 'runtime-a', usage(150, 30), 3_000)
  state = applyUsage(state, 'runtime-a', usage(150, 30), 30_000)
  assert.equal(state.phase, 'active')
  assert.equal(state.turn, null)
}

// Only the authoritative running=false edge finalizes, and tok/s is output
// throughput rather than the input+output burst that caused million-tok/s UI.
{
  let state = selectRuntime(createMeterState(), 'runtime-a')
  state = applyUsage(state, 'runtime-a', usage(100, 10), 1_000)
  state = startTurn(state, 'runtime-a', 2_000)
  state = applyUsage(state, 'runtime-a', usage(200, 60), 7_000)
  state = finishTurn(state, 'runtime-a', 12_000)
  assert.equal(state.phase, 'done')
  assert.deepEqual(state.turn, {
    elapsedMs: 10_000,
    input: 100,
    output: 50,
    speed: 5
  })
}

// Repeated running=true/session.info heartbeats cannot reset the baseline.
{
  let state = selectRuntime(createMeterState(), 'runtime-a')
  state = applyUsage(state, 'runtime-a', usage(100, 10), 1_000)
  state = startTurn(state, 'runtime-a', 2_000)
  state = applyUsage(state, 'runtime-a', usage(140, 20), 3_000)
  state = startTurn(state, 'runtime-a', 4_000)
  state = applyUsage(state, 'runtime-a', usage(180, 40), 5_000)
  state = finishTurn(state, 'runtime-a', 12_000)
  assert.equal(state.turn.input, 80)
  assert.equal(state.turn.output, 30)
  assert.equal(state.turn.elapsedMs, 10_000)
}

// Switching to a high-usage conversation is a reset, never a giant 5-second turn.
{
  let state = selectRuntime(createMeterState(), 'runtime-a')
  state = applyUsage(state, 'runtime-a', usage(100, 10), 1_000)
  state = startTurn(state, 'runtime-a', 2_000)
  state = applyUsage(state, 'runtime-a', usage(120, 20), 3_000)
  state = selectRuntime(state, 'runtime-b')
  state = applyUsage(state, 'runtime-b', usage(15_500_000, 844_300, 200), 4_000)
  assert.equal(state.phase, 'idle')
  assert.equal(state.turn, null)
  assert.equal(state.usage.input, 15_500_000)
  assert.equal(state.usage.output, 844_300)
}

// A late async response from the previously selected runtime must be ignored.
{
  let state = selectRuntime(createMeterState(), 'runtime-a')
  state = applyUsage(state, 'runtime-a', usage(100, 10), 1_000)
  state = selectRuntime(state, 'runtime-b')
  state = applyUsage(state, 'runtime-b', usage(200, 20), 2_000)
  const afterLateA = applyUsage(state, 'runtime-a', usage(999_999, 999_999), 3_000)
  assert.deepEqual(afterLateA, state)
}

// Finishing an idle session is a harmless usage refresh, not a fabricated turn.
{
  let state = selectRuntime(createMeterState(), 'runtime-a')
  state = applyUsage(state, 'runtime-a', usage(100, 10), 1_000)
  state = finishTurn(state, 'runtime-a', 2_000)
  assert.equal(state.phase, 'idle')
  assert.equal(state.turn, null)
}

// If a turn starts before the initial cumulative snapshot arrives, that first
// snapshot establishes the baseline instead of counting all historical usage.
{
  let state = selectRuntime(createMeterState(), 'runtime-a')
  state = startTurn(state, 'runtime-a', 1_000)
  state = applyUsage(state, 'runtime-a', usage(1_000_000, 50_000), 2_000)
  let view = meterView(state)
  assert.equal(view.turnInput, 0)
  assert.equal(view.turnOutput, 0)

  state = applyUsage(state, 'runtime-a', usage(1_000_120, 50_030), 3_000)
  view = meterView(state)
  assert.equal(view.turnInput, 120)
  assert.equal(view.turnOutput, 30)
}

// Visible message deltas arrive before provider usage. They must yield an
// explicitly approximate speed immediately. Authoritative usage corrects the
// cumulative turn output, while the rolling one-second rate remains a stream
// estimate because providers do not report per-delta token timestamps.
{
  let state = selectRuntime(createMeterState(), 'runtime-a')
  state = applyUsage(state, 'runtime-a', usage(0, 0, 0), 500)
  state = startTurn(state, 'runtime-a', 1_000)
  state = applyTextDelta(state, 'runtime-a', 'This is the first streamed response chunk.', 1_100)
  let view = meterView(state)
  assert.equal(view.speedEstimated, true)
  assert.equal(view.turnSpeedEstimated, true)
  assert.ok(view.turnOutput > 0, 'streamed text should produce a temporary token estimate')
  assert.ok(view.turnSpeed > 0, 'speed should appear on the first visible response chunk')

  state = applyUsage(state, 'runtime-a', usage(120, 8), 2_000)
  view = meterView(state)
  assert.equal(view.speedEstimated, false)
  assert.equal(view.turnSpeedEstimated, true)
  assert.equal(view.turnOutput, 8)
  assert.ok(view.turnSpeed > 0)
}

// If the lifecycle edge lands before final provider usage, keep the streamed
// estimate pinned briefly and correct it in place when usage arrives later.
{
  let state = selectRuntime(createMeterState(), 'runtime-a')
  state = applyUsage(state, 'runtime-a', usage(0, 0, 0), 500)
  state = startTurn(state, 'runtime-a', 1_000)
  state = applyTextDelta(state, 'runtime-a', 'A streamed answer before final usage.', 1_100)
  state = finishTurn(state, 'runtime-a', 2_000)
  let view = meterView(state)
  assert.equal(view.speedEstimated, true)
  assert.ok(view.turnOutput > 0)

  state = applyUsage(state, 'runtime-a', usage(100, 12), 2_100)
  view = meterView(state)
  assert.equal(view.speedEstimated, false)
  assert.equal(view.turnOutput, 12)
  assert.equal(view.speed, 12)
}

// After an intermediate API call reports exact usage, later streamed output in
// the same turn must continue moving immediately instead of freezing until the
// next provider usage snapshot.
{
  let state = selectRuntime(createMeterState(), 'runtime-a')
  state = applyUsage(state, 'runtime-a', usage(0, 0, 0), 500)
  state = startTurn(state, 'runtime-a', 1_000)
  state = applyTextDelta(state, 'runtime-a', 'abcdefgh', 1_100)
  state = applyUsage(state, 'runtime-a', usage(50, 2), 1_200)
  let view = meterView(state)
  assert.equal(view.speedEstimated, false)
  assert.equal(view.turnSpeedEstimated, true)
  assert.equal(view.turnOutput, 2)

  state = applyTextDelta(state, 'runtime-a', 'ijklmnop', 1_300)
  view = meterView(state)
  assert.equal(view.speedEstimated, true)
  assert.equal(view.turnSpeedEstimated, true)
  assert.equal(view.turnOutput, 4)
}

// Active tok/s is the output seen in the latest 1,000 ms, not total output
// divided by the whole turn. Delayed cumulative usage must not create a rate
// spike, and a quiet one-second window must decay to zero.
{
  let state = selectRuntime(createMeterState(), 'runtime-a')
  state = applyUsage(state, 'runtime-a', usage(0, 0, 0), 500)
  state = startTurn(state, 'runtime-a', 1_000)

  state = applyTextDelta(state, 'runtime-a', 'a'.repeat(40), 2_000)
  assert.equal(meterView(state).turnSpeed, 10)

  state = applyUsage(state, 'runtime-a', usage(100, 100), 2_500)
  assert.equal(meterView(state).turnSpeed, 10, 'a delayed usage jump is not instantaneous output')

  state = applyTextDelta(state, 'runtime-a', 'b'.repeat(8), 3_000)
  assert.equal(meterView(state).turnSpeed, 2, 'the prior second must not dilute the current second')

  state = tickMeter(state, 4_001)
  assert.equal(meterView(state).turnSpeed, 0, 'no recent stream output means 0 tok/s')
}

// Multiple chunks inside the same trailing second raise the live rate; once the
// older chunk leaves the window, only current-second output remains.
{
  let state = selectRuntime(createMeterState(), 'runtime-a')
  state = applyUsage(state, 'runtime-a', usage(0, 0, 0), 500)
  state = startTurn(state, 'runtime-a', 1_000)
  state = applyTextDelta(state, 'runtime-a', 'a'.repeat(8), 1_100)
  assert.equal(meterView(state).turnSpeed, 2)

  state = applyTextDelta(state, 'runtime-a', 'b'.repeat(32), 1_500)
  assert.equal(meterView(state).turnSpeed, 10)

  state = tickMeter(state, 2_101)
  assert.equal(meterView(state).turnSpeed, 8)
}

assert.doesNotMatch(
  source,
  /speedText\s*=.*`~\$\{rawSpeedText\}`/,
  'status-bar speed must not be prefixed with a tilde'
)
assert.doesNotMatch(source, /[~]/, 'plugin.js must not contain any tilde characters at all')
assert.match(
  source,
  /last 1s estimate/,
  'the popup should still disclose that active speed is an estimate'
)
assert.match(
  source,
  /estimated average/,
  'the popup should still disclose a done-state estimated average in words'
)

console.log('token-meter state-machine tests: 12 passed; chip display assertions: 4 passed')
