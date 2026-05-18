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
const OPENROUTER_ANALYSIS_MAX_TOKENS = Number(process.env.OPENROUTER_ANALYSIS_MAX_TOKENS || 8000);
const OPENROUTER_H5_MAX_TOKENS = Number(process.env.OPENROUTER_H5_MAX_TOKENS || 12000);
const OPENROUTER_MANIFEST_MAX_TOKENS = Number(process.env.OPENROUTER_MANIFEST_MAX_TOKENS || 8192);
const OPENROUTER_SVG_MAX_TOKENS = Number(process.env.OPENROUTER_SVG_MAX_TOKENS || 4096);
const OPENROUTER_IMAGE_TEXT_MAX_TOKENS = Number(process.env.OPENROUTER_IMAGE_TEXT_MAX_TOKENS || 1024);

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

    if (request.method === "POST" && request.url === "/api/design/reconstruct-h5") {
      const payload = await readJson(request);
      const result = await reconstructEditableDesignH5(payload);
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "POST" && request.url === "/api/design/analyze-ui") {
      requireApiKey();
      const payload = await readJson(request);
      const width = clampNumber(payload.width || 390, 256, 4096);
      const height = clampNumber(payload.height || 844, 256, 4096);
      const referenceAssets = normalizeEditableReferenceAssets(payload.referenceAssets, width, height);
      const modelReferenceAssets = selectEditableModelReferenceAssets(referenceAssets);
      const result = await analyzeEditableDesignImage({
        prompt: assertString(payload.prompt || "", "prompt"),
        width,
        height,
        imageDataUrl: typeof payload.imageDataUrl === "string" ? payload.imageDataUrl : "",
        referenceAssets,
        modelReferenceAssets
      });
      sendJson(response, 200, { ok: true, analysis: result });
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
    temperature: 0.08,
    ...(activeProvider === "openrouter" ? { max_tokens: OPENROUTER_SVG_MAX_TOKENS } : {})
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
      max_tokens: OPENROUTER_IMAGE_TEXT_MAX_TOKENS,
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
  throw new Error("模型没有返回文本内容");
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
  const referenceAssets = normalizeEditableReferenceAssets(payload.referenceAssets, width, height);
  const modelReferenceAssets = selectEditableModelReferenceAssets(referenceAssets);

  let html = buildFallbackEditableDesignHtml({ prompt, width, height });
  let mode = "template";
  let warning = "";
  let visualAnalysis = null;
  let manifest = null;

  if (openaiApiKey && activeProvider === "openrouter" && imageDataUrl) {
    try {
      try {
        visualAnalysis = await analyzeEditableDesignImage({
          prompt,
          width,
          height,
          imageDataUrl,
          referenceAssets,
          modelReferenceAssets
        });
      } catch (analysisError) {
        warning = `AI 视觉分析失败，已跳过分析层：${formatEditableDesignError(analysisError)}`;
      }
      const data = await callOpenRouterJson("/chat/completions", {
        model: openaiImageModel,
        messages: [
          {
            role: "user",
            content: buildOpenRouterMessageContent(
              buildEditableDesignManifestPrompt({
                prompt,
                width,
                height,
                referenceAssets,
                modelReferenceAssets,
                visualAnalysis
              }),
              [
                {
                  dataUrl: imageDataUrl,
                  name: payload.sourceImageName || "selected-design.png"
                },
                ...modelReferenceAssets.map((asset, index) => ({
                  dataUrl: asset.dataUrl,
                  name: `slice-reference-${index + 1}-${asset.name || asset.id || "asset"}.png`
                }))
              ]
            )
          }
        ],
        response_format: { type: "json_object" },
        stream: false,
        max_tokens: OPENROUTER_MANIFEST_MAX_TOKENS
      });
      manifest = sanitizeEditableDesignManifest(
        extractEditableDesignManifestJson(extractChatCompletionText(data)),
        { width, height, sourceImage, referenceAssets }
      );
      html = buildHtmlPreviewFromEditableManifest(manifest);
      mode = "model-manifest";
    } catch (error) {
      const prefix = warning ? `${warning}；` : "";
      warning = `${prefix}AI 还原失败，已使用实验模板：${formatEditableDesignError(error)}`;
    }
  }

  if (!manifest) {
    manifest = buildEditableDesignManifest({
      prompt,
      width,
      height,
      html,
      sourceImage,
      mode,
      referenceAssets
    });
  }
  manifest.metadata = Object.assign({}, manifest.metadata || {}, {
    mode,
    provider: activeProvider,
    model: openaiImageModel,
    referenceAssetCount: referenceAssets.length,
    modelReferenceAssetCount: modelReferenceAssets.length,
    analysisMode: visualAnalysis ? "two-stage" : "direct"
  });

  return {
    ok: true,
    mode,
    warning,
    html,
    manifest,
    analysis: visualAnalysis,
    provider: {
      activeProvider,
      baseUrl: openaiBaseUrl,
      model: openaiImageModel
    }
  };
}

async function reconstructEditableDesignH5(payload) {
  const prompt = assertString(payload.prompt || "", "prompt");
  const width = clampNumber(payload.width || 390, 256, 4096);
  const height = clampNumber(payload.height || 844, 256, 4096);
  const imageDataUrl = typeof payload.imageDataUrl === "string" ? payload.imageDataUrl : "";
  const referenceAssets = normalizeEditableReferenceAssets(payload.referenceAssets, width, height);
  const modelReferenceAssets = selectEditableModelReferenceAssets(referenceAssets);
  const previewWidth = Math.round(width);
  const previewHeight = Math.max(1, Math.round(height * (previewWidth / width)));
  const fallbackHtml = buildFallbackH5PreviewHtml({
    prompt,
    width,
    height,
    previewWidth,
    previewHeight,
    imageDataUrl,
    referenceAssets
  });

  if (!openaiApiKey || activeProvider !== "openrouter" || !imageDataUrl) {
    return {
      ok: true,
      mode: "h5-template",
      warning: "当前没有可用 OpenRouter 图片理解配置，已打开本地 H5 预览模板。",
      html: fallbackHtml,
      metadata: {
        width,
        height,
        previewWidth,
        previewHeight,
        referenceAssetCount: referenceAssets.length,
        modelReferenceAssetCount: modelReferenceAssets.length
      },
      provider: {
        activeProvider,
        baseUrl: openaiBaseUrl,
        model: openaiImageModel
      }
    };
  }

  try {
    let visualAnalysis = null;
    try {
      visualAnalysis = await analyzeEditableDesignImage({
        prompt,
        width,
        height,
        imageDataUrl,
        referenceAssets,
        modelReferenceAssets
      });
    } catch (analysisError) {
      console.warn("[reconstruct-h5] visual analysis failed, continue direct HTML generation:", analysisError?.message || analysisError);
    }
    const data = await callOpenRouterJson("/chat/completions", {
      model: openaiImageModel,
      messages: [
        {
          role: "user",
          content: buildOpenRouterMessageContent(
            buildEditableDesignH5Prompt({
              prompt,
              width,
              height,
              previewWidth,
              previewHeight,
              referenceAssets,
              modelReferenceAssets,
              visualAnalysis
            }),
            [
              {
                dataUrl: imageDataUrl,
                name: payload.sourceImageName || "full-ui-screenshot.png"
              },
              ...modelReferenceAssets.map((asset, index) => ({
                dataUrl: asset.dataUrl,
                name: `slice-reference-${index + 1}-${asset.name || asset.id || "asset"}.png`
              }))
            ]
          )
        }
      ],
      stream: false,
      max_tokens: OPENROUTER_H5_MAX_TOKENS
    });
    const rawHtml = extractHtmlDocument(extractChatCompletionText(data));
    const html = sanitizeGeneratedHtml(rawHtml, referenceAssets, {
      previewWidth,
      previewHeight,
      sourceWidth: width,
      sourceHeight: height
    });
    return {
      ok: true,
      mode: "h5-direct",
      warning: "",
      html,
      metadata: {
        width,
        height,
        previewWidth,
        previewHeight,
        referenceAssetCount: referenceAssets.length,
        modelReferenceAssetCount: modelReferenceAssets.length,
        hasVisualAnalysis: Boolean(visualAnalysis)
      },
      provider: {
        activeProvider,
        baseUrl: openaiBaseUrl,
        model: openaiImageModel
      }
    };
  } catch (error) {
    const formattedError = formatEditableDesignError(error);
    console.warn("[reconstruct-h5] html generation failed:", error?.message || error);
    const h5Error = new Error(`AI H5 还原失败：${formattedError}`);
    h5Error.statusCode = error.statusCode || 502;
    throw h5Error;
  }
}

function formatEditableDesignError(error) {
  const message = error && error.message ? error.message : String(error);
  if (/terminated|socket|network|fetch failed/i.test(message)) {
    return "上游连接被中断，通常是请求体过大或模型响应超时。已减少切图附件数量，请重试。";
  }
  return message;
}

async function analyzeEditableDesignImage({ prompt, width, height, imageDataUrl, referenceAssets, modelReferenceAssets }) {
  if (!openaiApiKey || activeProvider !== "openrouter" || !imageDataUrl) {
    return null;
  }
  const data = await callOpenRouterJson("/chat/completions", {
    model: openaiImageModel,
    messages: [
      {
        role: "user",
        content: buildOpenRouterMessageContent(
          buildEditableDesignAnalysisPrompt({ prompt, width, height, referenceAssets, modelReferenceAssets }),
          [
            {
              dataUrl: imageDataUrl,
              name: "full-ui-screenshot.png"
            },
            ...modelReferenceAssets.map((asset, index) => ({
              dataUrl: asset.dataUrl,
              name: `slice-reference-${index + 1}-${asset.name || asset.id || "asset"}.png`
            }))
          ]
        )
      }
    ],
    response_format: { type: "json_object" },
    stream: false,
    max_tokens: OPENROUTER_ANALYSIS_MAX_TOKENS
  });
  return sanitizeEditableDesignAnalysis(extractEditableDesignManifestJson(extractChatCompletionText(data)));
}

function sanitizeEditableDesignAnalysis(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  return {
    version: "ui-visual-analysis-0.1",
    screen: sanitizeAnalysisObject(value.screen, 2),
    layout: sanitizeAnalysisObject(value.layout, 3),
    regions: sanitizeAnalysisList(value.regions, 60),
    texts: sanitizeAnalysisList(value.texts, 100),
    controls: sanitizeAnalysisList(value.controls, 100),
    assets: sanitizeAnalysisList(value.assets, 60),
    missingButImportant: sanitizeAnalysisList(value.missingButImportant, 24)
  };
}

function sanitizeAnalysisObject(value, depth) {
  const sanitized = sanitizeAnalysisValue(value, depth);
  return sanitized && typeof sanitized === "object" && !Array.isArray(sanitized) ? sanitized : {};
}

function sanitizeAnalysisList(value, maxItems) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .slice(0, maxItems)
    .map((item) => sanitizeAnalysisValue(item, 4))
    .filter((item) => item !== null && item !== undefined && item !== "");
}

function sanitizeAnalysisValue(value, depth) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^data:image\//i.test(trimmed)) {
      return "[image-data-removed]";
    }
    return trimmed.slice(0, 700);
  }
  if (depth <= 0) {
    return null;
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, 40)
      .map((item) => sanitizeAnalysisValue(item, depth - 1))
      .filter((item) => item !== null && item !== undefined && item !== "");
  }
  if (typeof value === "object") {
    const result = {};
    for (const [key, item] of Object.entries(value).slice(0, 40)) {
      if (/dataUrl|base64|image_base64|b64_json/i.test(key)) {
        continue;
      }
      const safeKey = String(key).replace(/[^\w-]/g, "_").slice(0, 48);
      const safeValue = sanitizeAnalysisValue(item, depth - 1);
      if (safeKey && safeValue !== null && safeValue !== undefined && safeValue !== "") {
        result[safeKey] = safeValue;
      }
    }
    return result;
  }
  return null;
}

function stableJsonStringify(value, maxLength) {
  const seen = new WeakSet();
  const text = JSON.stringify(value, (key, item) => {
    if (/dataUrl|base64|image_base64|b64_json/i.test(key)) {
      return undefined;
    }
    if (item && typeof item === "object") {
      if (seen.has(item)) {
        return "[circular]";
      }
      seen.add(item);
    }
    return item;
  }, 2);
  if (maxLength && text.length > maxLength) {
    return `${text.slice(0, maxLength)}\n...truncated`;
  }
  return text;
}

function normalizeEditableReferenceAssets(value, width, height) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((asset, index) => {
      if (!asset || typeof asset !== "object") {
        return null;
      }
      const dataUrl = typeof asset.dataUrl === "string" ? asset.dataUrl : "";
      if (!/^data:image\/(?:png|jpeg|jpg|webp|gif);base64,/i.test(dataUrl)) {
        return null;
      }
      const placement = asset.placement && typeof asset.placement === "object" ? asset.placement : {};
      const x = clampNumber(placement.x || 0, 0, width - 1);
      const y = clampNumber(placement.y || 0, 0, height - 1);
      const assetWidth = clampNumber(placement.width || 1, 1, width - x);
      const assetHeight = clampNumber(placement.height || 1, 1, height - y);
      const radius = clampNumber(asset.radius || 0, 0, Math.min(assetWidth, assetHeight) / 2);
      return {
        id: safeNodeName(asset.id || `slice_${index + 1}`),
        name: safeNodeName(asset.name || asset.id || `slice_${index + 1}`),
        kind: safeNodeName(asset.kind || asset.type || "asset"),
        dataUrl,
        radius: Math.round(radius),
        placement: {
          x: Math.round(x),
          y: Math.round(y),
          width: Math.round(assetWidth),
          height: Math.round(assetHeight)
        }
      };
    })
    .filter(Boolean)
    .slice(0, 24);
}

function selectEditableModelReferenceAssets(referenceAssets) {
  const MAX_MODEL_ASSET_COUNT = 6;
  const MAX_MODEL_ASSET_CHARS = 360000;
  return referenceAssets
    .filter((asset) => asset && typeof asset.dataUrl === "string" && asset.dataUrl.length <= MAX_MODEL_ASSET_CHARS)
    .slice(0, MAX_MODEL_ASSET_COUNT);
}

function buildReferenceAssetImageNodes(referenceAssets) {
  return referenceAssets.map((asset, index) => {
    const placement = asset.placement;
    const minEdge = Math.min(placement.width, placement.height);
    return {
      type: "image",
      name: safeNodeName(`slice_asset_${index + 1}_${asset.name}`),
      dataUrl: asset.dataUrl,
      x: placement.x,
      y: placement.y,
      width: placement.width,
      height: placement.height,
      radius: Math.round(clampNumber(asset.radius || minEdge * 0.18, 0, minEdge / 2)),
      fill: "#F3F5F8"
    };
  });
}

function mergeReferenceAssetNodes(nodes, referenceAssets) {
  const existing = Array.isArray(nodes) ? nodes : [];
  if (!referenceAssets.length) {
    return existing;
  }
  return existing.concat(buildReferenceAssetImageNodes(referenceAssets));
}

function buildEditableDesignManifest({ prompt, width, height, sourceImage, mode, referenceAssets = [] }) {
  const isTall = height >= width;
  const margin = Math.round(width * 0.07);
  const cardWidth = width - margin * 2;
  const headerTop = Math.round(height * 0.055);
  const copy = createEditableTemplateCopy(mode);
  const accent = pickPromptAccent(prompt);
  const heroHeight = Math.round(height * (isTall ? 0.2 : 0.28));
  const cardY = headerTop + Math.round(height * 0.1);
  const metricY = cardY + heroHeight + Math.round(height * 0.03);
  const bottomHeight = Math.max(64, Math.round(height * 0.09));

  return {
    version: "editable-design-experiment-0.1",
    metadata: {
      mode,
      note: mode === "template" ? "template placeholder, not real screenshot reconstruction" : "model generated editable manifest"
    },
    screen: {
      name: mode === "template" ? "editable_design_template_placeholder" : "editable_design_ai_reconstruction",
      width,
      height,
      fill: "#F6F8FB",
      clipsContent: true
    },
    sourceImage,
    nodes: mergeReferenceAssetNodes([
      {
        type: "text",
        name: "screen_title",
        text: copy.screenTitle,
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
            text: copy.heroTitle,
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
            text: copy.heroSubtitle,
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
            text: copy.actionLabel,
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
    ], referenceAssets)
  };
}

function createEditableTemplateCopy(mode) {
  if (mode === "model-manifest") {
    return {
      screenTitle: "AI 还原稿",
      heroTitle: "可编辑界面",
      heroSubtitle: "模型已返回结构化节点",
      actionLabel: "查看结构"
    };
  }
  return {
    screenTitle: "可编辑稿占位",
    heroTitle: "等待 AI 还原",
    heroSubtitle: "当前为实验模板，不代表原图文字",
    actionLabel: "实验模式"
  };
}

function buildEditableDesignAnalysisPrompt({ prompt, width, height, referenceAssets = [], modelReferenceAssets = [] }) {
  const attachedAssetIds = new Set(modelReferenceAssets.map((asset) => asset.id));
  const assetLines = referenceAssets.length
    ? referenceAssets.map((asset, index) => {
        const p = asset.placement;
        const attached = attachedAssetIds.has(asset.id) ? "attached" : "metadata-only";
        return `- reference asset ${index + 1} (${attached}): ${asset.name}, original position x=${p.x}, y=${p.y}, width=${p.width}, height=${p.height}, radius=${asset.radius || 0}`;
      }).join("\n")
    : "- No user-sliced reference assets were provided.";
  return [
    "你是资深 UI 视觉标注员、移动端设计还原审稿人。",
    "请只分析输入截图，不要生成代码，不要生成 Figma manifest。",
    "目标是把截图拆解为一份高精度视觉分析 JSON，供后续程序还原 H5/Figma。不要凭用户提示词重新设计。",
    "",
    `画布尺寸：${width} x ${height}`,
    "输入图片顺序：第 1 张是完整 UI 截图；后续图片是部分用户手动切图样本。完整切图坐标如下：",
    assetLines,
    "",
    "分析原则：",
    "- 从上到下、从左到右分析，不跳过任何明显区域。",
    "- 必须记录背景色/背景渐变、卡片颜色、圆角、阴影、间距、文字层级、按钮样式、底部导航。",
    "- 必须尽量抄录截图中的真实文字；看不清时写 unclear_text，不要使用用户提示词补文案。",
    "- 用户切图资产必须作为真实 image asset 复用，记录它们附近的文本、卡片和层级关系。",
    "- 对没有切图的通用线性图标，记录语义 iconName；对彩色图标/头像/IP/商品图，建议使用 image asset。",
    "- 坐标和尺寸要按截图估算，宁可粗略也不要省略。",
    "- 输出要紧凑，不要写长篇 notes；每个 notes 不超过 18 个中文字符。",
    "- regions 最多 35 项，texts 最多 70 项，controls 最多 50 项，assets 最多 40 项。",
    "",
    "只输出 JSON 对象，schema：",
    "{",
    "  \"version\": \"ui-visual-analysis-0.1\",",
    "  \"screen\": { \"width\": " + width + ", \"height\": " + height + ", \"background\": \"#RRGGBB or gradient description\", \"styleSummary\": \"视觉风格一句话\" },",
    "  \"layout\": { \"density\": \"sparse|normal|dense\", \"mainAxis\": \"vertical\", \"safeArea\": { \"top\": 0, \"bottom\": 0 }, \"globalPadding\": 0 },",
    "  \"regions\": [",
    "    { \"name\":\"header\", \"role\":\"status/header/banner/card/grid/list/nav\", \"x\":0, \"y\":0, \"width\":100, \"height\":100, \"fill\":\"#RRGGBB\", \"gradient\":\"optional\", \"radius\":0, \"shadow\":\"none|soft|medium\", \"notes\":\"visual details\" }",
    "  ],",
    "  \"texts\": [",
    "    { \"text\":\"真实文字\", \"x\":0, \"y\":0, \"width\":100, \"height\":24, \"fontSize\":16, \"fontWeight\":400, \"color\":\"#RRGGBB\", \"align\":\"left|center|right\", \"region\":\"header\" }",
    "  ],",
    "  \"controls\": [",
    "    { \"kind\":\"button|tab|search|nav-item|badge\", \"text\":\"真实文字或空\", \"x\":0, \"y\":0, \"width\":100, \"height\":40, \"fill\":\"#RRGGBB\", \"radius\":20, \"iconName\":\"optional\", \"region\":\"card\" }",
    "  ],",
    "  \"assets\": [",
    "    { \"assetId\":\"reference asset id or empty\", \"usage\":\"avatar|icon|illustration|logo|photo\", \"x\":0, \"y\":0, \"width\":40, \"height\":40, \"mustUseImage\":true, \"notes\":\"how it appears\" }",
    "  ],",
    "  \"missingButImportant\": [\"需要后续还原重点\"]",
    "}",
    "",
    "用户原始提示词只可辅助理解主题，不能用于替换截图真实文案：",
    prompt || ""
  ].join("\n");
}

function buildEditableDesignManifestPrompt({ prompt, width, height, referenceAssets = [], modelReferenceAssets = [], visualAnalysis = null }) {
  const attachedAssetIds = new Set(modelReferenceAssets.map((asset) => asset.id));
  const assetLines = referenceAssets.length
    ? referenceAssets.map((asset, index) => {
        const p = asset.placement;
        const attached = attachedAssetIds.has(asset.id) ? "attached" : "metadata-only";
        return `- reference asset ${index + 1} (${attached}): ${asset.name}, original position x=${p.x}, y=${p.y}, width=${p.width}, height=${p.height}`;
      }).join("\n")
    : "- No user-sliced reference assets were provided.";
  const analysisText = visualAnalysis
    ? stableJsonStringify(visualAnalysis, 14000)
    : "No visual analysis JSON was available; infer directly from the screenshot.";
  return [
    "你是资深 UI 截图结构化还原工程师和 Figma 插件节点生成专家。",
    "请基于输入的 UI 截图生成一个可编辑 Figma manifest JSON。输入截图是唯一真实参考，用户原始提示词只能帮助理解页面主题，绝对不能被当成界面文案写入 manifest。",
    "你会收到一份上一步 AI 视觉分析 JSON。必须优先遵循其中的 regions/texts/controls/assets；如果分析与截图冲突，以截图为准。",
    "",
    "AI 视觉分析 JSON：",
    analysisText,
    "",
    "输入图片顺序：第 1 张是完整 UI 截图；后续图片是部分用户切图样本。所有切图的完整位置清单如下，metadata-only 的切图不会作为图片附件传给模型，但后处理仍会按原坐标注入为真实 image 节点。",
    assetLines,
    "",
    "强约束：",
    "- 只输出 JSON 对象，不要 Markdown，不要解释。",
    "- 不要输出 HTML。",
    "- 不要把用户提示词复制成页面标题、按钮、卡片文案或任何界面文字。",
    "- 目标是视觉还原截图，不是生成一套新模板；相似度优先于抽象组件完整度。",
    "- 文本节点只能来自截图中清晰可见的真实文字；看不清时用短占位：文本。",
    "- 坐标、尺寸必须在截图画布内，画布尺寸为 " + width + " x " + height + "。",
    "- 用户切出的 reference assets 是强约束：它们代表真实头像、图标、插画、商品图或复杂视觉元素，必须在还原稿中保留其原始位置、大小和层级关系。",
    "- 不要把 reference assets 对应的区域重新画成普通矩形或文字；后处理会按原坐标把它们注入为 image 节点，你需要围绕这些真实资产安排附近卡片、文案、按钮和布局。",
    "- 请按截图从上到下、从左到右逐区还原：状态栏、头部信息、会员/banner、功能宫格、推荐列表、收藏列表、底部导航。不要跳过明显区域。",
    "- 优先还原主要布局、文字层级、卡片、按钮、底部导航、状态栏、搜索框、banner、列表和主要装饰块。",
    "- 不要生成覆盖内容的大白色空卡片；只有截图中真实存在的卡片才创建 frame/rect，并尽量补齐卡片内可见文字与按钮。",
    "- 对截图中的重复宫格、功能入口、列表项、底部导航，请用多个独立节点按真实行列位置排布，不要合并成一个空白容器。",
    "- 通用功能图标不要用 rect 占位，请使用 icon 节点。icon 节点会由插件映射为 Hugeicons 风格 inline SVG。",
    "- iconName 只能使用这些语义名之一：star, clock, bookmark, download, calendarcheck, cloud, wallet, code, plus, home, play, mic, message, user, search, settings, scan。",
    "- 如果截图里的图标属于强风格彩色图标、头像、Logo、IP 或插画，应由 reference asset/image 保留，不要用 icon 节点替代。",
    "- 复杂角色、商品图、插画、照片不要硬画，使用 image 类型占位或简化矩形占位。",
    "- 控制节点数量在 24 到 90 个之间；少量关键节点不够，还原度会很低，但也不要生成无意义碎片。",
    "- 所有颜色使用 #RRGGBB。",
    "- 圆角、阴影、透明度要尽量接近截图。",
    "",
    "允许的节点类型：",
    "- frame: 可包含 children，用于卡片、导航、分组。",
    "- rect: 矩形、背景、按钮、卡片、分割线、普通色块。",
    "- text: 真实文本。",
    "- icon: 通用线性功能图标，字段包括 iconName、color、strokeWidth。",
    "- image: 复杂图片占位，不需要 dataUrl。",
    "",
    "返回 JSON schema：",
    "{",
    "  \"version\": \"editable-design-experiment-0.2\",",
    "  \"metadata\": { \"mode\": \"model-manifest\", \"confidence\": 0.0-1.0 },",
    "  \"screen\": { \"name\": \"editable_design_ai_reconstruction\", \"width\": " + width + ", \"height\": " + height + ", \"fill\": \"#FFFFFF\", \"clipsContent\": true },",
    "  \"nodes\": [",
    "    { \"type\":\"text\", \"name\":\"title\", \"text\":\"截图中的真实文字\", \"x\":0, \"y\":0, \"width\":100, \"height\":30, \"fontSize\":20, \"fontWeight\":700, \"lineHeight\":26, \"color\":\"#111111\" },",
    "    { \"type\":\"icon\", \"name\":\"icon_star\", \"iconName\":\"star\", \"x\":0, \"y\":0, \"width\":24, \"height\":24, \"color\":\"#111111\", \"strokeWidth\":2 },",
    "    { \"type\":\"frame\", \"name\":\"card\", \"x\":0, \"y\":0, \"width\":100, \"height\":100, \"radius\":16, \"fill\":\"#FFFFFF\", \"shadow\":{\"y\":8,\"blur\":24,\"opacity\":0.12}, \"children\":[] }",
    "  ]",
    "}",
    "",
    "用户原始提示词，仅用于理解主题，不得复制到界面文案：",
    prompt || ""
  ].join("\n");
}

function buildEditableDesignH5Prompt({ prompt, width, height, previewWidth, previewHeight, referenceAssets = [], modelReferenceAssets = [], visualAnalysis = null }) {
  const attachedAssetIds = new Set(modelReferenceAssets.map((asset) => asset.id));
  const assetLines = referenceAssets.length
    ? referenceAssets.map((asset, index) => {
        const p = asset.placement;
        const sx = Math.round(p.x * (previewWidth / width));
        const sy = Math.round(p.y * (previewHeight / height));
        const sw = Math.round(p.width * (previewWidth / width));
        const sh = Math.round(p.height * (previewHeight / height));
        const radius = Math.round((asset.radius || 0) * (previewWidth / width));
        const attached = attachedAssetIds.has(asset.id) ? "attached image available" : "metadata only";
        return `- asset ${index + 1}: id=${asset.id}, name=${asset.name}, ${attached}, source x=${p.x}, y=${p.y}, w=${p.width}, h=${p.height}, radius=${asset.radius || 0}; preview x=${sx}, y=${sy}, w=${sw}, h=${sh}, radius=${radius}. REQUIRED ANCHOR HTML: <img data-reference-asset="${asset.id}" src="asset:${asset.id}" style="position:absolute;left:${sx}px;top:${sy}px;width:${sw}px;height:${sh}px;border-radius:${radius}px;object-fit:contain;z-index:900;">. Do not redraw, replace, simplify, recolor, crop, or move it.`;
      }).join("\n")
    : "- No user-sliced assets were provided.";
  const analysisText = visualAnalysis
    ? stableJsonStringify(visualAnalysis, 18000)
    : "No visual analysis JSON is available. Infer regions/texts/assets directly from the screenshot.";
  return [
    "You are a senior UI screenshot-to-HTML reconstruction engineer and mobile UI tracing specialist.",
    "Convert the attached UI screenshot into one standalone HTML document for visual inspection and later Figma import.",
    "This is a pixel-reconstruction task. The goal is not a nicer similar app, but a faithful HTML trace of the provided screenshot.",
    "Think of this as manually tracing the screenshot on an artboard that matches the source image width, not redesigning an app screen.",
    "",
    "Highest priority:",
    `- The output artboard width MUST be exactly ${previewWidth}px.`,
    `- The output artboard height MUST be exactly ${previewHeight}px, derived from the original screenshot ${width}x${height}.`,
    "- Reconstruct the screenshot, do not redesign it, do not improve it, do not simplify it, and do not create a new visual style.",
    "- Preserve relative position, proportion, visual hierarchy, colors, gradients, shadows, border radii, strokes, spacing, typography, and layer order.",
    "- Every visible element must be placed by absolute coordinates inside .screen. Do not rely on flex/grid/normal document flow for main layout.",
    "- Use the screenshot as the coordinate source: status bar, header, cards, icons, tabs, list rows, and bottom navigation must keep their original x/y/width/height relationships.",
    "- The screenshot is the only source of truth. The user prompt is only theme context and must not be copied as interface text.",
    "- Do not use the full screenshot as a background image. Build the UI with HTML/CSS shapes, editable text, and provided sliced assets.",
    "- Every provided sliced asset is mandatory and is a locked visual anchor. Place each one as an <img> inside .screen at its exact preview x/y/width/height.",
    "- If a sliced asset is an icon, mascot, avatar, decorative badge, product image, or complex graphic, DO NOT redraw it with CSS/SVG and DO NOT replace it with a similar icon. Use the exact asset:<id> image.",
    "- The injected asset must be visible in the final page. Do not cover it with white cards, text blocks, masks, or gradients.",
    "- Put sliced assets above their matching card/background but below only text that truly overlays the original image. Do not hide them behind white cards.",
    "- Do not invent large blank cards. If a region exists, fill it with its visible content.",
    "- All visible text should be transcribed from the screenshot. If unreadable, use a very short plausible placeholder only where text exists.",
    "- Use absolute positioning inside a single .screen root. This is for pixel-level comparison, not responsive layout.",
    "- Text must not reflow differently from the screenshot. Short labels, currency values, dates, tab labels, button labels, nav labels, and list titles should use white-space:nowrap.",
    "- Multi-line text is allowed only when the screenshot itself clearly shows multiple lines.",
    "- Currency and numeric values must stay on one line, e.g. ¥268.00 must not become two lines or lose decimals.",
    "- Do not replace real icons with empty squares, checkboxes, emoji, generic placeholders, or unrelated icon glyphs.",
    "- If an icon is not provided as a sliced asset, draw a simple inline SVG with matching size, stroke weight, and position.",
    "- Never use literal arrow characters such as ›, ‹, →, ←, ↓, ↑, >, or < as UI arrows. Draw chevrons, back arrows, refresh arrows, and dropdown arrows as inline SVG shapes so they remain vector icons after Figma import.",
    "- Avoid oversized text. Match the screenshot's apparent font scale in the source image: header text, card labels, secondary text, badges, and navigation labels must stay visually proportional to the screenshot.",
    "- Use only inline CSS in a <style> tag. No JavaScript. No external URLs. No web fonts.",
    "- Use CSS gradients and shadows where the screenshot has them.",
    "- For complex avatars, colorful icons, mascot IP, product photos, decorative illustrations, and all user-sliced assets, use <img> layers.",
    "- For generic simple line icons not provided as slices, draw only very simple monochrome inline SVG paths or CSS strokes. Do not create colorful decorative SVG icons, do not redesign icons, and do not use emoji as icons.",
    "- Do not output any <img> tag unless it is one of the provided asset:<id> references. For unsliced simple icons, use inline <svg>.",
    "",
    "Absolute-positioning implementation rules:",
    "- .screen must be position:relative; each major visual element should be position:absolute.",
    "- For every card/banner/button/list row, set explicit left/top/width/height/radius/background/box-shadow.",
    "- For every text element, set explicit left/top/width/height/font-size/font-weight/line-height/color and white-space where appropriate.",
    "- For every SVG icon, set explicit left/top/width/height and keep it visually close to the screenshot.",
    "- Do not let line-height, margins, padding, flex wrapping, or browser defaults change the screenshot geometry.",
    "- Reset h1,h2,h3,p,button margins to 0 in CSS.",
    "",
    "Visual analysis JSON from a previous screenshot-reading pass:",
    analysisText,
    "",
    "Provided sliced assets:",
    assetLines,
    "",
    "Reference-asset usage rules:",
    "- Treat every listed asset as an already-cut real UI element. Its coordinates are authoritative.",
    "- Create surrounding text, card backgrounds, dividers, buttons, and labels around these assets, but do not synthesize replacement artwork for them.",
    "- If an asset belongs to a grid item or card, reconstruct the whole grid/card around the fixed asset coordinate.",
    "- If an asset overlaps a section that the model thinks is blank, the asset wins: keep the asset and reconstruct the nearby UI.",
    "",
    "Pixel reconstruction workflow:",
    "1. Use the visual analysis JSON to create the main screen background and section bounding boxes first.",
    "2. Place all cards, banners, list rows, nav bars, search boxes, buttons, dividers, and gradients at their approximate screenshot coordinates.",
    "3. Place all required <img data-reference-asset> anchors at the exact coordinates listed above.",
    "4. Add visible text from the screenshot, preserving line breaks, font weight, size hierarchy, and color.",
    "5. Add simple unsliced line icons only where the screenshot has unsliced line icons.",
    "6. Review for common failures: no empty giant cards, no copied user prompt as UI text, no missing sliced assets, no rearranged grid, no unrelated icon set.",
    "",
    "HTML requirements:",
    "- Return only the complete HTML document, no Markdown fences and no explanation.",
    "- The document must contain <!doctype html>, <html>, <head>, <meta charset=\"UTF-8\">, <style>, and <body>.",
    "- Body background may be neutral gray for preview only; the UI itself must be inside .screen.",
    "- .screen must have width and height exactly as specified and overflow hidden.",
    "- Asset references must use src=\"asset:<id>\". Do not embed base64 yourself.",
    "- Asset references should include data-reference-asset=\"<id>\" so the importer can preserve them.",
    "- Keep CSS readable and grouped by major regions.",
    "- Prefer border-box sizing.",
    "",
    "ScreenCoder-style reasoning checklist to apply silently before writing HTML:",
    "1. Identify all UI regions from top to bottom.",
    "2. Estimate the bounding box of every card/list/grid/nav/header/banner.",
    "3. Transcribe visible text and place it at matching coordinates.",
    "4. Reuse every provided sliced asset in its exact position. Treat these assets as locked visual anchors.",
    "5. Recreate gradients/backgrounds before placing foreground content.",
    "6. Compare mentally against screenshot and adjust obvious spacing/size issues.",
    "",
    "User prompt, for topic context only:",
    prompt || "(empty)"
  ].join("\n");
}

function extractHtmlDocument(text) {
  const raw = String(text || "")
    .trim()
    .replace(/^```(?:html)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const fullMatch = raw.match(/<!doctype html[\s\S]*<\/html>/i) || raw.match(/<html[\s\S]*<\/html>/i);
  if (fullMatch) {
    const html = fullMatch[0].trim();
    return /^<!doctype html/i.test(html) ? html : `<!doctype html>\n${html}`;
  }
  const bodyMatch = raw.match(/<body[\s\S]*<\/body>/i);
  if (bodyMatch) {
    return `<!doctype html><html><head><meta charset="UTF-8"></head>${bodyMatch[0]}</html>`;
  }
  return `<!doctype html><html><head><meta charset="UTF-8"></head><body>${raw}</body></html>`;
}

function sanitizeGeneratedHtml(html, referenceAssets, { previewWidth, previewHeight, sourceWidth, sourceHeight }) {
  const assetMap = new Map((referenceAssets || []).map((asset) => [asset.id, asset.dataUrl]));
  let safe = extractHtmlDocument(html)
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, "")
    .replace(/<object\b[\s\S]*?<\/object>/gi, "")
    .replace(/<embed\b[^>]*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*(['"])[\s\S]*?\1/gi, "")
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, "")
    .replace(/javascript:/gi, "");

  safe = safe.replace(/(["'(])asset:([\w\u4e00-\u9fa5-]+)(["')])/g, (match, open, id, close) => {
    const dataUrl = assetMap.get(id);
    return dataUrl ? `${open}${dataUrl}${close}` : `${open}${close}`;
  });
  safe = safe.replace(/=\s*asset:([\w\u4e00-\u9fa5-]+)/g, (match, id) => {
    const dataUrl = assetMap.get(id);
    return dataUrl ? `="${dataUrl}"` : "=\"\"";
  });

  safe = safe.replace(/\s(?:href|src)\s*=\s*(['"])(?!data:image\/|#)[\s\S]*?\1/gi, (match) => {
    return /\ssrc\s*=/i.test(match) ? " src=\"\"" : " href=\"#\"";
  });
  safe = safe.replace(/\ssrc\s*=\s*(?!["']?data:image\/)([^\s>]+)/gi, " src=\"\"");

  safe = removeGeneratedImageTags(safe);

  safe = injectMissingReferenceAssets(safe, referenceAssets, {
    previewWidth,
    sourceWidth,
    sourceHeight
  });

  const guardStyle = [
    "<style data-preview-guard>",
    "html,body{margin:0;padding:0;background:#eef0f4;}",
    "body{min-height:100vh;display:flex;justify-content:center;align-items:flex-start;font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",Arial,\"PingFang SC\",\"Microsoft YaHei\",sans-serif;}",
    "*{box-sizing:border-box;}",
    `.screen{width:${previewWidth}px!important;height:${previewHeight}px!important;max-width:none;overflow:hidden;position:relative;}`,
    "img{display:block;}",
    ".screen [data-reference-asset]{position:absolute!important;object-fit:contain!important;object-position:center!important;background:transparent!important;z-index:999!important;pointer-events:none!important;}",
    "</style>"
  ].join("");

  if (/<head\b[^>]*>/i.test(safe)) {
    safe = safe.replace(/<head\b([^>]*)>/i, `<head$1><meta charset="UTF-8">${guardStyle}`);
  } else {
    safe = safe.replace(/<html\b([^>]*)>/i, `<html$1><head><meta charset="UTF-8">${guardStyle}</head>`);
  }
  if (!/<body\b/i.test(safe)) {
    safe = safe.replace(/<\/head>/i, "</head><body>");
    safe = safe.replace(/<\/html>/i, "</body></html>");
  }
  return safe;
}

function removeGeneratedImageTags(html) {
  return String(html || "").replace(/<img\b[^>]*>/gi, "");
}

function injectMissingReferenceAssets(html, referenceAssets = [], { previewWidth, sourceWidth }) {
  if (!referenceAssets.length || !previewWidth || !sourceWidth) {
    return html;
  }
  const scale = previewWidth / sourceWidth;
  const injected = [];
  let nextHtml = html;
  for (const asset of referenceAssets) {
    if (!asset || !asset.dataUrl || !asset.placement) {
      continue;
    }
    const escapedId = escapeRegExp(String(asset.id || ""));
    if (escapedId) {
      const existingAssetImage = new RegExp(`<img\\b(?=[^>]*\\bdata-reference-asset=(["'])${escapedId}\\1)[^>]*>`, "gi");
      nextHtml = nextHtml.replace(existingAssetImage, "");
    }
    const p = asset.placement;
    const left = Math.round(Number(p.x || 0) * scale);
    const top = Math.round(Number(p.y || 0) * scale);
    const width = Math.max(1, Math.round(Number(p.width || 1) * scale));
    const height = Math.max(1, Math.round(Number(p.height || 1) * scale));
    const radius = Math.round(Number(asset.radius || 0) * scale);
    injected.push(
      `<img src="${asset.dataUrl}" alt="${escapeHtmlAttribute(asset.name || asset.id || "reference_asset")}" data-reference-asset="${escapeHtmlAttribute(asset.id || "")}" style="position:absolute!important;left:${left}px!important;top:${top}px!important;width:${width}px!important;height:${height}px!important;border-radius:${radius}px!important;object-fit:contain!important;object-position:center!important;background:transparent!important;z-index:999!important;pointer-events:none!important;" />`
    );
  }
  if (!injected.length) {
    return nextHtml;
  }
  const payload = `\n${injected.join("\n")}\n`;
  const screenOpen = /(<[^>]+class=(["'])[^"']*\bscreen\b[^"']*\2[^>]*>)/i;
  if (screenOpen.test(nextHtml)) {
    return nextHtml.replace(screenOpen, `$1${payload}`);
  }
  if (/<body\b[^>]*>/i.test(nextHtml)) {
    return nextHtml.replace(/<body\b([^>]*)>/i, `<body$1>${payload}`);
  }
  return `${payload}${nextHtml}`;
}

function buildFallbackH5PreviewHtml({ prompt, width, height, previewWidth, previewHeight, imageDataUrl, referenceAssets = [] }) {
  const scale = previewWidth / width;
  const assetHtml = referenceAssets.slice(0, 16).map((asset) => {
    const p = asset.placement;
    return `<img class="slice-asset" src="${escapeHtmlAttribute(asset.dataUrl)}" alt="${escapeHtmlAttribute(asset.name)}" style="left:${Math.round(p.x * scale)}px;top:${Math.round(p.y * scale)}px;width:${Math.round(p.width * scale)}px;height:${Math.round(p.height * scale)}px;border-radius:${Math.round((asset.radius || 0) * scale)}px;">`;
  }).join("");
  return [
    "<!doctype html>",
    "<html>",
    "<head>",
    "<meta charset=\"UTF-8\">",
    "<style>",
    "html,body{margin:0;padding:0;background:#eef0f4;font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",Arial,\"PingFang SC\",\"Microsoft YaHei\",sans-serif;}",
    "body{min-height:100vh;display:flex;justify-content:center;align-items:flex-start;}",
    "*{box-sizing:border-box;}",
    `.screen{position:relative;width:${previewWidth}px;height:${previewHeight}px;overflow:hidden;background:#f7f8fb;box-shadow:0 18px 60px rgba(20,24,36,.16);}`,
    ".source{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;opacity:.2;}",
    ".hint{position:absolute;left:32px;top:32px;right:32px;padding:22px;border-radius:24px;background:rgba(255,255,255,.86);box-shadow:0 18px 50px rgba(20,24,36,.12);}",
    ".hint strong{display:block;color:#151821;font-size:28px;line-height:1.2;}",
    ".hint span{display:block;margin-top:8px;color:#7a8190;font-size:15px;line-height:1.5;}",
    ".slice-asset{position:absolute;object-fit:contain;border-radius:8px;}",
    "</style>",
    "</head>",
    "<body>",
    "<main class=\"screen\">",
    imageDataUrl ? `<img class="source" src="${escapeHtmlAttribute(imageDataUrl)}" alt="">` : "",
    "<section class=\"hint\">",
    "<strong>H5 预览模板</strong>",
    `<span>AI 还原不可用时显示。原图尺寸 ${width} × ${height}，预览宽度 ${previewWidth}px。${escapeHtml(prompt || "")}</span>`,
    "</section>",
    assetHtml,
    "</main>",
    "</body>",
    "</html>"
  ].join("");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeHtmlAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function numericTextLooksLikeMetric(text) {
  const value = String(text || "").trim();
  return !!value && /^[¥￥$€£+\-−–—.,:/%()\s0-9]+$/.test(value) && /\d/.test(value);
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractEditableDesignManifestJson(text) {
  const raw = String(text || "").trim();
  const withoutFence = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("模型没有返回 manifest JSON");
  }
  try {
    return JSON.parse(withoutFence.slice(start, end + 1));
  } catch (error) {
    throw new Error(`manifest JSON 解析失败：${error.message || String(error)}`);
  }
}

function sanitizeEditableDesignManifest(manifest, { width, height, sourceImage, referenceAssets = [] }) {
  if (!manifest || typeof manifest !== "object" || !Array.isArray(manifest.nodes)) {
    throw new Error("manifest 缺少 nodes 数组");
  }
  const screen = manifest.screen && typeof manifest.screen === "object" ? manifest.screen : {};
  const sanitized = {
    version: "editable-design-experiment-0.2",
    metadata: Object.assign({}, manifest.metadata || {}, { mode: "model-manifest" }),
    screen: {
      name: "editable_design_ai_reconstruction",
      width,
      height,
      fill: normalizeHexColor(screen.fill, "#FFFFFF"),
      clipsContent: screen.clipsContent !== false
    },
    sourceImage,
    nodes: mergeReferenceAssetNodes(
      sanitizeEditableNodes(manifest.nodes, { width, height, depth: 0 }).slice(0, 80),
      referenceAssets
    )
  };
  if (!sanitized.nodes.length) {
    throw new Error("manifest 没有可用节点");
  }
  return sanitized;
}

function sanitizeEditableNodes(nodes, bounds) {
  if (!Array.isArray(nodes) || bounds.depth > 5) {
    return [];
  }
  const width = bounds.width;
  const height = bounds.height;
  return nodes
    .map((node, index) => sanitizeEditableNode(node, { width, height, depth: bounds.depth, index }))
    .filter(Boolean);
}

function sanitizeEditableNode(node, context) {
  if (!node || typeof node !== "object") {
    return null;
  }
  const allowedTypes = new Set(["frame", "rect", "text", "image", "icon"]);
  const type = allowedTypes.has(String(node.type || "").toLowerCase()) ? String(node.type).toLowerCase() : "rect";
  const x = clampNumber(node.x || 0, 0, context.width);
  const y = clampNumber(node.y || 0, 0, context.height);
  const maxWidth = Math.max(1, context.width - x);
  const maxHeight = Math.max(1, context.height - y);
  const sanitized = {
    type,
    name: safeNodeName(node.name || `${type}_${context.index + 1}`),
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(clampNumber(node.width || 80, 1, maxWidth)),
    height: Math.round(clampNumber(node.height || 40, 1, maxHeight))
  };

  if (type === "text") {
    sanitized.text = String(node.text || "文本").slice(0, 80);
    sanitized.fontSize = Math.round(clampNumber(node.fontSize || 16, 8, 96));
    sanitized.fontWeight = Math.round(clampNumber(node.fontWeight || 500, 300, 900));
    sanitized.lineHeight = Math.round(clampNumber(node.lineHeight || sanitized.fontSize * 1.25, sanitized.fontSize, 140));
    sanitized.color = normalizeHexColor(node.color, "#111318");
    return sanitized;
  }

  if (type === "icon") {
    sanitized.iconName = normalizeEditableIconName(node.iconName || node.name);
    sanitized.color = normalizeHexColor(node.color || node.stroke, "#111318");
    sanitized.strokeWidth = clampNumber(node.strokeWidth || 2, 1, 5);
    return sanitized;
  }

  sanitized.fill = normalizeHexColor(node.fill, type === "image" ? "#EEF1F6" : "#FFFFFF");
  sanitized.radius = Math.round(clampNumber(node.radius || 0, 0, 999));
  sanitized.opacity = clampNumber(node.opacity === undefined ? 1 : node.opacity, 0, 1);
  if (node.stroke) {
    sanitized.stroke = normalizeHexColor(node.stroke, "#E4E7EE");
    sanitized.strokeWidth = clampNumber(node.strokeWidth || 1, 0, 24);
  }
  if (node.shadow && typeof node.shadow === "object") {
    sanitized.shadow = {
      color: normalizeHexColor(node.shadow.color, "#000000"),
      opacity: clampNumber(node.shadow.opacity === undefined ? 0.12 : node.shadow.opacity, 0, 0.5),
      x: clampNumber(node.shadow.x || 0, -80, 80),
      y: clampNumber(node.shadow.y || 8, -80, 80),
      blur: clampNumber(node.shadow.blur || 20, 0, 120),
      spread: clampNumber(node.shadow.spread || 0, -40, 40)
    };
  }
  if (type === "frame") {
    sanitized.clipsContent = node.clipsContent === true;
    sanitized.children = sanitizeEditableNodes(node.children || [], {
      width: sanitized.width,
      height: sanitized.height,
      depth: context.depth + 1
    });
  }
  if (type === "image" && /^data:image\/(?:png|jpeg|jpg);base64,/i.test(String(node.dataUrl || ""))) {
    sanitized.dataUrl = node.dataUrl;
  }
  return sanitized;
}

function normalizeHexColor(value, fallback) {
  const text = String(value || "").trim();
  if (/^#[0-9a-f]{6}$/i.test(text)) {
    return text;
  }
  if (/^#[0-9a-f]{3}$/i.test(text)) {
    return `#${text[1]}${text[1]}${text[2]}${text[2]}${text[3]}${text[3]}`;
  }
  return fallback;
}

function normalizeEditableIconName(value) {
  const text = String(value || "").toLowerCase().replace(/[\s_-]+/g, "");
  const aliases = {
    favourite: "star",
    favorite: "star",
    collect: "star",
    collection: "star",
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
    scan: "scan"
  };
  const allowed = new Set(["star", "clock", "bookmark", "download", "calendarcheck", "cloud", "wallet", "code", "plus", "home", "play", "mic", "message", "user", "search", "settings", "scan"]);
  const normalized = aliases[text] || text;
  return allowed.has(normalized) ? normalized : "plus";
}

function safeNodeName(value) {
  return String(value || "node")
    .replace(/[^\w\u4e00-\u9fa5-]+/g, "_")
    .slice(0, 64) || "node";
}

function buildHtmlPreviewFromEditableManifest(manifest) {
  const renderNode = (node) => {
    if (!node) {
      return "";
    }
    const commonStyle = [
      "position:absolute",
      "box-sizing:border-box",
      `left:${node.x || 0}px`,
      `top:${node.y || 0}px`,
      `width:${node.width || 1}px`,
      `height:${node.height || 1}px`,
      node.opacity === undefined ? "" : `opacity:${node.opacity}`
    ].filter(Boolean).join(";");
    if (node.type === "text") {
      const numericAttr = numericTextLooksLikeMetric(node.text) ? ' data-numeric="true"' : "";
      return `<div class="node text"${numericAttr} style="${commonStyle};font-size:${node.fontSize}px;line-height:${node.lineHeight}px;font-weight:${node.fontWeight};color:${node.color};">${escapeHtml(node.text)}</div>`;
    }
    if (node.type === "image" && node.dataUrl) {
      return `<img class="node image" src="${node.dataUrl}" alt="${escapeHtml(node.name || "image")}" style="${commonStyle};border-radius:${node.radius || 0}px;object-fit:contain;" />`;
    }
    if (node.type === "icon") {
      return `<div class="node icon" style="${commonStyle};color:${node.color || "#111318"};">${buildPreviewIconSvg(node)}</div>`;
    }
    const shadow = node.shadow
      ? `box-shadow:${node.shadow.x || 0}px ${node.shadow.y || 8}px ${node.shadow.blur || 24}px rgba(20,24,36,${node.shadow.opacity === undefined ? 0.1 : node.shadow.opacity});`
      : "";
    const border = node.stroke ? `border:${node.strokeWidth || 1}px solid ${node.stroke};` : "";
    const children = (node.children || []).map(renderNode).join("");
    return `<div class="node box" style="${commonStyle};border-radius:${node.radius || 0}px;background:${node.fill || "#fff"};${shadow}${border}">${children}</div>`;
  };
  const nodes = (manifest.nodes || []).map(renderNode).join("");
  return [
    "<!doctype html><html><head><meta charset=\"utf-8\" />",
    `<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#e8e8e8;font-family:'PingFang SC',-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',Inter,sans-serif}.screen{position:relative;width:${manifest.screen.width}px;height:${manifest.screen.height}px;overflow:hidden;background:${manifest.screen.fill};box-shadow:0 18px 60px rgba(20,24,36,.16)}.node{position:absolute;box-sizing:border-box}.text{white-space:pre-wrap}.text[data-numeric="true"]{font-family:'DIN Alternate','DIN Condensed','DIN 2014','D-DIN','PingFang SC',sans-serif}.image{display:block}.icon svg{display:block;width:100%;height:100%}</style>`,
    "</head><body>",
    "<main class=\"screen\">",
    nodes,
    "</main></body></html>"
  ].join("");
}

function buildPreviewIconSvg(node) {
  const stroke = normalizeHexColor(node.color, "#111318");
  const strokeWidth = clampNumber(node.strokeWidth || 2, 1, 5);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"><g stroke="${stroke}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="7.8"/><path d="M12 8.3v7.4M8.3 12h7.4"/></g></svg>`;
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
  const accent = pickPromptAccent(prompt);
  return [
    "<!doctype html>",
    "<html>",
    "<head>",
    "<meta charset=\"utf-8\" />",
    `<meta name=\"viewport\" content=\"width=${width}, initial-scale=1\" />`,
    "<style>",
    ":root{--bg:#F6F8FB;--text:#171A22;--muted:#6D7280;--card:#FFFFFF;--accent:" + accent.main + ";--soft:" + accent.soft + ";}",
    "*{box-sizing:border-box}body{margin:0;width:" + width + "px;height:" + height + "px;background:var(--bg);font-family:'PingFang SC',-apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',Inter,sans-serif;color:var(--text);} .num{font-family:'DIN Alternate','DIN Condensed','DIN 2014','D-DIN','PingFang SC',sans-serif;}",
    ".screen{position:relative;width:100%;height:100%;padding:7%;overflow:hidden}.title{font-size:32px;font-weight:800;line-height:1.1}.hero{margin-top:44px;border-radius:28px;background:var(--soft);padding:28px;box-shadow:0 18px 36px rgba(20,24,36,.10)}.hero h2{margin:0 0 10px;font-size:26px}.hero p{margin:0;color:var(--muted)}.button{display:inline-flex;margin-top:18px;padding:10px 18px;border-radius:999px;background:var(--accent);color:white;font-weight:700}.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:18px}.metric{border-radius:18px;background:var(--card);padding:16px;box-shadow:0 10px 24px rgba(20,24,36,.07)}.nav{position:absolute;left:7%;right:7%;bottom:3%;height:72px;border-radius:28px;background:#fff;display:grid;grid-template-columns:repeat(4,1fr);place-items:center;box-shadow:0 14px 28px rgba(20,24,36,.08)}",
    "</style>",
    "</head>",
    "<body>",
    "<main class=\"screen\">",
    "<div class=\"title\">可编辑稿占位</div>",
    "<section class=\"hero\">",
    "<h2>等待 AI 还原</h2>",
    "<p>当前为实验模板，不代表原图文字</p>",
    "<span class=\"button\">实验模式</span>",
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
