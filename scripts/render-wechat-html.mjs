#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

// ============================================================================
// 基础清洗
// ============================================================================

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

// ============================================================================
// v11 三层加固：frontmatter / 标题去重兜底 / 结构 sanity check
// ============================================================================

// 极简 YAML frontmatter 解析（只支持 key: value 单行字符串，够标题/副标题/作者/摘要用）
// 输入：原始 md / html 文本
// 输出：{ meta: {title?, subtitle?, author?, digest?, ...}, body: string, hadFrontmatter: bool }
export function parseFrontmatter(text) {
  const s = String(text || "");
  const m = s.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: s, hadFrontmatter: false };
  const yamlBlock = m[1];
  const body = m[2];
  const meta = {};
  for (const rawLine of yamlBlock.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, "");
    if (!line || line.trim().startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    meta[key] = value;
  }
  return { meta, body, hadFrontmatter: true };
}

// 从 HTML 里提取 meta：<title>、<meta name="title|subtitle|author|digest" content="...">
// 注意：sanitizeWechatHtml 会剥 <meta> 和 <title>，所以本函数必须在 sanitize 之前调用。
export function extractMetaFromHtml(html) {
  const out = {};
  const s = String(html || "");
  const tM = s.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (tM) out.title = tM[1].replace(/<[^>]+>/g, "").trim();
  const metaRe = /<meta\b[^>]*\bname\s*=\s*["']([^"']+)["'][^>]*\bcontent\s*=\s*["']([^"']*)["'][^>]*\/?>/gi;
  let m;
  while ((m = metaRe.exec(s)) !== null) {
    const key = m[1].toLowerCase();
    if (["title", "subtitle", "author", "digest", "summary"].includes(key)) {
      out[key === "summary" ? "digest" : key] = m[2];
    }
  }
  return out;
}

// 文本归一化（去标签、去空白、去常见标点），用于"标题等价"判断
function normalizeText(s) {
  return String(s || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z]+;/gi, "")
    .replace(/[\s 　]+/g, "")
    .replace(/[　-〿＀-￯`~!@#$%^&*()\-_=+\[\]{}|\\;:'",.<>?/]/g, "")
    .toLowerCase();
}

// "标题等价"：完全相同 / normalized 相同 / 一方是另一方子串（且长度比 ≥ 0.6）
export function isLikelyTitleMatch(htmlText, title) {
  const a = normalizeText(htmlText);
  const b = normalizeText(title);
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(b) && b.length / a.length >= 0.6) return true;
  if (b.includes(a) && a.length / b.length >= 0.6) return true;
  return false;
}

// 三层加固第 3 层的兜底（render 也暴露，方便测试和复用）：
// 扫描 body 开头 2000 字符里的第一个 <h1>/<h2>/<h3>，
// 如果其文本跟 title 高度相似 → 删除该标题块 + 紧随的 <hr> 装饰线 + 紧跟的短 <p> 副标题。
// 返回 { html, stripped, removed: string[] }
export function stripLeadingTitle(html, title) {
  if (!title || !html) return { html, stripped: false, removed: [] };

  const searchLimit = 2000;
  const head = html.slice(0, searchLimit);
  const blockRe = /<(h[123])\b[^>]*>([\s\S]*?)<\/\1>/i;
  const m = head.match(blockRe);
  if (!m) return { html, stripped: false, removed: [] };

  const inner = m[2];
  if (!isLikelyTitleMatch(inner, title)) return { html, stripped: false, removed: [] };

  const start = m.index;
  const end = start + m[0].length;
  const removed = [`<${m[1]}>${inner.replace(/<[^>]+>/g, "").trim()}</${m[1]}>`];
  let after = html.slice(0, start) + html.slice(end);

  // 删除紧随的 <hr ...>（含空白前缀）
  const hrM = after.slice(start).match(/^\s*<hr\b[^>]*\/?>/i);
  if (hrM) {
    after = after.slice(0, start) + after.slice(start + hrM[0].length);
    removed.push("<hr>");
  }

  // 删除紧跟的短 <p>（视为副标题，文本 < 80 字才删，避免误删正文首段）
  const pM = after.slice(start).match(/^\s*<p\b[^>]*>([\s\S]*?)<\/p>/i);
  if (pM) {
    const pText = pM[1].replace(/<[^>]+>/g, "").trim();
    if (pText.length > 0 && pText.length < 80) {
      after = after.slice(0, start) + after.slice(start + pM[0].length);
      removed.push(`<p>${pText}</p>`);
    }
  }

  return { html: after, stripped: true, removed };
}

// 结构 sanity check：统计 <section>/<div> 的开闭标签数量是否平衡。
// 不阻断，只返回信息，调用方决定 warn 还是 throw。
// 说明：section/div 都是非 void 标签，HTML 规范禁止自闭合；
// 即使源里写了 <section/>，浏览器也按"开标签"处理。
export function checkStructureBalance(html) {
  const s = String(html || "");
  const issues = [];
  const stats = {};
  for (const tag of ["section", "div"]) {
    const open = (s.match(new RegExp(`<${tag}\\b[^>]*>`, "gi")) || []).length;
    const close = (s.match(new RegExp(`<\\/${tag}\\s*>`, "gi")) || []).length;
    stats[tag] = { open, close, balanced: open === close };
    if (open !== close) {
      issues.push(`<${tag}> 不平衡：开 ${open} / 闭 ${close} (差 ${open - close})`);
    }
  }
  return { ok: issues.length === 0, issues, stats };
}

// .md → 解析 frontmatter；其他 → 视为 HTML，尝试从 <title>/<meta> 提取
export function loadSourceWithMeta(filePath, rawText) {
  const ext = path.extname(filePath || "").toLowerCase();
  if (ext === ".md" || ext === ".markdown") {
    return parseFrontmatter(rawText);
  }
  return { meta: extractMetaFromHtml(rawText), body: rawText, hadFrontmatter: false };
}

// 写 sidecar .meta.json
export function writeMetaSidecar(outputHtmlPath, meta) {
  if (!meta || Object.keys(meta).length === 0) return null;
  const sidecarPath = `${outputHtmlPath}.meta.json`;
  fs.writeFileSync(sidecarPath, `${JSON.stringify(meta, null, 2)}\n`, "utf-8");
  return sidecarPath;
}

// 读 sidecar .meta.json
export function readMetaSidecar(htmlPath) {
  const sidecarPath = `${htmlPath}.meta.json`;
  if (!fs.existsSync(sidecarPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(sidecarPath, "utf-8"));
  } catch {
    return null;
  }
}

// ============================================================================
// CLI
// ============================================================================

function parseArgs(argv) {
  const args = {
    input: "",
    output: "",
    metaOut: "",
    title: "",
    selfTest: false,
    skipFrontmatter: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--self-test") args.selfTest = true;
    else if ((arg === "-o" || arg === "--output") && argv[i + 1]) args.output = argv[++i];
    else if (arg === "--meta-out" && argv[i + 1]) args.metaOut = argv[++i];
    else if (arg === "--title" && argv[i + 1]) args.title = argv[++i];
    else if (arg === "--skip-frontmatter") args.skipFrontmatter = true;
    else if (!arg.startsWith("-")) args.input = arg;
  }
  return args;
}

function selfTest() {
  // 1. 基础清洗
  const r1 = ensureWechatRoot('<style>p{}</style><p onclick="x()">hello</p><script>x()</script>');
  if (!r1.startsWith("<section")) throw new Error("[self-test] root missing");
  if (r1.includes("<script") || r1.includes("<style") || r1.includes("onclick")) {
    throw new Error("[self-test] sanitize failed");
  }

  // 2. frontmatter 解析
  const f1 = parseFrontmatter("---\ntitle: 测试标题\nauthor: 船帆\n---\n这是正文");
  if (!f1.hadFrontmatter) throw new Error("[self-test] frontmatter not detected");
  if (f1.meta.title !== "测试标题" || f1.meta.author !== "船帆") {
    throw new Error("[self-test] frontmatter parse wrong");
  }
  if (f1.body !== "这是正文") throw new Error("[self-test] frontmatter body wrong");

  const f2 = parseFrontmatter("no frontmatter here");
  if (f2.hadFrontmatter) throw new Error("[self-test] false positive frontmatter");

  // 3. 引号包裹
  const f3 = parseFrontmatter('---\ntitle: "带：冒号的标题"\n---\n正文');
  if (f3.meta.title !== "带：冒号的标题") throw new Error("[self-test] quoted value wrong");

  // 4. 标题等价
  if (!isLikelyTitleMatch("新茶饮出海 2.0", "新茶饮出海 2.0")) throw new Error("[self-test] exact match failed");
  if (!isLikelyTitleMatch("新茶饮出海 2.0：副标题", "新茶饮出海 2.0")) throw new Error("[self-test] prefix match failed");
  if (isLikelyTitleMatch("完全不同的内容", "新茶饮出海 2.0")) throw new Error("[self-test] false positive title match");

  // 5. stripLeadingTitle 删 H1 + hr + 短 p
  const s1 = stripLeadingTitle(
    "<h1>新茶饮出海 2.0</h1>\n<hr/>\n<p>副标题一句话</p>\n<p>这是真正的正文，比较长，至少要超过 80 个字才会被认为是正文而不是副标题，这里再凑一些字数来确保它不会被误删——继续凑字数继续凑字数继续凑字数。</p>",
    "新茶饮出海 2.0",
  );
  if (!s1.stripped) throw new Error("[self-test] stripLeadingTitle failed to strip");
  if (s1.html.includes("<h1>")) throw new Error("[self-test] H1 not removed");
  if (s1.html.includes("<hr")) throw new Error("[self-test] hr not removed");
  if (s1.html.includes("副标题一句话")) throw new Error("[self-test] subtitle p not removed");
  if (!s1.html.includes("这是真正的正文")) throw new Error("[self-test] body p 误删");

  // 6. stripLeadingTitle 不误伤
  const s2 = stripLeadingTitle("<h1>另外的标题</h1><p>正文</p>", "完全不一样的标题");
  if (s2.stripped) throw new Error("[self-test] stripLeadingTitle 误删");

  // 7. structure balance
  const b1 = checkStructureBalance("<section><p>x</p></section>");
  if (!b1.ok) throw new Error("[self-test] balanced HTML 误判");
  const b2 = checkStructureBalance("<section><p>x</p></div>");
  if (b2.ok) throw new Error("[self-test] unbalanced HTML 未识别");
  if (!b2.issues.some((s) => s.includes("section"))) throw new Error("[self-test] section issue missing");
  if (!b2.issues.some((s) => s.includes("div"))) throw new Error("[self-test] div issue missing");

  // 8. extractMetaFromHtml
  const e1 = extractMetaFromHtml(
    '<title>抓我</title><meta name="author" content="船帆"><meta name="digest" content="一句话摘要">',
  );
  if (e1.title !== "抓我" || e1.author !== "船帆" || e1.digest !== "一句话摘要") {
    throw new Error("[self-test] extractMetaFromHtml failed");
  }

  // 9. summary 别名归一为 digest
  const e2 = extractMetaFromHtml('<meta name="summary" content="摘要文">');
  if (e2.digest !== "摘要文") throw new Error("[self-test] summary alias failed");

  // 10. sidecar 读写
  const tmpHtml = path.join(process.cwd(), `.self-test-${Date.now()}.html`);
  fs.writeFileSync(tmpHtml, "<section>x</section>", "utf-8");
  writeMetaSidecar(tmpHtml, { title: "T", author: "A" });
  const read = readMetaSidecar(tmpHtml);
  if (!read || read.title !== "T") throw new Error("[self-test] sidecar 读写失败");
  fs.unlinkSync(tmpHtml);
  fs.unlinkSync(`${tmpHtml}.meta.json`);

  console.log("render-wechat-html self-test passed (10 cases)");
}

function runCli() {
  const args = parseArgs(process.argv.slice(2));
  if (args.selfTest) {
    selfTest();
    return;
  }
  if (!args.input) {
    console.error(
      "Usage: node scripts/render-wechat-html.mjs <input.html> [-o output.html] [--meta-out file.meta.json] [--title <title>] [--skip-frontmatter] [--self-test]",
    );
    process.exit(1);
  }
  const inputPath = path.resolve(args.input);
  const ext = path.extname(inputPath).toLowerCase();
  // render 只处理 HTML（清洗 + 加根 section + 标题去重 + 结构检查），不做 markdown → HTML 转换。
  // .md 请走 layout-html.mjs 调模型排版。
  if (ext === ".md" || ext === ".markdown") {
    console.error("❌ render-wechat-html.mjs 不处理 .md 源稿（不做 markdown→HTML 转换）。");
    console.error("   .md 请走：node scripts/layout-html.mjs --input draft.md --output dist/wechat.html --images-dir images");
    console.error("   render 只用于：清洗手写或 AI 排版后的 .html");
    process.exit(2);
  }
  const raw = fs.readFileSync(inputPath, "utf8");

  // 1. 解析 frontmatter / meta（在 sanitize 之前，否则 <meta>/<title> 会被剥）
  //    HTML 文件极少带 YAML frontmatter，但 loadSourceWithMeta 会同时探测 frontmatter 和 <meta>/<title>，兼容到位。
  const { meta, body, hadFrontmatter } = args.skipFrontmatter
    ? { meta: {}, body: raw, hadFrontmatter: false }
    : loadSourceWithMeta(inputPath, raw);

  // 2. 渲染：保证 <section> 根容器 + 清理危险标签
  let out = ensureWechatRoot(body);

  // 3. 兜底：如果命令行/frontmatter 给了 title，把 body 开头的重复标题块剥掉
  const effectiveTitle = args.title || meta.title || "";
  if (effectiveTitle) {
    const r = stripLeadingTitle(out, effectiveTitle);
    if (r.stripped) {
      console.error(`[render-wechat] stripLeadingTitle 命中，删除：${r.removed.join(" / ")}`);
      out = r.html;
    }
  }

  // 4. 结构 sanity check（warn 不 throw）
  const check = checkStructureBalance(out);
  if (!check.ok) {
    console.error("[render-wechat] ⚠️  HTML 结构不平衡（不阻断，但建议检查源稿）：");
    for (const issue of check.issues) console.error(`  - ${issue}`);
  }

  // 5. 输出
  if (args.output) {
    const outputPath = path.resolve(args.output);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${out}\n`);
    // 6. 写 sidecar .meta.json（仅当从 frontmatter 提到东西时）
    if (hadFrontmatter && Object.keys(meta).length > 0) {
      const sidecarPath = args.metaOut ? path.resolve(args.metaOut) : `${outputPath}.meta.json`;
      fs.writeFileSync(sidecarPath, `${JSON.stringify(meta, null, 2)}\n`, "utf-8");
      console.error(`[render-wechat] sidecar 已写：${sidecarPath}`);
    }
  } else {
    process.stdout.write(`${out}\n`);
  }
}

// 守卫：仅当本文件被作为入口直接执行时才跑 CLI；被 import 时不污染。
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
  runCli();
}
