# Hermes Token Meter

A real-time token usage meter for the [Hermes] desktop status bar. While a
response streams it shows per-turn input/output tokens and a **rolling
one-second output speed**; when the turn finishes it pins the whole-turn
average (`avg`) until the next turn.

## Features

- **Rolling one-second speed** — `XX tok/s` reflects only the output tokens
  received in the last 1,000 ms, so the number rises and falls with the actual
  stream and visibly decays to `0.0 tok/s` when output pauses — instead of
  showing a cumulative average over the whole turn.
- **Stream-first estimates, usage-corrected** — `message.delta` /
  `reasoning.delta` chunks are tokenized locally (CJK ≈ 1 token/char, other
  text ≈ 1 token/4 chars) for instant display; provider `session.info.usage`
  then corrects the cumulative totals and computes the final `avg` speed.
- **No synthetic spikes** — a late batch usage update never counts as a burst
  of tokens inside the speed window.
- **Multi-call turns** — tool calls and multiple model calls within one turn
  keep the stream tail moving instead of freezing after the first API
  response.
- **Session following** — switching conversations switches the meter; the idle
  state shows session-wide totals aggregated across all model rows (a
  conversation that changes models spans several `session_model_usage` rows).

## Architecture

| Part | File | Role |
|---|---|---|
| Frontend (renderer) | `plugin.js` | Event-driven store + status-bar chip + popover panel; subscribes to `host.state.activeSessionId`, `message.start`, `message.delta`, `reasoning.delta`, `session.info` |
| Tests | `plugin.test.mjs` | 12 state-machine scenarios + 4 display assertions |
| Metadata | `plugin.yaml` | Required for `hermes plugins enable token-meter` |
| Backend (dashboard) | `dashboard/plugin_api.py` | Thin FastAPI router, mounted at `/api/plugins/token-meter/`; hot-reloads `impl.py` per request |
| Backend logic | `dashboard/impl.py` | READ-ONLY `state.db` queries; aggregates `session_model_usage` per `(session_id, model)` |
| Manifest | `dashboard/manifest.json` | Dashboard plugin discovery (`tab.hidden: true` → status-bar-only plugin) |

Key design rules:

- `message.start` snapshots a usage baseline; `session.info.payload.running ===
  false` is the **only** turn-end signal — never infer turn boundaries from
  silence (tool calls can be quiet for minutes) or from token growth.
- The speed window is a strict trailing 1,000 ms of timestamped stream samples;
  a one-second tick prunes old samples so a quiet window decays to `0.0 tok/s`.
- Provider usage corrects cumulative counters only — it is never injected into
  the speed window as a rate sample.
- No displayed number carries a `~` prefix; estimation status is disclosed in
  words (`last 1s estimate`, `estimated average`) in the popover.

## Requirements

- Hermes desktop app (targets its runtime plugin API)
- Node.js 22+ for the test suite
- Python 3.10+ for the dashboard backend

## Install

1. Copy `plugin.js` to `<hermes-home>/desktop-plugins/token-meter/`
2. Copy `plugin.yaml` to `<hermes-home>/plugins/token-meter/`
3. Copy the `dashboard/` directory to `<hermes-home>/plugins/token-meter/dashboard/`
4. Enable the plugin: `hermes plugins enable token-meter`

The frontend hot-reloads on save; a new dashboard backend mounts at backend
startup.

## Development

```bash
node --check plugin.js
node plugin.test.mjs
# token-meter state-machine tests: 12 passed; chip display assertions: 4 passed
```

[Hermes]: https://hermes-agent.nousresearch.com
