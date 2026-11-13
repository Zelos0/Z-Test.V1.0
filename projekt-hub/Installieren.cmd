@echo off
rem Doppelklick: installiert den Projekt-Hub (Ordner + Cache auf H:). Optionen werden durchgereicht, z. B. -Drive D
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
echo.
pause
