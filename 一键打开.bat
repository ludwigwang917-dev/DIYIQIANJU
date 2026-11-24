@echo off
chcp 65001 >nul
cd /d "%~dp0"

rem 用正式构建在本地玩：不盯源码、不会因为有人改文件就整页刷新、数据清零。
rem 写代码要热更新时另开终端用 npm.cmd run dev（那个模式下服务器重启会让页面清零）。

where npm.cmd >nul 2>&1
if errorlevel 1 (
  echo 未找到 npm.cmd，请先安装 Node.js（建议 >= 22.13）。
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo 首次运行：正在安装依赖...
  call npm.cmd install
  if errorlevel 1 (
    echo 依赖安装失败。
    pause
    exit /b 1
  )
)

echo 正在构建正式版（约半分钟）...
call npm.cmd run build
if errorlevel 1 (
  echo 构建失败，请把上面的报错发给开发者。
  pause
  exit /b 1
)

rem 复制一份单独跑：别的窗口跑 npm test 会重建 dist，直接跑 dist 的话服务器会在重建时崩掉。
robocopy dist ".wrangler\play" /MIR /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 (
  echo 复制构建结果失败。如果已经开着一个“一键打开”窗口，先关掉它再试。
  pause
  exit /b 1
)

echo.
echo 正在启动第一千局（正式版）...
echo 浏览器将在几秒后打开 http://localhost:8787
echo 关闭本窗口即可停止服务。改了代码要重新双击本文件才能看到。
echo.

start "" cmd /c "timeout /t 5 /nobreak >nul && start http://localhost:8787/"
call npx.cmd wrangler dev -c ".wrangler\play\server\wrangler.json" --port 8787

echo.
pause
