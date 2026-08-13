/**
 * Token Meter — live per-turn token usage in the Hermes status bar.
 *
 * Truth sources:
 *   - host.state.activeSessionId selects the visible runtime session.
 *   - message.start / session.info.running define turn boundaries.
 *   - message.delta / reasoning.delta provide immediate approximate throughput.
 *   - session.info.usage plus session.usage provide authoritative counters.
 *
 * The plugin deliberately does NOT infer a turn from token growth or a quiet
 * timeout. Long tool calls can be silent for minutes, and switching to a large
 * conversation can make cumulative usage jump by millions of tokens. Both were
 * previously misreported as a five-second turn with an impossible tok/s value.
 *
 * One module-level store is shared by the status-bar detail and popup panel, so
 * mounting the panel never starts a second poller or an independent state
 * machine.
 */

import { useSyncExternalStore } from 'react'
import { haptic, host, icons, StatusDot } from '@hermes/plugin-sdk'
import { jsx, jsxs } from 'react/jsx-runtime'

const POLL_MS = 1000
const STATUS_BACKSTOP_MS = 5000

// TOKEN_METER_CORE_START
const RATE_WINDOW_MS = 1000

export function normalizeUsage(value) {
  const source = value && typeof value === 'object' ? value : {}
  const finite = key => {
    const number = Number(source[key] ?? 0)
    return Number.isFinite(number) && number > 0 ? number : 0
  }
  const input = finite('input')
  const output = finite('output')

  return {
    cacheRead: finite('cacheRead') || finite('cache_read'),
    cacheWrite: finite('cacheWrite') || finite('cache_write'),
    calls: finite('calls'),
    input,
    model: typeof source.model === 'string' ? source.model : '',
    output,
    reasoning: finite('reasoning'),
    total: input + output
  }
}

export function createMeterState() {
  return {
    base: null,
    model: '',
    nowAt: 0,
    phase: 'idle',
    rateSamples: [],
    runtimeId: null,
    startAt: 0,
    streamConfirmedTokens: 0,
    streamDenseChars: 0,
    streamSparseChars: 0,
    turn: null,
    usage: null
  }
}

export function selectRuntime(state, runtimeId, now = Date.now()) {
  const selected = runtimeId || null
  if (state.runtimeId === selected) return state

  return {
    ...createMeterState(),
    nowAt: now,
    runtimeId: selected
  }
}

export function applyUsage(state, runtimeId, usage, now = Date.now()) {
  if (!runtimeId || state.runtimeId !== runtimeId) return state
  const nextUsage = normalizeUsage(usage)
  // If the plugin attaches or switches sessions exactly as a turn begins, the
  // initial cumulative snapshot may arrive after message.start. Prime the
  // baseline from that first snapshot; treating a missing baseline as zero
  // would count the whole conversation as this turn.
  const primeBase = state.phase === 'active' && state.base == null
  let base = primeBase ? nextUsage : state.base
  let streamConfirmedTokens = state.streamConfirmedTokens
  let turn = state.turn

  if (state.phase === 'active' && !primeBase && base) {
    const previous = normalizeUsage(state.usage)
    const baseline = normalizeUsage(base)
    const previousOutput = Math.max(0, previous.output - baseline.output)
    const nextOutput = Math.max(0, nextUsage.output - baseline.output)
    if (nextOutput > previousOutput) {
      streamConfirmedTokens = estimatedStreamTokens(state)
    }
  }

  // Some providers emit the running=false edge immediately before their final
  // usage snapshot. Correct a pinned stream estimate in place once that
  // authoritative snapshot arrives.
  if (state.phase === 'done' && turn?.speedEstimated && base) {
    const previous = normalizeUsage(base)
    const input = Math.max(0, nextUsage.input - previous.input)
    const output = Math.max(0, nextUsage.output - previous.output)
    if (output > 0) {
      turn = {
        elapsedMs: turn.elapsedMs,
        input,
        output,
        speed: turn.elapsedMs > 0 ? output / (turn.elapsedMs / 1000) : null,
        speedEstimated: false
      }
      base = null
    }
  }

  return {
    ...state,
    base,
    model: nextUsage.model || state.model,
    nowAt: now,
    streamConfirmedTokens,
    turn,
    usage: nextUsage
  }
}

export function applyModel(state, runtimeId, model, now = Date.now()) {
  if (!runtimeId || state.runtimeId !== runtimeId || typeof model !== 'string') return state
  return { ...state, model: model || state.model, nowAt: now }
}

export function startTurn(state, runtimeId, now = Date.now()) {
  if (!runtimeId || state.runtimeId !== runtimeId || state.phase === 'active') return state

  return {
    ...state,
    base: state.usage ? normalizeUsage(state.usage) : null,
    nowAt: now,
    phase: 'active',
    rateSamples: [],
    startAt: now,
    streamConfirmedTokens: 0,
    streamDenseChars: 0,
    streamSparseChars: 0,
    turn: null
  }
}

function streamCharCounts(text) {
  let dense = 0
  for (const char of text) {
    const code = char.codePointAt(0)
    if (
      (code >= 0x3400 && code <= 0x9fff) ||
      (code >= 0x3040 && code <= 0x30ff) ||
      (code >= 0xac00 && code <= 0xd7af)
    ) dense += 1
  }
  return { dense, sparse: Math.max(0, [...text].length - dense) }
}

function estimatedStreamTokens(state) {
  return state.streamDenseChars + Math.ceil(state.streamSparseChars / 4)
}

function recentRateSamples(samples, now) {
  const cutoff = now - RATE_WINDOW_MS
  return samples.filter(sample => sample.at > cutoff && sample.at <= now)
}

function recentOutputSpeed(state) {
  if (estimatedStreamTokens(state) <= 0) return null
  const recentTokens = recentRateSamples(state.rateSamples, state.nowAt)
    .reduce((total, sample) => total + sample.tokens, 0)
  return recentTokens / (RATE_WINDOW_MS / 1000)
}

function turnOutputSnapshot(state, exactOutput) {
  const estimatedTail = Math.max(0, estimatedStreamTokens(state) - state.streamConfirmedTokens)
  return {
    output: exactOutput + estimatedTail,
    speedEstimated: estimatedTail > 0
  }
}

export function applyTextDelta(state, runtimeId, text, now = Date.now()) {
  if (
    !runtimeId ||
    state.runtimeId !== runtimeId ||
    state.phase !== 'active' ||
    typeof text !== 'string' ||
    !text
  ) return state

  const counts = streamCharCounts(text)
  const tokens = counts.dense + counts.sparse / 4
  return {
    ...state,
    nowAt: now,
    rateSamples: recentRateSamples(
      [...state.rateSamples, { at: now, tokens }],
      now
    ),
    streamDenseChars: state.streamDenseChars + counts.dense,
    streamSparseChars: state.streamSparseChars + counts.sparse
  }
}

export function finishTurn(state, runtimeId, now = Date.now()) {
  if (!runtimeId || state.runtimeId !== runtimeId || state.phase !== 'active') return state

  const current = normalizeUsage(state.usage)
  const base = normalizeUsage(state.base)
  const elapsedMs = Math.max(0, now - state.startAt)
  const input = Math.max(0, current.input - base.input)
  const exactOutput = Math.max(0, current.output - base.output)
  const { output, speedEstimated } = turnOutputSnapshot(state, exactOutput)
  const speed = elapsedMs > 0 && output > 0 ? output / (elapsedMs / 1000) : null

  return {
    ...state,
    base: speedEstimated ? state.base : null,
    nowAt: now,
    phase: 'done',
    rateSamples: [],
    startAt: 0,
    turn: speedEstimated
      ? { elapsedMs, input, output, speed, speedEstimated: true }
      : { elapsedMs, input, output, speed }
  }
}

export function tickMeter(state, now = Date.now()) {
  return state.phase === 'active'
    ? { ...state, nowAt: now, rateSamples: recentRateSamples(state.rateSamples, now) }
    : state
}

export function meterView(state) {
  if (state.phase === 'done' && state.turn) {
    return {
      elapsedMs: state.turn.elapsedMs,
      model: state.model,
      phase: state.phase,
      session: state.usage,
      speed: state.turn.speed,
      speedEstimated: Boolean(state.turn.speedEstimated),
      turnInput: state.turn.input,
      turnOutput: state.turn.output
    }
  }

  if (state.phase === 'active') {
    const usage = normalizeUsage(state.usage)
    const base = normalizeUsage(state.base)
    const elapsedMs = Math.max(0, state.nowAt - state.startAt)
    const exactInput = Math.max(0, usage.input - base.input)
    const exactOutput = Math.max(0, usage.output - base.output)
    const { output: turnOutput, speedEstimated } = turnOutputSnapshot(state, exactOutput)
    const turnSpeed = recentOutputSpeed(state)

    return {
      elapsedMs,
      model: state.model,
      phase: state.phase,
      session: state.usage,
      speedEstimated,
      turnSpeedEstimated: turnSpeed != null,
      turnInput: exactInput,
      turnOutput,
      turnSpeed
    }
  }

  return {
    model: state.model,
    phase: state.phase,
    session: state.usage
  }
}
// TOKEN_METER_CORE_END

function fmtN(number) {
  const value = number || 0
  if (value >= 1e6) return `${(value / 1e6).toFixed(2).replace(/\.?0+$/, '')}M`
  if (value >= 1e3) return `${(value / 1e3).toFixed(1).replace(/\.0$/, '')}k`
  return String(value)
}

function fmtSpeed(speed) {
  if (speed == null || !Number.isFinite(speed) || speed < 0) return null
  return speed >= 100 ? `${Math.round(speed)} tok/s` : `${speed.toFixed(1)} tok/s`
}

function fmtDur(ms) {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return seconds % 60 ? `${minutes}m${seconds % 60}s` : `${minutes}m`
}

const listeners = new Set()
let meterState = createMeterState()
let meterStop = null
let requestGeneration = 0
let usageInFlightFor = null

function publish(next, force = false) {
  if (!force && Object.is(next, meterState)) return
  meterState = next
  for (const listener of listeners) listener()
}

const meterStore = {
  getSnapshot: () => meterState,
  subscribe(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }
}

function useMeter() {
  return meterView(useSyncExternalStore(meterStore.subscribe, meterStore.getSnapshot, meterStore.getSnapshot))
}

async function refreshUsage(runtimeId = meterState.runtimeId) {
  if (!runtimeId || usageInFlightFor === runtimeId) return null
  usageInFlightFor = runtimeId
  try {
    const usage = await host.request('session.usage', { session_id: runtimeId })
    publish(applyUsage(meterState, runtimeId, usage))
    return usage
  } catch {
    return null
  } finally {
    if (usageInFlightFor === runtimeId) usageInFlightFor = null
  }
}

function statusSaysRunning(result) {
  return Boolean(result && typeof result.output === 'string' && /Agent Running:\s*Yes/i.test(result.output))
}

async function syncSelectedRuntime(runtimeId) {
  const generation = ++requestGeneration
  publish(selectRuntime(meterState, runtimeId))
  if (!runtimeId) return

  const [usageResult, statusResult] = await Promise.allSettled([
    host.request('session.usage', { session_id: runtimeId }),
    host.request('session.status', { session_id: runtimeId })
  ])
  if (generation !== requestGeneration || meterState.runtimeId !== runtimeId) return

  if (usageResult.status === 'fulfilled') {
    publish(applyUsage(meterState, runtimeId, usageResult.value))
  }
  // This is a hot-reload/reconnect backstop. Normal starts are message.start
  // events. If the plugin joins mid-turn, status is the only existing RPC that
  // exposes the live running bit.
  if (statusResult.status === 'fulfilled' && statusSaysRunning(statusResult.value)) {
    publish(startTurn(meterState, runtimeId))
  }
}

async function settleBackstop(runtimeId) {
  if (!runtimeId || meterState.runtimeId !== runtimeId || meterState.phase !== 'active') return
  try {
    const status = await host.request('session.status', { session_id: runtimeId })
    if (meterState.runtimeId !== runtimeId || meterState.phase !== 'active' || statusSaysRunning(status)) return
    await refreshUsage(runtimeId)
    publish(finishTurn(meterState, runtimeId))
  } catch {
    // Gateway events remain the primary path; a failed backstop is harmless.
  }
}

function handleGatewayEvent(event) {
  const runtimeId = typeof event?.session_id === 'string' ? event.session_id : ''
  if (!runtimeId || runtimeId !== meterState.runtimeId) return

  if (event.type === 'message.start') {
    publish(startTurn(meterState, runtimeId))
    return
  }

  if (event.type === 'message.delta' || event.type === 'reasoning.delta') {
    const payload = event.payload && typeof event.payload === 'object' ? event.payload : {}
    const text = typeof payload.text === 'string' ? payload.text : ''
    publish(applyTextDelta(meterState, runtimeId, text))
    return
  }

  if (event.type !== 'session.info') return
  const payload = event.payload && typeof event.payload === 'object' ? event.payload : {}
  if (payload.usage && typeof payload.usage === 'object') {
    const usage = { ...payload.usage, model: payload.model || payload.usage.model }
    publish(applyUsage(meterState, runtimeId, usage))
  } else if (typeof payload.model === 'string') {
    publish(applyModel(meterState, runtimeId, payload.model))
  }

  if (payload.running === true) {
    publish(startTurn(meterState, runtimeId))
  } else if (payload.running === false) {
    publish(finishTurn(meterState, runtimeId))
  }
}

function startMeter(ctx) {
  if (meterStop) meterStop()
  const disposers = []
  let lastStatusBackstop = 0

  disposers.push(host.state.activeSessionId.subscribe(runtimeId => {
    void syncSelectedRuntime(runtimeId || null)
  }))
  disposers.push(host.onEvent('*', handleGatewayEvent))

  const timer = setInterval(() => {
    const runtimeId = meterState.runtimeId
    if (!runtimeId) return
    publish(tickMeter(meterState), meterState.phase === 'active')
    if (meterState.phase === 'active') {
      void refreshUsage(runtimeId)
      const now = Date.now()
      if (now - lastStatusBackstop >= STATUS_BACKSTOP_MS) {
        lastStatusBackstop = now
        void settleBackstop(runtimeId)
      }
    }
  }, POLL_MS)
  disposers.push(() => clearInterval(timer))

  meterStop = () => {
    ++requestGeneration
    for (const dispose of disposers.splice(0)) dispose()
    meterStop = null
  }
  ctx.onDispose(meterStop)
}

function ChipDetail() {
  const usage = useMeter()
  if (usage.phase === 'idle') {
    const session = usage.session
    if (session && (session.input > 0 || session.output > 0)) {
      return jsx('span', {
        className: 'flex items-center gap-1 tabular-nums text-(--ui-text-quaternary)',
        children: `S↑${fmtN(session.input)} ↓${fmtN(session.output)}`
      })
    }
    return jsx('span', { className: 'text-(--ui-text-quaternary)', children: '·' })
  }

  const burn = (usage.turnInput || 0) + (usage.turnOutput || 0)
  const speedText = usage.phase === 'active' ? fmtSpeed(usage.turnSpeed) : fmtSpeed(usage.speed)
  const outputText = fmtN(usage.turnOutput)
  const parts = []
  if (burn > 0) {
    parts.push(jsx('span', { key: 'tokens', children: `↑${fmtN(usage.turnInput)} ↓${outputText}` }))
  } else if (usage.phase === 'active') {
    parts.push(jsx('span', { key: 'waiting', className: 'text-(--ui-accent)', children: '…' }))
  }
  if (speedText) {
    parts.push(jsx('span', {
      key: 'speed',
      className: usage.phase === 'active' ? 'text-(--ui-accent)' : 'text-(--ui-text-quaternary)',
      children: usage.phase === 'done' ? `avg ${speedText}` : speedText
    }))
  }
  if (usage.phase === 'done' && usage.elapsedMs > 0) {
    parts.push(jsx('span', { key: 'duration', className: 'text-(--ui-text-quaternary)', children: fmtDur(usage.elapsedMs) }))
  }
  if (!parts.length) return null

  return jsx('span', {
    className: `${usage.phase === 'active' ? 'animate-pulse rounded-md bg-(--ui-accent)/15 px-1.5 py-0.5 text-(--ui-accent)' : ''} flex items-center gap-1 tabular-nums`,
    children: parts
  })
}

function Row({ label, value, sub }) {
  return jsxs('div', { className: 'flex items-center justify-between gap-2', children: [
    jsx('span', { className: 'min-w-0 flex-1 truncate text-(--ui-text-secondary)', children: label }),
    jsxs('div', { className: 'flex min-w-0 shrink-0 flex-col items-end text-right tabular-nums', children: [
      jsx('span', { className: 'whitespace-nowrap text-foreground', children: value }),
      sub ? jsx('span', { className: 'max-w-[8rem] truncate text-[0.66rem] text-(--ui-text-quaternary)', children: sub }) : null
    ] })
  ] })
}

function MeterPanel({ onClose }) {
  const usage = useMeter()
  const session = usage.session
  const turnRows = usage.phase === 'active' || usage.phase === 'done'
    ? [
        jsx(Row, { key: 'ti', label: 'Turn input', value: fmtN(usage.turnInput), sub: usage.phase === 'active' ? 'live' : 'final' }),
        jsx(Row, { key: 'to', label: 'Turn output', value: fmtN(usage.turnOutput) }),
        jsx(Row, { key: 'tt', label: 'Turn total', value: fmtN((usage.turnInput || 0) + (usage.turnOutput || 0)) }),
        jsx(Row, {
          key: 'ts',
          label: 'Output speed',
          value: fmtSpeed(usage.phase === 'active' ? usage.turnSpeed : usage.speed) || '—',
          sub: usage.phase === 'active' ? 'last 1s estimate' : usage.speedEstimated ? 'estimated average' : 'final average'
        }),
        jsx(Row, { key: 'td', label: 'Elapsed', value: usage.elapsedMs ? fmtDur(usage.elapsedMs) : '—' })
      ]
    : session && (session.input > 0 || session.output > 0)
      ? [
          jsx(Row, { key: 'si', label: 'Session input', value: fmtN(session.input) }),
          jsx(Row, { key: 'so', label: 'Session output', value: fmtN(session.output) }),
          jsx(Row, { key: 'st', label: 'Session total', value: fmtN(session.total), sub: session.calls ? `${session.calls} calls` : null }),
          jsx(Row, { key: 'ss', label: 'Status', value: 'Idle', sub: 'send a message to start' })
        ]
      : [jsx('div', { key: 'empty', className: 'py-4 text-center text-xs text-(--ui-text-quaternary)', children: 'No usage yet — send a message' })]

  const sessionRows = session
    ? [
        jsx(Row, { key: 'si', label: 'Session input', value: fmtN(session.input) }),
        jsx(Row, { key: 'so', label: 'Session output', value: fmtN(session.output) }),
        jsx(Row, { key: 'st', label: 'Session total', value: fmtN(session.total), sub: session.calls ? `${session.calls} calls` : null }),
        ...(session.reasoning ? [jsx(Row, { key: 'sr', label: 'Reasoning', value: fmtN(session.reasoning) })] : []),
        ...(session.cacheRead ? [jsx(Row, { key: 'sc', label: 'Cache read', value: fmtN(session.cacheRead) })] : [])
      ]
    : [jsx('div', { key: 'none', className: 'py-4 text-center text-xs text-(--ui-text-quaternary)', children: 'No session yet' })]

  return jsxs('div', { className: 'flex w-80 flex-col text-sm', children: [
    jsxs('div', { className: 'flex items-center justify-between gap-2 border-b border-border/50 px-3 py-2', children: [
      jsxs('div', { className: 'flex items-center gap-1.5 text-[0.7rem] font-medium leading-none', children: [
        jsx(StatusDot, { tone: usage.phase === 'active' ? 'good' : 'muted' }),
        jsx('span', { children: 'Token Meter' })
      ] }),
      jsx('button', {
        type: 'button',
        onClick: () => { haptic('tap'); onClose() },
        className: 'rounded p-0.5 text-(--ui-text-tertiary) hover:text-foreground',
        children: jsx(icons.X, { className: 'size-3' })
      })
    ] }),
    jsx('div', { className: 'flex flex-col gap-2 border-b border-border/50 px-3 py-2.5', children: [
      jsx('div', { className: 'text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-(--ui-text-quaternary)', children: 'This turn' }),
      ...turnRows
    ] }),
    jsx('div', { className: 'flex flex-col gap-2 px-3 py-2.5', children: [
      jsx('div', { className: 'text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-(--ui-text-quaternary)', children: 'Session' }),
      ...sessionRows
    ] }),
    jsx('div', { className: 'border-t border-border/50 px-3 py-1.5 text-[0.62rem] text-(--ui-text-quaternary)', children: `model: ${usage.model || '—'}` })
  ] })
}

export default {
  id: 'token-meter',
  name: 'Token Meter',
  description: 'Live per-turn input/output tokens, output speed, and elapsed time.',
  register(ctx) {
    startMeter(ctx)
    ctx.register({
      id: 'pill',
      area: 'statusBar.right',
      order: 125,
      data: {
        id: 'token-meter',
        variant: 'menu',
        label: 'Tokens',
        icon: jsx(icons.Activity, { className: 'size-3' }),
        detail: jsx(ChipDetail, {}),
        menuClassName: 'w-80',
        menuContent: close => jsx(MeterPanel, { onClose: close })
      }
    })
  }
}
