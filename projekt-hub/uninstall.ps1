<#
.SYNOPSIS
  Entfernt den Projekt-Hub: stoppt den Server, loescht Verknuepfungen und App-Dateien
  und stellt die Umgebungsvariablen aus env-backup.json wieder her.
  Projekte (H:\Projekte) und Caches (H:\DevCache) werden NICHT angetastet.
#>
[CmdletBinding()]
param([switch]$KeepFiles, [switch]$Yes)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2
$HubDir = $PSScriptRoot

function Info([string]$Text) { Write-Host "    $Text" }

if (-not $Yes) {
  $answer = Read-Host "Projekt-Hub aus $HubDir entfernen? Projekte und Caches bleiben erhalten. [j/N]"
  if ($answer -notmatch '^[jJyY]') { Write-Host 'Abgebrochen.'; exit 0 }
}

Write-Host '==> Server stoppen' -ForegroundColor Green
$serverJs = Join-Path $HubDir 'app\server.js'
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine.Contains($serverJs) } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue; Info "PID $($_.ProcessId) beendet" }

Write-Host '==> Verknuepfungen entfernen' -ForegroundColor Green
foreach ($folder in @('Desktop', 'Programs', 'Startup')) {
  $link = Join-Path ([Environment]::GetFolderPath($folder)) 'Projekt-Hub.lnk'
  if (Test-Path -LiteralPath $link) { Remove-Item -LiteralPath $link -Force; Info "entfernt: $link" }
}

Write-Host '==> Umgebungsvariablen wiederherstellen' -ForegroundColor Green
$backupFile = Join-Path $HubDir 'env-backup.json'
if (Test-Path -LiteralPath $backupFile) {
  $backup = Get-Content -LiteralPath $backupFile -Raw | ConvertFrom-Json
  foreach ($prop in $backup.PSObject.Properties) {
    [Environment]::SetEnvironmentVariable($prop.Name, $prop.Value, 'User')
    if ($prop.Value) { Info "$($prop.Name) = $($prop.Value)" } else { Info "$($prop.Name) entfernt" }
  }
} else {
  Info 'Keine env-backup.json gefunden - Variablen bleiben unveraendert.'
}

if (-not $KeepFiles) {
  Write-Host '==> App-Dateien entfernen' -ForegroundColor Green
  $appDir = Join-Path $HubDir 'app'
  if (Test-Path -LiteralPath $appDir) { Remove-Item -LiteralPath $appDir -Recurse -Force; Info "entfernt: $appDir" }
  foreach ($file in @('start-hidden.ps1', 'Projekt-Hub.cmd', 'README.md', 'env-backup.json', 'Deinstallieren.cmd')) {
    $path = Join-Path $HubDir $file
    if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
  }
  Info "config.json bleibt in $HubDir (fuer eine spaetere Neuinstallation)."
}

Write-Host ''
Write-Host 'Projekt-Hub entfernt. Neue Terminals oeffnen, damit die Variablen-Aenderung greift.' -ForegroundColor Green
# uninstall.ps1 selbst wird zuletzt entfernt
if (-not $KeepFiles) { Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue }
