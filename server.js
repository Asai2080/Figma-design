const http = require("http");
const { Buffer } = require("buffer");
const fs = require("fs");
const path = require("path");

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 8787);
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

function buildUiScreenshotPrompt(prompt) {
  return [
    prompt,
    "Generate a full-screen app UI screenshot.",
    "Fill the entire image with the interface.",
    "No phone mockup, no device frame, no floating poster, no outer grey background, no table, no wall, no presentation board.",
    "Keep the UI aligned to the requested orientation and make it read like a real in-app screen."
  ].join("\n\n");
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

function normalizeBaseUrl(value) {
  const trimmed = value.trim().replace(/\/$/, "");
  if (!/^https?:\/\//.test(trimmed)) {
    throw badRequest("baseUrl must start with http:// or https://");
  }
  return trimmed;
}
