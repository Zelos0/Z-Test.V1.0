@echo off
rem Entfernt den Projekt-Hub. Projekte und Caches bleiben erhalten.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1" %*
echo.
pause
