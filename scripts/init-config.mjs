#!/usr/bin/env node
// scripts/init-config.mjs
//
// 首次运行配置。v12 起：
//   - 不用 readline 交互（agent 平台没人在终端答题），改用 CLI flags
//   - agent 在 SKILL.md 引导下跟用户中文对话，收集到答案后非交互调本脚本
//   - 写入 ~/.wechat-auto-publisher/config.json + .env
//   - 设置 setup_completed: true，后续命令不再触发首次配置
//
// 用法（agent 调）：
//   node scripts/init-config.mjs \
//     --wechat-app-id "wx..." \
//     --wechat-app-secret "..." \
//     --layout-mode external \
//     --image-mode external \
//     --external-api-key "sk-..."
//
// 也支持从 stdin / 文件读 JSON（给复杂场景）：
//   echo '{"wechat_app_id":"...","layout_mode":"external",...}' | node scripts/init-config.mjs --write -

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { configPaths, defaultConfig } from "./config.mjs";

function parseArgs(argv) {
  const args = {
    wechatAppId: "",
    wechatAppSecret: "",
    layoutMode: "",
    imageMode: "",
    externalApiKey: "",
    writeJson: "",
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--help" || a === "-h") args.help = true;
    else if (a === "--wechat-app-id" && argv[i + 1]) args.wechatAppId = argv[++i];
    else if (a === "--wechat-app-secret" && argv[i + 1]) args.wechatAppSecret = argv[++i];
    else if (a === "--layout-mode" && argv[i + 1]) args.layoutMode = argv[++i];
    else if (a === "--image-mode" && argv[i + 1]) args.imageMode = argv[++i];
    else if (a === "--external-api-key" && argv[i + 1]) args.externalApiKey = argv[++i];
    else if (a === "--write" && argv[i + 1]) args.writeJson = argv[++i];
  }
  return args;
}

function printHelp() {
  console.log(`用法：node scripts/init-config.mjs [选项]

必填：
  --wechat-app-id <id>          公众号 AppID
  --wechat-app-secret <secret>  公众号 AppSecret
  --layout-mode <mode>          排版模式：external | self
  --image-mode <mode>           生图模式：external | self | manual

可选：
  --external-api-key <key>      外部 API key（layout-mode 或 image-mode 选 external 时必填）

JSON 模式：
  --write <path>                从指定 JSON 文件读字段；用 "-" 表示从 stdin 读
                                JSON 字段：wechat_app_id / wechat_app_secret /
                                          layout_mode / image_mode / external_api_key
示例：
  node scripts/init-config.mjs \\
    --wechat-app-id "wx0123" \\
    --wechat-app-secret "abc" \\
    --layout-mode external \\
    --image-mode external \\
    --external-api-key "sk-..."
`);
}

function readJsonInput(source) {
  if (source === "-") {
    return JSON.parse(fs.readFileSync(0, "utf-8"));
  }
  return JSON.parse(fs.readFileSync(path.resolve(source), "utf-8"));
}

function mergeFromJson(args, json) {
  if (json.wechat_app_id) args.wechatAppId = json.wechat_app_id;
  if (json.wechat_app_secret) args.wechatAppSecret = json.wechat_app_secret;
  if (json.layout_mode) args.layoutMode = json.layout_mode;
  if (json.image_mode) args.imageMode = json.image_mode;
  if (json.external_api_key) args.externalApiKey = json.external_api_key;
  return args;
}

function validate(args) {
  const errs = [];
  if (!args.wechatAppId) errs.push("缺少 --wechat-app-id（公众号 AppID）");
  if (!args.wechatAppSecret) errs.push("缺少 --wechat-app-secret（公众号 AppSecret）");
  const validLayout = ["external", "self"];
  const validImage = ["external", "self", "manual"];
  if (!args.layoutMode) {
    errs.push("缺少 --layout-mode（排版模式：external | self）");
  } else if (!validLayout.includes(args.layoutMode)) {
    errs.push(`--layout-mode 取值无效：${args.layoutMode}（应为 ${validLayout.join(" / ")}）`);
  }
  if (!args.imageMode) {
    errs.push("缺少 --image-mode（生图模式：external | self | manual）");
  } else if (!validImage.includes(args.imageMode)) {
    errs.push(`--image-mode 取值无效：${args.imageMode}（应为 ${validImage.join(" / ")}）`);
  }
  const needsKey = args.layoutMode === "external" || args.imageMode === "external";
  if (needsKey && !args.externalApiKey) {
    errs.push("排版或生图选了 external 模式，必须传 --external-api-key");
  }
  return errs;
}

function writeIfNeeded(filePath, content, mode = 0o600) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const existed = fs.existsSync(filePath);
  fs.writeFileSync(filePath, content, { mode });
  return existed ? "已更新" : "已创建";
}

function main() {
  let args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (args.writeJson) {
    try {
      const json = readJsonInput(args.writeJson);
      args = mergeFromJson(args, json);
    } catch (e) {
      console.error(`❌ --write 读取 JSON 失败：${e.message}`);
      process.exit(2);
    }
  }

  const errs = validate(args);
  if (errs.length > 0) {
    console.error("❌ 配置参数有问题：");
    for (const e of errs) console.error(`   - ${e}`);
    console.error("");
    console.error("跑 `node scripts/init-config.mjs --help` 看用法。");
    process.exit(2);
  }

  const paths = configPaths();
  fs.mkdirSync(paths.userDir, { recursive: true });

  // 1. 写 config.json（基于 defaultConfig + 用户选择的 mode）
  const config = defaultConfig();
  config.setup_completed = true;
  config.layout_mode = args.layoutMode;
  config.image_mode = args.imageMode;

  const configStatus = writeIfNeeded(paths.userConfig, `${JSON.stringify(config, null, 2)}\n`);

  // 2. 写 .env
  const envLines = [
    `WECHAT_APP_ID=${args.wechatAppId}`,
    `WECHAT_APP_SECRET=${args.wechatAppSecret}`,
  ];
  if (args.externalApiKey) {
    envLines.push(`EXTERNAL_API_KEY=${args.externalApiKey}`);
  }
  const envStatus = writeIfNeeded(paths.userEnv, `${envLines.join("\n")}\n`);

  console.log("✅ 首次配置完成");
  console.log("");
  console.log(`配置文件 ${configStatus}：${paths.userConfig}`);
  console.log(`  排版模式：${args.layoutMode}`);
  console.log(`  生图模式：${args.imageMode}`);
  console.log("");
  console.log(`密钥文件 ${envStatus}：${paths.userEnv}`);
  console.log(`  WECHAT_APP_ID=${args.wechatAppId.slice(0, 6)}***`);
  console.log(`  WECHAT_APP_SECRET=***（隐藏）`);
  if (args.externalApiKey) {
    console.log(`  EXTERNAL_API_KEY=${args.externalApiKey.slice(0, 6)}***`);
  }
  console.log("");
  console.log("⚠️  这两个文件含敏感信息，**不要 commit 到 git**。");
  console.log("");
  console.log("接下来可以开始发文：");
  console.log("  1. 写 draft.md（头部加 YAML frontmatter：title / author / digest）");
  console.log("  2. 准备图片（按生图模式自动走）");
  console.log("  3. node scripts/layout-html.mjs --input draft.md --output dist/wechat.html");
  console.log("  4. node scripts/publish-draft.mjs dist/wechat.html --cover images/01-cover.jpg");
}

main();
