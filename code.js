const DEFAULT_UI_WINDOW = { width: 980, height: 700 };
const MIN_UI_WINDOW = { width: 360, height: 240 };
const COLLAPSED_UI_WINDOW = { width: 320, height: 72 };
const UI_WINDOW_STORAGE_KEY = "ai-ui-window-state-v2";

figma.showUI(__html__, { width: DEFAULT_UI_WINDOW.width, height: DEFAULT_UI_WINDOW.height, themeColors: true });

restoreUiWindowState().catch((error) => {
  notifyRecoverableError("窗口状态恢复失败", error);
});

figma.ui.onmessage = async (message) => {
  try {
    if (message.type === "create-ui-asset-screen") {
      await createUiAssetScreen(message.manifest);
      figma.notify("已生成 UI 预览和透明 PNG 素材");
    }

    if (message.type === "create-editable-design-screen") {
      await createEditableDesignScreen(message.manifest);
      figma.notify("已生成可编辑设计稿实验图层");
    }

    if (message.type === "resize-ui") {
      safeResizeUi(message.width, message.height);
    }

    if (message.type === "save-ui-window-state") {
      await saveUiWindowState(message.state);
    }

    if (message.type === "set-ui-collapsed") {
      await setUiCollapsed(Boolean(message.collapsed));
    }

    if (message.type === "close") {
      figma.closePlugin();
    }
  } catch (error) {
    const reason = error && error.message ? error.message : String(error);
    figma.notify(`生成失败：${reason}`, { error: true });
    safePostMessage({ type: "generation-error", message: reason });
  }
};

async function restoreUiWindowState() {
  const state = await getStoredUiWindowState();
  const nextSize = state.collapsed ? COLLAPSED_UI_WINDOW : normalizeUiSize(state.width, state.height);
  safeResizeUi(nextSize.width, nextSize.height, state.collapsed);
  safePostMessage({
    type: "ui-window-state",
    state: {
      width: nextSize.width,
      height: nextSize.height,
      collapsed: Boolean(state.collapsed)
    }
  });
}

async function setUiCollapsed(collapsed) {
  const previous = await getStoredUiWindowState();
  const normalSize = normalizeUiSize(previous.width, previous.height);
  const nextSize = collapsed ? COLLAPSED_UI_WINDOW : normalSize;
  const nextState = {
    width: normalSize.width,
    height: normalSize.height,
    collapsed
  };
  await figma.clientStorage.setAsync(UI_WINDOW_STORAGE_KEY, nextState);
  safeResizeUi(nextSize.width, nextSize.height, collapsed);
  safePostMessage({
    type: "ui-window-state",
    state: {
      width: nextSize.width,
      height: nextSize.height,
      collapsed: Boolean(nextState.collapsed)
    }
  });
}

async function saveUiWindowState(state) {
  const previous = await getStoredUiWindowState();
  const size = normalizeUiSize(state && state.width, state && state.height);
  const nextState = {
    width: size.width,
    height: size.height,
    collapsed: Boolean(state && Object.prototype.hasOwnProperty.call(state, "collapsed") ? state.collapsed : previous.collapsed)
  };
  await figma.clientStorage.setAsync(UI_WINDOW_STORAGE_KEY, nextState);
}

async function getStoredUiWindowState() {
  const stored = await figma.clientStorage.getAsync(UI_WINDOW_STORAGE_KEY).catch(() => null);
  if (!stored || typeof stored !== "object") {
    return {
      width: DEFAULT_UI_WINDOW.width,
      height: DEFAULT_UI_WINDOW.height,
      collapsed: false
    };
  }

  const size = normalizeUiSize(stored.width, stored.height);
  return {
    width: size.width,
    height: size.height,
    collapsed: Boolean(stored.collapsed)
  };
}

function normalizeUiSize(width, height) {
  return {
    width: clampNumber(Number(width), MIN_UI_WINDOW.width, 2200, DEFAULT_UI_WINDOW.width),
    height: clampNumber(Number(height), MIN_UI_WINDOW.height, 1600, DEFAULT_UI_WINDOW.height)
  };
}

function clampNumber(value, min, max, fallback) {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(value)));
}

function safeResizeUi(width, height, allowCollapsed) {
  const size = allowCollapsed
    ? {
        width: clampNumber(Number(width), COLLAPSED_UI_WINDOW.width, 2200, COLLAPSED_UI_WINDOW.width),
        height: clampNumber(Number(height), COLLAPSED_UI_WINDOW.height, 1600, COLLAPSED_UI_WINDOW.height)
      }
    : normalizeUiSize(width, height);
  try {
    figma.ui.resize(size.width, size.height);
  } catch (error) {
    notifyRecoverableError("窗口尺寸调整失败", error);
  }
}

function safePostMessage(message) {
  try {
    figma.ui.postMessage(message);
  } catch (error) {
    notifyRecoverableError("消息同步失败", error);
  }
}

function notifyRecoverableError(prefix, error) {
  const reason = error && error.message ? error.message : String(error);
  console.warn(`${prefix}: ${reason}`);
}

async function createUiAssetScreen(manifest) {
  validateManifest(manifest);

  const frame = figma.createFrame();
  frame.name = manifest.screen.name || "ai_generated_app_screen";
  frame.resize(manifest.screen.width, manifest.screen.height);
  frame.x = figma.viewport.center.x - manifest.screen.width / 2;
  frame.y = figma.viewport.center.y - manifest.screen.height / 2;
  frame.clipsContent = false;
  frame.fills = [{ type: "SOLID", color: { r: 0.96, g: 0.97, b: 0.98 } }];

  const preview = await createImageRectangle({
    name: "preview_full_ui_reference",
    imageDataUrl: manifest.previewImage.dataUrl,
    width: manifest.screen.width,
    height: manifest.screen.height
  });
  preview.locked = true;
  frame.appendChild(preview);

  const selectedAssets = manifest.assets.filter((asset) => asset.selected !== false);
  for (const asset of selectedAssets) {
    const node = await createAssetNode(asset);

    node.x = asset.placement.x;
    node.y = asset.placement.y;
    const useSvgExport = Boolean(asset.svgData && node.type !== "RECTANGLE");
    node.exportSettings = [
      useSvgExport
        ? { format: "SVG" }
        : {
            format: "PNG",
            constraint: { type: "SCALE", value: 1 }
          }
    ];
    node.setPluginData("assetManifest", JSON.stringify(createPluginDataAssetManifest(asset)));
    frame.appendChild(node);
  }

  figma.currentPage.selection = [frame];
  figma.viewport.scrollAndZoomIntoView([frame]);
}

async function createEditableDesignScreen(manifest) {
  validateEditableDesignManifest(manifest);

  const frame = figma.createFrame();
  frame.name = manifest.screen.name || "editable_design_experiment";
  frame.resize(manifest.screen.width, manifest.screen.height);
  frame.x = figma.viewport.center.x - manifest.screen.width / 2;
  frame.y = figma.viewport.center.y - manifest.screen.height / 2;
  frame.clipsContent = Boolean(manifest.screen.clipsContent);
  frame.fills = [hexToSolidPaint(manifest.screen.fill || "#F7F8FA")];

  for (const nodeDefinition of manifest.nodes || []) {
    const node = await createEditableNode(nodeDefinition);
    frame.appendChild(node);
  }

  const createdNodes = [frame];
  if (manifest.sourceImage && manifest.sourceImage.dataUrl) {
    const reference = await createImageRectangle({
      name: "source_image_locked_reference",
      imageDataUrl: manifest.sourceImage.dataUrl,
      width: manifest.screen.width,
      height: manifest.screen.height
    });
    reference.x = frame.x + manifest.screen.width + 48;
    reference.y = frame.y;
    reference.locked = true;
    reference.opacity = 0.55;
    figma.currentPage.appendChild(reference);
    createdNodes.push(reference);
  }

  figma.currentPage.selection = [frame];
  figma.viewport.scrollAndZoomIntoView(createdNodes);
}

async function createEditableNode(definition) {
  const type = String(definition.type || "").toLowerCase();
  if (type === "text") {
    return createEditableText(definition);
  }
  if (type === "image") {
    return createEditableImage(definition);
  }
  if (type === "frame") {
    return createEditableFrame(definition);
  }
  return createEditableRectangle(definition);
}

async function createEditableFrame(definition) {
  const frame = figma.createFrame();
  applyBaseNodeProperties(frame, definition);
  frame.clipsContent = Boolean(definition.clipsContent);
  frame.fills = [hexToSolidPaint(definition.fill || "#FFFFFF", definition.opacity)];
  frame.cornerRadius = normalizeRadius(definition.radius);
  if (definition.shadow) {
    frame.effects = [createDropShadow(definition.shadow)];
  }
  for (const child of definition.children || []) {
    frame.appendChild(await createEditableNode(child));
  }
  return frame;
}

function createEditableRectangle(definition) {
  const rectangle = figma.createRectangle();
  applyBaseNodeProperties(rectangle, definition);
  rectangle.fills = [hexToSolidPaint(definition.fill || "#FFFFFF", definition.opacity)];
  rectangle.cornerRadius = normalizeRadius(definition.radius);
  if (definition.stroke) {
    rectangle.strokes = [hexToSolidPaint(definition.stroke, definition.strokeOpacity)];
    rectangle.strokeWeight = clampNumber(Number(definition.strokeWidth), 0, 24, 1);
  }
  if (definition.shadow) {
    rectangle.effects = [createDropShadow(definition.shadow)];
  }
  return rectangle;
}

async function createEditableImage(definition) {
  if (!definition.dataUrl) {
    const fallbackDefinition = Object.assign({}, definition, {
      fill: definition.fill || "#EEF1F6"
    });
    return createEditableRectangle(fallbackDefinition);
  }
  const image = await createImageRectangle({
    name: definition.name || "image_asset",
    imageDataUrl: definition.dataUrl,
    width: definition.width,
    height: definition.height
  });
  applyBaseNodeProperties(image, definition);
  image.cornerRadius = normalizeRadius(definition.radius);
  return image;
}

async function createEditableText(definition) {
  const fontStyle = fontStyleFromWeight(definition.fontWeight);
  await loadInterFont(fontStyle);

  const text = figma.createText();
  applyBaseNodeProperties(text, definition);
  text.fontName = { family: "Inter", style: fontStyle };
  text.characters = String(definition.text || "");
  text.fontSize = clampNumber(Number(definition.fontSize), 8, 160, 16);
  text.lineHeight = { unit: "PIXELS", value: clampNumber(Number(definition.lineHeight), text.fontSize, 240, Math.round(text.fontSize * 1.25)) };
  text.fills = [hexToSolidPaint(definition.color || "#111318", definition.opacity)];
  if (definition.letterSpacing) {
    text.letterSpacing = { unit: "PIXELS", value: Number(definition.letterSpacing) };
  }
  return text;
}

async function loadInterFont(style) {
  try {
    await figma.loadFontAsync({ family: "Inter", style });
  } catch (error) {
    await figma.loadFontAsync({ family: "Inter", style: "Regular" });
  }
}

function fontStyleFromWeight(weight) {
  const numericWeight = Number(weight);
  if (numericWeight >= 700) {
    return "Bold";
  }
  if (numericWeight >= 600) {
    return "Semi Bold";
  }
  if (numericWeight >= 500) {
    return "Medium";
  }
  return "Regular";
}

function applyBaseNodeProperties(node, definition) {
  node.name = definition.name || definition.type || "editable_node";
  node.x = clampNumber(Number(definition.x), -100000, 100000, 0);
  node.y = clampNumber(Number(definition.y), -100000, 100000, 0);
  node.resize(
    Math.max(1, clampNumber(Number(definition.width), 1, 100000, 100)),
    Math.max(1, clampNumber(Number(definition.height), 1, 100000, 40))
  );
}

function createDropShadow(shadow) {
  const shadowOpacity = shadow.opacity === undefined || shadow.opacity === null ? 0.12 : shadow.opacity;
  return {
    type: "DROP_SHADOW",
    color: hexToRgbColor(shadow.color || "#000000", shadowOpacity),
    offset: {
      x: Number.isFinite(Number(shadow.x)) ? Number(shadow.x) : 0,
      y: Number.isFinite(Number(shadow.y)) ? Number(shadow.y) : 10
    },
    radius: clampNumber(Number(shadow.blur), 0, 120, 24),
    spread: Number.isFinite(Number(shadow.spread)) ? Number(shadow.spread) : 0,
    visible: true,
    blendMode: "NORMAL"
  };
}

function normalizeRadius(radius) {
  return clampNumber(Number(radius), 0, 999, 0);
}

function hexToSolidPaint(hex, opacity) {
  const color = hexToRgbColor(hex, opacity);
  return {
    type: "SOLID",
    color: {
      r: color.r,
      g: color.g,
      b: color.b
    },
    opacity: color.a
  };
}

function hexToRgbColor(hex, opacity) {
  const normalized = String(hex || "#000000").replace("#", "").trim();
  const value = normalized.length === 3
    ? normalized.split("").map((character) => `${character}${character}`).join("")
    : normalized.padEnd(6, "0").slice(0, 6);
  const number = Number.parseInt(value, 16);
  return {
    r: ((number >> 16) & 255) / 255,
    g: ((number >> 8) & 255) / 255,
    b: (number & 255) / 255,
    a: clampOpacity(opacity)
  };
}

function clampOpacity(opacity) {
  const value = Number(opacity);
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.min(1, Math.max(0, value));
}

async function createImageRectangle({ name, imageDataUrl, width, height }) {
  const bytes = dataUrlToBytes(imageDataUrl);
  const image = figma.createImage(bytes);
  const rectangle = figma.createRectangle();
  rectangle.name = name;
  rectangle.resize(width, height);
  rectangle.fills = [
    {
      type: "IMAGE",
      scaleMode: "FIT",
      imageHash: image.hash
    }
  ];
  return rectangle;
}

async function createAssetNode(asset) {
  if (asset.svgData) {
    try {
      return createSvgAssetNode({
        name: asset.name,
        svgData: asset.svgData,
        width: asset.placement.width,
        height: asset.placement.height
      });
    } catch (error) {
      notifyRecoverableError("SVG 回填失败，已回退 PNG", error);
    }
  }

  return createImageRectangle({
    name: asset.name,
    imageDataUrl: asset.dataUrl,
    width: asset.placement.width,
    height: asset.placement.height
  });
}

function createSvgAssetNode({ name, svgData, width, height }) {
  if (typeof figma.createNodeFromSvg !== "function") {
    throw new Error("当前 Figma 环境不支持创建 SVG 节点");
  }
  const node = figma.createNodeFromSvg(svgData);
  node.name = name;
  node.resize(width, height);
  return node;
}

function createPluginDataAssetManifest(asset) {
  return {
    id: asset.id,
    name: asset.name,
    type: asset.type,
    kind: asset.kind,
    placement: asset.placement,
    transparent: Boolean(asset.transparent),
    selected: asset.selected !== false,
    hasSvg: Boolean(asset.svgData)
  };
}

function dataUrlToBytes(dataUrl) {
  const match = /^data:image\/(?:png|jpeg|jpg);base64,(.+)$/.exec(dataUrl);
  if (!match) {
    throw new Error("图片数据必须是 base64 PNG/JPEG data URL");
  }

  if (typeof figma.base64Decode === "function") {
    return figma.base64Decode(match[1]);
  }

  const binary = atob(match[1]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function validateManifest(manifest) {
  if (!manifest || !manifest.screen || !manifest.previewImage) {
    throw new Error("缺少 screen 或 previewImage 数据");
  }

  if (!Number.isFinite(manifest.screen.width) || !Number.isFinite(manifest.screen.height)) {
    throw new Error("screen.width 和 screen.height 必须是数字");
  }

  if (!Array.isArray(manifest.assets)) {
    throw new Error("assets 必须是数组");
  }

  for (const asset of manifest.assets) {
    if (!asset.name || !asset.placement || (!asset.dataUrl && !asset.svgData)) {
      throw new Error("每个 asset 必须包含 name、placement、dataUrl 或 svgData");
    }

    const placement = asset.placement;
    const fields = [placement.x, placement.y, placement.width, placement.height];
    if (fields.some((value) => !Number.isFinite(value))) {
      throw new Error(`asset ${asset.name} 的 placement 坐标必须是数字`);
    }
  }
}

function validateEditableDesignManifest(manifest) {
  if (!manifest || !manifest.screen) {
    throw new Error("缺少 editable design screen 数据");
  }
  if (!Number.isFinite(manifest.screen.width) || !Number.isFinite(manifest.screen.height)) {
    throw new Error("editable design screen.width 和 screen.height 必须是数字");
  }
  if (!Array.isArray(manifest.nodes)) {
    throw new Error("editable design nodes 必须是数组");
  }
}
