@echo off
start "" "http://localhost:8000"
start /min python -m http.server 8000
timeout /t 2 /nobreak >nul
start "" ""
exit