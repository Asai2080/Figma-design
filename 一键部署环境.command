#!/bin/bash

set -u

cd "$(dirname "$0")" || exit 1

clear
echo "AI UI Asset Generator - 一键部署环境"
echo "-----------------------------------"
echo

if ! command -v node >/dev/null 2>&1; then
  echo "未检测到 Node.js。"
  echo "请先安装 Node.js 20 或更高版本，然后重新双击本文件。"
  echo "下载地址：https://nodejs.org/"
  echo
  read -r -p "按回车键退出..."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "未检测到 npm。"
  echo "请重新安装 Node.js 20 或更高版本，然后重新双击本文件。"
  echo "下载地址：https://nodejs.org/"
  echo
  read -r -p "按回车键退出..."
  exit 1
fi

NODE_MAJOR="$(node -p "Number(process.versions.node.split('.')[0])")"

if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "当前 Node.js 版本过低：$(node -v)"
  echo "请升级到 Node.js 20 或更高版本，然后重新双击本文件。"
  echo "下载地址：https://nodejs.org/"
  echo
  read -r -p "按回车键退出..."
  exit 1
fi

echo "Node.js 版本：$(node -v)"
echo
echo "正在安装或检查项目依赖..."
echo

npm install

if [ $? -ne 0 ]; then
  echo
  echo "依赖安装失败。请检查上方红色错误信息。"
  echo "常见原因：网络异常、Node.js 版本过低、项目目录没有写入权限。"
  echo
  read -r -p "按回车键退出..."
  exit 1
fi

echo
echo "依赖已准备好。"
echo "正在启动本地 API 服务..."
echo
echo "看到下面这句就说明启动成功："
echo "OpenAI image proxy listening on http://127.0.0.1:18787"
echo
echo "重要：使用 Figma 插件期间，请不要关闭这个终端窗口。"
echo

npm run api

echo
echo "本地服务已停止。"
read -r -p "按回车键退出..."
