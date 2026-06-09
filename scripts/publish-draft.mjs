#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig, loadCredentials } from "./config.mjs";
import { ensureWechatRoot } from "./render-wechat-html.mjs";

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
  const args = { html: "", title: "", author: "", digest: "", cover: "", sourceUrl: "", imagesDir: "", showIp: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--title" && argv[i + 1]) args.title = argv[++i];
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

function extractTitle(htmlPath, html) {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) return titleMatch[1].trim();
  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match) return h1Match[1].replace(/<[^>]+>/g, "").trim();
  return path.basename(htmlPath, path.extname(htmlPath));
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
    console.error("Usage: node scripts/publish-draft.mjs <article.html> --title <title> --cover <cover.jpg> [--images-dir <dir>] [--show-ip]");
    process.exit(1);
  }
  const htmlPath = path.resolve(args.html);
  const htmlDir = path.dirname(htmlPath);
  // 修：--images-dir 显式覆盖 HTML 内 <img src="..."> 的相对基准目录。
  // 不传时用 HTML 所在目录（dist/wechat.html → dist/）。
  // 传了时用传入目录（如 ./images），HTML 里的 "images/01.jpg" 会被解析为 <imagesDir>/images/01.jpg。
  // 传 article.html 所在项目根目录的 images/ 目录最稳。
  const imageBase = args.imagesDir ? path.resolve(args.imagesDir) : htmlDir;
  const rawHtml = fs.readFileSync(htmlPath, "utf8");
  // 修：把 entry 脚本目录加入查找链。
  const config = loadConfig(process.cwd(), [ENTRY_DIR]);
  const { appId, appSecret } = loadCredentials(process.cwd(), [ENTRY_DIR]);
  const title = args.title || extractTitle(htmlPath, rawHtml);
  if (!args.cover) throw new Error("Cover image required: pass --cover <path>");

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
  let html = ensureWechatRoot(rawHtml);
  html = await uploadBodyImages(html, accessToken, imageBase);

  console.error(`[wechat-auto] uploading cover: ${args.cover}`);
  // 封面：--cover 一般是绝对路径或相对 cwd 路径，单独用 cwd 解析。
  const coverPath = path.isAbsolute(args.cover) ? args.cover : path.resolve(process.cwd(), args.cover);
  const coverResp = await uploadImage(coverPath, accessToken, path.dirname(coverPath), "material");
  if (!coverResp.media_id) throw new Error("Cover upload did not return media_id");

  console.error("[wechat-auto] creating draft");
  const draft = await createDraft({
    accessToken,
    title,
    author: args.author,
    digest: args.digest,
    content: html,
    thumbMediaId: coverResp.media_id,
    sourceUrl: args.sourceUrl,
    config,
  });

  console.log(JSON.stringify({
    success: true,
    media_id: draft.media_id,
    title,
    target: "draft",
  }, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
