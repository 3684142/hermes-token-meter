# Changelog

All notable changes to this project are documented in this file.

## [v1.4.1] - 2026-09-22

### Fixed

- The running `tok/s` reading did not stand out. Its highlight class
  (`bg-(--ui-accent)/15`) was plugin-only, and Tailwind scans only the app's own
  source tree — so it compiled to no rule and the highlight silently rendered as
  bare text on every theme.

### Changed

- The live speed now borrows the app's own `text-primary` class — the one the
  status bar itself uses for a highlighted reading — applied only while a turn is
  live. The highlight therefore follows every official theme (and any future
  change to what the app means by "highlighted"), instead of depending on a class
  only this plugin renders.
- The plugin's own stylesheet is now layout-only (inline layout, gap, tabular
  figures, popover subtitle width). It defines no colour, weight, or box, so the
  chip can never drift from the host's styling.
- Idle and finished readings are completely unstyled: no pill, no border, no
  bold. An interim revision painted a filled pill inside a 1px inset ring, which
  read as a selected control (the ring looked like a stray border around the
  numbers) and bolded the reading, making it the only heavy text in a bar whose
  highlight is colour-only.
- Tests assert the highlight contract: the borrowed class, the running-only
  application, and a layout-only plugin stylesheet.

## [v1.4.0] - 2026-08-13

Initial public release.

### Added

- Rolling one-second output speed (`XX tok/s`) in the status bar while a
  response streams — reflects only the last 1,000 ms, decays to `0.0 tok/s`
  on pause, never a cumulative average.
- Stream-first token estimates from `message.delta` / `reasoning.delta`
  (CJK ≈ 1 token/char, other text ≈ 1 token/4 chars), corrected by provider
  `session.info.usage` at turn end (`avg`).
- No synthetic speed spikes: late batch usage updates correct cumulative
  counters only, never the speed window.
- Multi-call turns: tool calls and multiple model calls keep the stream tail
  moving instead of freezing after the first API response.
- Session following: switching conversations switches the meter; idle state
  shows session totals aggregated across all `(session_id, model)` rows.
- No `~` prefixes on displayed numbers; estimation status is disclosed in the
  popover (`last 1s estimate`, `estimated average`).

### Infrastructure

- Canonical layout: `desktop-plugins/token-meter/` (frontend) +
  `plugins/token-meter/` (backend).
- One-command installers: `install.sh` (Linux/macOS/Git-Bash) and
  `install.ps1` (Windows PowerShell), both `HERMES_HOME`-aware.
- GitHub Actions CI (`check.yml`): `node --check` + state-machine tests on
  every push/PR.
- Bilingual docs: `README.md` / `README.zh-CN.md`, `INSTALL.md` /
  `INSTALL.zh-CN.md`.

[v1.4.1]: https://github.com/3684142/hermes-token-meter/releases/tag/v1.4.1
[v1.4.0]: https://github.com/3684142/hermes-token-meter/releases/tag/v1.4.0
