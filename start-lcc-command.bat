@echo off
rem LCC COMMAND ワンクリック起動（Windows）
cd /d "%~dp0"
if not exist node_modules ( echo 初回セットアップ中... && call npm install )
start "" "docs\lcc-command-vui.html"
echo LCC COMMAND を起動します（停止は Ctrl+C）...
call npm run dev
