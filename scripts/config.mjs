import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const APP_DIR = ".wechat-auto-publisher";

export function homeDir() {
  return process.env.HOME || process.env.USERPROFILE || os.homedir();
}

export function configPaths(cwd = process.cwd(), extraDirs = []) {
  // 查找顺序：调用方传入的额外目录 → cwd → HOME
  const extra = extraDirs.map((d) => ({
    dir: d,
    config: path.join(d, APP_DIR, "config.json"),
    env: path.join(d, APP_DIR, ".env"),
  }));
  return {
    userDir: path.join(homeDir(), APP_DIR),
    userConfig: path.join(homeDir(), APP_DIR, "config.json"),
    userEnv: path.join(homeDir(), APP_DIR, ".env"),
    projectDir: path.join(cwd, APP_DIR),
    projectConfig: path.join(cwd, APP_DIR, "config.json"),
    projectEnv: path.join(cwd, APP_DIR, ".env"),
    extra,
  };
}

export function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function readEnvIfExists(filePath) {
  const values = {};
  if (!fs.existsSync(filePath)) return values;
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf("=");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

export function loadConfig(cwd = process.cwd(), extraDirs = []) {
  const p = configPaths(cwd, extraDirs);
  const merged = { ...defaultConfig() };
  for (const k of [p.userConfig, p.projectConfig, ...p.extra.map((e) => e.config)]) {
    Object.assign(merged, readJsonIfExists(k));
  }
  return merged;
}

export function loadCredentials(cwd = process.cwd(), extraDirs = []) {
  const p = configPaths(cwd, extraDirs);
  const env = {};
  for (const k of [p.userEnv, p.projectEnv, ...p.extra.map((e) => e.env), ""]) {
    if (k === "") {
      Object.assign(env, process.env);
    } else {
      Object.assign(env, readEnvIfExists(k));
    }
  }
  const appId = String(env.WECHAT_APP_ID || "").trim();
  const appSecret = String(env.WECHAT_APP_SECRET || "").trim();
  if (!appId || !appSecret) {
    throw new Error("Missing WECHAT_APP_ID or WECHAT_APP_SECRET. Run: node scripts/init-config.mjs");
  }
  return { appId, appSecret };
}

// v12 起：读外部 API key（同时供排版和生图用）。返回字符串（可能为空，调用方判断）。
// 通过 config.external_api.api_key_env 决定读哪个环境变量名，默认 EXTERNAL_API_KEY。
export function loadExternalApiKey(cwd = process.cwd(), extraDirs = [], config = null) {
  const p = configPaths(cwd, extraDirs);
  const env = {};
  for (const k of [p.userEnv, p.projectEnv, ...p.extra.map((e) => e.env), ""]) {
    if (k === "") {
      Object.assign(env, process.env);
    } else {
      Object.assign(env, readEnvIfExists(k));
    }
  }
  const cfg = config || loadConfig(cwd, extraDirs);
  const keyEnv = (cfg.external_api && cfg.external_api.api_key_env) || "EXTERNAL_API_KEY";
  return String(env[keyEnv] || "").trim();
}

export function defaultConfig() {
  return {
    // v12：首次配置完成标记。init-config.mjs 写入时设 true。
    // SKILL.md 让 agent 启动时检测：false → 引导对话；true → 跳过引导。
    setup_completed: false,

    // v12：模式开关
    // layout_mode: external 调外部 API（推荐）/ self Agent 自己用当前模型排
    layout_mode: "external",
    // image_mode: external 调外部 API 生图 / self Agent 自己尝试 / manual 手动找图
    image_mode: "external",

    // v12：统一外部 API 配置。排版和生图都走这同一个 host + key。
    external_api: {
      api_base: "https://chuanfanai.com",
      api_key_env: "EXTERNAL_API_KEY",
      // 排版
      layout_model: "gemini-3.1-flash-lite",
      // 生图（OpenAI Images API 协议，POST /v1/images/generations）
      image_gen_model: "gpt-image-2",
      image_gen_endpoint: "/v1/images/generations",
      image_gen_size: "1024x1024",
      image_gen_quality: "low",
      image_gen_format: "jpeg"
    },

    // v11 标题去重三层加固
    require_frontmatter: false,

    // v12 配图硬约束
    require_images: true,
    min_images: 3,

    publish_method: "api",
    source_window_days: 7,
    need_open_comment: 1,
    only_fans_can_comment: 0,
    writing_style: {
      identity: "digital-life-khazix",
      reader: "对 AI 和新技术保持好奇的公众号读者",
      tone: "真诚、口语化、有判断、有活人感",
      length: "4000-8000字",
      structure: "具体事件切入，层层展开，结尾回环"
    },
    image_policy: {
      reusable_rights_required: true,
      attribution_required: true
    }
  };
}
