#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, loadCredentials } from "./config.mjs";
import {
  ensureWechatRoot,
  stripLeadingTitle,
  checkStructureBalance,
  extractMetaFromHtml,
  readMetaSidecar,
} from "./render-wechat-html.mjs";

const TOKEN_URL = "https://api.weixin.qq.com/cgi-bin/token";
const UPLOAD_BODY_IMG_URL = "https://api.weixin.qq.com/cgi-bin/media/uploadimg";
const UPLOAD_MATERIAL_URL = "https://api.weixin.qq.com/cgi-bin/material/add_material";
const DRAFT_URL = "https://api.weixin.qq.com/cgi-bin/draft/add";
const IP_LOOKUP_URL = "https://api.ipify.org?format=json";
// 公众号后台 → 设置与开发 → 基本配置 → 公众号开发信息 → IP 白名单
const WHITELIST_HELP_URL = "https://mp.weixin.qq.com/cgi-bin/setting?action=dev&t=dev/base&lang=zh_CN";

const MIME_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
};

// 修：把 entry 脚本所在目录作为凭证查找链的一环，
// 不管 cwd 是哪个目录启动 publish，都能找到随 skill 打包的 .env。
const ENTRY_DIR = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const args = {
    html: "",
    title: "",
    subtitle: "",
    author: "",
    digest: "",
    cover: "",
    sourceUrl: "",
    imagesDir: "",
    showIp: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--title" && argv[i + 1]) args.title = argv[++i];
    // v11 新增 --subtitle，可被 frontmatter 的 subtitle 字段覆盖／覆盖。
    else if (arg === "--subtitle" && argv[i + 1]) args.subtitle = argv[++i];
    else if (arg === "--author" && argv[i + 1]) args.author = argv[++i];
    else if ((arg === "--digest" || arg === "--summary") && argv[i + 1]) args.digest = argv[++i];
    else if (arg === "--cover" && argv[i + 1]) args.cover = argv[++i];
    else if (arg === "--source-url" && argv[i + 1]) args.sourceUrl = argv[++i];
    // 修：--images-dir 显式指定 HTML 内 <img src="..."> 的相对基准目录，
    // 解决"HTML 在 dist/ 下、图片在项目根 images/ 下"时相对路径解析错位的问题。
    else if (arg === "--images-dir" && argv[i + 1]) args.imagesDir = argv[++i];
    // 修：--show-ip 启动时主动打印出口 IP，方便加白名单前先确认要加哪个。
    else if (arg === "--show-ip") args.showIp = true;
    else if (!arg.startsWith("-")) args.html = arg;
  }
  return args;
}

async function fetchJson(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON from WeChat API: HTTP ${res.status}`);
  }
  if (!res.ok || (data.errcode && data.errcode !== 0)) {
    const err = new Error(`WeChat API error ${data.errcode || res.status}: ${data.errmsg || res.statusText}`);
    err.errcode = data.errcode;
    err.errmsg = data.errmsg;
    throw err;
  }
  return data;
}

async function getAccessToken(appId, appSecret) {
  const url = `${TOKEN_URL}?grant_type=client_credential&appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(appSecret)}`;
  const data = await fetchJson(url);
  if (!data.access_token) throw new Error("WeChat API did not return access_token");
  return data.access_token;
}

async function detectPublicIp() {
  // 通过 ipify 查询当前出口 IP（云电脑/容器场景下基本能拿到公网 IP）。
  // 拿不到也不阻塞主流程——拿不到就别打 IP 那行了。
  try {
    const res = await fetch(IP_LOOKUP_URL, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.json();
    return data.ip || null;
  } catch {
    return null;
  }
}

function isWhitelistError(err) {
  if (!err) return false;
  if (err.errcode === 40164) return true;
  const msg = String(err.errmsg || err.message || "");
  return /invalid\s+ip/i.test(msg) || /not in whitelist/i.test(msg);
}

function printWhitelistHelp(currentIp) {
  console.error("\n┌─ 微信 IP 白名单未通过 ─────────────────────────────────");
  if (currentIp) {
    console.error(`│ 当前调用方出口 IP: ${currentIp}`);
  } else {
    console.error("│ 当前调用方出口 IP: (无法自动检测，请自行确认)");
  }
  console.error("│ 错误: 40164 (invalid ip … not in whitelist)");
  console.error("│");
  console.error("│ 解决步骤：");
  console.error("│ 1. 打开公众号后台：" + WHITELIST_HELP_URL);
  console.error("│ 2. 路径：设置与开发 → 基本配置 → 公众号开发信息 → IP 白名单");
  console.error("│ 3. 把上面那个出口 IP 加进去（如果有多个，全部加上）");
  console.error("│ 4. 加完后重跑本命令（其他参数不用改）");
  console.error("│");
  console.error("│ 注意：云电脑/容器出口 IP 经常变；如果频繁变，");
  console.error("│       建议一次性加一段（如 115.190.0.0/16）或联系平台方确认 IP 段。");
  console.error("│ 也可以用 --show-ip 先确认再跑。");
  console.error("└────────────────────────────────────────────────────────\n");
}

async function loadImageAsset(imagePath, baseDir) {
  if (/^https?:\/\//i.test(imagePath)) {
    const res = await fetch(imagePath);
    if (!res.ok) throw new Error(`Failed to download image: ${imagePath}`);
    const buffer = Buffer.from(await res.arrayBuffer());
    const urlPath = new URL(imagePath).pathname;
    const filename = path.basename(urlPath) || "image.jpg";
    const ext = path.extname(filename).toLowerCase();
    return {
      buffer,
      filename,
      contentType: res.headers.get("content-type") || MIME_TYPES[ext] || "image/jpeg",
    };
  }
  const resolved = path.isAbsolute(imagePath) ? imagePath : path.resolve(baseDir, imagePath);
  const buffer = fs.readFileSync(resolved);
  const filename = path.basename(resolved);
  const ext = path.extname(filename).toLowerCase();
  return { buffer, filename, contentType: MIME_TYPES[ext] || "image/jpeg" };
}

async function uploadImage(imagePath, accessToken, baseDir, type) {
  const asset = await loadImageAsset(imagePath, baseDir);
  const form = new FormData();
  form.append("media", new Blob([asset.buffer], { type: asset.contentType }), asset.filename);
  const uploadUrl = type === "body" ? UPLOAD_BODY_IMG_URL : UPLOAD_MATERIAL_URL;
  const url = `${uploadUrl}?type=image&access_token=${encodeURIComponent(accessToken)}`;
  const data = await fetchJson(url, { method: "POST", body: form });
  if (data.url && data.url.startsWith("http://")) data.url = data.url.replace(/^http:\/\//i, "https://");
  return data;
}

async function uploadBodyImages(html, accessToken, baseDir) {
  const imgRegex = /<img[^>]*\ssrc=["']([^"']+)["'][^>]*>/gi;
  const uploaded = new Map();
  let updated = html;
  for (const match of [...html.matchAll(imgRegex)]) {
    const [fullTag, src] = match;
    if (!src || src.startsWith("https://mmbiz.qpic.cn")) continue;
    let resp = uploaded.get(src);
    if (!resp) {
      console.error(`[wechat-auto] uploading body image: ${src}`);
      resp = await uploadImage(src, accessToken, baseDir, "body");
      uploaded.set(src, resp);
    }
    updated = updated.replace(fullTag, fullTag.replace(/\ssrc=["'][^"']+["']/, ` src="${resp.url}"`));
  }
  return updated;
}

// v11：4 级元信息优先级解析。
// 优先级（高 → 低）：
//   1. CLI args（--title / --subtitle / --author / --digest）—— 命令行最强，能即时覆盖任何文件内容
//   2. sidecar .meta.json —— layout-html.mjs / render-wechat-html.mjs 从 frontmatter 写入
//   3. HTML <meta name="title|subtitle|author|digest" content="..."> —— 兼容外部生成器的格式
//   4. <title> / <h1> 兜底 —— 最后一招
//   5. 文件名兜底 —— 都没有时
// 注意：rawHtml 必须是 sanitize 之前的原始字符串，否则 <meta>/<title> 已被剥不到。
function resolveMeta({ args, htmlPath, rawHtml }) {
  const cli = {
    title: args.title || "",
    subtitle: args.subtitle || "",
    author: args.author || "",
    digest: args.digest || "",
  };
  const sidecar = readMetaSidecar(htmlPath) || {};
  const htmlMeta = extractMetaFromHtml(rawHtml) || {};

  // 兜底
  const fallback = {};
  if (!cli.title && !sidecar.title && !htmlMeta.title) {
    const h1 = rawHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (h1) fallback.title = h1[1].replace(/<[^>]+>/g, "").trim();
    else fallback.title = path.basename(htmlPath, path.extname(htmlPath));
  }

  const pick = (k) => cli[k] || sidecar[k] || htmlMeta[k] || fallback[k] || "";
  const resolved = {
    title: pick("title"),
    subtitle: pick("subtitle"),
    author: pick("author"),
    digest: pick("digest"),
  };

  // 来源标注（写日志用，不进 article 字段）
  const sourceOf = (k) =>
    cli[k] ? "cli"
    : sidecar[k] ? "sidecar"
    : htmlMeta[k] ? "html-meta"
    : fallback[k] ? "fallback"
    : "none";
  resolved._sources = {
    title: sourceOf("title"),
    subtitle: sourceOf("subtitle"),
    author: sourceOf("author"),
    digest: sourceOf("digest"),
  };
  return resolved;
}

function truncateDigest(digest) {
  if (!digest) return "";
  if (digest.length <= 120) return digest;
  // 修：优先按标点截断到 ≤117 字再加省略号，避免在句子中间硬切。
  const slice = digest.slice(0, 120);
  const stops = ["。", "！", "？", "…", ";", ";"];
  let cut = -1;
  for (const ch of stops) {
    const i = slice.lastIndexOf(ch);
    if (i > cut) cut = i;
  }
  if (cut >= 80) return `${slice.slice(0, cut + 1)}...`;
  return `${slice.slice(0, 117)}...`;
}

async function createDraft({ accessToken, title, author, digest, content, thumbMediaId, sourceUrl, config }) {
  const article = {
    article_type: "news",
    title,
    content,
    thumb_media_id: thumbMediaId,
    need_open_comment: config.need_open_comment ?? 1,
    only_fans_can_comment: config.only_fans_can_comment ?? 0,
  };
  if (author) article.author = author;
  if (digest) article.digest = truncateDigest(digest);
  if (sourceUrl) article.content_source_url = sourceUrl;

  return fetchJson(`${DRAFT_URL}?access_token=${encodeURIComponent(accessToken)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ articles: [article] }),
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.html) {
    console.error("Usage: node scripts/publish-draft.mjs <article.html> [--title <t>] [--subtitle <s>] [--author <a>] [--digest <d>] --cover <cover.jpg> [--images-dir <dir>] [--source-url <url>] [--show-ip]");
    process.exit(1);
  }
  const htmlPath = path.resolve(args.html);
  const htmlDir = path.dirname(htmlPath);
  // 修：--images-dir 显式覆盖 HTML 内 <img src="..."> 的相对基准目录。
  const imageBase = args.imagesDir ? path.resolve(args.imagesDir) : htmlDir;
  const rawHtml = fs.readFileSync(htmlPath, "utf8");
  const config = loadConfig(process.cwd(), [ENTRY_DIR]);
  const { appId, appSecret } = loadCredentials(process.cwd(), [ENTRY_DIR]);

  // v11：4 级元信息解析（必须在 sanitize 之前用 rawHtml）
  const meta = resolveMeta({ args, htmlPath, rawHtml });

  // v11：require_frontmatter 强约束
  // 没有 sidecar，命令行也没传 --title → 拒绝执行，提示用 frontmatter。
  if (config.require_frontmatter) {
    const hasSidecar = readMetaSidecar(htmlPath) !== null;
    const hasCliTitle = !!args.title;
    if (!hasSidecar && !hasCliTitle) {
      console.error("❌ require_frontmatter 已开启，但没有找到 .meta.json sidecar，也没有 --title 参数。");
      console.error("   修复：");
      console.error("   1) 推荐：在 .md 源稿头部加 frontmatter（title / subtitle / author / digest），由 layout-html.mjs / render-wechat-html.mjs 自动生成 sidecar。");
      console.error("   2) 临时：传 --title <标题> 强制覆盖。");
      console.error("   3) 关闭强约束：把 config.json 的 require_frontmatter 设为 false。");
      process.exit(2);
    }
  }

  console.error(`[wechat-auto] meta 解析：`);
  console.error(`  title:    ${meta.title}    (来源: ${meta._sources.title})`);
  if (meta.author) console.error(`  author:   ${meta.author}   (来源: ${meta._sources.author})`);
  if (meta.digest) console.error(`  digest:   ${meta.digest.slice(0, 40)}${meta.digest.length > 40 ? "..." : ""}    (来源: ${meta._sources.digest})`);

  if (!args.cover) throw new Error("Cover image required: pass --cover <path>");

  // v11：把本地 HTML 处理提前到 fetch token 之前，
  // 让 stripLeadingTitle / checkStructureBalance 的警告先打出来——
  // 即使后面 token / 网络挂了，用户也能先看到结构问题。
  // 1. 渲染：保证 <section> 根容器 + 危险标签剥离
  let html = ensureWechatRoot(rawHtml);

  // 2. v11 三层加固之第 3 层：标题去重兜底
  //    即使源稿写了 H1（手抖、AI 排版漏剥），这一步也能把开头的重复标题剥掉。
  const stripResult = stripLeadingTitle(html, meta.title);
  if (stripResult.stripped) {
    console.error(`[wechat-auto] ⚠️  正文开头检测到重复标题，已自动剥离：${stripResult.removed.join(" / ")}`);
    console.error(`[wechat-auto]    建议在源稿层修复（用 frontmatter 替代正文 H1）`);
    html = stripResult.html;
  }

  // 3. v11：结构 sanity check（warn 不阻断）
  //    曾经的 bug：input-v13.html 引言 section 里 </section> 写成了 </div>，
  //    一路误闭合到第一个图片包装 section，渲染成"空框"。
  const balance = checkStructureBalance(html);
  if (!balance.ok) {
    console.error("[wechat-auto] ⚠️  HTML 结构不平衡（不阻断，但发布出去样式可能错位）：");
    for (const issue of balance.issues) console.error(`  - ${issue}`);
    console.error("[wechat-auto]    建议：检查源稿里有没有写错的 </div>（应为 </section>）或漏掉的闭合标签。");
  }

  if (args.showIp) {
    const ip = await detectPublicIp();
    console.error(`[wechat-auto] current egress IP: ${ip || "(unable to detect)"}`);
  }

  console.error("[wechat-auto] fetching access token");
  let accessToken;
  try {
    accessToken = await getAccessToken(appId, appSecret);
  } catch (err) {
    // 修：40164 时主动打友好提示，不再让用户自己猜为什么是 invalid ip。
    if (isWhitelistError(err)) {
      const ip = await detectPublicIp();
      printWhitelistHelp(ip);
    }
    throw err;
  }

  // 4. 上传正文图（token 拿到才能上传）
  html = await uploadBodyImages(html, accessToken, imageBase);

  console.error(`[wechat-auto] uploading cover: ${args.cover}`);
  // 封面：--cover 一般是绝对路径或相对 cwd 路径，单独用 cwd 解析。
  const coverPath = path.isAbsolute(args.cover) ? args.cover : path.resolve(process.cwd(), args.cover);
  const coverResp = await uploadImage(coverPath, accessToken, path.dirname(coverPath), "material");
  if (!coverResp.media_id) throw new Error("Cover upload did not return media_id");

  console.error("[wechat-auto] creating draft");
  const draft = await createDraft({
    accessToken,
    title: meta.title,
    author: meta.author,
    digest: meta.digest,
    content: html,
    thumbMediaId: coverResp.media_id,
    sourceUrl: args.sourceUrl,
    config,
  });

  console.log(JSON.stringify({
    success: true,
    media_id: draft.media_id,
    title: meta.title,
    subtitle: meta.subtitle || undefined,
    author: meta.author || undefined,
    target: "draft",
  }, null, 2));
}

// 守卫：仅当本文件被作为入口直接执行时才跑 main。
// 修（v11）：原写法 `process.argv[1] === fileURLToPath(import.meta.url)` 在 macOS 上失效——
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
