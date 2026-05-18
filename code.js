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
  frame.fills = createEditableFills(manifest.screen, "#F7F8FA");

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
  if (type === "icon") {
    return createEditableIcon(definition);
  }
  if (type === "svg") {
    return createEditableSvg(definition);
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
  frame.fills = createEditableFills(definition, "#FFFFFF");
  applyCornerRadius(frame, definition);
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
  rectangle.fills = createEditableFills(definition, "#FFFFFF");
  applyCornerRadius(rectangle, definition);
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
    height: definition.height,
    scaleMode: definition.scaleMode
  });
  applyBaseNodeProperties(image, definition);
  applyCornerRadius(image, definition);
  return image;
}

async function createEditableText(definition) {
  const fontStyle = fontStyleFromWeight(definition.fontWeight);
  const fontName = await loadPreferredTextFont(String(definition.text || ""), fontStyle);

  const text = figma.createText();
  applyBaseNodeProperties(text, definition);
  text.fontName = fontName;
  text.characters = String(definition.text || "");
  text.fontSize = clampNumber(Number(definition.fontSize), 8, 160, 16);
  text.lineHeight = { unit: "PIXELS", value: clampNumber(Number(definition.lineHeight), text.fontSize, 240, Math.round(text.fontSize * 1.25)) };
  text.fills = [hexToSolidPaint(definition.color || "#111318", definition.opacity)];
  if (definition.letterSpacing) {
    text.letterSpacing = { unit: "PIXELS", value: Number(definition.letterSpacing) };
  }
  try {
    text.textAutoResize = "NONE";
    text.resize(
      Math.max(1, clampNumber(Number(definition.width), 1, 100000, 100)),
      Math.max(1, clampNumber(Number(definition.height), 1, 100000, 40))
    );
  } catch (error) {
    // Older Figma runtimes may not allow text auto-resize changes here.
  }
  return text;
}

async function createEditableIcon(definition) {
  const width = clampNumber(Number(definition.width), 1, 512, 24);
  const height = clampNumber(Number(definition.height), 1, 512, 24);
  const svgData = createHugeiconsStyleSvg({
    name: definition.iconName || definition.name || "circle",
    color: definition.color || definition.stroke || "#111318",
    width: width,
    height: height,
    strokeWidth: definition.strokeWidth || Math.max(1.6, Math.min(width, height) * 0.08)
  });
  const node = createSvgAssetNode({
    name: definition.name || "icon",
    svgData: svgData,
    width: width,
    height: height
  });
  applyBaseNodeProperties(node, definition);
  return node;
}

function createEditableSvg(definition) {
  const svgData = String(definition.svgData || "").trim();
  if (!svgData) {
    const fallbackDefinition = Object.assign({}, definition, {
      fill: definition.fill || "#EEF1F6"
    });
    return createEditableRectangle(fallbackDefinition);
  }
  const node = createSvgAssetNode({
    name: definition.name || "svg_asset",
    svgData,
    width: clampNumber(Number(definition.width), 1, 100000, 24),
    height: clampNumber(Number(definition.height), 1, 100000, 24)
  });
  applyBaseNodeProperties(node, definition);
  return node;
}

function createHugeiconsStyleSvg(options) {
  const width = Math.max(1, Math.round(Number(options.width) || 24));
  const height = Math.max(1, Math.round(Number(options.height) || 24));
  const name = normalizeIconName(options.name);
  const color = sanitizeSvgColor(options.color || "#111318");
  const strokeWidth = Math.max(1, Math.min(5, Number(options.strokeWidth) || 2));
  const body = getHugeiconsPathBody(name);
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="' + width + '" height="' + height + '" fill="none">',
    '<g stroke="' + color + '" stroke-width="' + strokeWidth + '" stroke-linecap="round" stroke-linejoin="round">',
    body,
    '</g>',
    '</svg>'
  ].join("");
}

function normalizeIconName(value) {
  const text = String(value || "").toLowerCase().replace(/[\s_-]+/g, "");
  const aliases = {
    favourite: "star",
    favorite: "star",
    collect: "star",
    history: "clock",
    recent: "clock",
    bookshelf: "bookmark",
    book: "bookmark",
    download: "download",
    filedownload: "download",
    file: "download",
    order: "calendarcheck",
    orders: "calendarcheck",
    task: "calendarcheck",
    cloud: "cloud",
    drive: "cloud",
    netdisk: "cloud",
    wallet: "wallet",
    money: "wallet",
    miniapp: "code",
    miniprogram: "code",
    more: "plus",
    add: "plus",
    home: "home",
    video: "play",
    play: "play",
    microphone: "mic",
    mic: "mic",
    message: "message",
    chat: "message",
    user: "user",
    profile: "user",
    search: "search",
    settings: "settings",
    scan: "scan",
    right: "chevronright",
    next: "chevronright",
    chevronright: "chevronright",
    arrowright: "arrowright",
    left: "chevronleft",
    back: "chevronleft",
    chevronleft: "chevronleft",
    arrowleft: "arrowleft",
    down: "chevrondown",
    dropdown: "chevrondown",
    chevrondown: "chevrondown",
    up: "chevronup",
    chevronup: "chevronup",
    refresh: "refresh",
    reload: "refresh"
  };
  return aliases[text] || text || "circle";
}

function sanitizeSvgColor(value) {
  const text = String(value || "#111318").trim();
  if (/^#[0-9a-fA-F]{3}$/.test(text) || /^#[0-9a-fA-F]{6}$/.test(text)) {
    return text;
  }
  return "#111318";
}

function getHugeiconsPathBody(name) {
  const icons = {
    star: '<path d="M12 3.6l2.35 4.75 5.25.76-3.8 3.7.9 5.23L12 15.57 7.3 18.04l.9-5.23-3.8-3.7 5.25-.76L12 3.6z"/>',
    clock: '<circle cx="12" cy="12" r="8.25"/><path d="M12 7.8v4.55l3.05 1.85"/>',
    bookmark: '<path d="M7.2 4.5h9.6c.66 0 1.2.54 1.2 1.2v14l-6-3.35-6 3.35v-14c0-.66.54-1.2 1.2-1.2z"/>',
    download: '<path d="M12 4.5v9.2"/><path d="M8.4 10.2l3.6 3.6 3.6-3.6"/><path d="M5.2 18.7h13.6"/>',
    calendarcheck: '<rect x="4.4" y="5.6" width="15.2" height="14" rx="3"/><path d="M8 3.8v3.6M16 3.8v3.6M4.8 9.4h14.4"/><path d="M8.6 14.4l2.1 2.1 4.6-4.8"/>',
    cloud: '<path d="M7.4 18.4h9.2a4 4 0 0 0 .5-7.96A5.6 5.6 0 0 0 6.25 9.2 4.6 4.6 0 0 0 7.4 18.4z"/>',
    wallet: '<path d="M4.2 7.4h14.9c.8 0 1.45.65 1.45 1.45v8.25c0 .8-.65 1.45-1.45 1.45H4.9c-.8 0-1.45-.65-1.45-1.45V6.9c0-.8.65-1.45 1.45-1.45h12.2"/><path d="M15.9 12.2h4.65v3.4H15.9a1.7 1.7 0 0 1 0-3.4z"/>',
    code: '<path d="M8.5 7.4L4.2 12l4.3 4.6"/><path d="M15.5 7.4l4.3 4.6-4.3 4.6"/>',
    plus: '<circle cx="12" cy="12" r="8.2"/><path d="M12 8.3v7.4M8.3 12h7.4"/>',
    home: '<path d="M4.2 11.4L12 4.8l7.8 6.6"/><path d="M6.4 10.2v8.4h11.2v-8.4"/><path d="M9.8 18.6v-5.2h4.4v5.2"/>',
    play: '<circle cx="12" cy="12" r="8.25"/><path d="M10.2 8.8l5.1 3.2-5.1 3.2V8.8z"/>',
    mic: '<path d="M12 4.2a3 3 0 0 0-3 3v4.2a3 3 0 0 0 6 0V7.2a3 3 0 0 0-3-3z"/><path d="M6.8 11.2a5.2 5.2 0 0 0 10.4 0"/><path d="M12 16.4v3.4M9.2 19.8h5.6"/>',
    message: '<path d="M5.2 5.4h13.6c.88 0 1.6.72 1.6 1.6v8.4c0 .88-.72 1.6-1.6 1.6H9.1l-4.3 3v-13c0-.88.72-1.6 1.6-1.6z"/><path d="M8.2 10h7.6M8.2 13.2h4.8"/>',
    user: '<circle cx="12" cy="8.6" r="3.5"/><path d="M5.4 19.4c1.25-3.25 3.45-4.85 6.6-4.85s5.35 1.6 6.6 4.85"/>',
    search: '<circle cx="10.8" cy="10.8" r="6.2"/><path d="M15.4 15.4l4.2 4.2"/>',
    settings: '<path d="M12 8.8a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4z"/><path d="M19.1 13.6v-3.2l-2.05-.45a6.2 6.2 0 0 0-.65-1.55l1.15-1.75-2.25-2.25-1.75 1.15c-.5-.28-1.02-.5-1.55-.65L11.6 2.9H8.4l-.45 2.05c-.53.15-1.05.37-1.55.65L4.65 4.45 2.4 6.7 3.55 8.45c-.28.5-.5 1.02-.65 1.55L.9 10.4v3.2l2 .45c.15.53.37 1.05.65 1.55L2.4 17.35l2.25 2.25 1.75-1.15c.5.28 1.02.5 1.55.65l.45 2.05h3.2l.45-2.05c.53-.15 1.05-.37 1.55-.65l1.75 1.15 2.25-2.25-1.15-1.75c.28-.5.5-1.02.65-1.55l2.05-.45z"/>',
    scan: '<path d="M5.2 8V5.2H8M16 5.2h2.8V8M18.8 16v2.8H16M8 18.8H5.2V16"/><path d="M8 12h8"/>',
    chevronright: '<path d="M9 5.2l6.8 6.8L9 18.8"/>',
    chevronleft: '<path d="M15 5.2L8.2 12 15 18.8"/>',
    chevrondown: '<path d="M5.2 9l6.8 6.8L18.8 9"/>',
    chevronup: '<path d="M5.2 15l6.8-6.8L18.8 15"/>',
    arrowright: '<path d="M4.5 12h14"/><path d="M13.2 6.2L19 12l-5.8 5.8"/>',
    arrowleft: '<path d="M19.5 12h-14"/><path d="M10.8 6.2L5 12l5.8 5.8"/>',
    refresh: '<path d="M18.4 9.1a6.5 6.5 0 1 0 1 4.1"/><path d="M18.8 4.8v4.4h-4.4"/>',
    circle: '<circle cx="12" cy="12" r="7.8"/>'
  };
  return icons[name] || icons.circle;
}

async function loadPreferredTextFont(text, fontStyle) {
  const candidates = numericTextLooksLikeMetric(text)
    ? numericFontCandidates(fontStyle).concat(cjkFontCandidates(fontStyle))
    : cjkFontCandidates(fontStyle);
  candidates.push(
    { family: "Inter", style: fontStyle },
    { family: "Inter", style: "Regular" }
  );
  for (const candidate of candidates) {
    try {
      await figma.loadFontAsync(candidate);
      return candidate;
    } catch (error) {
      // Try the next installed font. Figma font availability differs by machine.
    }
  }
  await figma.loadFontAsync({ family: "Inter", style: "Regular" });
  return { family: "Inter", style: "Regular" };
}

function numericTextLooksLikeMetric(text) {
  const value = String(text || "").trim();
  return !!value && /^[¥￥$€£+\-−–—.,:/%()\s0-9]+$/.test(value) && /\d/.test(value);
}

function numericFontCandidates(fontStyle) {
  const style = fontStyle === "Bold" || fontStyle === "Semi Bold" ? "Bold" : "Regular";
  return [
    { family: "DIN Alternate", style },
    { family: "DIN Alternate", style: "Bold" },
    { family: "DIN Condensed", style: "Bold" },
    { family: "DIN 2014", style },
    { family: "D-DIN", style },
    { family: "Arial", style }
  ];
}

function cjkFontCandidates(fontStyle) {
  const pingFangStyle = fontStyle === "Bold" ? "Semibold" : fontStyle === "Semi Bold" ? "Semibold" : fontStyle;
  return [
    { family: "PingFang SC", style: pingFangStyle },
    { family: "PingFang SC", style: "Regular" },
    { family: "Microsoft YaHei", style: fontStyle === "Bold" ? "Bold" : "Regular" },
    { family: "Noto Sans CJK SC", style: fontStyle === "Bold" ? "Bold" : "Regular" },
    { family: "Source Han Sans SC", style: fontStyle === "Bold" ? "Bold" : "Regular" }
  ];
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

function applyCornerRadius(node, definition) {
  const radii = definition && definition.radii;
  if (radii && typeof radii === "object") {
    node.topLeftRadius = normalizeRadius(radii.topLeft);
    node.topRightRadius = normalizeRadius(radii.topRight);
    node.bottomRightRadius = normalizeRadius(radii.bottomRight);
    node.bottomLeftRadius = normalizeRadius(radii.bottomLeft);
    return;
  }
  node.cornerRadius = normalizeRadius(definition && definition.radius);
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

function createEditableFills(definition, fallbackHex) {
  const gradient = definition && definition.gradient;
  if (gradient && Array.isArray(gradient.stops) && gradient.stops.length >= 2) {
    if (gradient.type === "radial") {
      return [createRadialGradientPaint(gradient, definition.opacity)];
    }
    return [createLinearGradientPaint(gradient, definition.opacity)];
  }
  return [hexToSolidPaint((definition && definition.fill) || fallbackHex || "#FFFFFF", definition && definition.opacity)];
}

function createLinearGradientPaint(gradient, opacity) {
  const stops = gradient.stops
    .map((stop, index) => ({
      position: clampNumber(Number(stop.position), 0, 1, index / Math.max(1, gradient.stops.length - 1)),
      color: hexToRgbColor(stop.color || "#FFFFFF", (stop.opacity === undefined ? 1 : stop.opacity) * clampOpacity(opacity))
    }))
    .sort((a, b) => a.position - b.position);
  return {
    type: "GRADIENT_LINEAR",
    gradientTransform: gradientTransformFromAngle(gradient.angle),
    gradientStops: stops
  };
}

function createRadialGradientPaint(gradient, opacity) {
  const stops = gradient.stops
    .map((stop, index) => ({
      position: clampNumber(Number(stop.position), 0, 1, index / Math.max(1, gradient.stops.length - 1)),
      color: hexToRgbColor(stop.color || "#FFFFFF", (stop.opacity === undefined ? 1 : stop.opacity) * clampOpacity(opacity))
    }))
    .sort((a, b) => a.position - b.position);
  return {
    type: "GRADIENT_RADIAL",
    gradientTransform: [[1, 0, 0], [0, 1, 0]],
    gradientStops: stops
  };
}

function gradientTransformFromAngle(angle) {
  const normalized = ((Number(angle) % 360) + 360) % 360;
  if (normalized >= 45 && normalized < 135) {
    return [[1, 0, 0], [0, 1, 0]];
  }
  if (normalized >= 135 && normalized < 225) {
    return [[0, 1, 0], [-1, 0, 1]];
  }
  if (normalized >= 225 && normalized < 315) {
    return [[-1, 0, 1], [0, -1, 1]];
  }
  return [[0, -1, 1], [1, 0, 0]];
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

async function createImageRectangle({ name, imageDataUrl, width, height, scaleMode }) {
  const bytes = dataUrlToBytes(imageDataUrl);
  const image = figma.createImage(bytes);
  const rectangle = figma.createRectangle();
  rectangle.name = name;
  rectangle.resize(width, height);
  rectangle.fills = [
    {
      type: "IMAGE",
      scaleMode: normalizeImageScaleMode(scaleMode),
      imageHash: image.hash
    }
  ];
  return rectangle;
}

function normalizeImageScaleMode(scaleMode) {
  const mode = String(scaleMode || "").toUpperCase();
  if (mode === "FILL" || mode === "FIT" || mode === "CROP" || mode === "TILE") {
    return mode;
  }
  return "FIT";
}

async function createAssetNode(asset) {
  if (asset.svgData) {
    try {
      const svgNode = createSvgAssetNode({
        name: asset.name,
        svgData: asset.svgData,
        width: asset.placement.width,
        height: asset.placement.height
      });
      applyAssetCornerRadius(svgNode, asset);
      return svgNode;
    } catch (error) {
      notifyRecoverableError("SVG 回填失败，已回退 PNG", error);
    }
  }

  const imageNode = await createImageRectangle({
    name: asset.name,
    imageDataUrl: asset.dataUrl,
    width: asset.placement.width,
    height: asset.placement.height
  });
  applyAssetCornerRadius(imageNode, asset);
  return imageNode;
}

function applyAssetCornerRadius(node, asset) {
  if (!node || asset.radius === undefined || asset.radius === null) {
    return;
  }
  try {
    applyCornerRadius(node, { radius: asset.radius });
  } catch (error) {
    notifyRecoverableError(`切图圆角应用失败：${asset.name || "asset"}`, error);
  }
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
    radius: normalizeRadius(asset.radius),
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
