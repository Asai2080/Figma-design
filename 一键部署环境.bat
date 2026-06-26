@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo AI UI Asset Generator - 一键部署环境
echo -----------------------------------
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo 未检测到 Node.js。
  echo 请先安装 Node.js 20 或更高版本，然后重新双击本文件。
  echo 下载地址：https://nodejs.org/
  echo.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo 未检测到 npm。
  echo 请重新安装 Node.js 20 或更高版本，然后重新双击本文件。
  echo 下载地址：https://nodejs.org/
  echo.
  pause
  exit /b 1
)

for /f "usebackq delims=" %%v in (`node -p "Number(process.versions.node.split('.')[0])"`) do set NODE_MAJOR=%%v

if %NODE_MAJOR% LSS 20 (
  echo 当前 Node.js 版本过低：
  node -v
  echo 请升级到 Node.js 20 或更高版本，然后重新双击本文件。
  echo 下载地址：https://nodejs.org/
  echo.
  pause
  exit /b 1
)

echo Node.js 版本：
node -v
echo.
echo 正在安装或检查项目依赖...
echo.

call npm install
if errorlevel 1 (
  echo.
  echo 依赖安装失败。请检查上方红色错误信息。
  echo 常见原因：网络异常、Node.js 版本过低、项目目录没有写入权限。
  echo.
  pause
  exit /b 1
)

echo.
echo 依赖已准备好。
echo 正在启动本地 API 服务...
echo.
echo 看到下面这句就说明启动成功：
echo OpenAI image proxy listening on http://127.0.0.1:18787
echo.
echo 重要：使用 Figma 插件期间，请不要关闭这个窗口。
echo.

call npm run api

echo.
echo 本地服务已停止。
pause
