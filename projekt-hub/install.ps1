<#
.SYNOPSIS
  Installiert den Projekt-Hub und legt Projekt- und Cache-Ordner auf H: an.

.DESCRIPTION
  - legt H:\Projekte (Projekte), H:\DevCache (Paket-Caches) und H:\Projekt-Hub (App) an
  - leitet npm/yarn/pnpm/bun/pip/uv/Playwright-Caches per Benutzer-Umgebungsvariable nach H:\DevCache um
  - kopiert die App, schreibt config.json, legt Verknüpfungen (Desktop, Startmenü, Autostart) an
  - optional: verschiebt die Claude-Code-Konfiguration nach H:\DevCache\claude (-MoveClaudeConfig)
  Nichts wird gelöscht. Vorherige Werte der Umgebungsvariablen landen in env-backup.json.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File install.ps1
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File install.ps1 -Drive D -NoAutostart
#>
[CmdletBinding()]
param(
  [string]$Drive = 'H',
  [string]$ProjectsRoot,
  [string]$CacheRoot,
  [string]$HubDir,
  [string]$MaxMePath,
  [int]$Port = 4310,
  [switch]$MoveClaudeConfig,
  [switch]$NoCacheVars,
  [switch]$NoAutostart,
  [switch]$NoShortcuts,
  [switch]$NoStart,
  [switch]$Yes
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2

function Step([string]$Text) { Write-Host ''; Write-Host "==> $Text" -ForegroundColor Green }
function Info([string]$Text) { Write-Host "    $Text" }
function Warn([string]$Text) { Write-Host "    ! $Text" -ForegroundColor Yellow }
function Confirm-Choice([string]$Question) {
  if ($Yes) { return $true }
  $answer = Read-Host "    $Question [J/n]"
  return ($answer -eq '' -or $answer -match '^[jJyY]')
}
function Write-Utf8NoBom([string]$Path, [string]$Text) {
  $encoding = New-Object System.Text.UTF8Encoding($false)
  [System.IO.File]::WriteAllText($Path, $Text, $encoding)
}
function New-Shortcut([string]$Path, [string]$Target, [string]$Arguments, [string]$WorkDir, [string]$IconPath) {
  $shell = New-Object -ComObject WScript.Shell
  $link = $shell.CreateShortcut($Path)
  $link.TargetPath = $Target
  $link.Arguments = $Arguments
  $link.WorkingDirectory = $WorkDir
  $link.WindowStyle = 7
  $link.Description = 'Projekt-Hub - alle Projekte auf einen Blick'
  if ($IconPath -and (Test-Path -LiteralPath $IconPath)) { $link.IconLocation = $IconPath }
  $link.Save()
}

$Drive = $Drive.Trim().TrimEnd(':', '\').ToUpper()
$DriveRoot = "$($Drive):\"
if (-not $ProjectsRoot) { $ProjectsRoot = Join-Path $DriveRoot 'Projekte' }
if (-not $CacheRoot) { $CacheRoot = Join-Path $DriveRoot 'DevCache' }
if (-not $HubDir) { $HubDir = Join-Path $DriveRoot 'Projekt-Hub' }
if (-not $MaxMePath) { $MaxMePath = Join-Path $DriveRoot 'MY-SKILLS\MAX-ME' }

Write-Host ''
Write-Host '  Projekt-Hub - Installation' -ForegroundColor Cyan
Write-Host "  Projekte : $ProjectsRoot"
Write-Host "  Cache    : $CacheRoot"
Write-Host "  App      : $HubDir"

# ---------------------------------------------------------------- 1. Voraussetzungen
Step 'Voraussetzungen pruefen'
if (-not (Test-Path -LiteralPath $DriveRoot)) {
  throw "Laufwerk $DriveRoot nicht gefunden. Laufwerk anschliessen oder z. B. -Drive D angeben."
}
Info "Laufwerk $DriveRoot gefunden"

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  Warn 'Node.js wurde nicht gefunden.'
  if ((Get-Command winget -ErrorAction SilentlyContinue) -and (Confirm-Choice 'Node.js LTS jetzt mit winget installieren?')) {
    & winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
    $node = Get-Command node -ErrorAction SilentlyContinue
  }
  if (-not $node) { throw 'Node.js 18 oder neuer wird benoetigt: https://nodejs.org (LTS) installieren und install.ps1 erneut starten.' }
}
$nodeVersion = (& node --version).Trim().TrimStart('v')
if ([int]($nodeVersion.Split('.')[0]) -lt 18) { throw "Node.js $nodeVersion ist zu alt - mindestens Version 18 noetig." }
Info "Node.js $nodeVersion"

if (Get-Command git -ErrorAction SilentlyContinue) { Info ((& git --version) -replace 'git version ', 'Git ') }
else { Warn 'Git fehlt - Git-Status und Sync sind ohne Git nicht verfuegbar. Installieren: winget install Git.Git' }

$ghReady = $false
if (Get-Command gh -ErrorAction SilentlyContinue) {
  # via cmd: in Windows PowerShell 5.1 redirected native stderr would become a terminating error here
  & cmd.exe /d /c "gh auth status >nul 2>&1"
  if ($LASTEXITCODE -eq 0) { $ghReady = $true; Info 'GitHub CLI angemeldet - fehlende Repos werden automatisch geklont' }
  else { Warn 'GitHub CLI nicht angemeldet - einmal "gh auth login" ausfuehren, damit GitHub-Repos auf H: landen.' }
} else {
  Warn 'GitHub CLI fehlt (optional). Fuer automatisches Klonen: winget install GitHub.cli, danach gh auth login'
}

$sourceApp = Join-Path $PSScriptRoot 'app'
if (-not (Test-Path -LiteralPath (Join-Path $sourceApp 'server.js'))) {
  throw "app\server.js nicht gefunden neben install.ps1 ($sourceApp). Bitte den kompletten Ordner projekt-hub entpacken."
}

# ---------------------------------------------------------------- 2. Ordner
Step "Ordner auf $DriveRoot anlegen"
$hubCache = Join-Path $CacheRoot 'projekt-hub'
foreach ($dir in @($ProjectsRoot, $CacheRoot, $hubCache, $HubDir)) {
  if (Test-Path -LiteralPath $dir) { Info "vorhanden : $dir" }
  else { New-Item -ItemType Directory -Force -Path $dir | Out-Null; Info "angelegt  : $dir" }
}

# ---------------------------------------------------------------- 3. Caches
$cacheVars = [ordered]@{
  'npm_config_cache'         = 'npm'
  'YARN_CACHE_FOLDER'        = 'yarn'
  'BUN_INSTALL_CACHE_DIR'    = 'bun'
  'PIP_CACHE_DIR'            = 'pip'
  'UV_CACHE_DIR'             = 'uv'
  'PLAYWRIGHT_BROWSERS_PATH' = 'ms-playwright'
}
$backupFile = Join-Path $HubDir 'env-backup.json'
if (-not (Test-Path -LiteralPath $backupFile)) {
  $original = [ordered]@{}
  foreach ($name in (@($cacheVars.Keys) + @('CLAUDE_CONFIG_DIR'))) {
    $original[$name] = [Environment]::GetEnvironmentVariable($name, 'User')
  }
  Write-Utf8NoBom $backupFile ($original | ConvertTo-Json)
}

if (-not $NoCacheVars) {
  Step "Paket-Caches nach $CacheRoot umleiten (Benutzer-Umgebungsvariablen)"
  foreach ($name in $cacheVars.Keys) {
    $dir = Join-Path $CacheRoot $cacheVars[$name]
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    [Environment]::SetEnvironmentVariable($name, $dir, 'User')
    Set-Item -Path "Env:$name" -Value $dir
    Info ('{0,-26} -> {1}' -f $name, $dir)
  }
  if (Get-Command pnpm -ErrorAction SilentlyContinue) {
    $pnpmStore = Join-Path $CacheRoot 'pnpm-store'
    & pnpm config set store-dir $pnpmStore --global | Out-Null
    Info ('{0,-26} -> {1}' -f 'pnpm store-dir', $pnpmStore)
  }
  Info 'Gilt fuer neu geoeffnete Terminals. Playwright-Browser werden beim naechsten Bedarf auf H: neu geladen.'
}

if ($MoveClaudeConfig) {
  Step 'Claude-Code-Konfiguration nach H: verschieben'
  $claudeSrc = Join-Path $env:USERPROFILE '.claude'
  $claudeDst = Join-Path $CacheRoot 'claude'
  New-Item -ItemType Directory -Force -Path $claudeDst | Out-Null
  if (Test-Path -LiteralPath $claudeSrc) {
    & robocopy $claudeSrc $claudeDst /E /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "Kopieren der Claude-Konfiguration fehlgeschlagen (robocopy $LASTEXITCODE)." }
  }
  $claudeJson = Join-Path $env:USERPROFILE '.claude.json'
  if ((Test-Path -LiteralPath $claudeJson) -and -not (Test-Path -LiteralPath (Join-Path $claudeDst '.claude.json'))) {
    Copy-Item -LiteralPath $claudeJson -Destination $claudeDst
  }
  [Environment]::SetEnvironmentVariable('CLAUDE_CONFIG_DIR', $claudeDst, 'User')
  Info "CLAUDE_CONFIG_DIR -> $claudeDst"
  Info "Original bleibt als Sicherung in $claudeSrc. Claude Code neu starten; ggf. einmal neu anmelden."
}

# ---------------------------------------------------------------- 4. App
Step "Projekt-Hub nach $HubDir kopieren"
$appDst = Join-Path $HubDir 'app'
$serverJs = Join-Path $appDst 'server.js'
$running = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine.Contains($serverJs) })
foreach ($proc in $running) {
  Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue
  Info "laufende Instanz beendet (PID $($proc.ProcessId))"
}
& robocopy $sourceApp $appDst /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "Kopieren fehlgeschlagen (robocopy $LASTEXITCODE)." }
foreach ($file in @('start-hidden.ps1', 'Projekt-Hub.cmd', 'uninstall.ps1', 'Deinstallieren.cmd', 'README.md')) {
  $src = Join-Path $PSScriptRoot $file
  if (Test-Path -LiteralPath $src) { Copy-Item -LiteralPath $src -Destination $HubDir -Force }
}
Get-ChildItem -LiteralPath $HubDir -Recurse -File | Unblock-File
Info 'App kopiert'

$configFile = Join-Path $HubDir 'config.json'
if (Test-Path -LiteralPath $configFile) {
  Info 'config.json existiert - deine Einstellungen bleiben erhalten'
} else {
  $config = [ordered]@{
    port      = $Port
    roots     = @($ProjectsRoot)
    cacheDir  = $hubCache
    maxMePath = $MaxMePath
    editor    = 'code'
    scanDepth = 1
    git       = [ordered]@{ trustRoots = $true }
    sync      = [ordered]@{ onStart = $true; intervalMinutes = 30; autoPull = $true; autoCloneMissing = $true }
    github    = [ordered]@{ owners = @(); includeForks = $false; includeArchived = $false }
  }
  Write-Utf8NoBom $configFile ($config | ConvertTo-Json -Depth 5)
  Info "config.json geschrieben ($configFile)"
}
if (-not (Test-Path -LiteralPath $MaxMePath)) {
  Warn "MAX-ME nicht gefunden unter $MaxMePath - 'SPINE einrichten' bleibt aus, bis der Pfad in den Einstellungen stimmt."
}

# ---------------------------------------------------------------- 5. Verknuepfungen
$psExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$launcher = Join-Path $HubDir 'start-hidden.ps1'
$iconFile = Join-Path $appDst 'public\icon.ico'
$openArgs = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcher`" -Open"
$bgArgs = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcher`""

if (-not $NoShortcuts) {
  Step 'Verknuepfungen anlegen'
  $desktopLink = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Projekt-Hub.lnk'
  $startLink = Join-Path ([Environment]::GetFolderPath('Programs')) 'Projekt-Hub.lnk'
  New-Shortcut $desktopLink $psExe $openArgs $HubDir $iconFile
  New-Shortcut $startLink $psExe $openArgs $HubDir $iconFile
  Info "Desktop   : $desktopLink"
  Info "Startmenue: $startLink"
}
if (-not $NoAutostart) {
  $autoLink = Join-Path ([Environment]::GetFolderPath('Startup')) 'Projekt-Hub.lnk'
  New-Shortcut $autoLink $psExe $bgArgs $HubDir $iconFile
  Info "Autostart : $autoLink (startet still bei der Anmeldung und synchronisiert)"
}

# ---------------------------------------------------------------- 6. Start
if (-not $NoStart) {
  Step 'Projekt-Hub starten'
  Start-Process -FilePath $psExe -ArgumentList $openArgs -WindowStyle Hidden
  Info "Laeuft auf http://127.0.0.1:$Port/ - der Browser oeffnet sich gleich."
}

Write-Host ''
Write-Host '  Fertig.' -ForegroundColor Green
Write-Host "  Neue Projekte: im Hub 'Neues Projekt' oder einfach einen Ordner in $ProjectsRoot anlegen."
if (-not $ghReady) { Write-Host '  Tipp: "gh auth login" ausfuehren, damit alle GitHub-Repos automatisch nach H: geklont werden.' }
Write-Host "  Deinstallieren: $HubDir\Deinstallieren.cmd (Projekte und Caches bleiben erhalten)."
Write-Host ''
