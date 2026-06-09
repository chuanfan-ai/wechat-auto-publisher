#!/usr/bin/env node
import fs from "node:fs";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { configPaths, defaultConfig } from "./config.mjs";

const paths = configPaths();
fs.mkdirSync(paths.userDir, { recursive: true });

const rl = readline.createInterface({ input, output });

function writeIfMissing(filePath, content) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, content, { mode: 0o600 });
    return "created";
  }
  return "exists";
}

console.log("WeChat Auto Publisher first-run setup");
console.log("Default source window: recent 7 days");
console.log("Default publishing target: WeChat draft box only");
console.log("");

const appId = (await rl.question("WECHAT_APP_ID: ")).trim();
const appSecret = (await rl.question("WECHAT_APP_SECRET: ")).trim();
const reader = (await rl.question("Default reader profile (press Enter for default): ")).trim();
const tone = (await rl.question("Default tone (press Enter for Khazix style): ")).trim();
rl.close();

const config = defaultConfig();
if (reader) config.writing_style.reader = reader;
if (tone) config.writing_style.tone = tone;

const configStatus = writeIfMissing(paths.userConfig, `${JSON.stringify(config, null, 2)}\n`);
const envStatus = writeIfMissing(
  paths.userEnv,
  `WECHAT_APP_ID=${appId}\nWECHAT_APP_SECRET=${appSecret}\n`,
);

console.log("");
console.log(`Config ${configStatus}: ${paths.userConfig}`);
console.log(`Secrets ${envStatus}: ${paths.userEnv}`);
console.log("Do not commit these files.");
