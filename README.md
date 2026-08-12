# token-meter

Real-time token usage meter for the Hermes desktop status bar: rolling
one-second output speed while a response streams, usage-corrected per-turn
totals, and a pinned final average.

**English** | [简体中文](README.zh-CN.md)

Status bar while a turn is streaming:

```text
Tokens ↑36.6k ↓1.4k  77.8 tok/s
```

## What it does

- **Rolling one-second speed** — `XX tok/s` reflects only the output tokens
  received in the last 1,000 ms. The number rises and falls with the real
  stream and decays to `0.0 tok/s` when output pauses — never a cumulative
  average over the whole turn.
- **Stream-first estimates, usage-corrected** — `message.delta` /
  `reasoning.delta` chunks are tokenized locally (CJK ≈ 1 token/char, other
  text ≈ 1 token/4 chars) for instant display; provider `session.info.usage`
  then corrects the cumulative totals and computes the final `avg`.
- **No synthetic spikes** — a late batch usage update is never counted as a
  burst of tokens inside the speed window.
- **Multi-call turns** — tool calls and multiple model calls inside one turn
  keep the stream tail moving instead of freezing after the first API
  response.
- **Session following** — switching conversations switches the meter; the idle
  state shows session totals aggregated across all model rows (a conversation
  that changes models spans several `session_model_usage` rows).

## How it works

| Event | Role |
|---|---|
| `host.state.activeSessionId` | Follows the visible desktop session; switching resets the meter |
| `message.start` | Starts the turn and snapshots the usage baseline |
| `message.delta` / `reasoning.delta` | Append timestamped token estimates to the trailing 1,000 ms speed window |
| `session.info` | `running === false` ends the turn; provider `usage` corrects totals |

Design rules:

- `session.info.payload.running === false` is the **only** turn-end signal —
  never infer turn boundaries from silence (tool calls can be quiet for
  minutes) or from token growth.
- The speed window is a strict trailing 1,000 ms of timestamped samples; a
  one-second tick prunes old samples so a quiet window visibly decays to
  `0.0 tok/s`.
- Provider usage corrects cumulative counters only — it is never injected into
  the speed window as a rate sample.
- No displayed number carries a `~` prefix; estimation status is disclosed in
  words (`last 1s estimate`, `estimated average`) in the popover.
- The dashboard backend aggregates `session_model_usage` per `(session_id,
  model)` — reading only the newest row silently loses tokens from other
  models.

## Files

```text
token-meter/
├── plugin.js                  # frontend: event-driven store + status-bar chip + popover
├── plugin.test.mjs            # state-machine tests + display assertions
├── plugin.yaml                # plugin metadata (required for `hermes plugins enable`)
├── dashboard/
│   ├── manifest.json          # dashboard plugin discovery (status-bar-only)
│   ├── plugin_api.py          # thin FastAPI router, hot-reloads impl.py per request
│   └── impl.py                # READ-ONLY state.db queries
├── INSTALL.md
├── INSTALL.zh-CN.md
├── README.md
└── README.zh-CN.md
```

## Install

**Option A — release package (recommended)**

Download `hermes-token-meter-<version>-install.zip` from the
[Releases](https://github.com/3684142/hermes-token-meter/releases) page.
Unzip, then copy the two directories into your Hermes home directory (the
folder containing `state.db` — `HERMES_HOME`, usually `~/.hermes`, on Windows
commonly `%LOCALAPPDATA%\hermes`):

```text
desktop-plugins/token-meter/  →  <hermes-home>/desktop-plugins/token-meter/
plugins/token-meter/          →  <hermes-home>/plugins/token-meter/
```

**Option B — git**

```bash
git clone https://github.com/3684142/hermes-token-meter.git
cp -r desktop-plugins/token-meter <hermes-home>/desktop-plugins/
cp -r plugins/token-meter         <hermes-home>/plugins/
```

Then enable and restart:

```bash
hermes plugins enable token-meter
```

Restart the Hermes desktop app — dashboard backend routes mount at startup.
The status-bar chip appears bottom-right.

Verify:

```bash
node <hermes-home>/desktop-plugins/token-meter/plugin.test.mjs
# token-meter state-machine tests: 12 passed; chip display assertions: 4 passed
```

## Updating

Replace the files (or `git pull --ff-only` if installed via git). If the
dashboard backend changed, restart the desktop app once so the new
`dashboard/` routes mount.

## Development

```bash
node --check plugin.js
node plugin.test.mjs
```

## License

MIT
