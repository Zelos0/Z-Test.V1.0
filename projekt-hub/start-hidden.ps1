# Startet den Projekt-Hub unsichtbar im Hintergrund. -Open oeffnet zusaetzlich den Browser.
# Laeuft der Hub schon, oeffnet server.js nur den Browser und beendet sich wieder.
param([switch]$Open)

$ErrorActionPreference = 'Stop'
$server = Join-Path $PSScriptRoot 'app\server.js'
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show('Node.js wurde nicht gefunden. Bitte Node.js LTS installieren (winget install OpenJS.NodeJS.LTS).', 'Projekt-Hub') | Out-Null
  exit 1
}
$argList = @("`"$server`"")
if ($Open) { $argList += '--open' }
Start-Process -FilePath $node.Source -ArgumentList $argList -WorkingDirectory $PSScriptRoot -WindowStyle Hidden
