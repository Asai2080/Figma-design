# Codex 交接文档

最后更新：2026-05-13

项目路径：

```text
/Users/zhuyanming/Documents/批量生成视频/figma插件（GPT生图导入figma）
```

这是一个 Figma 插件项目，目标是把 AI 生成的 UI App 设计稿导入 Figma，并支持切图、透明 PNG、SVG / AI SVG 实验、以及“图片生成可编辑设计稿”的实验链路。

## 1. 当前项目定位

插件名称：

```text
AI UI Asset Generator / AI Image Generator
```

当前核心能力：

- 文生图生成 UI/App 设计稿
- 图生图生成 UI/App 设计稿
- 支持多供应商：
  - 第三方接口
  - OpenAI 官方
  - OpenRouter
- 生成结果预览和轮播
- 手动切图
- 切图资产透明化
- SVG / AI 重绘 SVG 实验
- 一键放入 Figma
- 实验能力：把生成图还原成 H5，再把 H5 导入为可编辑 Figma 图层

当前用户重点关注：

1. 生成图质量和比例正确。
2. 切图资产能准确保留位置并放入 Figma。
3. 可编辑设计稿实验链路要提升还原度。
4. H5 预览不能假成功，如果 AI 还原失败要显示真实错误。
5. 切图资产必须进入 H5，还原后再进入 Figma。

## 2. 运行方式

安装依赖：

```bash
npm install
```

启动本地 API：

```bash
npm run api
```

API 地址：

```text
http://127.0.0.1:18787
```

健康检查：

```bash
curl http://127.0.0.1:18787/health
```

启动本地模拟器：

```bash
npm run preview
```

模拟器地址：

```text
http://127.0.0.1:4173/figma-sim.html
```

当前交接时进程状态：

- API 端口 `18787` 有进程，PID 为 `52053`
- 预览端口 `4173` 有进程，PID 为 `49965`

如果要重启：

```bash
kill 52053
npm run api
```

如需重启预览：

```bash
kill 49965
npm run preview
```

## 3. 当前配置状态

当前 `/health` 返回：

```json
{
  "ok": true,
  "activeProvider": "openrouter",
  "baseUrl": "https://openrouter.ai/api/v1",
  "model": "gpt-5.4-image-2",
  "hasApiKey": true
}
```

注意：

- `.local-provider-config.json` 存储本地供应商配置和 key，不能提交到 GitHub。
- `.env` / `.local-provider-config.json` 已在 `.gitignore` 中。
- 交接文档不要写真实 API Key。

## 4. 关键文件

```text
manifest.json
```

Figma 插件清单。

```text
code.js
```

Figma 插件主线程。负责：

- `figma.showUI`
- 窗口 resize / 迷你模式
- 接收 UI 消息
- 创建 Figma 画布
- 放入原图、切图资产、SVG、可编辑设计稿节点

```text
ui.html
```

插件前端。体积较大，负责：

- 文生图 / 图生图界面
- 供应商配置面板
- 生成结果预览
- 轮播
- 切图交互
- 透明 / AI 透明 / SVG / AI SVG
- H5 预览弹窗
- DOM 捕获并发送给 Figma 主线程

```text
server.js
```

本地 API 代理。负责：

- 调用图片模型
- 透明资产生成
- AI SVG 重绘
- 可编辑设计稿 manifest 实验
- H5 还原实验
- 对 AI 返回 HTML 做清洗和切图资产注入

```text
figma-sim.html
```

本地模拟 Figma 插件环境，用来在浏览器里调试 UI。

```text
vendor/web-to-figma-capture-adapter.js
```

最小化接入的 H5 DOM 捕获桥，参考 `Paidax01/web-to-figma` 的思路，用于把 iframe 里的 HTML/CSS 抽取成可放入 Figma 的节点描述。

```text
docs/v2-roadmap.md
```

2.0 规划文档。

```text
docs/editable-design-import-experiment.md
```

“图片 -> H5 -> Figma 可编辑设计稿”实验方案文档。

## 5. 当前 Git 工作区状态

交接时工作区是 dirty，不要随便回滚。

已修改：

```text
code.js
docs/editable-design-import-experiment.md
docs/v2-roadmap.md
figma-sim.html
server.js
ui.html
```

新增未跟踪：

```text
vendor/web-to-figma-capture-adapter.js
docs/codex-handoff.md
```

用户明确说过：2.0 开发完成之前先不推送 GitHub。

## 6. 已经跑通的能力

用户验收过的 1.0 / 2.0 基础能力：

- 文生图可以生成。
- 图生图可以上传或粘贴多张参考图。
- OpenRouter 模型固定为 `gpt-5.4-image-2`。
- 生成按钮文案已改为 `生成设计稿`。
- Figma 插件顶部内部关闭 icon 已去掉，保留 Figma 自己的外层关闭。
- 切图模式可以框选资产。
- 切图资产可以保持原位置。
- 放入 Figma 源文件流程基本可用。
- P0 背景修复和 P1 颜色填充做过尝试，用户后来觉得过度优化效果不好，需谨慎。
- SVG 普通矢量化和 AI 重绘 SVG 均做过，但用户认为 SVG 质量不稳定，暂时告一段落。
- 窗口 resize / 迷你模式已经做过一轮。
- 右侧预览区域曾经支持滚动，但最近用户要求“整个右侧内容超出就滚动，不要只有切图资产面板滚动”，需继续检查。

## 7. 当前正在处理的问题

### 7.1 H5 预览变成 fallback 模板

用户刚反馈：

> 这一版是图片上去了，为啥成这样了呢？为啥没有生成 html 直接放了一张图片？

原因已经定位：

- `/api/design/reconstruct-h5` 原先在 AI H5 生成失败时，会返回 `mode: "h5-template"`。
- 这个 fallback 模板会把原图半透明铺底，并显示 `H5 预览模板 / AI 还原不可用时显示`。
- 用户看到的是 fallback，不是真正的 AI 生成 HTML。

已经修改：

- `server.js` 中 `reconstructEditableDesignH5` 的 catch 不再返回 fallback。
- 现在会抛出 `AI H5 还原失败：...`，并在后端日志打印真实错误。

后续原则：

- 不要再静默 fallback。
- 如果 AI H5 失败，要让 UI 显示真实失败原因。
- fallback 只适合没有配置、没有图片时作为本地占位，不适合伪装成成功。

### 7.2 当前最新错误：OpenRouter credits / max_tokens

用户刚重试后出现：

```text
This request requires more credits, or fewer max_tokens.
You requested up to 65536 tokens, but can only afford 61879.
```

含义：

- 不是图片生成失败。
- 是 OpenRouter 的聊天补全请求默认预占 `65536` 输出 token。
- 当前账号余额只能支持 `61879`，所以请求被拒绝。

下一步建议：

在 `server.js` 里给 OpenRouter 的 H5/分析/manifest/SVG chat completion 请求显式加 token 上限。

建议常量：

```js
const OPENROUTER_ANALYSIS_MAX_TOKENS = Number(process.env.OPENROUTER_ANALYSIS_MAX_TOKENS || 4096);
const OPENROUTER_H5_MAX_TOKENS = Number(process.env.OPENROUTER_H5_MAX_TOKENS || 12000);
const OPENROUTER_MANIFEST_MAX_TOKENS = Number(process.env.OPENROUTER_MANIFEST_MAX_TOKENS || 8192);
const OPENROUTER_SVG_MAX_TOKENS = Number(process.env.OPENROUTER_SVG_MAX_TOKENS || 4096);
```

需要加的位置：

- `analyzeEditableDesignImage()` 的 `/chat/completions`
- `reconstructEditableDesignH5()` 的 `/chat/completions`
- `reconstructEditableDesign()` 的 manifest `/chat/completions`
- `requestSvgChatCompletion()` 的 `/chat/completions`

OpenRouter 一般兼容 `max_tokens`。如果模型要求 `max_completion_tokens`，可在错误后改为二选一；先用 `max_tokens` 更稳。

### 7.3 切图资产没有进入 H5

用户多次反馈：

- H5 里切图资产显示 broken image。
- 有时 HTML 和导入 Figma 都没有切图资产。
- 最近一轮图片上去了，但不是作为真实 H5 元素，像 fallback。

当前代码思路：

- 前端 `collectEditableReferenceAssets(activeImage)` 收集当前选中图的切图资产。
- 只发送 PNG/JPEG data URL。
- 后端 `normalizeEditableReferenceAssets()` 归一化。
- 后端 `selectEditableModelReferenceAssets()` 选一部分给模型作为视觉参考。
- 后端 `sanitizeGeneratedHtml()` 现在会移除 AI 自己生成的 `<img>`，然后调用 `injectMissingReferenceAssets()` 注入真实切图资产。

重点检查点：

1. 前端是否真的把 `referenceAssets` 发到了 `/api/design/reconstruct-h5`。
2. `referenceAssets[].dataUrl` 是否都是 `data:image/png;base64,...` 或 `data:image/jpeg;base64,...`。
3. `sanitizeGeneratedHtml()` 是否把注入后的 `<img data-reference-asset>` 保留了。
4. H5 预览 iframe 的 `cleanupHtmlPreviewImages()` 是否误删了这些 asset。
5. DOM 捕获阶段 `resolveWebToFigmaAssetDataUrl()` 是否能识别 `data-reference-asset`。

之前有报错：

```text
图片数据必须是 base64 PNG/JPEG data URL
```

对应修过：

- 过滤非 PNG/JPEG。
- inline SVG 改成 `type:"svg"` 节点。
- Figma 主线程支持 svg node。

但仍需验证这条链路。

### 7.4 H5 还原质量仍不稳定

用户认为：

- H5 生成出来比原图差很多。
- 背景渐变、icon、文字排版、布局还原度不足。
- 有时 prompt 里出现用户输入的生图提示词，而不是图中的真实文字。

当前做过的方向：

- 借鉴 ScreenCoder 思路，先视觉分析，再生成 H5。
- H5 预览作为中间态，用来判断是 AI 还原差，还是 H5 -> Figma 导入差。
- 接了一个最小版 web-to-figma 捕获桥，不是完整复制 `Paidax01/web-to-figma`。

用户后续明确表示：

- `Paidax01/web-to-figma` 这个方向肯定要接。
- 可以复刻代码，改成项目可用。
- 但当前最紧急还是先让 H5 本身更好。

建议下一步不要先重构整个 web-to-figma，而是：

1. 先修 OpenRouter `max_tokens`。
2. 确认 H5 能真实生成。
3. 确认切图资产真实进入 H5。
4. 再对比 H5 和 Figma 导入差异。

## 8. 用户对可编辑设计稿链路的真实预期

用户想要的“放入 Figma”有两个选项：

### 8.1 源文件

保持当前 1.0 逻辑：

- 放入生成图。
- 放入切图资产。
- 保留坐标。
- 稳定保真。

### 8.2 设计稿 / 可编辑设计稿（实验）

预想流程：

1. 用户生成 UI 图片。
2. 用户在插件里手动切图，把关键 icon / 插画 / 吉祥物等切出来。
3. 点击 `放入 Figma`，选择 `可编辑设计稿（实验）` 或 H5 预览。
4. 后端让 AI 识别原图和切图资产，生成 H5。
5. H5 中必须使用用户切出来的资产，不要重新画丑 icon。
6. H5 预览可以先给用户看，用来判断质量。
7. 再通过 DOM 捕获 / web-to-figma 思路导入 Figma。

关键点：

- 切图仍然用插件里的手动切图。
- 切图资产要传给后端。
- 后端生成 H5 时要把这些资产作为可用素材。
- 导入 Figma 时也要把这些资产作为图片节点放进去。

## 9. 用户偏好和沟通习惯

用户很重视视觉结果，反馈直接。需要少说空话，多给可验证结果。

用户偏好：

- 界面一定要好看。
- 不接受“看起来能用但很丑”的方案。
- 不喜欢 fallback 假成功。
- 不喜欢功能按钮点了没反应。
- 不喜欢每次都重新配置 key。
- 不想破坏已有 1.0 功能。
- 实验能力可以做，但必须保留原流程。

回答风格建议：

- 简短说明问题原因。
- 直接说接下来改什么。
- 改完告诉他服务地址和验证方式。
- 看到视觉效果差，要承认并说明是哪个环节差。

## 10. 近期用户明确要求过的功能/决策

已经决定：

- 不做真实 ChatGPT 登录调用模型，这条路放弃。
- 保留第三方 API。
- 增加官方 OpenAI API。
- 增加 OpenRouter 配置，并固定模型为 `gpt-5.4-image-2`。
- SVG 能力暂时先告一段落，不作为核心能力继续纠缠。
- 可编辑设计稿实验继续，但必须不影响源文件导入。
- 2.0 未完成前先不推送 GitHub。

暂时不做 / 低优先级：

- Sketch 文件生成。
- `awesome-design-md` 作为主流程。
- “干净 SVG”按钮，用户要求去掉。
- 真实 ChatGPT 登录。

## 11. 下一步建议执行顺序

### Step 1：修 OpenRouter max_tokens

目标：

- 避免 `requested up to 65536 tokens` 错误。

改动：

- 在 `server.js` 增加 token 常量。
- 给 H5、分析、manifest、SVG 的 chat completion body 增加 `max_tokens`。

验证：

```bash
node --check server.js
```

重启：

```bash
kill $(lsof -ti tcp:18787)
npm run api
```

再让用户点 H5 预览。

### Step 2：验证 H5 是否真实生成

如果仍失败，读 API 日志：

```bash
# 如果 npm run api 是当前终端 session，直接看终端输出
```

重点看：

- OpenRouter 状态码
- 模型返回是否为空
- `extractHtmlDocument()` 是否失败
- 是否超时

### Step 3：验证切图资产注入

在 `/api/design/reconstruct-h5` 里临时打印：

```js
console.log("[reconstruct-h5] referenceAssets:", referenceAssets.length, referenceAssets.map((asset) => ({
  id: asset.id,
  name: asset.name,
  mime: String(asset.dataUrl || "").slice(0, 32),
  placement: asset.placement
})));
```

确认：

- 前端有传。
- 后端有收。
- HTML 里有 `<img data-reference-asset="...">`。
- iframe 没删。
- 导入 Figma 时没丢。

### Step 4：优化 H5 生成 prompt

用户提供过一版“图片转 HTML / 750px / 像素级还原”提示词，但里面混入 Figma 图层要求和一些不适合 HTML 的说法。

建议改成两段式：

1. 视觉分析 JSON：读取布局、颜色、文字、区域、切图资产用途。
2. H5 生成：只输出 HTML/CSS/JS，宽度 750px，优先绝对定位，必须使用切图资产 data URL。

关键要求：

- 不要把用户 prompt 当页面文字。
- 页面文字必须来自图片视觉识别。
- 切图资产有坐标和尺寸时，必须作为 `<img>` 放回对应位置。
- icon 如果已有切图资产，不要重新画。
- 没有切图资产的 icon 可用 CSS/SVG 近似，但不要破坏整体布局。

### Step 5：再看 H5 -> Figma

如果 H5 本身已经还原不错，但导入 Figma 后变差，再继续复刻/增强 `Paidax01/web-to-figma`。

重点补：

- gradient
- border radius
- box shadow
- text line-height / font-weight
- absolute position
- image node
- overflow/clip
- pseudo element

## 12. 常见验证命令

语法检查：

```bash
node --check server.js
node --check code.js
```

检查 HTML 内脚本语法：

```bash
node - <<'NODE'
const fs = require('fs');
const html = fs.readFileSync('ui.html', 'utf8');
const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
for (const [index, script] of scripts.entries()) {
  new Function(script);
  console.log(`script ${index + 1} ok`);
}
NODE
```

健康检查：

```bash
curl -s http://127.0.0.1:18787/health
```

预览服务：

```bash
curl -I -s http://127.0.0.1:4173/figma-sim.html | head
```

## 13. 注意事项

- 不要提交 `.local-provider-config.json`。
- 不要把用户 key 写进文档、代码或 commit。
- 不要用 `git reset --hard` 或 `git checkout --` 回滚用户改动。
- 这个项目当前有很多未提交变更，下一个 Codex 需要先读 diff 再改。
- `ui.html` 很大，改动时优先 `rg` 找函数名，避免盲改。
- 每次改完尽量重启 API，因为 `server.js` 不会热更新。
- Figma 插件环境和浏览器模拟环境行为不同，最终还是要在 Figma Desktop 里验。

