const http = require("http");
const { Buffer } = require("buffer");
const fs = require("fs");
const path = require("path");

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 18787);
const CONFIG_FILE = path.join(__dirname, ".local-provider-config.json");
const PROVIDER_DEFAULTS = {
  thirdParty: {
    baseUrl: "https://www.ai.banyanteck.com",
    model: "gpt-image-2-all"
  },
  openai: {
    baseUrl: "https://api.openai.com",
    model: "gpt-image-2"
  },
  openrouter: {
    baseUrl: "https://openrouter.ai/api/v1",
    model: "gpt-5.4-image-2"
  }
};
const localConfig = loadLocalConfig();
let activeProvider = localConfig.activeProvider || "thirdParty";
if (!PROVIDER_DEFAULTS[activeProvider]) {
  activeProvider = "thirdParty";
}
let providerConfigs = normalizeProviderConfigs(localConfig);
let openaiApiKey = providerConfigs[activeProvider].apiKey || process.env.OPENAI_API_KEY || "";
let openaiImageModel = providerConfigs[activeProvider].model || process.env.OPENAI_IMAGE_MODEL || PROVIDER_DEFAULTS[activeProvider].model;
let openaiBaseUrl = providerConfigs[activeProvider].baseUrl || process.env.OPENAI_BASE_URL || PROVIDER_DEFAULTS[activeProvider].baseUrl;
let vectorizerModulePromise = null;
let sharpModulePromise = null;

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
  "access-control-allow-headers": "content-type,authorization"
};
const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS || 300000);

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "OPTIONS") {
      sendJson(response, 204, {});
      return;
    }

    if (request.method === "GET" && request.url === "/health") {
      sendJson(response, 200, {
        ok: true,
        activeProvider,
        baseUrl: openaiBaseUrl,
        model: openaiImageModel,
        hasApiKey: Boolean(openaiApiKey)
      });
      return;
    }

    if (request.method === "GET" && request.url === "/api/config") {
      sendJson(response, 200, {
        activeProvider,
        providers: summarizeProviders(),
        baseUrl: openaiBaseUrl,
        model: openaiImageModel,
        hasApiKey: Boolean(openaiApiKey)
      });
      return;
    }

    if (request.method === "POST" && request.url === "/api/config") {
      const payload = await readJson(request);
      const provider = PROVIDER_DEFAULTS[payload.provider] ? payload.provider : activeProvider;
      const defaults = PROVIDER_DEFAULTS[provider];
      const existingConfig = providerConfigs[provider] || defaults;
      activeProvider = provider;
      openaiImageModel = typeof payload.model === "string" && payload.model.trim()
        ? normalizeProviderModel(provider, payload.model)
        : existingConfig.model || defaults.model;
      openaiBaseUrl = typeof payload.baseUrl === "string" && payload.baseUrl.trim()
        ? normalizeProviderBaseUrl(provider, payload.baseUrl)
        : normalizeProviderBaseUrl(provider, existingConfig.baseUrl || defaults.baseUrl);
      openaiApiKey = typeof payload.apiKey === "string" && payload.apiKey.trim()
        ? payload.apiKey.trim()
        : existingConfig.apiKey || "";
      providerConfigs[provider] = {
        ...providerConfigs[provider],
        baseUrl: openaiBaseUrl,
        model: openaiImageModel,
        apiKey: openaiApiKey
      };
      saveLocalConfig();
      sendJson(response, 200, {
        ok: true,
        activeProvider,
        baseUrl: openaiBaseUrl,
        model: openaiImageModel,
        hasApiKey: Boolean(openaiApiKey),
        persisted: true
      });
      return;
    }

    if (request.method === "DELETE" && request.url === "/api/config") {
      const payload = await readJson(request);
      const provider = PROVIDER_DEFAULTS[payload.provider] ? payload.provider : activeProvider;
      const defaults = PROVIDER_DEFAULTS[provider];
      activeProvider = provider;
      providerConfigs[provider] = {
        baseUrl: defaults.baseUrl,
        model: defaults.model,
        apiKey: ""
      };
      openaiBaseUrl = providerConfigs[provider].baseUrl;
      openaiImageModel = providerConfigs[provider].model;
      openaiApiKey = "";
      saveLocalConfig();
      sendJson(response, 200, {
        ok: true,
        activeProvider,
        baseUrl: openaiBaseUrl,
        model: openaiImageModel,
        hasApiKey: false,
        cleared: true
      });
      return;
    }

    if (request.method === "POST" && request.url === "/api/images/generate") {
      requireApiKey();
      const payload = await readJson(request);
      const result = await generateImage(payload);
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && request.url === "/api/images/edit") {
      requireApiKey();
      const payload = await readJson(request);
      const result = await editImage(payload);
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && request.url === "/api/assets/generate-transparent") {
      requireApiKey();
      const payload = await readJson(request);
      const result = await generateTransparentAsset(payload);
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && request.url === "/api/assets/ai-redraw") {
      requireApiKey();
      const payload = await readJson(request);
      const result = await redrawAsset(payload);
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && request.url === "/api/assets/redraw-svg") {
      requireApiKey();
      const payload = await readJson(request);
      const result = await redrawAssetAsSvg(payload);
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && request.url === "/api/assets/vectorize") {
      const payload = await readJson(request);
      const result = await vectorizeAsset(payload);
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && request.url === "/api/design/reconstruct-html") {
      const payload = await readJson(request);
      const result = await reconstructEditableDesign(payload);
      sendJson(response, 200, result);
      return;
    }

    sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    const status = error.statusCode || 500;
    sendJson(response, status, {
      error: error.message || "Internal server error"
    });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`OpenAI image proxy listening on http://${HOST}:${PORT}`);
  console.log(`Base URL: ${openaiBaseUrl}`);
  console.log(`Model: ${openaiImageModel}`);
  console.log(`OPENAI_API_KEY: ${openaiApiKey ? "configured" : "missing"}`);
});

function loadLocalConfig() {
  try {
    if (!fs.existsSync(CONFIG_FILE)) {
      return {};
    }
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
  } catch (error) {
    console.warn(`Failed to read local provider config: ${error.message}`);
    return {};
  }
}

function saveLocalConfig() {
  const payload = {
    activeProvider,
    providers: providerConfigs,
    baseUrl: openaiBaseUrl,
    model: openaiImageModel,
    apiKey: openaiApiKey,
    updatedAt: new Date().toISOString()
  };
  fs.writeFileSync(CONFIG_FILE, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
}

function normalizeProviderConfigs(config) {
  const providers = {};
  for (const [key, defaults] of Object.entries(PROVIDER_DEFAULTS)) {
    providers[key] = {
      baseUrl: defaults.baseUrl,
      model: defaults.model,
      apiKey: ""
    };
  }

  if (config.providers && typeof config.providers === "object") {
    for (const [key, value] of Object.entries(config.providers)) {
      if (!PROVIDER_DEFAULTS[key] || !value || typeof value !== "object") {
        continue;
      }
      if (key === "thirdParty" && String(value.baseUrl || "").includes("openrouter.ai")) {
        providers.openrouter = {
          baseUrl: PROVIDER_DEFAULTS.openrouter.baseUrl,
          model: PROVIDER_DEFAULTS.openrouter.model,
          apiKey: value.apiKey || providers.openrouter.apiKey || ""
        };
        if (activeProvider === "thirdParty") {
          activeProvider = "openrouter";
        }
        continue;
      }
      providers[key] = {
        baseUrl: normalizeProviderBaseUrl(key, value.baseUrl || providers[key].baseUrl),
        model: normalizeProviderModel(key, value.model || providers[key].model),
        apiKey: value.apiKey || ""
      };
    }
  } else if (config.baseUrl || config.model || config.apiKey) {
    const legacyProvider = config.baseUrl && String(config.baseUrl).includes("banyanteck") ? "thirdParty" : "openai";
    providers[legacyProvider] = {
      baseUrl: normalizeProviderBaseUrl(legacyProvider, config.baseUrl || providers[legacyProvider].baseUrl),
      model: normalizeProviderModel(legacyProvider, config.model || providers[legacyProvider].model),
      apiKey: config.apiKey || ""
    };
    activeProvider = legacyProvider;
  }

  return providers;
}

function normalizeProviderModel(provider, value) {
  const defaults = PROVIDER_DEFAULTS[provider] || PROVIDER_DEFAULTS.openai;
  if (provider === "openrouter") {
    return defaults.model;
  }
  return typeof value === "string" && value.trim() ? value.trim() : defaults.model;
}

function normalizeProviderBaseUrl(provider, value) {
  const defaults = PROVIDER_DEFAULTS[provider] || PROVIDER_DEFAULTS.openai;
  const baseUrl = normalizeBaseUrl(value || defaults.baseUrl);
  if (provider === "openai" && baseUrl.includes("platform.openai.com")) {
    return defaults.baseUrl;
  }
  if (provider === "openrouter" && baseUrl.includes("openrouter.ai") && !baseUrl.endsWith("/api/v1")) {
    return defaults.baseUrl;
  }
  return baseUrl;
}

function summarizeProviders() {
  return Object.fromEntries(
    Object.entries(providerConfigs).map(([key, config]) => [
      key,
      {
        baseUrl: config.baseUrl,
        model: config.model,
        hasApiKey: Boolean(config.apiKey)
      }
    ])
  );
}

async function generateImage(payload) {
  const prompt = buildUiScreenshotPrompt(assertString(payload.prompt, "prompt"));
  const count = clampNumber(payload.count || 1, 1, 4);
  if (activeProvider === "openrouter") {
    return generateOpenRouterImages({
      prompt,
      count,
      width: payload.width,
      height: payload.height
    });
  }

  const body = {
    model: openaiImageModel,
    prompt,
    size: toOpenAIImageSize(payload.width, payload.height),
    quality: payload.quality || "high",
    output_format: payload.outputFormat || "png",
    background: payload.background || "opaque",
    n: count
  };

  const data = await callOpenAIJson("/v1/images/generations", body);
  return {
    ...(await normalizeImageResponse(data)),
    provider: {
      baseUrl: openaiBaseUrl,
      model: openaiImageModel,
      size: body.size
    }
  };
}

async function editImage(payload) {
  const prompt = buildUiScreenshotPrompt(assertString(payload.prompt, "prompt"));
  const count = clampNumber(payload.count || 1, 1, 4);
  const images = Array.isArray(payload.images) ? payload.images : [];
  if (images.length === 0) {
    throw badRequest("images must contain at least one data URL image");
  }
  if (activeProvider === "openrouter") {
    return generateOpenRouterImages({
      prompt,
      count,
      width: payload.width,
      height: payload.height,
      images
    });
  }

  const form = new FormData();
  form.set("model", openaiImageModel);
  form.set("prompt", prompt);
  form.set("size", toOpenAIImageSize(payload.width, payload.height));
  form.set("quality", payload.quality || "high");
  form.set("output_format", payload.outputFormat || "png");
  form.set("background", payload.background || "opaque");
  form.set("n", String(count));

  images.slice(0, 16).forEach((image, index) => {
    const file = dataUrlToFile(image.dataUrl, image.name || `reference-${index + 1}.png`);
    form.append("image[]", file);
  });

  const data = await callOpenAIForm("/v1/images/edits", form);
  return {
    ...(await normalizeImageResponse(data)),
    provider: {
      baseUrl: openaiBaseUrl,
      model: openaiImageModel,
      size: toOpenAIImageSize(payload.width, payload.height)
    }
  };
}

async function generateTransparentAsset(payload) {
  const prompt = assertString(payload.prompt, "prompt");
  if (activeProvider === "openrouter") {
    return generateOpenRouterImages({
      prompt: `${prompt}\n\nTransparent background. Isolated UI asset. No mockup, no device frame, no background.`,
      count: 1,
      width: payload.width,
      height: payload.height
    });
  }

  const body = {
    model: openaiImageModel,
    prompt: `${prompt}\n\nTransparent background. Isolated UI asset. No mockup, no device frame, no background.`,
    size: toOpenAIImageSize(payload.width, payload.height),
    quality: payload.quality || "high",
    output_format: "png",
    background: "transparent",
    n: 1
  };

  const data = await callOpenAIJson("/v1/images/generations", body);
  return {
    ...(await normalizeImageResponse(data)),
    provider: {
      baseUrl: openaiBaseUrl,
      model: openaiImageModel,
      size: body.size
    }
  };
}

async function redrawAsset(payload) {
  const dataUrl = assertString(payload.dataUrl, "dataUrl");
  const width = payload.width;
  const height = payload.height;
  const prompt = buildAssetRedrawPrompt(assertString(payload.prompt || "Redraw this UI asset.", "prompt"));
  if (activeProvider === "openrouter") {
    return {
      ...(await generateOpenRouterImages({
        prompt,
        count: 1,
        width,
        height,
        images: [
          {
            dataUrl,
            name: payload.name || "slice-reference.png"
          }
        ]
      })),
      transparent: false
    };
  }

  const form = new FormData();
  form.set("model", openaiImageModel);
  form.set("prompt", prompt);
  form.set("size", toOpenAIImageSize(width, height));
  form.set("quality", payload.quality || "high");
  form.set("output_format", "png");
  form.set("background", "transparent");
  form.set("n", "1");
  form.append("image[]", dataUrlToFile(dataUrl, payload.name || "slice-reference.png"));

  const data = await callOpenAIForm("/v1/images/edits", form);
  return {
    ...(await normalizeImageResponse(data)),
    provider: {
      baseUrl: openaiBaseUrl,
      model: openaiImageModel,
      size: toOpenAIImageSize(width, height)
    },
    transparent: true
  };
}

async function redrawAssetAsSvg(payload) {
  const dataUrl = assertString(payload.dataUrl, "dataUrl");
  const width = clampNumber(payload.width || 512, 16, 4096);
  const height = clampNumber(payload.height || 512, 16, 4096);
  const basePrompt = buildAssetSvgPrompt({
    prompt: payload.prompt || "",
    name: payload.name || "ui_asset",
    width,
    height
  });
  const attempts = [
    { prompt: basePrompt, label: "primary" },
    { prompt: buildAssetSvgRetryPrompt(basePrompt), label: "retry-clean-vector" }
  ];
  let lastError = null;
  let svg = "";
  let usedAttempt = attempts[0].label;

  for (const attempt of attempts) {
    try {
      const data = await requestSvgChatCompletion({
        prompt: attempt.prompt,
        dataUrl,
        name: payload.name || "slice-reference.png"
      });
      const text = extractChatCompletionText(data);
      svg = sanitizeGeneratedSvg(text);
      usedAttempt = attempt.label;
      break;
    } catch (error) {
      lastError = error;
      if (!error.isSvgValidationError || attempt === attempts[attempts.length - 1]) {
        throw error;
      }
    }
  }

  if (!svg) {
    throw lastError || svgValidationError("模型没有返回有效 SVG");
  }

  return {
    ok: true,
    engine: "ai-direct-svg",
    svg,
    attempt: usedAttempt,
    provider: {
      baseUrl: openaiBaseUrl,
      model: openaiImageModel,
      size: `${width}x${height}`
    }
  };
}

async function requestSvgChatCompletion({ prompt, dataUrl, name }) {
  const body = {
    model: openaiImageModel,
    messages: [
      {
        role: "user",
        content: buildOpenRouterMessageContent(prompt, [
          {
            dataUrl,
            name
          }
        ])
      }
    ],
    stream: false,
    temperature: 0.08
  };
  return activeProvider === "openrouter"
    ? callOpenRouterJson("/chat/completions", body)
    : callOpenAIJson("/v1/chat/completions", body);
}

async function vectorizeAsset(payload) {
  const dataUrl = assertString(payload.dataUrl, "dataUrl");
  const imageBuffer = dataUrlToBuffer(dataUrl);
  const { buffer: vectorImageBuffer, info: preprocessInfo } = await preprocessImageForVectorization(imageBuffer);
  const {
    vectorize,
    ColorMode,
    Hierarchical,
    PathSimplifyMode
  } = await loadVectorizerModule();

  const svg = await vectorize(vectorImageBuffer, {
    colorMode: ColorMode.Color,
    colorPrecision: 7,
    filterSpeckle: 8,
    spliceThreshold: 55,
    cornerThreshold: 68,
    hierarchical: Hierarchical.Stacked,
    mode: PathSimplifyMode.Spline,
    layerDifference: 8,
    lengthThreshold: 6,
    maxIterations: 3,
    pathPrecision: 4
  });

  const pathCount = (svg.match(/<path/g) || []).length;
  if (!pathCount) {
    throw badRequest("没有检测到可转换的 SVG 路径");
  }
  if (pathCount > 900) {
    throw badRequest("路径过多，这个素材更适合保留 PNG");
  }

  return {
    ok: true,
    engine: "vtracer",
    preprocess: preprocessInfo,
    pathCount,
    svg
  };
}

async function preprocessImageForVectorization(imageBuffer) {
  try {
    const sharp = await loadSharpModule();
    const image = sharp(imageBuffer, {
      animated: false,
      failOn: "none",
      limitInputPixels: false
    }).rotate().ensureAlpha();
    const metadata = await image.metadata();
    const width = metadata.width || 0;
    const height = metadata.height || 0;
    if (!width || !height) {
      return { buffer: imageBuffer, info: { applied: false, reason: "missing-size" } };
    }

    const longest = Math.max(width, height);
    const targetLongest = longest < 384 ? Math.min(768, longest * 3) : Math.min(1400, longest);
    const scale = targetLongest > longest ? targetLongest / longest : 1;
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));

    let pipeline = image;
    if (scale > 1.01) {
      pipeline = pipeline.resize({
        width: targetWidth,
        height: targetHeight,
        fit: "fill",
        kernel: sharp.kernel.lanczos3
      });
    }

    const buffer = await pipeline
      .median(1)
      .blur(0.18)
      .png({
        compressionLevel: 9,
        adaptiveFiltering: true
      })
      .toBuffer();

    return {
      buffer,
      info: {
        applied: true,
        width,
        height,
        targetWidth,
        targetHeight,
        scale: Number(scale.toFixed(2))
      }
    };
  } catch (error) {
    console.warn(`Vectorize preprocessing skipped: ${error.message}`);
    return { buffer: imageBuffer, info: { applied: false, reason: error.message } };
  }
}

function loadVectorizerModule() {
  if (!vectorizerModulePromise) {
    vectorizerModulePromise = import("@neplex/vectorizer");
  }
  return vectorizerModulePromise;
}

function loadSharpModule() {
  if (!sharpModulePromise) {
    sharpModulePromise = import("sharp").then((module) => module.default || module);
  }
  return sharpModulePromise;
}

async function generateOpenRouterImages({ prompt, count, width, height, images = [] }) {
  const aspectRatio = toOpenRouterAspectRatio(width, height);
  const results = [];
  for (let index = 0; index < count; index += 1) {
    const body = {
      model: openaiImageModel,
      messages: [
        {
          role: "user",
          content: buildOpenRouterMessageContent(
            count > 1 ? `${prompt}\n\nVariation ${index + 1} of ${count}.` : prompt,
            images
          )
        }
      ],
      modalities: ["image", "text"],
      stream: false,
      image_config: {
        aspect_ratio: aspectRatio,
        image_size: "1K"
      }
    };
    const data = await callOpenRouterJson("/chat/completions", body);
    const parsed = normalizeOpenRouterImageResponse(data, index);
    results.push(...parsed.images);
  }

  return {
    images: results.slice(0, count),
    provider: {
      baseUrl: openaiBaseUrl,
      model: openaiImageModel,
      size: aspectRatio
    }
  };
}

function buildOpenRouterMessageContent(prompt, images) {
  if (!images.length) {
    return prompt;
  }
  return [
    { type: "text", text: prompt },
    ...images.slice(0, 16).map((image) => ({
      type: "image_url",
      image_url: {
        url: image.dataUrl
      }
    }))
  ];
}

async function callOpenRouterJson(path, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
  const response = await fetch(`${openaiBaseUrl}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${openaiApiKey}`,
      "content-type": "application/json",
      "http-referer": "http://127.0.0.1:4173",
      "x-title": "AI UI Asset Generator"
    },
    body: JSON.stringify(body),
    signal: controller.signal
  }).catch((error) => {
    if (error.name === "AbortError") {
      const timeoutError = new Error(`OpenRouter request timed out after ${Math.round(OPENAI_TIMEOUT_MS / 1000)} seconds`);
      timeoutError.statusCode = 504;
      throw timeoutError;
    }
    throw error;
  }).finally(() => clearTimeout(timeout));
  return parseOpenAIResponse(response);
}

function normalizeOpenRouterImageResponse(data, startIndex = 0) {
  const choices = Array.isArray(data.choices) ? data.choices : [];
  const images = [];
  for (const choice of choices) {
    const message = choice.message || {};
    const messageImages = Array.isArray(message.images) ? message.images : [];
    for (const item of messageImages) {
      const imageUrl = item.image_url || item.imageUrl || {};
      const dataUrl = imageUrl.url || item.url || "";
      if (!dataUrl) {
        continue;
      }
      images.push({
        id: `image_${startIndex + images.length + 1}`,
        dataUrl,
        revisedPrompt: typeof message.content === "string" ? message.content : ""
      });
    }
  }
  if (images.length === 0) {
    throw new Error("OpenRouter did not return images. Check that the selected model supports image output.");
  }
  return { images };
}

function extractChatCompletionText(data) {
  const choices = Array.isArray(data.choices) ? data.choices : [];
  for (const choice of choices) {
    const content = choice?.message?.content;
    if (typeof content === "string" && content.trim()) {
      return content.trim();
    }
    if (Array.isArray(content)) {
      const text = content
        .map((item) => {
          if (typeof item === "string") {
            return item;
          }
          return item?.text || item?.content || "";
        })
        .join("\n")
        .trim();
      if (text) {
        return text;
      }
    }
  }
  throw new Error("模型没有返回 SVG 文本");
}

function sanitizeGeneratedSvg(text) {
  const withoutFence = String(text || "")
    .replace(/^```(?:svg|xml)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const match = withoutFence.match(/<svg\b[\s\S]*?<\/svg>/i);
  if (!match) {
    throw svgValidationError("模型没有返回有效 SVG");
  }
  const svg = match[0].trim();
  const blockedPatterns = [
    /<script\b/i,
    /<foreignObject\b/i,
    /<image\b/i,
    /\bon[a-z]+\s*=/i,
    /\b(?:href|xlink:href)\s*=/i,
    /data:image\//i,
    /javascript:/i
  ];
  if (blockedPatterns.some((pattern) => pattern.test(svg))) {
    throw svgValidationError("模型返回的 SVG 包含不允许的嵌入内容");
  }
  const openTag = svg.match(/<svg\b[^>]*>/i)?.[0] || "";
  if (!/\bviewBox\s*=/i.test(openTag)) {
    throw svgValidationError("模型返回的 SVG 缺少 viewBox");
  }
  const shapeCount = (svg.match(/<(path|rect|circle|ellipse|line|polyline|polygon)\b/gi) || []).length;
  if (!shapeCount) {
    throw svgValidationError("模型返回的 SVG 没有可编辑图形元素");
  }
  if (shapeCount > 220) {
    throw svgValidationError("AI SVG 图层过多，请重新切更小的区域或简化素材");
  }
  return svg;
}

async function callOpenAIJson(path, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
  const response = await fetch(`${openaiBaseUrl}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${openaiApiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(body),
    signal: controller.signal
  }).catch((error) => {
    if (error.name === "AbortError") {
      const timeoutError = new Error(`OpenAI request timed out after ${Math.round(OPENAI_TIMEOUT_MS / 1000)} seconds`);
      timeoutError.statusCode = 504;
      throw timeoutError;
    }
    throw error;
  }).finally(() => clearTimeout(timeout));
  return parseOpenAIResponse(response);
}

async function callOpenAIForm(path, form) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);
  const response = await fetch(`${openaiBaseUrl}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${openaiApiKey}`
    },
    body: form,
    signal: controller.signal
  }).catch((error) => {
    if (error.name === "AbortError") {
      const timeoutError = new Error(`OpenAI request timed out after ${Math.round(OPENAI_TIMEOUT_MS / 1000)} seconds`);
      timeoutError.statusCode = 504;
      throw timeoutError;
    }
    throw error;
  }).finally(() => clearTimeout(timeout));
  return parseOpenAIResponse(response);
}

async function parseOpenAIResponse(response) {
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const message = data.error && data.error.message ? data.error.message : `OpenAI request failed: ${response.status}`;
    const error = new Error(message);
    error.statusCode = response.status;
    throw error;
  }
  return data;
}

async function normalizeImageResponse(data) {
  const images = await Promise.all((data.data || []).map(async (item, index) => {
    const base64 = item.b64_json || item.image_base64 || item.base64;
    if (base64) {
      return {
        id: `image_${index + 1}`,
        dataUrl: `data:image/png;base64,${base64}`,
        revisedPrompt: item.revised_prompt || ""
      };
    }

    const remoteUrl = item.url || "";
    const dataUrl = remoteUrl ? await fetchRemoteImageAsDataUrl(remoteUrl) : "";
    return {
      id: `image_${index + 1}`,
      dataUrl,
      revisedPrompt: item.revised_prompt || ""
    };
  }));

  return { images };
}

async function reconstructEditableDesign(payload) {
  const prompt = assertString(payload.prompt || "Generate an app UI screen.", "prompt");
  const width = clampNumber(payload.width || 390, 256, 4096);
  const height = clampNumber(payload.height || 844, 256, 4096);
  const imageDataUrl = typeof payload.imageDataUrl === "string" ? payload.imageDataUrl : "";
  const sourceImage = imageDataUrl
    ? {
        dataUrl: imageDataUrl,
        name: payload.sourceImageName || "source_ui_reference.png"
      }
    : null;

  let html = buildFallbackEditableDesignHtml({ prompt, width, height });
  let mode = "template";
  let warning = "";

  if (openaiApiKey && activeProvider === "openrouter" && imageDataUrl) {
    try {
      const data = await callOpenRouterJson("/chat/completions", {
        model: openaiImageModel,
        messages: [
          {
            role: "user",
            content: buildOpenRouterMessageContent(
              buildEditableDesignReconstructionPrompt({ prompt, width, height }),
              [
                {
                  dataUrl: imageDataUrl,
                  name: payload.sourceImageName || "selected-design.png"
                }
              ]
            )
          }
        ],
        stream: false
      });
      html = sanitizeGeneratedHtml(extractChatCompletionText(data));
      mode = "model-html";
    } catch (error) {
      warning = `HTML 还原模型调用失败，已使用实验模板：${error.message || String(error)}`;
    }
  }

  return {
    ok: true,
    mode,
    warning,
    html,
    manifest: buildEditableDesignManifest({
      prompt,
      width,
      height,
      html,
      sourceImage
    }),
    provider: {
      activeProvider,
      baseUrl: openaiBaseUrl,
      model: openaiImageModel
    }
  };
}

function buildEditableDesignManifest({ prompt, width, height, sourceImage }) {
  const isTall = height >= width;
  const margin = Math.round(width * 0.07);
  const cardWidth = width - margin * 2;
  const headerTop = Math.round(height * 0.055);
  const titleText = deriveEditableDesignTitle(prompt);
  const accent = pickPromptAccent(prompt);
  const heroHeight = Math.round(height * (isTall ? 0.2 : 0.28));
  const cardY = headerTop + Math.round(height * 0.1);
  const metricY = cardY + heroHeight + Math.round(height * 0.03);
  const bottomHeight = Math.max(64, Math.round(height * 0.09));

  return {
    version: "editable-design-experiment-0.1",
    screen: {
      name: "editable_design_experiment",
      width,
      height,
      fill: "#F6F8FB",
      clipsContent: true
    },
    sourceImage,
    nodes: [
      {
        type: "text",
        name: "screen_title",
        text: titleText,
        x: margin,
        y: headerTop,
        width: Math.round(width * 0.48),
        height: 44,
        fontSize: Math.max(24, Math.round(width * 0.08)),
        fontWeight: 700,
        lineHeight: Math.max(30, Math.round(width * 0.1)),
        color: "#171A22"
      },
      {
        type: "rect",
        name: "notification_button",
        x: width - margin - 44,
        y: headerTop + 2,
        width: 44,
        height: 44,
        radius: 22,
        fill: "#FFFFFF",
        shadow: { y: 8, blur: 22, opacity: 0.1 }
      },
      {
        type: "frame",
        name: "hero_card",
        x: margin,
        y: cardY,
        width: cardWidth,
        height: heroHeight,
        radius: Math.max(22, Math.round(width * 0.06)),
        fill: "#FFFFFF",
        shadow: { y: 18, blur: 36, opacity: 0.1 },
        children: [
          {
            type: "rect",
            name: "hero_gradient",
            x: 0,
            y: 0,
            width: cardWidth,
            height: heroHeight,
            radius: Math.max(22, Math.round(width * 0.06)),
            fill: accent.soft
          },
          {
            type: "text",
            name: "hero_title",
            text: titleText,
            x: Math.round(cardWidth * 0.07),
            y: Math.round(heroHeight * 0.22),
            width: Math.round(cardWidth * 0.62),
            height: 40,
            fontSize: Math.max(22, Math.round(width * 0.065)),
            fontWeight: 700,
            lineHeight: Math.max(28, Math.round(width * 0.08)),
            color: "#161922"
          },
          {
            type: "text",
            name: "hero_subtitle",
            text: "智能生成 · 可编辑设计稿",
            x: Math.round(cardWidth * 0.07),
            y: Math.round(heroHeight * 0.48),
            width: Math.round(cardWidth * 0.7),
            height: 28,
            fontSize: Math.max(13, Math.round(width * 0.038)),
            fontWeight: 500,
            lineHeight: Math.max(18, Math.round(width * 0.05)),
            color: "#6D7280"
          },
          {
            type: "rect",
            name: "hero_action",
            x: Math.round(cardWidth * 0.07),
            y: Math.round(heroHeight * 0.68),
            width: Math.round(cardWidth * 0.28),
            height: 34,
            radius: 17,
            fill: accent.main
          },
          {
            type: "text",
            name: "hero_action_label",
            text: "开始体验",
            x: Math.round(cardWidth * 0.095),
            y: Math.round(heroHeight * 0.705),
            width: Math.round(cardWidth * 0.22),
            height: 20,
            fontSize: Math.max(12, Math.round(width * 0.034)),
            fontWeight: 600,
            lineHeight: 18,
            color: "#FFFFFF"
          }
        ]
      },
      ...buildMetricCardNodes({ margin, width, cardWidth, metricY, accent }),
      {
        type: "frame",
        name: "bottom_navigation",
        x: margin,
        y: height - bottomHeight - Math.round(height * 0.025),
        width: cardWidth,
        height: bottomHeight,
        radius: Math.round(bottomHeight * 0.36),
        fill: "#FFFFFF",
        shadow: { y: 14, blur: 28, opacity: 0.08 },
        children: buildBottomNavNodes({ cardWidth, bottomHeight, accent })
      }
    ]
  };
}

function buildMetricCardNodes({ margin, width, cardWidth, metricY, accent }) {
  const gap = Math.max(10, Math.round(width * 0.025));
  const itemWidth = Math.round((cardWidth - gap * 2) / 3);
  return ["数据", "任务", "消息"].map((label, index) => ({
    type: "frame",
    name: `metric_card_${index + 1}`,
    x: margin + index * (itemWidth + gap),
    y: metricY,
    width: itemWidth,
    height: Math.round(width * 0.28),
    radius: 18,
    fill: "#FFFFFF",
    shadow: { y: 10, blur: 24, opacity: 0.07 },
    children: [
      {
        type: "rect",
        name: "metric_icon",
        x: 16,
        y: 16,
        width: 32,
        height: 32,
        radius: 12,
        fill: index === 0 ? accent.main : "#EEF1F6"
      },
      {
        type: "text",
        name: "metric_label",
        text: label,
        x: 16,
        y: 58,
        width: itemWidth - 32,
        height: 18,
        fontSize: 13,
        fontWeight: 600,
        lineHeight: 18,
        color: "#6D7280"
      },
      {
        type: "text",
        name: "metric_value",
        text: index === 0 ? "128" : index === 1 ? "24" : "8",
        x: 16,
        y: 80,
        width: itemWidth - 32,
        height: 26,
        fontSize: 22,
        fontWeight: 700,
        lineHeight: 26,
        color: "#151821"
      }
    ]
  }));
}

function buildBottomNavNodes({ cardWidth, bottomHeight, accent }) {
  return ["首页", "发现", "记录", "我的"].map((label, index) => {
    const itemWidth = Math.round(cardWidth / 4);
    return {
      type: "text",
      name: `nav_${index + 1}`,
      text: label,
      x: index * itemWidth,
      y: Math.round(bottomHeight * 0.38),
      width: itemWidth,
      height: 22,
      fontSize: 12,
      fontWeight: index === 0 ? 700 : 500,
      lineHeight: 18,
      color: index === 0 ? accent.main : "#7B8190"
    };
  });
}

function deriveEditableDesignTitle(prompt) {
  const cleaned = String(prompt || "")
    .replace(/[，。,.!！?？]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) {
    return "智能首页";
  }
  return cleaned.slice(0, 8);
}

function pickPromptAccent(prompt) {
  const text = String(prompt || "");
  if (/电商|购物|商城|红包|促销/.test(text)) {
    return { main: "#FF5A3D", soft: "#FFF1EA" };
  }
  if (/健康|健身|运动|医疗|养生/.test(text)) {
    return { main: "#35BF78", soft: "#EAF8F1" };
  }
  if (/游戏|勇者|冒险|竞技/.test(text)) {
    return { main: "#3478F6", soft: "#EAF2FF" };
  }
  if (/音乐|会员|vip|娱乐/.test(text)) {
    return { main: "#7B5CFF", soft: "#F0EDFF" };
  }
  return { main: "#111318", soft: "#EEF1F6" };
}

function buildFallbackEditableDesignHtml({ prompt, width, height }) {
  const title = deriveEditableDesignTitle(prompt);
  const accent = pickPromptAccent(prompt);
  return [
    "<!doctype html>",
    "<html>",
    "<head>",
    "<meta charset=\"utf-8\" />",
    `<meta name=\"viewport\" content=\"width=${width}, initial-scale=1\" />`,
    "<style>",
    ":root{--bg:#F6F8FB;--text:#171A22;--muted:#6D7280;--card:#FFFFFF;--accent:" + accent.main + ";--soft:" + accent.soft + ";}",
    "*{box-sizing:border-box}body{margin:0;width:" + width + "px;height:" + height + "px;background:var(--bg);font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:var(--text);}",
    ".screen{position:relative;width:100%;height:100%;padding:7%;overflow:hidden}.title{font-size:32px;font-weight:800;line-height:1.1}.hero{margin-top:44px;border-radius:28px;background:var(--soft);padding:28px;box-shadow:0 18px 36px rgba(20,24,36,.10)}.hero h2{margin:0 0 10px;font-size:26px}.hero p{margin:0;color:var(--muted)}.button{display:inline-flex;margin-top:18px;padding:10px 18px;border-radius:999px;background:var(--accent);color:white;font-weight:700}.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:18px}.metric{border-radius:18px;background:var(--card);padding:16px;box-shadow:0 10px 24px rgba(20,24,36,.07)}.nav{position:absolute;left:7%;right:7%;bottom:3%;height:72px;border-radius:28px;background:#fff;display:grid;grid-template-columns:repeat(4,1fr);place-items:center;box-shadow:0 14px 28px rgba(20,24,36,.08)}",
    "</style>",
    "</head>",
    "<body>",
    "<main class=\"screen\">",
    `<div class=\"title\">${escapeHtml(title)}</div>`,
    "<section class=\"hero\">",
    `<h2>${escapeHtml(title)}</h2>`,
    "<p>智能生成 · 可编辑设计稿</p>",
    "<span class=\"button\">开始体验</span>",
    "</section>",
    "<section class=\"metrics\"><div class=\"metric\">数据<br><strong>128</strong></div><div class=\"metric\">任务<br><strong>24</strong></div><div class=\"metric\">消息<br><strong>8</strong></div></section>",
    "<nav class=\"nav\"><b>首页</b><span>发现</span><span>记录</span><span>我的</span></nav>",
    "</main>",
    "</body>",
    "</html>"
  ].join("");
}

function buildEditableDesignReconstructionPrompt({ prompt, width, height }) {
  return [
    "你是资深 UI 设计还原工程师、前端工程师和设计系统专家。",
    "请基于输入的 UI 截图，还原一个高精度、结构清晰、可交互的静态 HTML/CSS 页面。",
    "输入截图是唯一真实参考，目标是尽量还原截图中的界面样式、组件层级、布局比例、颜色、圆角、阴影、间距、图标风格和交互状态，而不是重新设计一个新页面。",
    "",
    `用户原始提示词：${prompt}`,
    `页面尺寸：${width} x ${height}`,
    "",
    "核心要求：",
    "- 最大深度理解截图中的界面样式和组件结构。",
    "- 高精度还原每个组件的视觉效果。",
    "- 所有可交互组件都要保留交互性，包括 default、hover、active、disabled 状态。",
    "- 文本必须使用真实文本节点，不要把文字作为图片。",
    "- 按钮、输入框、卡片、标签、导航项、列表项要用 HTML/CSS 还原。",
    "- 通用功能图标默认使用 Hugeicons 风格作为参考，并用 inline SVG 或 CSS 表达。",
    "- 吉祥物、角色、复杂插画、照片和商品图不要用 HTML/CSS 硬画，用 image asset placeholder 表达。",
    "- 不要生成无法编辑的一整张大图。",
    "- 不要加载远程 JS，不要依赖外部网络资源。",
    "- 使用 CSS variables 提取主要颜色、圆角、阴影和字号。",
    "",
    "最终输出：只返回完整 HTML，不要返回 Markdown，不要解释。"
  ].join("\n");
}

function sanitizeGeneratedHtml(text) {
  const withoutFence = String(text || "")
    .replace(/^```(?:html)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const match = withoutFence.match(/<!doctype html>[\s\S]*<\/html>|<html[\s\S]*<\/html>/i);
  if (!match) {
    throw badRequest("模型没有返回有效 HTML");
  }
  return match[0]
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "");
}

async function fetchRemoteImageAsDataUrl(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch generated image: ${response.status}`);
  }
  const mimeType = response.headers.get("content-type") || "image/png";
  const bytes = Buffer.from(await response.arrayBuffer());
  return `data:${mimeType};base64,${bytes.toString("base64")}`;
}

function dataUrlToFile(dataUrl, name) {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) {
    throw badRequest("image dataUrl must be a base64 data URL");
  }

  const mimeType = match[1];
  const bytes = Buffer.from(match[2], "base64");
  const blob = new Blob([bytes], { type: mimeType });
  return new File([blob], name, { type: mimeType });
}

function dataUrlToBuffer(dataUrl) {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) {
    throw badRequest("image dataUrl must be a base64 data URL");
  }
  return Buffer.from(match[2], "base64");
}

function buildUiScreenshotPrompt(prompt) {
  return [
    prompt,
    "Generate a full-screen app UI screenshot.",
    "Fill the entire image with the interface.",
    "No phone mockup, no device frame, no floating poster, no outer grey background, no table, no wall, no presentation board.",
    "Keep the UI aligned to the requested orientation and make it read like a real in-app screen."
  ].join("\n\n");
}

function buildAssetRedrawPrompt(prompt) {
  return [
    prompt,
    "This is not a full-screen UI generation task.",
    "Use the attached image only as the source asset reference.",
    "Redraw a single clean standalone UI asset.",
    "Preserve the source asset meaning, rough shape, color family, and orientation.",
    "Remove screenshot noise, neighboring UI fragments, accidental background, compression artifacts, and blurry edges.",
    "Output a transparent PNG when the provider supports transparency.",
    "Do not add a phone frame, app screen, mockup, poster, labels, extra icons, or extra background."
  ].join("\n\n");
}

function buildAssetSvgPrompt({ prompt, name, width, height }) {
  return [
    "You are a senior SVG vectorization engineer and UI icon restoration expert.",
    "Generate a high-fidelity, editable SVG icon based on the attached UI icon asset.",
    "The attached image is the only source of truth. The goal is to look like the original was carefully traced and vectorized, not redesigned.",
    prompt || `Redraw "${name}" as an SVG asset.`,
    "",
    "Core principles:",
    "- 1:1 similarity is more important than making a prettier new icon.",
    "- Faithful restoration is more important than simplification.",
    "- Do not redesign, restyle, normalize into an icon set, or change the category of the icon.",
    "- Do not simplify key structures or add elements that are not present in the source.",
    "- Do not convert a small UI icon into a large illustration.",
    "",
    "Before drawing, silently analyze the source:",
    "1. Identify the icon type: object, animal, person, symbol, abstract shape, functional icon, etc.",
    "2. Count the main contour blocks and major visual pieces.",
    "3. Identify the subject position, scale, visual center, and padding inside the crop.",
    "4. Identify the main contour direction, angles, posture, weight, asymmetry, concave/convex corners, notches, and special curves.",
    "5. Identify internal structures: highlights, shadows, facets, holes, lines, patterns, decorations, and local details.",
    "6. Identify layer order: what is in front, what is behind, and which parts overlap.",
    "7. Identify color relationships: main colors, gradient direction, opacity, highlights, dark areas, and shadows.",
    "Do not output this analysis. Use it only to guide the SVG.",
    "",
    "Canvas requirements:",
    "- Transparent background.",
    `- Use viewBox=\"0 0 ${width} ${height}\".`,
    "- Preserve the original crop's position, scale, and padding ratio.",
    "- Do not arbitrarily enlarge the subject to fill the canvas.",
    "- Do not crop the subject.",
    "- Do not add a background color, base plate, rounded rectangle, glow field, or decorative backdrop unless it exists in the source asset.",
    "",
    "Contour requirements:",
    "- The outer silhouette is mandatory and must closely match the source. Trace-like accuracy is preferred over creative interpretation.",
    "- Preserve the original proportions, posture, direction, visual weight, rounded corners, sharp corners, concave areas, convex areas, notches, tilt, asymmetry, and special curves.",
    "- For abstract icons and symbols, prioritize geometric contour accuracy over illustration style.",
    "- Do not round, blobify, inflate, smooth, or regularize the shape unless the source does.",
    "- Do not turn a complex contour into a generic geometric shape.",
    "- Do not add complexity to a simple source icon.",
    "",
    "Detail requirements:",
    "- Keep only details that are actually present in the source.",
    "- Preserve key highlights, shadows, gradients, facets, cutouts, lines, patterns, local decorations, and internal white/negative shapes.",
    "- Detail position, size, angle, and layer order should stay close to the original.",
    "- Clean up only screenshot noise, compression artifacts, accidental background contamination, blurry pixel edges, and neighboring UI fragments.",
    "- Do not add new textures, lighting effects, decorations, expressions, accessories, or backgrounds.",
    "",
    "Color requirements:",
    "- Match the source colors as closely as possible.",
    "- Preserve gradient direction, brightness relationships, opacity, highlights, and dark areas.",
    "- If the source uses gradients, use linearGradient or radialGradient.",
    "- If the source is flat color, keep it flat. Do not force gradients.",
    "- For soft shadows, prefer low-opacity paths, ellipses, or gradients. Use only simple filters when absolutely necessary.",
    "- Do not use heavy drop shadows or colors outside the source palette.",
    "",
    "SVG requirements:",
    `- Return exactly one complete <svg>...</svg> element sized ${width} by ${height}.`,
    "- Output SVG code only. No explanation, no Markdown, no surrounding text.",
    "- Do not embed base64, raster images, <image>, foreignObject, external href, CSS imports, script, animation, or HTML.",
    "- Use editable SVG elements: path, circle, rect, ellipse, polygon, polyline, line, g, defs, linearGradient, radialGradient, mask, clipPath, and simple filter when needed.",
    "- Prefer path and Bezier curves for the main contour.",
    "- Each major visual block should be grouped clearly for later editing.",
    "- Keep path count reasonable: not over-simplified, but no meaningless pixel fragments.",
    "- Use clear ids such as main-shape, highlight, shadow, detail, outline, inner-cutout, gradient-main.",
    "- Do not use strokes to fake filled shapes unless the source itself is a line icon.",
    "- If the source has a stroke, preserve stroke width, cap style, join style, and rounded corner behavior.",
    "",
    "Forbidden:",
    "- No redesign. No category changes. No direction changes. No proportion changes. No visual weight changes.",
    "- No added elements. No background. No bitmap output. No PNG/JPG/base64.",
    "- Do not turn it into a generic icon. Do not turn a simple UI icon into a complex illustration. Do not over-simplify a complex icon."
  ].join("\n");
}

function buildAssetSvgRetryPrompt(basePrompt) {
  return [
    basePrompt,
    "",
    "The previous SVG candidate failed quality validation.",
    "Regenerate it with stricter contour lock:",
    "- First create the exact outer contour, then add internal highlights, shadows, gradients, and details.",
    "- Preserve source silhouette point-by-point at the visual level: angles, corners, concave areas, convex areas, notches, tilt, and padding.",
    "- For small abstract icons, do not reinterpret the shape as a soft blob or a new symbol.",
    "- Do not redesign it into a generic simplified icon or remove small details that make the source recognizable.",
    "- Do not use raster images or embedded data.",
    "- Include a correct viewBox on the <svg> element.",
    "- Use enough clean vector layers, gradients, and opacity to preserve the source look, but merge tiny fragments into purposeful shapes.",
    "- The final SVG should look like a carefully vectorized version of the reference, not a newly generated icon."
  ].join("\n");
}

function toOpenAIImageSize(width, height) {
  const numericWidth = Number(width);
  const numericHeight = Number(height);
  if (!Number.isFinite(numericWidth) || !Number.isFinite(numericHeight)) {
    return "auto";
  }

  const ratio = numericWidth / numericHeight;
  if (ratio > 1.2) {
    return "1536x1024";
  }
  if (ratio < 0.85) {
    return "1024x1536";
  }
  return "1024x1024";
}

function toOpenRouterAspectRatio(width, height) {
  const numericWidth = Number(width);
  const numericHeight = Number(height);
  if (!Number.isFinite(numericWidth) || !Number.isFinite(numericHeight) || numericWidth <= 0 || numericHeight <= 0) {
    return "1:1";
  }
  const ratio = numericWidth / numericHeight;
  const candidates = [
    ["1:1", 1],
    ["16:9", 16 / 9],
    ["9:16", 9 / 16],
    ["4:3", 4 / 3],
    ["3:4", 3 / 4],
    ["3:2", 3 / 2],
    ["2:3", 2 / 3]
  ];
  return candidates.reduce((best, current) => {
    const currentDelta = Math.abs(current[1] - ratio);
    const bestDelta = Math.abs(best[1] - ratio);
    return currentDelta < bestDelta ? current : best;
  }, candidates[0])[0];
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 30 * 1024 * 1024) {
        reject(badRequest("Request body is too large"));
      }
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(badRequest("Invalid JSON body"));
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, JSON_HEADERS);
  if (statusCode === 204) {
    response.end();
    return;
  }
  response.end(JSON.stringify(data));
}

function requireApiKey() {
  if (!openaiApiKey) {
    const error = new Error("OPENAI_API_KEY is not configured");
    error.statusCode = 500;
    throw error;
  }
}

function assertString(value, name) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw badRequest(`${name} is required`);
  }
  return value.trim();
}

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return min;
  }
  return Math.min(max, Math.max(min, number));
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;"
    };
    return entities[character] || character;
  });
}

function svgValidationError(message) {
  const error = new Error(message);
  error.statusCode = 422;
  error.isSvgValidationError = true;
  return error;
}

function normalizeBaseUrl(value) {
  const trimmed = value.trim().replace(/\/$/, "");
  if (!/^https?:\/\//.test(trimmed)) {
    throw badRequest("baseUrl must start with http:// or https://");
  }
  return trimmed;
}
