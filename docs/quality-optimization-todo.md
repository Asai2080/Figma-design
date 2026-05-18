# 2.0 质量优化 TODO：SVG、透明 PNG、背景补全

> 当前阶段先规划，不立即改功能代码。目标是在不破坏 1.0 已跑通流程的前提下，让切图资产更干净、更可编辑、更适合放回 Figma。

## 背景

现在工具已经能跑通：

- 生成 UI 设计稿
- 选择设计稿
- 手动切图
- 输出 PNG / 透明 PNG
- 放入 Figma
- 尝试 SVG 转换
- AI 重绘 SVG

但当前质量问题主要集中在三处：

1. `AI 重绘 SVG` 的结果还不够精致，和设计师期望的图标质量有差距。
2. `透明` 功能容易出现毛边、脏边、残留背景色。
3. 切图后主图上的背景填充不够自然，有时像明显色块或糊块。

## 总原则

- 不覆盖原始切图：任何增强结果都作为附加版本保存。
- PNG 原图、透明 PNG、AI 透明 PNG、SVG 可以共存。
- 失败时不影响原资产，不影响放入 Figma。
- 优先保证用户可控：用户自己决定哪个切图要透明、哪个切图要 AI 重绘、哪个切图要 SVG。
- 不承诺复杂图片都能变成高质量 SVG。SVG 主要服务 icon、简单图形、按钮、徽章、线性元素。

## 1. SVG 更精致

### 当前问题

位图强转 SVG 容易出现：

- 路径碎片多
- 形状不干净
- 圆角不圆
- 颜色层级混乱
- 像素感明显
- 可编辑价值低

即使用 AI 重绘 SVG，如果提示词不够强，模型也可能返回“能看但不精致”的 SVG。

### 推荐方向

把 `AI 重绘 SVG` 从“一步生成”升级为“约束更强的一步生成 + 自动校验 + 必要时重试”。

### TODO

#### P0：提示词升级

状态：已实现。后端 `AI 重绘 SVG` 已改为更强的设计师 brief，要求模型重建设计而不是描摹像素，并明确禁止嵌入位图。

把当前提示词改成更像设计师 brief：

- 明确角色：资深图标设计师 + SVG 工程师。
- 明确目标：不是描摹像素，而是重新设计一个干净图标。
- 强调风格：保留原图语义、轮廓、色彩倾向、圆角、视觉重量。
- 强调删减：去掉截图噪点、文字残影、背景混色、毛边、阴影污染。
- 强调可编辑：优先用少量 path / rect / circle / rounded rect / gradient。
- 强调边界：不要整张 UI、不要手机框、不要额外装饰、不要嵌入位图。

建议提示词核心结构：

```text
You are a senior icon designer and SVG engineer.
Use the attached sliced UI asset as visual reference only.
Redraw it into a polished, editable vector icon suitable for Figma.

Design goals:
- Preserve the original meaning, silhouette, orientation, color family, and visual weight.
- Reconstruct clean geometric shapes instead of tracing pixels.
- Use tasteful rounded corners, balanced spacing, consistent stroke width, and simple gradients only when they improve the icon.
- Remove screenshot noise, blurry edges, background contamination, compression artifacts, and neighboring UI fragments.

SVG requirements:
- Return only one complete <svg>...</svg>.
- Use viewBox="0 0 {width} {height}".
- Use real editable vector elements only.
- Do not use <image>, base64, foreignObject, external href, scripts, CSS imports, or HTML.
- Keep path count reasonable. Prefer simple grouped shapes over many tiny fragments.
- Transparent background.
```

#### P0：SVG 结果校验

状态：已实现基础版。后端会检查是否返回 SVG、是否包含 viewBox、是否包含可编辑图形元素、是否嵌入位图或脚本、路径数量是否过多。

在后端拿到 SVG 后做质量检查：

- 禁止 `<image>` / base64 / `foreignObject`。
- 检查 path 数量上限。
- 检查 SVG 是否有 viewBox。
- 检查 SVG 是否为空。
- 检查是否返回了整张 UI，而不是局部 icon。

可以先做轻量规则：

- 宽高超过切图尺寸太多：拒绝。
- path 数量过多：提示“这个素材更适合保留 PNG”。
- 只包含一个巨大矩形：拒绝。

#### P1：自动重试

状态：已实现第一版。第一次 SVG 返回不达标时，后端会追加“不要描像素、减少碎路径、重新设计”的纠偏提示词自动重试一次。

如果第一次返回质量不达标，后端自动用更强提示词重试一次：

- “Your SVG contains too many fragmented paths. Redraw as fewer clean geometric shapes.”
- “Do not trace pixels. Reconstruct the icon.”
- “Use fewer than 40 visible shapes unless necessary.”

#### P1：SVG 预览对比

资产卡里支持：

- 原 PNG
- 普通 SVG
- AI SVG

用户能快速看哪个更好，再决定放入 Figma。

#### P2：视觉相似度检查

后端把 SVG 渲染成 PNG，与原切图做简单对比：

- 尺寸是否一致
- 透明区域是否合理
- 主体是否大致居中
- 是否出现大面积空白

可用 `sharp` / `resvg-js` / `pixelmatch` 做自动 QA。

## 2. 透明 PNG 质量优化

### 当前问题

毛边本质上不是“没抠掉”，而是边缘像素已经混入了原背景色。简单 alpha mask 或颜色阈值会留下：

- 白边
- 灰边
- 彩色脏边
- 半透明边缘发糊
- 阴影残留

### 推荐方向

透明能力拆成两条路：

1. 普通透明：快，适合简单背景。
2. AI 透明重绘：慢，但适合毛边严重、背景复杂的 icon。

### TODO

#### P0：优化现有普通透明

继续保留当前 `透明` 按钮，但优化边缘处理：

- alpha mask 后做轻微 `erode` 收缩，去掉边缘脏色。
- 再做轻微 `feather` 羽化，避免锯齿。
- 对半透明边缘做颜色去污染：把边缘 RGB 往主体内部颜色拉，而不是保留背景混色。
- 增加“边缘强度”参数预设：柔和 / 标准 / 强力。

#### P0：新增 `AI 透明` 或 `AI 抠图`

状态：已实现第一版。切图资产卡新增 `AI透明` 按钮，会调用后端 AI 重绘接口生成透明 PNG；原始切图保留在资产数据中，失败时不影响原 PNG、普通透明 PNG、SVG 或放入 Figma 流程。

在 `透明` 旁边新增一个动作：

- 输入：当前切图 PNG。
- 输出：重新绘制后的透明 PNG。
- 原切图保留，不覆盖。
- 失败时回退原 PNG。

建议文案：

- `透明`：快速抠图。
- `AI 透明`：重绘干净透明图。

建议内置提示词：

```text
Use the attached sliced UI asset as reference.
Recreate only the foreground icon or UI element as a clean isolated PNG with transparent background.
Remove all background pixels, screenshot noise, neighboring UI fragments, blurry edges, and color contamination.
Preserve the original meaning, silhouette, color family, orientation, and visual weight.
Do not generate a full app screen, phone mockup, label, or extra decoration.
```

#### P1：接入开源抠图模型

可选方案：

- [`danielgatis/rembg`](https://github.com/danielgatis/rembg)：成熟，模型选择多，适合后端服务；支持 U2Net、ISNet、BiRefNet、BRIA RMBG 等模型。
- [`bunn-io/rembg-web`](https://github.com/bunn-io/rembg-web)：浏览器端 ONNX Runtime Web 方案，适合未来做前端本地抠图，但模型体积和 Figma 插件环境要验证。
- [`xuebinqin/U-2-Net`](https://github.com/xuebinqin/U-2-Net)：经典显著目标检测，适合通用背景移除，但对 UI 小 icon 不一定总是最佳。
- [`yakhyo/modnet`](https://github.com/yakhyo/modnet)：偏人像抠图，不是 UI icon 首选。

建议优先级：

1. 后端接 `rembg`，先用 `birefnet-general-lite` 或 `isnet-general-use`。
2. 输出 alpha mask 后再做边缘 refinement。
3. 如果用户环境不方便装 Python，再评估 `rembg-web` 前端方案。

#### P2：交互式修边

后续可以允许用户在切图资产上：

- 擦除背景
- 恢复前景
- 调整边缘强度
- 预览透明棋盘格

这会更像一个轻量版 Figma 内抠图工具。

## 3. 抠图后背景填充优化

### 当前问题

切掉元素后，主图对应位置需要“消失”。如果只是填充平均色，会出现：

- 明显色块
- 纹理断层
- 渐变不连续
- 卡片边缘被破坏
- 文字或图标残影

### 推荐方向

按场景分层处理：

1. 小 icon / 简单背景：局部采样 + 模糊扩散。
2. 中等区域 / 渐变背景：OpenCV inpaint。
3. 大区域 / 复杂背景：AI inpainting。

### TODO

#### P0：保守背景修复

继续使用本地算法，但改成更自然的局部补全：

- 扩大采样区域，不只取边缘平均色。
- 根据上下左右边缘估计渐变方向。
- 使用镜像 padding + 高斯模糊扩散填充。
- 加少量噪声匹配，避免纯色块。
- 填充区域边缘做羽化融合。

适合：

- 小 icon
- 小按钮
- 纯色卡片
- 简单渐变背景

#### P1：OpenCV inpaint

接入 `opencv.js` 或后端 OpenCV：

- Telea inpainting：速度快，适合小洞。
- Navier-Stokes inpainting：对线条延续有时更自然。

注意：

- UI 图不是自然照片，OpenCV 对文字、卡片边缘、复杂渐变不一定稳定。
- 适合作为 P1 的“本地高级修复”，不应默认覆盖 P0。

#### P1：AI 背景补全

新增动作：

- `AI 修复背景`

输入：

- 原始生成图
- 切图 mask
- 当前切图区域坐标

输出：

- 修复后的主图版本

提示词方向：

```text
Remove the selected UI element from this generated app screen.
Fill the removed area naturally using surrounding background, card style, gradient, texture, and spacing.
Do not change any other part of the screen.
Do not add new icons, text, buttons, or decorative elements.
Keep the UI layout, typography, colors, and image dimensions unchanged.
```

#### P2：局部修复历史

每切一次图，保留一个修复历史：

- 原图
- 第 1 次修复
- 第 2 次修复
- 回退

这样用户不会因为 AI 修复失败而丢失原始设计稿。

## 4. 推荐落地顺序

### 第一轮：不动 UI 主结构，只增强质量

1. 升级 AI SVG 提示词。
2. AI SVG 加一次自动重试。
3. 普通透明加边缘收缩、羽化、去污染。
4. 新增 `AI 透明`，保留原 PNG。

### 第二轮：背景修复升级

1. P0 背景填充改成局部渐变 + feather。
2. 加 `AI 修复背景`，只对用户选择的切图区域生效。
3. 修复前后都保留版本，可回退。

### 第三轮：开源模型实验

1. 后端实验 `rembg`。
2. 比较 `isnet-general-use` / `birefnet-general-lite` / `bria-rmbg`。
3. 决定是否作为默认透明方案。
4. 评估 OpenCV inpaint 对 UI 背景是否值得接。

## 5. 技术方案对比

| 能力 | 方案 | 优点 | 风险 | 建议 |
| --- | --- | --- | --- | --- |
| SVG | AI 直接生成 SVG | 可编辑性最好，有机会生成干净图标 | 模型可能不稳定 | 作为主路线 |
| SVG | VTracer / ImageTracer | 本地、可控、无需 API | 容易碎路径 | 保留为兜底 |
| 透明 PNG | 当前阈值抠图 | 快、简单 | 毛边明显 | 优化后继续保留 |
| 透明 PNG | rembg / BiRefNet / ISNet | 抠图质量更高 | 模型体积、环境依赖 | P1 实验 |
| 透明 PNG | AI 重绘透明图 | 视觉最干净 | 可能改形状、慢、有成本 | 新增可选按钮 |
| 背景填充 | 局部采样 + 模糊 | 快、可控 | 复杂背景一般 | P0 优化 |
| 背景填充 | OpenCV inpaint | 本地、速度快 | UI 场景不一定自然 | P1 实验 |
| 背景填充 | AI inpainting | 质量上限高 | 可能改动其他区域 | P1 可选动作 |

## 6. 验收标准

### AI SVG

- 不嵌入位图。
- Figma 中可以看到可编辑图层。
- 简单 icon 不再是一堆 1px 小块。
- 路径数量可接受。
- 外观比普通矢量化更干净。

### 透明 PNG

- 普通透明：简单背景下无明显白边/灰边。
- AI 透明：复杂背景下主体边缘更干净。
- 原 PNG 永远保留。
- 失败时资产列表不丢失。

### 背景补全

- 小 icon 被移除后，原位置不再有突兀色块。
- 卡片、渐变、纯色背景过渡自然。
- 不破坏主图其他区域。
- 可以回退。

## 7. 当前结论

下一步最值得做的是：

1. 先改 AI SVG 提示词和自动重试。
2. 再新增 `AI 透明`，把“抠不干净”的情况交给模型重绘。
3. 最后升级背景填充，先做本地柔和补全，再评估 AI inpainting。

这三步最符合当前产品节奏：不会推翻现有流程，也能直接提升用户肉眼感知到的质量。
