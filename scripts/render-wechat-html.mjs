#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const DISALLOWED_CONTAINER_TAGS = [
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "form",
  "textarea",
  "button",
  "select",
  "option",
  "canvas",
];

const DISALLOWED_VOID_TAGS = ["input", "meta", "link"];
const ROOT_STYLE = "width: 100%; margin: 0; padding: 0; box-sizing: border-box; overflow: hidden;";

export function cleanMarkdownFence(html) {
  return String(html || "")
    .replace(/^\s*```html\s*/i, "")
    .replace(/^\s*```\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
}

export function sanitizeWechatHtml(html) {
  let out = cleanMarkdownFence(html);
  for (const tag of DISALLOWED_CONTAINER_TAGS) {
    out = out.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi"), "");
    out = out.replace(new RegExp(`<${tag}\\b[^>]*\\/?>`, "gi"), "");
  }
  for (const tag of DISALLOWED_VOID_TAGS) {
    out = out.replace(new RegExp(`<${tag}\\b[^>]*\\/?>`, "gi"), "");
  }
  out = out.replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  out = out.replace(/(javascript|vbscript):/gi, "");
  return out.trim();
}

export function ensureWechatRoot(html) {
  const sanitized = sanitizeWechatHtml(html);
  if (!/^<section\b/i.test(sanitized)) {
    return `<section style="${ROOT_STYLE}">\n${sanitized}\n</section>`;
  }
  return sanitized.replace(/^<section\b([^>]*)>/i, (match, attrs) => {
    if (/style\s*=/i.test(attrs)) {
      return `<section${attrs.replace(/style\s*=\s*"[^"]*"/i, `style="${ROOT_STYLE}"`)}>`;
    }
    return `<section${attrs} style="${ROOT_STYLE}">`;
  });
}

function parseArgs(argv) {
  const args = { input: "", output: "", selfTest: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--self-test") args.selfTest = true;
    else if ((arg === "-o" || arg === "--output") && argv[i + 1]) args.output = argv[++i];
    else if (!arg.startsWith("-")) args.input = arg;
  }
  return args;
}

function selfTest() {
  const result = ensureWechatRoot("<style>p{}</style><p onclick=\"x()\">hello</p><script>x()</script>");
  if (!result.startsWith("<section")) throw new Error("root missing");
  if (result.includes("<script") || result.includes("<style") || result.includes("onclick")) {
    throw new Error("sanitize failed");
  }
  console.log("render-wechat-html self-test passed");
}

const args = parseArgs(process.argv.slice(2));
if (args.selfTest) {
  selfTest();
} else if (args.input) {
  const inputPath = path.resolve(args.input);
  const html = fs.readFileSync(inputPath, "utf8");
  const out = ensureWechatRoot(html);
  if (args.output) {
    const outputPath = path.resolve(args.output);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${out}\n`);
  } else {
    process.stdout.write(`${out}\n`);
  }
} else if (import.meta.url === `file://${process.argv[1]}`) {
  console.error("Usage: node scripts/render-wechat-html.mjs <input.html> [-o output.html]");
  process.exit(1);
}

