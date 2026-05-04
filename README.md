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
- 多供应商配置：支持第三方接口、OpenAI 官方 API、OpenRouter

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
├── .env.example       # 环境变量示例
└── docs/              # 产品规划和阶段计划
```

## 本地运行

需要 Node.js 20+。

1. 安装依赖：

```bash
npm install
```

2. 配置环境变量：

```bash
cp .env.example .env
```

然后在 `.env` 或插件配置面板里填入你的供应商地址、模型和 API Key。

注意：`.env` 和 `.local-provider-config.json` 已加入 `.gitignore`，不要把真实 API Key 提交到仓库。

3. 启动本地 API 代理：

```bash
npm run api
```

后端默认运行在：

```text
http://127.0.0.1:8787
```

健康检查：

```bash
curl http://127.0.0.1:8787/health
```

4. 启动本地预览：

```bash
npm run preview
```

打开：

```text
http://127.0.0.1:4173/figma-sim.html
```

也可以直接在 Figma Desktop 中导入 `manifest.json` 运行插件。

## 在 Figma 中加载

1. 打开 Figma Desktop
2. 进入 `Plugins > Development > Import plugin from manifest...`
3. 选择本目录的 `manifest.json`
4. 运行 `AI UI Asset Generator`
5. 在设置面板里配置供应商和 API Key
6. 生成设计稿，选择满意结果后进入切图模式
7. 框选需要的 UI 元素，点击 `放入 Figma`

## 供应商配置

插件目前支持三类供应商：

- 第三方：默认模型 `gpt-image-2-all`
- 官方 OpenAI：默认模型 `gpt-image-2`
- OpenRouter：固定模型 `gpt-5.4-image-2`

前端会请求本地代理：

```text
http://127.0.0.1:8787
```

如果出现 `Failed to fetch`，通常表示本地 API 代理没有启动，请先运行：

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

