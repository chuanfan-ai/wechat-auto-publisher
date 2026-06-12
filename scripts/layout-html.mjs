#!/usr/bin/env node
// scripts/layout-html.mjs
//
// v12 起：两个路径排版
//   - external（默认）：调 chuanfanai.com 的 Gemini 协议中转网关，全自动跑完
//   - self：Agent 用自己的模型按 references/layout-prompt.md 排，
//           脚本只做两件事：(a) 吐出完整 prompt（--mode prompt-only）
//                          (b) 接 Agent 的 HTML 草稿，回填占位符 + 写 sidecar（--mode postprocess）
//
// 单一信任源：system prompt 和 user prompt 都从 references/layout-prompt.md 读，
// 不再 inline 在脚本里，单点维护、永不脱节。
//
// 依赖：node >= 18（自带 fetch / AbortController / TextDecoder）
//
// 用法（默认，external 模式）：
//   node scripts/layout-html.mjs \
//     --input draft.md \
//     --output dist/wechat.html \
//     --images-dir images/ \
//     [--cover 05-cover.jpg] \
//     [--stream] \
//     [--no-images]            # 显式跳过配图硬约束（默认 require_images: true，至少 3 张）
//
// 用法（self 模式两阶段）：
//   # 阶段 1：吐 prompt 给 agent，agent 拿这段去喂自己的模型
//   node scripts/layout-html.mjs --mode prompt-only \
//     --input draft.md --images-dir images/
//   # 阶段 2：agent 写完 dist/wechat.html.raw 之后，回填占位符 + 写 sidecar
//   node scripts/layout-html.mjs --mode postprocess \
//     --input draft.md \
//     --raw dist/wechat.html.raw \
//     --output dist/wechat.html \
//     --images-dir images/
//
// 环境变量：
//   EXTERNAL_API_KEY  external 模式必填（也兼读 LAYOUT_API_KEY，老脚本不破坏）
//                     可在 config.json 的 external_api.api_key_env 改成别的变量名
//
// 端点行为（2026-06-09 实测）：
//   - 同步：POST /v1beta/models/{model}:generateContent
//   - 流式：POST /v1beta/models/{model}:streamGenerateContent?alt=sse
//   - 鉴权：Authorization: Bearer <key>  与  URL ?key=<key>  二选一即可
//   - 思考片段：candidates[0].content.parts[i].thought === true → 跳过
//   - 真实文本：candidates[0].content.parts[i].text （无 thought 字段）

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { loadConfig, loadExternalApiKey } from "./config.mjs";
import { parseFrontmatter } from "./render-wechat-html.mjs";

const ENTRY_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.dirname(ENTRY_DIR);
const PROMPT_FILE = path.join(PROJECT_ROOT, "references", "layout-prompt.md");

function parseArgs(argv) {
  const args = {
    input: "",
    output: "",
    raw: "",
    imagesDir: "",
    cover: "",
    stream: false,
    noThink: true,
    mode: "", // ""=auto(按 config.layout_mode 决定) / "external" / "prompt-only" / "postprocess"
    noImages: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--input" && argv[i + 1]) args.input = argv[++i];
    else if (arg === "-i" && argv[i + 1]) args.input = argv[++i];
    else if (arg === "--output" && argv[i + 1]) args.output = argv[++i];
    else if (arg === "-o" && argv[i + 1]) args.output = argv[++i];
    else if (arg === "--raw" && argv[i + 1]) args.raw = argv[++i];
    else if (arg === "--images-dir" && argv[i + 1]) args.imagesDir = argv[++i];
    else if (arg === "--cover" && argv[i + 1]) args.cover = argv[++i];
    else if (arg === "--stream") args.stream = true;
    else if (arg === "--no-think") args.noThink = true;
    else if (arg === "--mode" && argv[i + 1]) args.mode = argv[++i];
    else if (arg === "--no-images") args.noImages = true;
  }
  return args;
}

// 读 references/layout-prompt.md，按二级标题 ## SYSTEM INSTRUCTION / ## USER PROMPT TEMPLATE
// 分成两段。允许两段顺序倒过来。
function loadPromptParts() {
  if (!fs.existsSync(PROMPT_FILE)) {
    throw new Error(`找不到 prompt 单一源文件：${PROMPT_FILE}\n   排版规则必须在这个文件里，不能 inline 进脚本。`);
  }
  const raw = fs.readFileSync(PROMPT_FILE, "utf-8");
  // 用 ^## 标题切片
  const re = /^## (.+)$/gm;
  const matches = [];
  let m;
  while ((m = re.exec(raw)) !== null) {
    matches.push({ name: m[1].trim(), idx: m.index, endHeader: re.lastIndex });
  }
  if (matches.length === 0) {
    throw new Error(`${PROMPT_FILE} 里没找到 "## XXX" 二级标题，无法拆分 system / user`);
  }
  const sections = {};
  for (let i = 0; i < matches.length; i += 1) {
    const start = matches[i].endHeader;
    const end = i + 1 < matches.length ? matches[i + 1].idx : raw.length;
    sections[matches[i].name] = raw.slice(start, end).trim();
  }
  const sys = sections["SYSTEM INSTRUCTION"];
  const user = sections["USER PROMPT TEMPLATE"];
  if (!sys || !user) {
    throw new Error(`${PROMPT_FILE} 必须同时含 "## SYSTEM INSTRUCTION" 和 "## USER PROMPT TEMPLATE" 两个二级标题`);
  }
  return { systemInstruction: sys, userPromptTemplate: user };
}

function listImages(imagesDir) {
  if (!imagesDir || !fs.existsSync(imagesDir)) return [];
  return fs.readdirSync(imagesDir)
    .filter((f) => /\.(jpe?g|png|gif|webp)$/i.test(f))
    .map((f) => `images/${f}`)
    .sort();
}

// 预先建好"【图片位_N】 → 完整 <section><img>...</section>" 映射
// 模型按编号挑图、输出 【图片位_N】 字面量，main 拿到 HTML 后做回填
function buildPlaceholderMap(imageList) {
  const map = {};
  imageList.forEach((url, i) => {
    const key = `【图片位_${i}】`;
    map[key] = `<section style="text-align:center;margin:24px 0;line-height:0;border-radius:12px;overflow:hidden;"><img src="${url}" style="display:block;width:100%;height:auto;border-radius:12px;margin:0 auto;" alt="" /></section>`;
  });
  return map;
}

function buildPrompt({ markdown, imageList, promptTemplate }) {
  // 图片清单：编号 → 文件（让模型按编号挑图）
  const imgs = imageList.length
    ? imageList.map((s, i) => `  - ${i} → ${s}`).join("\n")
    : "（无可用图片）";
  return promptTemplate.replace("{{MARKDOWN}}", markdown).replace("{{IMAGES}}", imgs);
}

function buildPayload({ systemInstruction, userText, lm, noThink }) {
  const generationConfig = {
    temperature: lm.temperature ?? 1,
    topP: lm.top_p ?? 1,
  };
  if (noThink) {
    generationConfig.thinkingConfig = { includeThoughts: false, thinkingBudget: 0 };
  } else {
    generationConfig.thinkingConfig = {
      includeThoughts: true,
      thinkingBudget: lm.thinking_budget ?? 26240,
    };
  }
  return {
    contents: [{ parts: [{ text: userText }], role: "user" }],
    systemInstruction: { parts: [{ text: systemInstruction }], role: "user" },
    safetySettings: [
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "OFF" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "OFF" },
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "OFF" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "OFF" },
      { category: "HARM_CATEGORY_CIVIC_INTEGRITY", threshold: "BLOCK_NONE" },
    ],
    tools: [],
    generationConfig,
  };
}

function extractText(json) {
  const candidates = json.candidates || [];
  for (const c of candidates) {
    const parts = (c && c.content && c.content.parts) || [];
    for (const p of parts) {
      if (!p || !p.text) continue;
      if (p.thought === true) continue;
      return p.text;
    }
  }
  return "";
}

async function callGemini({ apiBase, apiKey, model, systemInstruction, userText, lm, stream, noThink }) {
  const endpoint = stream ? "streamGenerateContent" : "generateContent";
  const apiPath = `/v1beta/models/${model}:${endpoint}`;
  const url = new URL(apiPath, apiBase);
  url.searchParams.set("key", apiKey);
  if (stream) url.searchParams.set("alt", "sse");

  const payload = buildPayload({ systemInstruction, userText, lm, noThink });

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${errText.slice(0, 500)}`);
  }

  if (!stream) {
    const json = await res.json();
    const usage = json.usageMetadata || {};
    if (usage.totalTokenCount) {
      console.error(
        `[layout-html] tokens: prompt=${usage.promptTokenCount} thought=${usage.thoughtsTokenCount || 0} answer=${usage.candidatesTokenCount} total=${usage.totalTokenCount}`,
      );
    }
    return extractText(json);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let fullText = "";
  process.stdout.write("\n--- 排版生成中 ---\n");
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const event = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const line = event.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      const data = line.slice(6).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const obj = JSON.parse(data);
        const text = extractText(obj);
        if (text) {
          fullText += text;
          process.stdout.write(text);
        }
      } catch {
        // ignore
      }
    }
  }
  process.stdout.write("\n--- 排版完成 ---\n\n");
  return fullText;
}

function stripFences(s) {
  let t = s.trim();
  if (t.startsWith("```html")) t = t.slice(7);
  else if (t.startsWith("```")) t = t.slice(3);
  if (t.endsWith("```")) t = t.slice(0, -3);
  return t.trim();
}

// 写 sidecar .meta.json
function writeSidecar(outPath, meta) {
  if (!meta || Object.keys(meta).length === 0) return;
  const sidecarPath = `${outPath}.meta.json`;
  fs.writeFileSync(sidecarPath, `${JSON.stringify(meta, null, 2)}\n`, "utf-8");
  console.error(`✅ sidecar 已写：${sidecarPath}`);
  console.error("   接下来 publish-draft.mjs 会自动读这个 sidecar 拿 title/author/digest");
}

// 占位符回填 + 写 HTML + 写 sidecar
function finalizeHtml({ rawHtml, placeholderMap, outPath, meta }) {
  let html = stripFences(rawHtml);
  let usedCount = 0;
  const available = Object.keys(placeholderMap);
  for (const [key, wrapped] of Object.entries(placeholderMap)) {
    if (html.includes(key)) {
      html = html.split(key).join(wrapped);
      usedCount += 1;
    }
  }
  if (available.length) {
    console.error(`[layout-html] placeholders: ${usedCount}/${available.length} used`);
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html, "utf-8");
  console.error(`✅ 已写入 ${outPath}（${html.length} 字符）`);
  writeSidecar(outPath, meta);
}

// 读 .md 源稿，解析 frontmatter，返回 body / meta
function loadSourceMarkdown(args, config) {
  const cwd = process.cwd();
  const mdPath = path.resolve(cwd, args.input);
  const rawMarkdown = fs.readFileSync(mdPath, "utf-8");
  const { meta, body: markdown, hadFrontmatter } = parseFrontmatter(rawMarkdown);

  if (config.require_frontmatter && !hadFrontmatter) {
    console.error("❌ require_frontmatter 已开启，但 .md 源稿没有 --- frontmatter 头。");
    console.error("   请在 .md 第一行加：");
    console.error("   ---");
    console.error("   title: 文章标题");
    console.error("   subtitle: 副标题");
    console.error("   author: 作者");
    console.error("   digest: 摘要");
    console.error("   ---");
    console.error("   （或把 config.json 的 require_frontmatter 改为 false）");
    process.exit(2);
  }

  if (hadFrontmatter) {
    console.error(`[layout-html] ✅ frontmatter 已剥离，提取字段：${Object.keys(meta).join(", ") || "(空)"}`);
  } else {
    console.error("[layout-html] ⚠️  未检测到 frontmatter，正文将连同标题一起送进模型，可能产生双标题。");
    console.error("[layout-html]    建议：在 .md 第一行加 frontmatter（title/subtitle/author/digest）。");
  }
  return { mdPath, markdown, meta };
}

// 列图 + 配图硬约束检查
function loadImagesWithCheck(args, mdPath, config) {
  const cwd = process.cwd();
  const imagesDir = args.imagesDir
    ? path.resolve(cwd, args.imagesDir)
    : path.resolve(path.dirname(mdPath), "images");
  const imageList = listImages(imagesDir);
  const placeholderMap = buildPlaceholderMap(imageList);

  // v12 配图硬约束
  const requireImages = config.require_images !== false;
  const minImages = config.min_images || 3;
  if (requireImages && !args.noImages && imageList.length < minImages) {
    console.error("");
    console.error(`❌ 配图不足：当前 ${imageList.length} 张，要求至少 ${minImages} 张。`);
    console.error("");
    console.error("   修复方式（4 选 1）：");
    console.error("");
    console.error(`   ① AI 生图（推荐）：`);
    console.error(`      让 agent 根据 draft.md 内容写 images/prompts.json，然后跑：`);
    console.error(`      node scripts/generate-images.mjs --output-dir ${path.relative(cwd, imagesDir) || "images"}/`);
    console.error("");
    console.error(`   ② 手动找图：按 references/image-policy.md 找授权图片，按字母序命名（01-cover.jpg, 02-xxx.jpg…）放到：`);
    console.error(`      ${imagesDir}`);
    console.error("");
    console.error(`   ③ 跳过配图（不推荐）：加 --no-images 参数（最终公众号文章会比较干）`);
    console.error("");
    console.error(`   ④ 临时降低门槛：在 ~/.wechat-auto-publisher/config.json 改 min_images，或 require_images: false`);
    console.error("");
    process.exit(2);
  }
  if (args.noImages && imageList.length === 0) {
    console.error("[layout-html] ⚠️  --no-images 已开启，跳过配图。");
  } else {
    console.error(`[layout-html] images:${imageList.length} from ${imagesDir}`);
  }
  return { imagesDir, imageList, placeholderMap };
}

// ── 子流程：external 模式（默认） ────────────────────────────────────────
async function runExternal({ args, config, markdown, meta, imageList, placeholderMap }) {
  const cwd = process.cwd();
  const ext = config.external_api || {};
  const apiKey = loadExternalApiKey(cwd, [ENTRY_DIR], config)
    || process.env.LAYOUT_API_KEY  // v11 老变量名向后兼容
    || "";

  if (!apiKey) {
    const keyEnv = ext.api_key_env || "EXTERNAL_API_KEY";
    console.error(`❌ 排版模式 external，但没找到 API key。`);
    console.error(`   修复：export ${keyEnv}="<你的 key>"，或重跑 init-config.mjs 重新写入。`);
    process.exit(2);
  }

  const apiBase = (ext.api_base || "https://chuanfanai.com").replace(/\/+$/, "");
  const model = ext.layout_model || "gemini-3.1-flash-lite";
  const { systemInstruction, userPromptTemplate } = loadPromptParts();
  const prompt = buildPrompt({ markdown, imageList, promptTemplate: userPromptTemplate });

  // 兼容老的 layout_model 段配置
  const lm = config.layout_model || {};

  console.error(`[layout-html] mode:  external`);
  console.error(`[layout-html] model: ${model}`);
  console.error(`[layout-html] api:   ${apiBase}/v1beta/models/${model}:${args.stream ? "streamGenerateContent" : "generateContent"}`);
  console.error(`[layout-html] input: ${args.input} (${markdown.length} chars, body only)`);

  const text = await callGemini({
    apiBase,
    apiKey,
    model,
    systemInstruction,
    userText: prompt,
    lm,
    stream: args.stream,
    noThink: args.noThink,
  });

  const outPath = path.resolve(cwd, args.output);
  finalizeHtml({ rawHtml: text, placeholderMap, outPath, meta });
}

// ── 子流程：self 模式阶段 1（吐 prompt） ─────────────────────────────────
function runPromptOnly({ markdown, imageList }) {
  const { systemInstruction, userPromptTemplate } = loadPromptParts();
  const prompt = buildPrompt({ markdown, imageList, promptTemplate: userPromptTemplate });
  // 给 agent 一份合并好的指令：先 system，再 user
  // 用清晰的分隔行让 agent 知道怎么拆
  process.stdout.write("=== SYSTEM INSTRUCTION ===\n");
  process.stdout.write(systemInstruction);
  process.stdout.write("\n\n=== USER PROMPT ===\n");
  process.stdout.write(prompt);
  process.stdout.write("\n");
  console.error("");
  console.error(`[layout-html] mode: prompt-only`);
  console.error(`[layout-html] ✅ prompt 已输出到 stdout`);
  console.error(`[layout-html] 下一步（agent）：`);
  console.error(`   1) 把上面 SYSTEM + USER 两段送进自己的模型`);
  console.error(`   2) 把模型返回的 HTML 草稿写到一个临时文件，如 dist/wechat.html.raw`);
  console.error(`   3) 跑 postprocess 阶段：`);
  console.error(`      node scripts/layout-html.mjs --mode postprocess \\`);
  console.error(`        --input <draft.md> --raw dist/wechat.html.raw \\`);
  console.error(`        --output dist/wechat.html --images-dir images/`);
}

// ── 子流程：self 模式阶段 2（回填占位符 + 写 sidecar） ─────────────────────
function runPostprocess({ args, meta, placeholderMap }) {
  const cwd = process.cwd();
  if (!args.raw) {
    console.error("❌ postprocess 模式需要 --raw <agent 写出来的 HTML 草稿路径>");
    process.exit(2);
  }
  const rawPath = path.resolve(cwd, args.raw);
  if (!fs.existsSync(rawPath)) {
    console.error(`❌ 找不到 --raw 文件：${rawPath}`);
    process.exit(2);
  }
  const rawHtml = fs.readFileSync(rawPath, "utf-8");
  const outPath = path.resolve(cwd, args.output);
  console.error(`[layout-html] mode: postprocess`);
  console.error(`[layout-html] raw:  ${rawPath} (${rawHtml.length} chars)`);
  finalizeHtml({ rawHtml, placeholderMap, outPath, meta });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input) {
    console.error("Usage: node scripts/layout-html.mjs --input <draft.md> --output <wechat.html> [--images-dir <dir>] [--cover <file>] [--stream] [--no-think] [--no-images] [--mode external|prompt-only|postprocess] [--raw <html-draft>]");
    process.exit(2);
  }

  const cwd = process.cwd();
  const config = loadConfig(cwd, [ENTRY_DIR]);

  // 决定真正跑哪条路径：CLI --mode 优先，否则按 config.layout_mode
  let effectiveMode = args.mode || config.layout_mode || "external";
  if (effectiveMode === "self") {
    // self 模式下 CLI 没指定子阶段时，默认走 prompt-only
    // agent 自己决定阶段 2 何时跑
    effectiveMode = "prompt-only";
  }

  // 三种模式都需要：读源稿 + 列图 + 配图检查
  const { mdPath, markdown, meta } = loadSourceMarkdown(args, config);
  const { imageList, placeholderMap } = loadImagesWithCheck(args, mdPath, config);

  if (effectiveMode === "external") {
    if (!args.output) {
      console.error("❌ external 模式必须传 --output");
      process.exit(2);
    }
    await runExternal({ args, config, markdown, meta, imageList, placeholderMap });
    return;
  }
  if (effectiveMode === "prompt-only") {
    runPromptOnly({ markdown, imageList });
    return;
  }
  if (effectiveMode === "postprocess") {
    if (!args.output) {
      console.error("❌ postprocess 模式必须传 --output");
      process.exit(2);
    }
    runPostprocess({ args, meta, placeholderMap });
    return;
  }
  console.error(`❌ 未知的 mode：${effectiveMode}（应为 external / prompt-only / postprocess）`);
  process.exit(2);
}

// 守卫：仅当本文件被作为入口直接执行时才跑 main。
// 修（v11）：原写法 `import.meta.url === \`file://${process.argv[1]}\`` 在 macOS 上失效——
// /var/folders、/tmp 这类 symlink 会让 import.meta.url 拿到 /private/var/... 而 argv[1] 还是 /var/...
// 用 realpathSync 把 argv[1] 解析到真实路径再比较，跨平台都稳。
function isMainModule() {
  try {
    return fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}
if (isMainModule()) {
  main().catch((err) => {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
