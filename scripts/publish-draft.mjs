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

const MIME_TYPES = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
};

function parseArgs(argv) {
  const args = { html: "", title: "", author: "", digest: "", cover: "", sourceUrl: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--title" && argv[i + 1]) args.title = argv[++i];
    else if (arg === "--author" && argv[i + 1]) args.author = argv[++i];
    else if ((arg === "--digest" || arg === "--summary") && argv[i + 1]) args.digest = argv[++i];
    else if (arg === "--cover" && argv[i + 1]) args.cover = argv[++i];
    else if (arg === "--source-url" && argv[i + 1]) args.sourceUrl = argv[++i];
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
    throw new Error(`WeChat API error ${data.errcode || res.status}: ${data.errmsg || res.statusText}`);
  }
  return data;
}

async function getAccessToken(appId, appSecret) {
  const url = `${TOKEN_URL}?grant_type=client_credential&appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(appSecret)}`;
  const data = await fetchJson(url);
  if (!data.access_token) throw new Error("WeChat API did not return access_token");
  return data.access_token;
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
  if (digest) article.digest = digest.length > 120 ? `${digest.slice(0, 117)}...` : digest;
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
    console.error("Usage: node scripts/publish-draft.mjs <article.html> --title <title> --cover <cover.jpg>");
    process.exit(1);
  }
  const htmlPath = path.resolve(args.html);
  const baseDir = path.dirname(htmlPath);
  const rawHtml = fs.readFileSync(htmlPath, "utf8");
  const config = loadConfig();
  const { appId, appSecret } = loadCredentials();
  const title = args.title || extractTitle(htmlPath, rawHtml);
  if (!args.cover) throw new Error("Cover image required: pass --cover <path>");

  console.error("[wechat-auto] fetching access token");
  const accessToken = await getAccessToken(appId, appSecret);
  let html = ensureWechatRoot(rawHtml);
  html = await uploadBodyImages(html, accessToken, baseDir);

  console.error(`[wechat-auto] uploading cover: ${args.cover}`);
  const coverResp = await uploadImage(args.cover, accessToken, baseDir, "material");
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

