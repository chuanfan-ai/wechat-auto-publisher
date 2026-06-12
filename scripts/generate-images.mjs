#!/usr/bin/env node
// scripts/generate-images.mjs
//
// v12 新增：AI 生图入口。
//
// 输入：images/prompts.json（agent 根据 draft.md 内容写出来的）
//   [
//     { "name": "01-cover.jpg", "prompt": "霸王茶姬店面在曼谷开幕的盛大场面，写实摄影风格" },
//     { "name": "02-asean.jpg", "prompt": "东南亚地图与茶饮品牌 logo 拼接，扁平插画风" }
//   ]
//
// 行为：按 config.image_mode 分支
//   - external：调外部 API 生图（OpenAI 协议）→ 下载到本地
//   - self：写 images/descriptions.md 让 agent / 用户对照生图或人工配图
//   - manual：不做事，提示 agent 手动找图
//
// 用法：
//   node scripts/generate-images.mjs \
//     --output-dir images/ \
//     [--prompts images/prompts.json] \
//     [--max 5]

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { loadConfig, loadExternalApiKey } from "./config.mjs";

const ENTRY_DIR = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = { outputDir: "images", prompts: "", max: 0 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--output-dir" && argv[i + 1]) args.outputDir = argv[++i];
    else if (a === "--prompts" && argv[i + 1]) args.prompts = argv[++i];
    else if (a === "--max" && argv[i + 1]) args.max = parseInt(argv[++i], 10);
  }
  return args;
}

function readPrompts(promptsPath) {
  if (!fs.existsSync(promptsPath)) {
    throw new Error(`找不到 prompts 文件：${promptsPath}\n   请让 agent 先根据 draft.md 内容写一份 images/prompts.json`);
  }
  const json = JSON.parse(fs.readFileSync(promptsPath, "utf-8"));
  if (!Array.isArray(json)) {
    throw new Error(`prompts.json 必须是数组，每项含 name 和 prompt 字段`);
  }
  for (const item of json) {
    if (!item.name || !item.prompt) {
      throw new Error(`prompts.json 每一项必须有 "name" 和 "prompt" 字段：${JSON.stringify(item)}`);
    }
  }
  return json;
}

// 调外部 API 生图（OpenAI Images API 协议）
// 参考：POST {api_base}/v1/images/generations
//   payload: { model, prompt, n, size, quality, format }
//   response: { data: [{ url: "..." }] } 或 { data: [{ b64_json: "..." }] }
async function generateOne({ prompt, name, apiBase, apiKey, model, size, quality, format }) {
  const url = `${apiBase.replace(/\/+$/, "")}/v1/images/generations`;
  const payload = {
    model,
    prompt,
    n: 1,
    size,
    quality,
    format,
  };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${errText.slice(0, 400)}`);
  }
  const json = await res.json();
  const item = json.data && json.data[0];
  if (!item) throw new Error(`响应里没有 data[0]：${JSON.stringify(json).slice(0, 200)}`);
  return item; // { url } 或 { b64_json }
}

// 把生图结果保存到本地
async function saveImage(item, outputPath) {
  if (item.b64_json) {
    const buf = Buffer.from(item.b64_json, "base64");
    fs.writeFileSync(outputPath, buf);
    return { source: "base64", bytes: buf.length };
  }
  if (item.url) {
    const res = await fetch(item.url);
    if (!res.ok) throw new Error(`下载图片失败：HTTP ${res.status}（URL: ${item.url}）`);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(outputPath, buf);
    return { source: "url", url: item.url, bytes: buf.length };
  }
  throw new Error(`响应里既没有 url 也没有 b64_json：${JSON.stringify(item).slice(0, 200)}`);
}

async function runExternal({ prompts, outputDir, config, apiKey, max }) {
  const apiBase = config.external_api.api_base;
  const model = config.external_api.image_gen_model;
  const size = config.external_api.image_gen_size || "1024x1024";
  const quality = config.external_api.image_gen_quality || "low";
  const format = config.external_api.image_gen_format || "jpeg";

  fs.mkdirSync(outputDir, { recursive: true });

  const targets = max > 0 ? prompts.slice(0, max) : prompts;
  console.error(`[generate-images] 模式：external（OpenAI 协议）`);
  console.error(`[generate-images] API:  ${apiBase}/v1/images/generations`);
  console.error(`[generate-images] 模型：${model} / 尺寸 ${size} / 质量 ${quality} / 格式 ${format}`);
  console.error(`[generate-images] 待生成：${targets.length} 张`);
  console.error("");

  const results = [];
  for (let i = 0; i < targets.length; i += 1) {
    const t = targets[i];
    const outputPath = path.resolve(outputDir, t.name);
    console.error(`[generate-images] [${i + 1}/${targets.length}] 生成 ${t.name}`);
    console.error(`   prompt: ${t.prompt.slice(0, 80)}${t.prompt.length > 80 ? "..." : ""}`);
    try {
      const item = await generateOne({
        prompt: t.prompt,
        name: t.name,
        apiBase,
        apiKey,
        model,
        size,
        quality,
        format,
      });
      const saved = await saveImage(item, outputPath);
      console.error(`   ✅ 已保存：${outputPath}（${saved.bytes} 字节，来源 ${saved.source}）`);
      results.push({ ok: true, name: t.name, path: outputPath, ...saved });
    } catch (e) {
      console.error(`   ❌ 失败：${e.message}`);
      results.push({ ok: false, name: t.name, error: e.message });
    }
  }

  const ok = results.filter((r) => r.ok).length;
  const fail = results.length - ok;
  console.error("");
  console.error(`[generate-images] 完成：成功 ${ok} / 失败 ${fail} / 总共 ${results.length}`);
  if (fail > 0) {
    console.error(`   失败列表：${results.filter((r) => !r.ok).map((r) => r.name).join(", ")}`);
    process.exitCode = 1;
  }
}

function runSelf({ prompts, outputDir }) {
  // self 模式：脚本不调任何 LLM，写一份 descriptions.md 让 agent 用自己的模型尝试生图，
  // 或在 agent 没有生图能力时让用户人工配图。
  fs.mkdirSync(outputDir, { recursive: true });
  const descPath = path.resolve(outputDir, "descriptions.md");
  const lines = [
    "# 配图描述清单（self 模式）",
    "",
    "**说明**：当前配置 `image_mode: self`，脚本不调外部生图 API。",
    "Agent 可以用自己的模型尝试根据下列 prompt 生图；如果 Agent 平台不支持生图，",
    "请用户对照下方描述自己找授权图片放到 `images/` 目录（文件名对应 `name` 字段）。",
    "",
    `共 ${prompts.length} 张图：`,
    "",
  ];
  for (const t of prompts) {
    lines.push(`## ${t.name}`);
    lines.push("");
    lines.push(`> ${t.prompt}`);
    lines.push("");
  }
  fs.writeFileSync(descPath, `${lines.join("\n")}\n`, "utf-8");
  console.error(`[generate-images] 模式：self`);
  console.error(`[generate-images] 已写描述清单：${descPath}`);
  console.error(`[generate-images] 下一步：Agent 自行根据描述生图，或让用户人工配图后放到 ${outputDir}/`);
}

function runManual({ outputDir }) {
  fs.mkdirSync(outputDir, { recursive: true });
  console.error(`[generate-images] 模式：manual`);
  console.error(`[generate-images] 脚本不主动生图。请 agent 按 references/image-policy.md 找网络授权图片，`);
  console.error(`   下载到 ${outputDir}/ 目录（按文件名字母序自动编号）`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  const config = loadConfig(cwd, [ENTRY_DIR]);
  const outputDir = path.resolve(cwd, args.outputDir);
  const promptsPath = args.prompts
    ? path.resolve(cwd, args.prompts)
    : path.resolve(outputDir, "prompts.json");

  const mode = config.image_mode || "external";

  if (mode === "manual") {
    runManual({ outputDir });
    return;
  }

  // external 和 self 都需要 prompts.json
  let prompts;
  try {
    prompts = readPrompts(promptsPath);
  } catch (e) {
    console.error(`❌ ${e.message}`);
    process.exit(2);
  }

  if (mode === "self") {
    runSelf({ prompts, outputDir });
    return;
  }

  if (mode === "external") {
    const apiKey = loadExternalApiKey(cwd, [ENTRY_DIR], config);
    if (!apiKey) {
      const keyEnv = (config.external_api && config.external_api.api_key_env) || "EXTERNAL_API_KEY";
      console.error(`❌ 排版/生图选了 external 模式，但没找到 API key。`);
      console.error(`   修复：export ${keyEnv}="<你的 key>"，或重跑 init-config.mjs 重新写入。`);
      process.exit(2);
    }
    await runExternal({ prompts, outputDir, config, apiKey, max: args.max });
    return;
  }

  console.error(`❌ 未知的 image_mode：${mode}（应为 external / self / manual）`);
  process.exit(2);
}

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
