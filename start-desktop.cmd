@echo off
setlocal
cd /d "%~dp0apps\desktop"
".\node_modules\electron\dist\electron.exe" .
