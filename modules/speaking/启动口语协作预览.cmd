@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Please install Node.js 22.13 or later. & pause & exit /b 1)
node scripts/build-worker.mjs || (pause & exit /b 1)
node scripts/preview.mjs
pause
