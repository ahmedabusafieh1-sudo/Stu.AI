@echo off
title Stu.Ai Server and Cloudflare Tunnel
echo ===================================================
echo Starting Stu.Ai Full-Stack Server on port 3001...
echo ===================================================
start /B npx tsx server/index.ts
timeout /t 3 /nobreak >nul
echo Starting Cloudflare Tunnel...
.\cloudflared.exe tunnel --url http://127.0.0.1:3001
pause
