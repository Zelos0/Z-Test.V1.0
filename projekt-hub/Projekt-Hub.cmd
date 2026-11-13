@echo off
rem Startet den Projekt-Hub sichtbar mit Log-Ausgabe (zur Fehlersuche). Normalstart: Desktop-Verknuepfung.
cd /d "%~dp0"
node "%~dp0app\server.js" --open
if errorlevel 1 pause
