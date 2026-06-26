# AI UI Asset Generator

AI UI Asset Generator 是一个运行在 Figma 内的 AI UI 设计稿生成与资产切图插件。它可以通过提示词生成 App/UI 设计稿，也可以上传或粘贴参考图进行图生图。生成后的设计稿可以在插件内预览、轮播选择，并进入切图模式，把图标、按钮、插画等元素裁切成独立 PNG 资产，同时保留它们在原始设计稿里的坐标位置，方便一键放回 Figma 画布。

这个项目当前处于原型验证阶段，重点打通 AI 生图、Figma 导入、手动切图、透明 PNG 和坐标回填工作流。

## 核心能力

- 文生图：输入提示词生成 App/UI 设计稿
- 图生图：上传、拖拽或粘贴参考图生成新设计稿
- 多图结果：支持多张设计稿结果预览和轮播选择
- 手动切图：在生成图上直接框选 UI 元素
- 透明 PNG：支持将切出的资产处理为透明底图片
- 坐标保留：切图资产保留原图中的位置和尺寸
- 放入 Figma：自动创建画布，并把设计稿与切图资产导入 Figma
- 多供应商配置：支持第三方接口、OpenAI 官方等供应商

## 适用场景

- 快速生成 App 首页、弹窗、活动页、工具页等 UI 草图
- 从 AI 生成图中拆分 icon、按钮、插画、卡片等素材
- 将 AI 生成视觉稿导入 Figma 继续二次设计
- 辅助设计师、产品经理、独立开发者快速探索 UI 方向

## 项目结构

```text
.
├── manifest.json      # Figma 插件清单
├── code.js            # Figma 插件主线程，负责创建画布和导入图片
├── ui.html            # 插件 UI 和前端交互逻辑
├── server.js          # 本地 API 代理，负责调用图像模型
├── figma-sim.html     # 本地浏览器模拟 Figma 插件环境
├── package.json       # 本地启动脚本
├── 一键部署环境.command # Mac 用户双击启动本地环境
├── 一键部署环境.bat     # Windows 用户双击启动本地环境
├── .env.example       # 环境变量示例
└── docs/              # 产品规划和阶段计划
```

## 新手快速开始

如果你不熟悉终端，优先使用资源包里的“一键部署环境”文件：

- Mac：双击 `一键部署环境.command`
- Windows：双击 `一键部署环境.bat`

它会自动完成：

- 检查 Node.js 是否可用，以及版本是否为 20 或更高
- 如果没有 Node.js，会提示你下载，并自动打开 Node.js 官网
- 提示你用 `node -v` 和 `npm -v` 验证安装是否成功
- 安装或检查项目依赖
- 启动本地 API 服务

如果你双击后看到“未检测到 Node.js”或“Node.js 版本过低”，请先安装 Node.js：

```text
https://nodejs.org/
```

安装完成后，重新打开终端，输入：

```bash
node -v
npm -v
```

如果能看到类似下面的版本号，就说明 Node.js 和 npm 已经装好了：

```text
v20.x.x
10.x.x
```

然后重新双击“一键部署环境”文件即可。

看到下面这句，就说明本地后端启动成功：

```text
OpenAI image proxy listening on http://127.0.0.1:18787
```

重要：使用 Figma 插件期间，不要关闭这个窗口。

如果你熟悉终端，也可以直接运行这两条：

```bash
npm install
npm run api
```

区别是：

- `npm install`：只需要第一次安装项目时运行一次。
- `npm run api`：每次使用 Figma 插件前都要运行，并且这个终端窗口不要关。

`npm install` 安装成功时，通常会看到类似下面的结果：

```text
added ... packages
```

或者：

```text
up to date
```

只要最后没有红色 `error` 报错，并且项目文件夹里出现 `node_modules` 文件夹，就说明安装成功。

运行 `npm run api` 后，看到下面这句，就说明本地后端启动成功：

```text
OpenAI image proxy listening on http://127.0.0.1:18787
```

然后再去 Figma 里打开插件使用。

如果你不熟悉终端，可以继续按下面的详细步骤操作。

### 先准备这些东西

- 一台已经安装 Figma Desktop 的电脑
- Node.js 20 或更高版本
- 一个可用的图片生成模型 API Key
  - 可以是 OpenAI 官方
  - 可以是火山引擎
  - 可以是 AI Studio
  - 也可以是兼容 OpenAI 图片接口的第三方供应商

不知道有没有安装 Node.js，可以打开终端输入：

```bash
node -v
npm -v
```

如果 `node -v` 能看到类似 `v20.x.x`、`v22.x.x`、`v24.x.x` 的版本号，并且 `npm -v` 也能看到版本号，就可以继续。  
如果提示 `command not found: npm`，说明 Node.js 没装好，请先去 [Node.js 官网](https://nodejs.org/) 下载并安装。

更完整的使用流程、功能说明和常见问题见：

- [使用说明与功能说明](docs/使用说明与功能说明.md)
- [2.0 更新说明](docs/2.0-update.md)
- [2.0 Roadmap](docs/v2-roadmap.md)

### 第 1 步：打开项目目录

先打开终端，并进入这个项目文件夹。

Mac 打开终端：

- 打开 `访达`
- 进入 `应用程序`
- 打开 `实用工具`
- 双击 `终端`

Windows 打开终端：

- 在项目文件夹空白处点击鼠标右键
- 选择 `在终端中打开` 或 `Open in Terminal`

如果你已经打开了终端，但还没进入项目目录，可以输入 `cd` 加项目路径。

例如 Mac：

```bash
cd /path/to/AI-UI-Asset-Generator
```

例如 Windows：

```powershell
cd C:\path\to\AI-UI-Asset-Generator
```

进入后输入下面命令确认位置。

Mac 输入：

```bash
pwd
```

Windows 输入：

```powershell
echo %cd%
```

如果返回的是你的项目文件夹路径，就说明位置对了。

你也可以继续输入下面命令确认项目文件是否存在。

Mac 输入：

```bash
ls
```

Windows 输入：

```powershell
dir
```

如果返回结果里能看到 `package.json`、`server.js`、`manifest.json`，说明目录正确。

### 第 2 步：安装依赖

只需要第一次运行项目时执行一次：

Mac 输入：

```bash
npm install
```

Windows 输入：

```powershell
npm install
```

如果安装成功，终端最后通常会看到类似下面内容：

```text
added ... packages
```

或者：

```text
up to date
```

只要最后没有红色 `error` 报错，并且项目目录里出现 `node_modules` 文件夹，就说明依赖安装成功。

如果提示 `npm: command not found` 或 `npm 不是内部或外部命令`，说明电脑还没安装 Node.js，需要先安装 Node.js 20 或更高版本。

### 第 3 步：启动本地 API

插件不能直接在 Figma 里调用 AI 接口，所以需要先启动一个本地 API 服务。

Mac 输入：

```bash
npm run api
```

Windows 输入：

```powershell
npm run api
```

看到类似下面内容，说明后端启动成功：

```text
OpenAI image proxy listening on http://127.0.0.1:18787
```

重要：这个终端窗口不要关。  
只要你在用插件生成图片，这个窗口就要保持运行。

如果后面插件提示“本地后端未启动或无法连接”，一般就是这个终端窗口被关掉了，重新运行 `npm run api` 即可。

### 第 4 步：在 Figma 里加载插件

1. 打开 Figma Desktop。
2. 点击顶部菜单 `Plugins`。
3. 选择 `Development`。
4. 点击 `Import plugin from manifest...`。
5. 选择本项目里的 `manifest.json`。
6. 运行 `AI UI Asset Generator`。

加载成功后，你会看到插件面板。

### 第 5 步：配置供应商和 API Key

在插件设置面板里选择一个供应商：

- **第三方**：推荐给大多数用户。填写供应商的 Base URL、模型名和 API Key。
- **官方 OpenAI**：填写 OpenAI 官方 API Key 和模型名。
- **火山引擎**：填写火山引擎 API Key 和模型名。
- **AI Studio**：填写 AI Studio API Key 和模型名。

配置完成后先点“测试连接”或保存配置。  
确认成功后，再回到生图页面生成设计稿。

注意：真实 API Key 只保存在本地，不要提交到 GitHub。

项目已经默认忽略这些本地配置文件：

- `.env`
- `.env.local`
- `.local-provider-config.json`

### 第 6 步：确认环境已经配置成功

你可以按下面 3 个结果判断环境是否配置好了：

1. **终端里看到本地 API 地址**

   Mac 输入：

   ```bash
   npm run api
   ```

   Windows 输入：

   ```powershell
   npm run api
   ```

   如果终端返回类似下面内容，就是正确的：

   ```text
   OpenAI image proxy listening on http://127.0.0.1:18787
   ```

   这说明本地后端已经启动。这个终端窗口不要关。

2. **插件设置里测试连接成功**

   在 Figma 插件的设置面板里填好供应商、模型名和 API Key 后，点击“测试连接”。

   如果插件提示“连接成功”或类似成功提示，就是正确的。

   如果提示模型不可用、API Key 错误、连接失败，通常是供应商地址、模型名或 API Key 填错了。

3. **能生成一张图**

   回到“文生图”页面，输入一句简单提示词，例如：

   ```text
   生成一个蓝色风格的手机 App 首页
   ```

   选择 1 张图，点击生成。  
   如果插件里出现生成结果图，就是正确的，说明环境已经完整跑通。

如果第 1 步成功，但第 2、3 步失败，通常是 API Key、模型名或供应商地址填错了。  
如果第 1 步失败，通常是本地后端没有启动，或者终端窗口被关闭了。

## 常见问题

### 插件提示“本地后端未启动或无法连接”

通常是因为没有运行：

```bash
npm run api
```

或者运行后把终端窗口关掉了。

解决方法：

1. 打开终端。
2. 进入项目目录。
3. 重新执行 `npm run api`。
4. 回到 Figma 插件里重新操作。

### 生成失败，提示模型不可用

如果看到类似：

```text
No available channel for model ...
```

说明当前供应商不支持你填写的模型名，或者这个 API Key 没有该模型权限。

解决方法：

- 回到插件设置。
- 确认供应商选对了。
- 把模型名改成供应商实际支持的图片生成模型。
- 保存后重新生成。

### `npm install` 失败

常见原因是 Node.js 版本过低或网络问题。

建议先检查：

```bash
node -v
```

如果版本低于 20，请先升级 Node.js。

## 供应商配置

插件支持在设置面板中配置可用供应商。常见配置包括：

- 第三方：用户自己填写 Base URL、模型名和 API Key
- 官方 OpenAI
- 其他项目已接入或后续接入的供应商

前端会请求本地代理：

```text
http://127.0.0.1:18787
```

如果出现 `Failed to fetch`，通常表示本地 API 没启动，请先运行：

```bash
npm run api
```

## 后端接口

### `POST /api/images/generate`

文生图。请求示例：

```json
{
  "prompt": "生成一个健身 App 首页",
  "width": 390,
  "height": 844,
  "count": 4,
  "quality": "high",
  "outputFormat": "png"
}
```

### `POST /api/images/edit`

图生图。插件会把本地参考图读取为 data URL，后端再转换成对应供应商需要的请求格式。

```json
{
  "prompt": "根据参考图生成一个健身 App 首页",
  "width": 390,
  "height": 844,
  "images": [
    {
      "name": "reference.png",
      "type": "image/png",
      "dataUrl": "data:image/png;base64,..."
    }
  ]
}
```

### `POST /api/assets/generate-transparent`

透明 PNG 切图素材生成接口。当前主要用于将切出的素材进一步处理为透明底。

## 安全说明

发布到 GitHub 前请确认不要提交这些文件：

- `.local-provider-config.json`
- `.env`
- 任何包含真实 API Key 的截图或日志
- `node_modules/`

建议使用 `.env.example` 只保留示例配置。

## 路线规划

- 更稳定的背景修复模式
- 自动识别 UI 元素并生成切图建议
- 切图资产批量命名和管理
- 图片/icon 转 SVG 的可编辑化能力
- 结构化生成 Figma 可编辑图层
