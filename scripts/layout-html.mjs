#!/usr/bin/env node
// scripts/layout-html.mjs
//
// 自定义排版：调 chuanfanai.com 的 Gemini 协议中转网关，
// 把 Markdown 文章排成微信公众号兼容的 inline-style HTML。
//
// 依赖：node >= 18（自带 fetch / AbortController / TextDecoder）
//
// 用法：
//   node scripts/layout-html.mjs \
//     --input draft.md \
//     --output dist/wechat.html \
//     --images-dir images/ \
//     [--cover 05-cover.jpg] \
//     [--stream] \
//     [--no-think]
//
// 环境变量：
//   LAYOUT_API_KEY  必填（脚本会优先读这个，
//                   也可以在 config.json 的 layout_model.api_key_env 改成别的变量名）
//
// 端点行为（2026-06-09 实测）：
//   - 同步：POST /v1beta/models/{model}:generateContent
//   - 流式：POST /v1beta/models/{model}:streamGenerateContent?alt=sse
//   - 鉴权：Authorization: Bearer <key>  与  URL ?key=<key>  二选一即可
//   - 思考片段：candidates[0].content.parts[i].thought === true → 跳过
//   - 真实文本：candidates[0].content.parts[i].text （无 thought 字段）
//   - 思考签名：parts[i].thoughtSignature（gemini 2.5+ 引入，直接忽略）

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.mjs";

const ENTRY_DIR = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_PROMPT = `你是资深的微信公众号排版师。请把下面这篇 Markdown 文章排成微信公众号兼容的 HTML 片段。

【绝对红线】不要在你的输出里写任何 <img> 标签或图片 markdown 语法！你需要从下面的"可用图片清单"中按编号挑选最合适的图片，输出 '【图片位_N】'（N 是编号，0、1、2...）这种字面量，包括中文方括号。后处理程序会负责把它替换成真正的 <img> 标签。

可用图片清单：
{{IMAGES}}

插入规则：
- 挑你认为语义最合适的图片，输出对应编号的【图片位_N】字面量。
- 不要全部用上，也不要硬塞；合适才用，最多 4-5 个。
- 在 H2 章节标题之后或叙事段落之间，**独立成段**输出占位符（不要放在 <p> 里面）。
- 原样输出'【图片位_0】''【图片位_1】'...这种字符串，不要修改字符、不要加引号、不要加 img 标签。



【字数硬性要求 - 最重要】原文必须 100% 逐字保留：
1. 禁止任何摘要、压缩、改写、扩写、删减、合并段落、调整顺序、替换措辞、润色。
2. 所有事实、数据、引文、案例细节、人名、机构名、产品名、数字、年份、术语、语气词、标点都必须原样出现。
3. 6 个 H2 章节（一、二、三、四、五、写在最后）必须全部保留，章节标题原文照搬，不得重命名、合并、删除。
4. 每段都必须出现。剥掉所有 HTML 标签后，正文字数必须 >= 原文清洗后字数的 95%。
5. 不确定时宁可拆成多张卡，也不要动内容。

【章节标记规则 - 关键】
- 文章总标题（Markdown 第一行的 # 标题）→ 用 H1 标签
- 数字章节标题（"一、二、三、四、五"）→ 必须用 H2 标签，样式：26px 白字阿里蓝 #1677ff 实心背景圆角（建议：background-color:#1677ff; color:#fff; padding:10px 20px; border-radius:6px; display:inline-block;）
- "写在最后" → 用 H2 标签，样式同上
- 中间可能出现的子标题 → 用 H3 标签，样式：18px 阿里蓝 #1677ff 加粗

【技术要求】
1. 输出必须用 inline-style（行内样式），不要用 <style> 块或外部 CSS（公众号会过滤）。
2. 不输出 <html> <head> <body>，只输出 <section>...</section> 包裹的正文片段。
3. 不要解释、不要前言后语、不要 markdown code fence 包裹（不要三个反引号 html 也不要三个反引号）。
4. 不要使用 <br> 跨段换行。普通段落必须用 <p> 标签并加 margin: 0 0 24px 0。
5. 配色调：阿里蓝 #1677ff + 日落橙 #FF7A00。

文章 Markdown（请按 systemInstruction 的设计风格排版，逐字保留）：
---
{{MARKDOWN}}
---`;

const DEFAULT_SYSTEM_INSTRUCTION =
  "# Role: 微信公众号·DOM结构映射与视觉样式注入专家\n\n" +
  "## 1. 核心认知与目标（最高指导原则）\n" +
  "你的唯一任务是\"视觉穿搭\"，绝对禁止进入\"文本编辑\"、\"结构重组\"或\"内容总结\"模式。\n" +
  "请将用户输入的纯文本，视为绝对不可篡改的底层数据库。你需要做的是：识别文本自带的自然逻辑（如标题、列表、重点段落），并原封不动地为其穿上适配 SaaS 界面风格的 HTML 与 CSS 样式外衣，借此降低读者的视觉认知负荷。\n\n" +
  "## 2. 文本无损映射逻辑（绝对红线）\n" +
  "原文的每一个字、每一个标点符号都受到严格保护。\n" +
  "* 严禁：概括、合并、删减、替换或润色任何原始句子。\n" +
  "* 动作（识别与样式包裹）：当你发现用户在列举事物、功能、文件名或步骤时，请精准锁定这些原始词汇。在完全保留原文语序和字数的前提下，直接使用对应的 UI 组件代码将原词紧紧包裹。\n\n" +
  "## 3. 色彩系统\n" +
  "* 主题色为 阿里蓝：#1677ff + 日落橙 (#FF7A00)\n\n" +
  "## 4. UI 组件化映射规则库\n" +
  "遇到特定内容，保持原文不变，自动套用以下视觉组件包裹：\n" +
  "1. 【大数字标题组件】：遇到文中的\"01、04\"等数字序号，采用\"超大字号 + 空心描边（或极浅实心色） + 并排紧凑的深色标题\"进行样式包裹。\n" +
  "2. 【金句标注】（必做，每篇至少 3 处）：遇到原文的核心概念、关键判断、振聋发聩的金句，必须用主题色下划线包裹，模拟真实荧光笔的笔触感。优先用方案 B（半高马克笔下划线，主题色 #1677ff），次选方案 A（扫光高亮）。\n" +
  "   * 方案A（扫光高亮）：`background: linear-gradient(90deg, rgba(22,119,255,0.25) 0%, rgba(22,119,255,0.02) 100%); padding: 2px 6px; border-radius: 4px; font-weight: bold;`\n" +
  "   * 方案B（半高马克笔下划线，**默认**）：`background: linear-gradient(90deg, rgba(22,119,255,0.45) 0%, rgba(22,119,255,0) 100%); background-size: 100% 40%; background-position: 0 100%; background-repeat: no-repeat; padding: 0 2px; font-weight: bold;`\n" +
  "3. 【操作/代码块组件】：遇到提示词、需要复制的代码、特定操作指令，使用一个独立容器包裹原文。四周使用契合当前主色彩体系的细虚线（如 `border: 1px dashed 主色`），背景保持纯白留白（`background-color: transparent`），并配合充裕的内边距（如 `padding: 16px; border-radius: 6px;`），呈现极简的呼吸感。\n\n" +
  "## 5. 微信底层排版规范（存活红线）\n" +
  "1. 根容器：必须且只能用一层 <section> 包裹全局，严格附加样式 width: 100%; margin: 0; padding: 0; box-sizing: border-box;。严禁在根容器擅自添加任何像素的 padding 内边距，内容必须 100% 紧贴边缘。\n" +
  "2. 段落与间距规范：普通纯文本段落必须使用 <p> 标签，并强制附加样式 <p style=\"margin: 0 0 24px 0; padding: 0;\"> 来拉开呼吸间距。只有在生成独立 UI 组件（如操作指令框）时，才使用 <section> 作为外层包裹容器。绝对严禁使用 <br> 进行跨段落换行。\n" +
  "3. 纯内联样式：严禁使用 <style> 标签或外部 CSS，所有样式必须 100% 写在标签的 style=\"...\" 属性中。\n" +
  "4. 字体设置：正文基准字号设为 16px，行高 1.8，文字颜色 #333333，两端对齐 text-align: justify; word-break: break-word; 不要出现任何斜体。\n" +
  "5. 保持克制：排版不要过于花哨，全局字体样式不要超过 3 种。\n\n" +
  "## 6. 输出要求\n" +
  "不需要任何思考过程和解释性对话。绝对保证用户内容零删减。直接输出纯净的 HTML 代码文本，绝对不要使用 Markdown 代码块语法包裹（严禁出现 ```html 和 ``` 符号）。第一行必须严格是 <section style=\"...\">，最后一行必须严格是 </section>。";

function parseArgs(argv) {
  const args = { input: "", output: "", imagesDir: "", cover: "", stream: false, noThink: true };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--input" && argv[i + 1]) args.input = argv[++i];
    else if (arg === "-i" && argv[i + 1]) args.input = argv[++i];
    else if (arg === "--output" && argv[i + 1]) args.output = argv[++i];
    else if (arg === "-o" && argv[i + 1]) args.output = argv[++i];
    else if (arg === "--images-dir" && argv[i + 1]) args.imagesDir = argv[++i];
    else if (arg === "--cover" && argv[i + 1]) args.cover = argv[++i];
    else if (arg === "--stream") args.stream = true;
    else if (arg === "--no-think") args.noThink = true;
  }
  return args;
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.input || !args.output) {
    console.error("Usage: node scripts/layout-html.mjs --input <draft.md> --output <wechat.html> [--images-dir <dir>] [--cover <file>] [--stream] [--no-think]");
    process.exit(2);
  }

  const cwd = process.cwd();
  const config = loadConfig(cwd, [ENTRY_DIR]);
  const lm = config.layout_model || {};

  const apiKeyEnv = lm.api_key_env || "LAYOUT_API_KEY";
  const apiKey = process.env[apiKeyEnv];
  if (!apiKey) {
    console.error(`❌ 缺少 API key：请 export ${apiKeyEnv}="<你的 key>" 后再跑。`);
    console.error(`   （也可以在 config.json 的 layout_model.api_key_env 改成你已有的环境变量名）`);
    process.exit(2);
  }

  const apiBase = (lm.api_base || "https://chuanfanai.com").replace(/\/+$/, "");
  const model = lm.model || "gemini-3.1-flash-lite";
  const systemInstruction = lm.system_instruction || DEFAULT_SYSTEM_INSTRUCTION;
  const promptTemplate = lm.prompt_template || DEFAULT_PROMPT;

  const mdPath = path.resolve(cwd, args.input);
  const markdown = fs.readFileSync(mdPath, "utf-8");
  const imagesDir = args.imagesDir
    ? path.resolve(cwd, args.imagesDir)
    : path.resolve(path.dirname(mdPath), "images");
  const imageList = listImages(imagesDir);
  const placeholderMap = buildPlaceholderMap(imageList);
  const prompt = buildPrompt({ markdown, imageList, promptTemplate });

  console.error(`[layout-html] model: ${model}`);
  console.error(`[layout-html] api:   ${apiBase}/v1beta/models/${model}:${args.stream ? "streamGenerateContent" : "generateContent"}`);
  console.error(`[layout-html] input: ${mdPath} (${markdown.length} chars)`);
  console.error(`[layout-html] images:${imageList.length} from ${imagesDir}`);

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

  let html = stripFences(text);
  // 占位符回填：【图片位_N】 → 完整 <section><img>...</section>
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
  const outPath = path.resolve(cwd, args.output);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, html, "utf-8");
  console.error(`✅ 已写入 ${outPath}（${html.length} 字符）`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
