@echo off
rem Double-click to start Vibe Clip in development mode.
cd /d "%~dp0"
if not exist node_modules (
  echo First run: installing packages (downloads about 400 MB, takes a few minutes)...
  call npm install || (echo npm install failed & pause & exit /b 1)
)
call npm run dev
