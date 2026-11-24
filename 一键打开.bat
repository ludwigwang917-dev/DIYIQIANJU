@echo off
chcp 65001 >nul
cd /d "%~dp0"

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

echo 正在启动概率余烬开发服务器...
echo 浏览器将在几秒后打开 http://localhost:3000
echo 关闭本窗口即可停止服务。
echo.

start "" cmd /c "timeout /t 4 /nobreak >nul && start http://localhost:3000/"
call npm.cmd run dev

echo.
pause
