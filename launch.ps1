# Opens Poker Trainer in its own Chrome window, starting the local server first if needed.
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$url = 'http://localhost:5173'

function Test-Server {
  try { (Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200 } catch { $false }
}

if (-not (Test-Server)) {
  if (-not (Test-Path (Join-Path $root 'node_modules'))) {
    Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', 'npm install' -WorkingDirectory $root -Wait -WindowStyle Minimized
  }
  # The server runs in a minimized window titled "Poker Trainer - server"; closing it stops the app.
  Start-Process -FilePath 'cmd.exe' -ArgumentList '/k', 'title Poker Trainer - server && npm run dev' -WorkingDirectory $root -WindowStyle Minimized
  for ($i = 0; $i -lt 60 -and -not (Test-Server); $i++) { Start-Sleep -Milliseconds 500 }
}

$chrome = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($chrome) {
  Start-Process -FilePath $chrome -ArgumentList "--app=$url", '--window-size=1280,900'
} else {
  Start-Process $url
}
