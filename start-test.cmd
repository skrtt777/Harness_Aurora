@echo off
set "PROJECT_ROOT=%~dp0"
start "AI Harness API" powershell -NoProfile -ExecutionPolicy Bypass -Command "Set-Location -LiteralPath '%PROJECT_ROOT%'; npm start"
start "AI Harness UI" powershell -NoProfile -ExecutionPolicy Bypass -Command "Set-Location -LiteralPath '%PROJECT_ROOT%'; npm run frontend:dev"
timeout /t 3 /nobreak >nul
start "" http://127.0.0.1:5173/
