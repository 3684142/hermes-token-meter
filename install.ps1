# Install Hermes Token Meter into the active Hermes home (Windows).
# Usage:  powershell -ExecutionPolicy Bypass -File install.ps1
#         powershell -ExecutionPolicy Bypass -File install.ps1 -HermesHome D:\hermes
param(
  [string]$HermesHome = ""
)
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not $HermesHome) {
  if ($env:HERMES_HOME) {
    $HermesHome = $env:HERMES_HOME
  } elseif ($env:LOCALAPPDATA) {
    $HermesHome = Join-Path $env:LOCALAPPDATA "hermes"
  } else {
    $HermesHome = Join-Path $HOME ".hermes"
  }
}

$desktopSrc = Join-Path $root "desktop-plugins\token-meter"
$agentSrc   = Join-Path $root "plugins\token-meter"
$desktopDst = Join-Path $HermesHome "desktop-plugins\token-meter"
$agentDst   = Join-Path $HermesHome "plugins\token-meter"

if (-not (Test-Path (Join-Path $desktopSrc "plugin.js"))) {
  Write-Error "missing $desktopSrc\plugin.js"
}
if (-not (Test-Path (Join-Path $agentSrc "dashboard\plugin_api.py"))) {
  Write-Error "missing $agentSrc\dashboard\plugin_api.py"
}

New-Item -ItemType Directory -Force -Path (Join-Path $HermesHome "desktop-plugins"), (Join-Path $HermesHome "plugins") | Out-Null
if (Test-Path $desktopDst) { Remove-Item -Recurse -Force $desktopDst }
if (Test-Path $agentDst)   { Remove-Item -Recurse -Force $agentDst }
Copy-Item -Recurse -Force $desktopSrc $desktopDst
Copy-Item -Recurse -Force $agentSrc   $agentDst
# never ship bytecode
Get-ChildItem -Recurse -Path $agentDst -Include "__pycache__", "*.pyc" | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "Installed desktop plugin -> $desktopDst"
Write-Host "Installed agent/backend  -> $agentDst"

try {
  & hermes plugins enable token-meter
  if ($LASTEXITCODE -ne 0) { throw "hermes plugins enable failed with exit code $LASTEXITCODE" }
  Write-Host "Enabled token-meter in plugins.enabled"
} catch {
  Write-Host "note: run: hermes plugins enable token-meter"
  Write-Host "      (or add 'token-meter' under plugins.enabled in config.yaml)"
}

Write-Host ""
Write-Host "Next:"
Write-Host "  1. Restart the Hermes desktop app so /api/plugins/token-meter mounts"
Write-Host "     (reloading desktop plugins alone does NOT remount the Python backend)"
Write-Host "  2. Look for the 'Tokens' chip bottom-right in the status bar"
Write-Host ""
Write-Host "Verify: node `"$desktopDst\plugin.test.mjs`""
