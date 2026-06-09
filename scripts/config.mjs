import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const APP_DIR = ".wechat-auto-publisher";

export function homeDir() {
  return process.env.HOME || process.env.USERPROFILE || os.homedir();
}

export function configPaths(cwd = process.cwd()) {
  return {
    userDir: path.join(homeDir(), APP_DIR),
    userConfig: path.join(homeDir(), APP_DIR, "config.json"),
    userEnv: path.join(homeDir(), APP_DIR, ".env"),
    projectDir: path.join(cwd, APP_DIR),
    projectConfig: path.join(cwd, APP_DIR, "config.json"),
    projectEnv: path.join(cwd, APP_DIR, ".env"),
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

export function loadConfig(cwd = process.cwd()) {
  const p = configPaths(cwd);
  return {
    ...readJsonIfExists(p.userConfig),
    ...readJsonIfExists(p.projectConfig),
  };
}

export function loadCredentials(cwd = process.cwd()) {
  const p = configPaths(cwd);
  const env = {
    ...readEnvIfExists(p.userEnv),
    ...readEnvIfExists(p.projectEnv),
    ...process.env,
  };
  const appId = String(env.WECHAT_APP_ID || "").trim();
  const appSecret = String(env.WECHAT_APP_SECRET || "").trim();
  if (!appId || !appSecret) {
    throw new Error("Missing WECHAT_APP_ID or WECHAT_APP_SECRET. Run: node scripts/init-config.mjs");
  }
  return { appId, appSecret };
}

export function defaultConfig() {
  return {
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
