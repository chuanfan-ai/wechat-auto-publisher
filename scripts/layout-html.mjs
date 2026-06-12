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
// v11（2026-06-12）新增：
//   - 自动解析 .md 头的 YAML frontmatter（title / subtitle / author / digest）
//   - 只把 body（不含 frontmatter）传给模型，**模型看不到标题，就不会生成 H1**
//   - 输出 HTML 旁边写 <output>.meta.json 给 publish-draft.mjs 消费
//   - config.require_frontmatter=true 时，没 frontmatter 的源稿会被拒绝
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
import { parseFrontmatter } from "./render-wechat-html.mjs";

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
3. 6 个章节（一、二、三、四、五、写在最后）必须全部保留章节结构。每个章节标题 = 编号+空格+小标题（如"一、中国抹茶的历史"），小标题 5-12 字，由模型根据段落内容自己提炼。
4. 每段都必须出现。剥掉所有 HTML 标签后，正文字数必须 >= 原文清洗后字数的 95%。
5. 不确定时宁可拆成多张卡，也不要动内容。

【章节标记规则 - 关键】（v11 更新）
- 本次输入的 Markdown 【不含】正文一级标题：标题/副标题/作者/摘要已经通过 frontmatter 单独传出，会写进公众号后台的标题字段，**绝对不要**在正文里再生成 <h1> 大标题。
- 如果你看到任何 # 开头的行（极罕见，通常是 frontmatter 漏剥），那都不是文章总标题，按 H2 处理。
- 数字章节标题（一、二、三、四、五）→ H2，格式 = "一、+空格+小标题"（如"一、中国抹茶的历史"），小标题 5-12 字概括本段核心。22px阿里蓝，字重700，上留白40px，下留白16px，底部2px阿里蓝实线（font-weight:700; font-size:22px; color:#1677ff; margin:40px 0 16px; padding-bottom:10px; border-bottom:2px solid #1677ff;）
- "写在最后" → H2，原文照搬，样式同上
- 中间可能出现的子标题 → H3，17px阿里蓝，字重600（font-weight:600; font-size:17px; color:#1677ff;）

【现代杂志感排版规范 - 整体视觉系统】
- 配色调：主色阿里蓝 #1677ff + 辅色日落橙 #FF7A00 + 正文色 #333333 + 灰副文字 #666666 + 灰边框 #DDDDDD
- 正文：16px，行高1.8，段间距24px，color:#333333，两端对齐，word-break:break-word
- 整体克制留白：章节之间有明显呼吸，H2 上方至少 40px 留白

【新组件清单 - 每个都请识别并使用】
1. 导读/导语：文章开头 1-2 句总结性引文，独立 <section>，左侧3px日落橙竖线 + 浅灰背景 + 斜体（margin:32px 20px 32px 0;padding:16px 20px 16px 24px;background:#F5F5F5;border-left:3px solid #FF7A00;font-style:italic;color:#555;font-size:15px;line-height:1.9;border-radius:0 8px 8px 0;）
2. 金句标注（每篇至少 3 处）：方案B 半高马克笔，日落橙 #FF7A00（不能换色）：background:linear-gradient(90deg,rgba(255,122,0,0.45) 0%,rgba(255,122,0,0) 100%); background-size:100% 40%; background-position:0 100%; background-repeat:no-repeat; padding:0 2px; font-weight:bold;
3. 引文/引用块：文中原话引出时用，左侧3px阿里蓝竖线 + 浅蓝背景包裹（<section style="margin:24px 20px 24px 0;padding:14px 20px 14px 24px;background:#EDF5FF;border-left:3px solid #1677ff;border-radius:0 6px 6px 0;"><p style="margin:0;padding:0;font-size:15px;line-height:1.9;color:#333;font-style:italic;">）
4. 要点提示/小贴士：知识点提示用，浅橙左边条（<section style="margin:24px 20px 24px 0;padding:14px 20px 14px 24px;background:#FFF8F0;border-left:3px solid #FF7A00;border-radius:0 6px 6px 0;">）
5. 图片 section 包裹 + 12px 圆角 + 图片说明：<section style="text-align:center;margin:28px 0;"><img ... style="display:block;width:100%;border-radius:12px;margin:0 auto;"/> <p style="margin:10px 0 0;font-size:13px;color:#999;text-align:center;font-style:italic;">图片说明文字</p></section>
6. 章节分隔线：章节标题底部已用 border-bottom:2px solid #1677ff; 体现分隔
7. 关键数字高亮：大数字醒目处理，阿里蓝超大字号（font-size:48px;font-weight:700;color:#1677ff;）
8. 作者署名/收尾：居中，阿里蓝，小字，底部可加 CTA 文字

【HTML 结构硬性要求 - v11 加】
- 闭合标签必须跟开标签对应：<section> 必须 </section>，<div> 必须 </div>，**严禁** <section>…</div> 错位
- 每生成一个 <section>，立刻检查后面是否有匹配的 </section>，否则别提交输出

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
  "# Role: 微信公众号·现代杂志感排版专家\n\n" +
  "## 1. 核心认知与目标（最高指导原则）\n\n" +
  "你的唯一任务是\"视觉穿搭\"——为文章穿上现代杂志感的 HTML 外衣。\n\n" +
  "参考风格：36氪、人物、晚点 LatePost、虎嗅、GQ报道。核心追求：克制、有层次、阅读舒适。不要花哨、不要实心背景块、不要圆角卡片框。\n\n" +
  "## 2. 文本无损映射逻辑（绝对红线）\n\n" +
  "原文每一个字、每一个标点都受到严格保护。禁止概括、合并、删减、替换或润色任何原始句子。\n\n" +
  "## 3. 色彩系统\n\n" +
  "- 主色：阿里蓝 #1677ff\n" +
  "- 辅色：日落橙 #FF7A00（金句标注专用）\n" +
  "- 正文色：#333333\n" +
  "- 灰副文字：#666666\n" +
  "- 灰边框：#DDDDDD\n" +
  "- 浅灰背景：#F5F5F5\n" +
  "- 浅蓝背景：#EDF5FF\n" +
  "- 浅橙背景：#FFF8F0\n\n" +
  "## 4. 字体规范\n\n" +
  "- 正文：16px，行高1.8，color:#333333，text-align:justify，word-break:break-word，font-weight:400\n" +
  "- 段间距：<p style=\"margin:0 0 24px 0;padding:0;\">\n\n" +
  "## 5. UI 组件化映射规则库\n\n" +
  "### 5.1 H1（大标题）—— v11：通常不会用到\n" +
  "**标题/副标题/作者/摘要由 frontmatter 单独传出，会写进公众号后台标题字段；正文里不应该出现 H1。**\n" +
  "默认情况下，输入 markdown 第一行不会是 # 一级标题，**不要主动生成 <h1>**。\n" +
  "（如果原文极例外地真的有正文级一级标题，样式：font-weight:700; font-size:26px; text-align:center; margin:48px 0 24px; padding-bottom:20px; border-bottom:2px solid #1677ff;）\n\n" +
  "### 5.2 H2（章节标题 - 编号+小标题，**关键**）\n" +
  "标签：<h2>\n" +
  "格式：编号+空格+小标题（如\"一、中国抹茶的历史\"），小标题 5-12 字概括本段核心，由模型根据段落内容自己提炼\n" +
  "样式：font-weight:700; font-size:22px; color:#1677ff; margin:40px 0 16px; padding-bottom:10px; border-bottom:2px solid #1677ff;\n" +
  "关键：只用纯文字+底部描边，**绝对不用**实心背景+圆角。\n\n" +
  "### 5.3 H3（子标题）\n" +
  "标签：<h3>\n" +
  "样式：font-weight:600; font-size:17px; color:#1677ff;\n\n" +
  "### 5.4 导读/导语（新组件）\n" +
  "识别文章开头1-2句总结性引文，用左侧日落橙竖线包裹。\n" +
  "标签：<section>\n" +
  "样式：margin:32px 20px 32px 0; padding:16px 20px 16px 24px; background:#F5F5F5; border-left:3px solid #FF7A00; font-style:italic; color:#555; font-size:15px; line-height:1.9; border-radius:0 8px 8px 0;\n\n" +
  "### 5.5 引文/引用块\n" +
  "文中原话引用，用左侧阿里蓝竖线。\n" +
  "标签：<section style=\"margin:24px 20px 24px 0; padding:14px 20px 14px 24px; background:#EDF5FF; border-left:3px solid #1677ff; border-radius:0 6px 6px 0;\">\n" +
  "内部文字：<p style=\"margin:0; padding:0; font-size:15px; line-height:1.9; color:#333; font-style:italic;\">\n\n" +
  "### 5.6 要点提示/小贴士（新组件）\n" +
  "知识点/提示性内容，浅橙左边条。\n" +
  "标签：<section>\n" +
  "样式：margin:24px 20px 24px 0; padding:14px 20px 14px 24px; background:#FFF8F0; border-left:3px solid #FF7A00; border-radius:0 6px 6px 0;\n" +
  "注意：文字不加 font-style:italic，保持正常字重。\n\n" +
  "### 5.7 金句标注（必做，每篇至少 3 处）\n" +
  "识别文章中的核心判断、振聋发聩的金句，用日落橙半高马克笔标注。\n" +
  "样式（方案B，日落橙）：background:linear-gradient(90deg,rgba(255,122,0,0.45) 0%,rgba(255,122,0,0) 100%); background-size:100% 40%; background-position:0 100%; background-repeat:no-repeat; padding:0 2px; font-weight:bold;\n" +
  "**必须用日落橙 #FF7A00，不是阿里蓝。每篇至少 3 处。**\n\n" +
  "### 5.8 图片（新组件）\n" +
  "标签：<section style=\"text-align:center; margin:28px 0;\">\n" +
  "<img style=\"display:block; width:100%; border-radius:12px; margin:0 auto;\">\n" +
  "<p style=\"margin:10px 0 0; font-size:13px; color:#999; text-align:center; font-style:italic;\">图片说明文字</p>\n" +
  "</section>\n\n" +
  "### 5.9 关键数字高亮\n" +
  "遇到文章中的大数字/关键数据，用超大字号+阿里蓝高亮。\n" +
  "样式：font-size:48px; font-weight:700; color:#1677ff; line-height:1;\n\n" +
  "### 5.10 列表\n" +
  "无序：<p style=\"margin:0 0 8px 0; padding:0;\">• 内容（16px，行高1.8）\n" +
  "有序：<p style=\"margin:0 0 8px 0; padding:0;\">1. 内容\n\n" +
  "### 5.11 作者署名/收尾\n" +
  "<section style=\"text-align:center; margin:48px 0 0; padding:24px 0; border-top:1px solid #DDDDDD;\">\n" +
  "<p style=\"margin:0 0 8px; font-size:14px; color:#1677ff; font-weight:600;\">撰文 / 船帆</p>\n" +
  "<p style=\"margin:0; font-size:13px; color:#999;\">感谢阅读，欢迎转发</p>\n" +
  "</section>\n\n" +
  "## 6. 微信底层规范\n\n" +
  "1. 根容器：<section style=\"width:100%; margin:0; padding:0; box-sizing:border-box;\">\n" +
  "2. 段落：<p style=\"margin:0 0 24px 0; padding:0;\">\n" +
  "3. 纯内联样式：禁止 <style> 标签\n" +
  "4. 字体：最多 3 种字重/样式组合\n" +
  "5. 克制：不要过于花哨，留白比填充更重要\n" +
  "6. **HTML 结构必须闭合配对**：<section> 必须 </section>，<div> 必须 </div>，严禁错位（v11 加）\n\n" +
  "## 7. 输出要求\n\n" +
  "直接输出纯净 HTML 代码，不使用 Markdown 代码块语法包裹（严禁 ```html 和 ``` 符号）。第一行严格是 <section>...</section>。";

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
  const rawMarkdown = fs.readFileSync(mdPath, "utf-8");

  // v11: 解析 frontmatter，剥离正文标题元信息
  // 重点：把 body（不含 frontmatter）传给模型，模型看不到标题就不会生成 H1，
  // 标题/副标题/作者/摘要单独写到 .meta.json sidecar，由 publish-draft.mjs 消费。
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

  const imagesDir = args.imagesDir
    ? path.resolve(cwd, args.imagesDir)
    : path.resolve(path.dirname(mdPath), "images");
  const imageList = listImages(imagesDir);
  const placeholderMap = buildPlaceholderMap(imageList);
  const prompt = buildPrompt({ markdown, imageList, promptTemplate });

  console.error(`[layout-html] model: ${model}`);
  console.error(`[layout-html] api:   ${apiBase}/v1beta/models/${model}:${args.stream ? "streamGenerateContent" : "generateContent"}`);
  console.error(`[layout-html] input: ${mdPath} (${markdown.length} chars, body only)`);
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

  // v11: 写 sidecar .meta.json，供 publish-draft.mjs 消费
  if (hadFrontmatter && Object.keys(meta).length > 0) {
    const sidecarPath = `${outPath}.meta.json`;
    fs.writeFileSync(sidecarPath, `${JSON.stringify(meta, null, 2)}\n`, "utf-8");
    console.error(`✅ sidecar 已写：${sidecarPath}`);
    console.error("   接下来 publish-draft.mjs 会自动读这个 sidecar 拿 title/author/digest");
  }
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
