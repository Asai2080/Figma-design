figma.showUI(__html__, { width: 980, height: 700, themeColors: true });

figma.ui.onmessage = async (message) => {
  try {
    if (message.type === "create-ui-asset-screen") {
      await createUiAssetScreen(message.manifest);
      figma.notify("已生成 UI 预览和透明 PNG 素材");
    }

    if (message.type === "resize-ui") {
      figma.ui.resize(message.width, message.height);
    }

    if (message.type === "close") {
      figma.closePlugin();
    }
  } catch (error) {
    const reason = error && error.message ? error.message : String(error);
    figma.notify(`生成失败：${reason}`, { error: true });
    figma.ui.postMessage({ type: "generation-error", message: reason });
  }
};

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
    const node = await createImageRectangle({
      name: asset.name,
      imageDataUrl: asset.dataUrl,
      width: asset.placement.width,
      height: asset.placement.height
    });

    node.x = asset.placement.x;
    node.y = asset.placement.y;
    node.exportSettings = [
      {
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

function createPluginDataAssetManifest(asset) {
  return {
    id: asset.id,
    name: asset.name,
    type: asset.type,
    kind: asset.kind,
    placement: asset.placement,
    transparent: Boolean(asset.transparent),
    selected: asset.selected !== false
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
    if (!asset.name || !asset.placement || !asset.dataUrl) {
      throw new Error("每个 asset 必须包含 name、placement、dataUrl");
    }

    const placement = asset.placement;
    const fields = [placement.x, placement.y, placement.width, placement.height];
    if (fields.some((value) => !Number.isFinite(value))) {
      throw new Error(`asset ${asset.name} 的 placement 坐标必须是数字`);
    }
  }
}
