# 可编辑设计稿导入实验方案

版本：草案 1

最后更新：2026-05-13

本文档用于规划一个临时实验能力：在点击 `放入 Figma` 时，用户可以选择导入 `源文件` 或 `设计稿`。

核心要求：不能改坏 1.0 / 当前 2.0 已经跑通的图片生成、切图、透明 PNG、SVG、放入 Figma 等功能。`源文件` 必须继续沿用当前逻辑，`设计稿` 作为实验入口独立接入。

## 1. 需求目标

现在的 `放入 Figma` 更接近“把生成图片和切图资产放入 Figma”，优点是稳定、保真，缺点是主设计稿本身不可编辑。

新增实验目标：

- `源文件`：沿用当前逻辑，把生成图、切图资产、透明 PNG / SVG 等放入 Figma。
- `设计稿`：尝试把生成图片还原成可编辑 HTML，再通过 Web 到 Figma 的转换流程导入，得到可编辑的 Figma 图层。

用户预期流程：

1. 生成一张或多张 UI 图片。
2. 用户选择其中一张设计稿。
3. 点击 `放入 Figma`。
4. 弹出导入方式选择：`源文件` / `设计稿（实验）`。
5. 选择 `源文件` 时走现有逻辑。
6. 选择 `设计稿（实验）` 时尝试生成可编辑 Figma 图层。

## 2. 初步可行性判断

结论：可以做实验版，但不建议一开始承诺“完全 1:1 可编辑还原”。

原因是这条链路包含两个难点：

1. 图片到 HTML 的还原质量。
   - 这一步需要模型理解截图结构、文字、间距、颜色、圆角、阴影、图片区域等。
   - 生成的 HTML 可以接近原图，但不一定完全一致。
   - 对 UI 截图来说，文字、图标和复杂插画通常最容易出现偏差。

2. HTML 到 Figma 的转换质量。
   - [`Paidax01/web-to-figma`](https://github.com/Paidax01/web-to-figma) 从仓库和 `capture.js` 看，更像一个浏览器扩展式的 DOM 捕获流程，而不是可以直接在 Figma 插件里 import 的库。
   - 它的思路有价值：把网页 DOM、样式和截图信息捕获成结构化数据，再转换成 Figma 节点。
   - 但我们大概率还需要自己补一个桥：把捕获结果转换成 Figma Plugin API 能创建的 `FRAME`、`TEXT`、`RECTANGLE`、`IMAGE` 等节点。

所以推荐把它作为 `设计稿（实验）`，默认仍然保留 `源文件`。

## 3. 推荐技术路线

### 3.1 导入模式选择

在现有 `放入 Figma` 上增加一个轻量选择：

- 默认：`源文件`
- 可选：`设计稿（实验）`

不要替换现有按钮行为，内部实现拆成两个独立路径：

- `placeSourceToFigma()`：当前已稳定逻辑。
- `placeEditableDesignToFigma()`：新增实验逻辑。

### 3.2 设计稿实验链路

建议 P0 先按下面链路跑通：

```text
生成图 / 用户选中图
  -> 发送到本地后端
  -> 调用模型还原 HTML / CSS
  -> 生成本地 HTML 文件或 HTML 字符串
  -> 用浏览器渲染 HTML
  -> 捕获 DOM 结构和样式
  -> 转换为 Figma 节点
  -> 在 Figma 创建可编辑 Frame
  -> 同时放一张原图作为锁定参考
```

### 3.3 HTML 还原策略

输入：

- 当前选中的生成图。
- 用户原始提示词。
- 图片宽高。
- 选片比例。
- 供应商信息。

输出：

- 一个自包含 HTML 文件。
- 一个 CSS 文件或内联 CSS。
- 可选资源：局部图片、图标、背景图。

原则：

- 尽量用真实 HTML 结构表达 UI。
- 文字必须是文字节点，不要全部转图片。
- 卡片、按钮、输入框、导航栏优先用 CSS 还原。
- 复杂插画、商品图、头像可以暂时保留为图片。
- 输出禁止远程依赖，避免 Figma 插件环境或本地预览不稳定。

### 3.4 通用设计稿还原 Prompt

这条 prompt 用于 `图片 -> HTML/CSS` 阶段。它不是某一个页面的固定提示词，而是通用的设计稿还原规范。

目标不是简单截图复刻，而是尽可能深度理解截图中的 UI 设计系统、组件层级、交互状态和视觉风格，再输出可被后续转换成 Figma 图层的结构化 HTML。

建议核心 prompt：

```text
你是资深 UI 设计还原工程师、前端工程师和设计系统专家。

请基于输入的 UI 截图，还原一个高精度、结构清晰、可交互的静态 HTML/CSS 页面。
输入截图是唯一真实参考，目标是尽量还原截图中的界面样式、组件层级、布局比例、颜色、圆角、阴影、间距、图标风格和交互状态，而不是重新设计一个新页面。

核心目标：
- 最大深度理解截图中的界面样式和组件结构。
- 高精度还原每个组件的视觉效果。
- 保持截图中的布局、比例、留白、字体层级、色彩关系、圆角、阴影、渐变、毛玻璃、卡片质感和状态样式。
- 所有可交互组件都要保留交互性，包括 default、hover、active、disabled 状态。
- 输出的 HTML/CSS 后续会被转换为 Figma 可编辑图层，所以结构要清晰，命名要语义化。

组件还原要求：
- 识别页面中的主要区域，例如 status bar、header、search bar、banner、tab、card、list、button、bottom navigation、floating action、modal 等。
- 每个区域用独立的语义化容器表达。
- 文本必须使用真实文本节点，不要把文字作为图片。
- 按钮、输入框、卡片、标签、导航项、列表项要用 HTML/CSS 还原。
- 对每个可交互组件补齐状态样式：
  - default：截图中的默认状态。
  - hover：轻微明暗、阴影或边框变化。
  - active：按压感、缩放或颜色加深。
  - disabled：降低透明度、禁用 cursor、降低对比。
- 不要生成无法编辑的一整张大图。

图标要求：
- 界面中的通用功能图标默认使用 Hugeicons 风格作为参考。
- 如果截图中的图标语义明确，例如搜索、设置、通知、关闭、返回、主页、用户、收藏、日历等，优先使用可编辑的 inline SVG 或 CSS 图标来表达。
- 图标要匹配截图中的线宽、圆角、大小、颜色和视觉重量。
- 不要随意替换成语义错误的图标。

吉祥物 / IP / 插画要求：
- 如果截图中有吉祥物 IP、角色、品牌插画或复杂人物，不要用 HTML/CSS 硬画。
- 如果已经有切图资产，保留为单独 image asset。
- 如果没有切图资产，标记为 mascot asset placeholder，后续由 image2 图片生成器生成透明底图片替换。
- 生成吉祥物时必须保持原图动作、姿态、朝向、表情、颜色倾向和风格一致。
- 吉祥物必须是透明背景图片，不要和页面背景合并。

图片和复杂素材要求：
- 商品图、头像、复杂插画、照片、品牌图可以作为 image asset 保留。
- 背景纹理、复杂渐变或装饰图如果无法可靠还原，可以拆成 image asset。
- 不要把整个页面合并成一张图片。

视觉还原要求：
- 颜色尽量匹配截图，保留主色、辅助色、文字色、描边色、阴影色和透明度。
- 保留渐变方向、模糊程度、阴影扩散、卡片层级和玻璃质感。
- 保留真实圆角比例，不要统一改成一种圆角。
- 保留组件之间的真实间距。
- 保持截图中的视觉重心和布局密度。

工程输出要求：
- 输出完整 HTML 文件。
- CSS 可以写在 <style> 中。
- 不要输出解释文字。
- 不要加载远程 JS。
- 不要把 API Key 或任何隐私信息写进 HTML。
- 不要依赖外部网络资源；如需图片资源，用占位的 asset id 或 data-url 占位。
- 使用语义化 className，例如 app-header、hero-banner、metric-card、bottom-nav-item。
- 用 CSS variables 提取主要颜色、圆角、阴影和字号。
- 页面尺寸应匹配输入截图的宽高比例。

最终输出：
只返回完整 HTML，不要返回 Markdown，不要解释。
```

Hugeicons 说明：

- Hugeicons 只作为默认图标风格参考，不强行覆盖截图中已有的强风格图标。
- 如果图标来自截图中的品牌视觉、活动视觉、游戏视觉、IP 视觉，应优先保持原图风格。
- 后续实现时可以把常用图标语义映射到 Hugeicons 名称，再由本地 SVG 表或在线资源转换成 inline SVG。

### 3.5 HTML 到 Figma 策略

有两条实现路径：

#### 方案 A：借鉴 web-to-figma 捕获流程

使用 `web-to-figma` 的思路捕获：

- DOM 层级
- computed style
- bounding rect
- text content
- image src
- background / border / radius / shadow

然后我们自己在 Figma 插件侧转换：

- `div` / `section` -> `FRAME` 或 `RECTANGLE`
- `text` -> `TEXT`
- `img` / background image -> `RECTANGLE` with image fill
- border radius -> `cornerRadius`
- fill color -> `fills`
- shadow -> `effects`

优点：

- 和“先生成 HTML 再导入 Figma”的目标一致。
- 可控，能逐步增强。

风险：

- 需要写转换层。
- DOM 到 Figma 不会天然 1:1。
- 复杂 CSS、渐变、filter、mask 可能需要降级。

#### 方案 B：自己做最小 HTML-to-Figma 转换

P0 不完整接入 `web-to-figma`，只做最小集合：

- Frame
- Text
- Rectangle
- Image
- Border radius
- Solid fill
- Basic shadow

优点：

- 更快验证闭环。
- 风险更低。
- 不被外部仓库实现细节卡住。

风险：

- 还原能力有限。
- 后续仍然需要扩展。

推荐：P0 先采用方案 B，方案 A 作为 P1/P2 增强。

## 4. UI 交互方案

点击 `放入 Figma` 后弹出选择浮层：

```text
放入 Figma

[源文件]
导入原始生成图和切图资产，稳定保真。

[设计稿（实验）]
尝试还原为可编辑 Figma 图层，可能有偏差。
```

交互规则：

- 默认选中 `源文件`。
- 选择 `设计稿（实验）` 时显示风险说明。
- 设计稿导入失败时，不影响源文件导入。
- 失败提示里提供“改用源文件导入”。

## 5. TODO

### P0：不破坏现有功能的实验入口

- [x] 在 `放入 Figma` 前增加导入方式选择。
- [x] `源文件` 继续走当前逻辑，不改数据结构和现有消息。
- [x] 新增 `设计稿（实验）` 路径，作为独立实验入口。
- [x] 新增后端接口：`POST /api/design/reconstruct-html`。
- [x] 使用一张选中图生成 HTML 字符串。
- [x] 先用最小 manifest-to-Figma 转换器创建可编辑 Frame。
- [x] 导入时同时放置原始图片，作为锁定参考图。
- [x] 失败时显示明确错误，不影响当前生成图和切图资产。

P0 当前实现说明：

- `源文件` 仍然发送 `create-ui-asset-screen`，保持 1.0 / 2.0 已验收路径。
- `设计稿（实验）` 调用本地后端 `/api/design/reconstruct-html`，返回 HTML 预览和可编辑 manifest。
- Figma 插件侧新增 `create-editable-design-screen`，根据 manifest 创建 `FRAME`、`TEXT`、`RECTANGLE`、`IMAGE` 等基础图层。
- 当前 P0 以稳定闭环为目标，manifest 仍是模板化可编辑结构；后续 P1 再提升截图理解和真实还原能力。

### P1：提升还原质量

- [x] 增加独立 H5 预览链路：`POST /api/design/reconstruct-h5`，用于直接验证 `截图 -> HTML` 的还原质量。
- [x] 接入 ScreenCoder 思路的两段式策略：先把截图当成唯一真实参考做视觉理解，再用绝对定位 HTML 还原 750px 宽移动端画板。
- [x] 在 H5 预览中增加 `导入此 H5 到 Figma`，把预览 iframe 的 DOM 捕获成可编辑 manifest。
- [ ] 增加 HTML 生成提示词模板的持续调优版本。
- [ ] 增加 OCR / 文本识别辅助，减少文字错误。
- [ ] 拆分复杂图片资源，保留头像、商品图、插画为 image fill。
- [ ] 增加吉祥物 / IP 资产占位策略：有切图用切图，无切图则调用 image2 生成透明底 mascot asset。
- [ ] 增加通用图标映射策略：常见功能图标默认按 Hugeicons 风格生成 inline SVG。
- [ ] 为按钮、输入框、卡片、导航项等交互组件补齐 default / hover / active / disabled 状态。
- [ ] 捕获并转换基础阴影、圆角、边框、渐变。
- [x] 导入前提供 HTML 预览。
- [ ] 导入后自动分组命名：`Header`、`Hero`、`Card`、`TabBar` 等。

P1 当前实现说明：

- `编辑设计稿` 不再复用 manifest 预览，而是调用 `/api/design/reconstruct-h5` 生成可预览 HTML。
- 该接口只负责“图片到 HTML”的还原质量验证，不直接影响 `源文件` 和 `设计稿（实验）` 的 Figma 导入。
- 编辑设计稿预览采用原图宽度 / 移动端宽度策略，按原图比例计算高度；用户切图资产会作为 `asset:<id>` 提供给模型，并在 HTML 安全处理后替换为本地 data URL。
- 用户切图资产现在是强约束：prompt 要求模型按原始坐标使用，后端也会在模型漏用时把缺失切图按坐标注入到 `.screen`，避免编辑设计稿预览只靠模型重画。
- 如果模型失败，会回退到本地预览模板，避免整个插件流程中断。
- `编辑设计稿` 已升级为 web-to-figma vendor 适配桥：复刻 `Paidax01/web-to-figma` 的核心 `capture.js` 到 `vendor/web-to-figma-capture-adapter.js`，本地补丁只暴露 raw capture 方法；导入预览时优先使用这套捕获器抓取 DOM / computed style / image assets / text rect，再映射成 `create-editable-design-screen` 可消费的 manifest。
- 如果 web-to-figma vendor 捕获失败，会自动回退到原来的最小 DOM capture，保证实验链路失败时不影响 1.0 的源文件导入。
- 旧版 `设计稿（实验）` 仍保留原 `/api/design/reconstruct-html` manifest 路径但默认隐藏；`编辑设计稿` 使用 H5 DOM 导入链路，不替换源文件导入。

### P2：接近生产能力

- [x] 接入最小版 `web-to-figma` 思路：从 H5 预览 DOM 捕获基础节点并映射到 Figma。
- [ ] 深度适配 `web-to-figma` 捕获字段，补齐渐变、复杂背景、mask、filter、伪元素等高级 CSS。
- [ ] 增加设计稿相似度对比。
- [ ] 支持多张生成图逐张还原。
- [ ] 支持导出 HTML 和 Figma 节点映射 JSON。
- [ ] 支持把常见 UI 元素识别成组件候选。
- [ ] 支持设计 token 提取：颜色、字号、圆角、间距。

### P2.1：web-to-figma 接入分阶段

目标：把当前 H5 预览生成出来的 DOM 更稳定地转成 Figma 可编辑节点。

分阶段策略：

1. [x] 研究并抽取 `Paidax01/web-to-figma` 的 DOM 捕获思想，而不是直接把整个 Chrome Extension 塞进 Figma 插件。
2. [x] 在 H5 预览 iframe 内实现最小 DOM capture：读取元素的 `getBoundingClientRect()` 和 `getComputedStyle()`，产出中间 JSON。
3. [x] 把中间 JSON 映射为现有 `create-editable-design-screen` 能消费的 manifest。
4. [x] 复刻 upstream `capture.js` 并改成本地 vendor runtime：`vendor/web-to-figma-capture-adapter.js`。
5. [x] 在 H5 预览 iframe 中注入 vendor runtime，优先使用 `web-to-figma` 原始 DOM 序列化结果，再映射为现有 manifest。
6. [ ] 继续补齐 vendor JSON 到 Figma manifest 的高级字段：多背景、复杂渐变、mask、filter、伪元素、背景图裁切方式。
7. 保留源文件导入作为稳定回退；web-to-figma 链路只服务 `设计稿（实验）`。

## 6. 风险和边界

### 6.1 这不是稳定的“图片转可编辑 Figma”

图片本身没有图层信息。任何“还原成可编辑设计稿”的方案，本质都是推断。

可以做到：

- 静态 UI 近似还原。
- 主要文字、卡片、按钮、布局可编辑。
- 常见 App 页面结构化。

很难保证：

- 复杂插画完全矢量可编辑。
- 所有图标都是 SVG。
- 字体完全一致。
- 像素级 1:1。
- 复杂渐变、模糊、透明叠加完全一致。

### 6.2 Codex 能力不能直接作为公开插件依赖

如果“调用 Codex 的代码功能”只是在本地开发阶段使用，可以做。

但如果插件要给同事或外部用户使用，Figma 插件本身不能直接依赖当前 Codex 桌面环境。生产化需要：

- 本地后端服务；或
- 云端后端服务；或
- 用户配置的 LLM API；或
- 插件内置固定的转换逻辑。

### 6.3 安全限制

生成 HTML 后必须做限制：

- 禁止执行任意脚本。
- 禁止加载远程资源。
- 禁止把 API Key 写进 HTML。
- 禁止把用户图片上传到未知第三方。
- HTML 预览使用 sandbox。

## 7. 验收标准

P0 验收只看闭环，不追求极致还原：

- `源文件` 导入行为和当前版本一致。
- 选择 `设计稿（实验）` 后，能在 Figma 创建一个可编辑 Frame。
- Frame 至少包含可编辑文本、矩形卡片、图片节点。
- 原始生成图会作为参考图一并放入 Figma。
- 失败时不影响当前设计稿、切图资产和源文件导入。
- 实验入口可以随时关闭或回退。

## 8. 当前建议

建议先做 P0，但不要默认启用。

最稳的产品表达是：

- `源文件`：稳定推荐。
- `设计稿（实验）`：尝试生成可编辑图层。

这样既能探索可编辑设计稿能力，又不会破坏当前最核心、已经验收过的生成和切图流程。
