# 微信公众号自动发布（wechat-auto-publisher）

从选题到公众号草稿箱，一站式跑完的 Agent 技能。

## 能力

- 🔍 **联网调研**：近 7 天资料自动检索 + 来源溯源
- ✍️ **AI 长文写作**：默认按"数字生命卡兹克"风格写（可换）
- 🎨 **AI 智能排版**（v4+ / v12 改造）：两条路径——调外部 API 或 Agent 自带模型
- 🖼️ **AI 生图**（v12 新增）：调外部 API（gpt-image-2）/ Agent 自带 / 手动找图，三选一
- ✨ **frontmatter 工作流**（v11）：标题/副标题/作者/摘要走 .md frontmatter，不混进正文
- 🔒 **三层加固**（v11）：源稿层剥离 + 渲染层 sanity check + 发布层标题去重兜底
- 📤 **草稿发布**：上传图 → 写草稿箱（**不群发、不发布、不定时**）

## v12 核心改变

| 改变 | 原因 |
|---|---|
| 初始化改 4 步中文引导（Agent 来问） | 终端不再交互，平台没人在终端答题 |
| 统一 `EXTERNAL_API_KEY`（替代 `LAYOUT_API_KEY`） | 排版和生图共用一把 key，少配置一个变量 |
| 新增 `scripts/generate-images.mjs`（AI 生图入口） | 之前只有手动找图一条路，覆盖不全 |
| 排版 prompt 剥离到 `references/layout-prompt.md` | 脚本和 Agent 自排共享单一源，永不脱节 |
| 默认 `require_images: true` + `min_images: 3` | 纯文字公众号文章可读性差，强制门槛 |
| 排版 `--mode external / prompt-only / postprocess` | self 模式两阶段：脚本吐 prompt → Agent 自排 → 脚本回填占位符 |

老用户仍可继续用 v11 LAYOUT_API_KEY（脚本兼容兜底）；v12 主要面向新用户。

## 快速开始

### 1. 安装

```bash
git clone https://github.com/chuanfan-ai/wechat-auto-publisher.git
cd wechat-auto-publisher
npm init -y   # 可选，scripts 是纯 ESM 不需要依赖
```

### 2. 首次配置（v12 新流程）

在 Agent 平台（Coze / Claude Code 等）里调用本技能，Agent 会用 4 步中文引导收集：

1. **公众号凭证**：AppID + AppSecret（公众号后台 → 基本配置）
2. **排版模式**：① 调外部 API（推荐）/ ② Agent 自己排
3. **生图模式**：① 调外部 API（推荐）/ ② Agent 自己生图 / ③ 手动找图
4. **外部 API key**：仅当 2 或 3 任意选 ① 时填，chuanfanai.com 一把 key 管两件事

Agent 收齐字段后调：

```bash
node scripts/init-config.mjs \
  --wechat-app-id "wx..." \
  --wechat-app-secret "..." \
  --layout-mode external \
  --image-mode external \
  --external-api-key "sk-..."
```

凭证存在 `~/.wechat-auto-publisher/` 下的 `config.json` + `.env`，**不要 commit**。

### 3. 写 .md 源稿（frontmatter 工作流）

```markdown
---
title: 新茶饮出海 2.0：霸王茶姬向左，喜茶向右
subtitle: 2026 年中国茶饮全球化的三个真相
author: 船帆
digest: 上周一篇文章刷屏，讲新茶饮出海。
---

上周有篇文章刷屏……（从这里开始才是正文，**不要再写 # 一级标题**）

## 一、霸王茶姬的本土化路线

文化先行……
```

### 4. 配图（v12 新流程：先配图再排版）

#### 4a. AI 生图（image_mode = external）

让 Agent 根据 draft.md 写 `images/prompts.json`：

```json
[
  { "name": "01-cover.jpg", "prompt": "霸王茶姬曼谷店开幕，写实摄影风格，黄昏暖色" },
  { "name": "02-asean.jpg", "prompt": "东南亚地图与茶饮 logo 拼接，扁平插画风" },
  { "name": "03-tea.jpg", "prompt": "茉莉绿茶特写，茶汤透亮，自然光" }
]
```

然后跑：

```bash
node scripts/generate-images.mjs --output-dir images/
```

#### 4b. Agent 自带生图（image_mode = self）

`generate-images.mjs` 不调 API，转写 `images/descriptions.md` 让 Agent 自带工具生图。

#### 4c. 手动找图（image_mode = manual）

按 `references/image-policy.md` 找授权图片。

### 5. 排版

#### 5a. 调外部 API（layout_mode = external，推荐）

```bash
node scripts/layout-html.mjs \
  --input draft.md \
  --output dist/wechat.html \
  --images-dir images/
```

输出：

- `dist/wechat.html` —— 排版后 HTML（不含 H1）
- `dist/wechat.html.meta.json` —— sidecar（title / subtitle / author / digest）

#### 5b. Agent 自排（layout_mode = self，两阶段）

```bash
# 阶段 1：脚本吐 prompt
node scripts/layout-html.mjs --mode prompt-only \
  --input draft.md --images-dir images/
# Agent 把 prompt 送进自己的模型，HTML 写到 dist/wechat.html.raw

# 阶段 2：脚本回填占位符 + 写 sidecar
node scripts/layout-html.mjs --mode postprocess \
  --input draft.md \
  --raw dist/wechat.html.raw \
  --output dist/wechat.html \
  --images-dir images/
```

### 6. 跑发布

```bash
node scripts/publish-draft.mjs \
  dist/wechat.html \
  --cover images/01-cover.jpg \
  --images-dir .
```

输出会带 `media_id`（草稿的 media_id，不是发布后的），到公众号后台草稿箱里能看到。

## 决策矩阵

| 步骤 | layout_mode | image_mode | 跑的脚本 |
|---|---|---|---|
| 生图 | — | external | `generate-images.mjs` 调 chuanfanai.com |
| 生图 | — | self | `generate-images.mjs` 转写 descriptions，Agent 自带工具或人工 |
| 生图 | — | manual | Agent 按 image-policy 找网络授权图 |
| 排版 | external | — | `layout-html.mjs`（默认全自动） |
| 排版 | self | — | `layout-html.mjs --mode prompt-only` → Agent 自排 → `--mode postprocess` |
| 发布 | — | — | `publish-draft.mjs` |

## 配图硬约束（v12）

默认每篇文章至少 3 张图，不够 `layout-html.mjs` 会拒绝排版并打印 4 种修复方式：

1. AI 生图（推荐）
2. 手动找图
3. `--no-images` 显式跳过
4. 改 `config.min_images` 或 `require_images: false`

## 元信息优先级（v11）

`publish-draft.mjs` 按 4 级优先级解析 title/subtitle/author/digest：

| 优先级 | 来源 | 适用 |
|---|---|---|
| 1（最高） | CLI args | 临时覆盖 |
| 2 | sidecar `<output>.html.meta.json` | 标准流程 |
| 3 | HTML `<meta name="...">` | 兼容外部生成器 |
| 4 | HTML `<title>` / `<h1>` | 兜底 |
| 5 | 文件名 | 都没有时 |

## 三层加固（v11）

杜绝"正文 H1 + 后台标题"双标题的三道防线：

| 层 | 文件 | 做什么 |
|---|---|---|
| 1. 源稿层 | `.md` 头部 frontmatter | 标题等元信息物理上不进正文 |
| 2. 渲染层 | `layout-html.mjs` | 解析 frontmatter，body 不含标题再喂模型，模型不会生成 H1 |
| 3. 发布层 | `publish-draft.mjs` | `stripLeadingTitle` 兜底：扫前 2000 字符的 H1/H2/H3 |

附加：`checkStructureBalance` 检测 `<section>`/`<div>` 不平衡（不阻断，只警告）。

## 强约束开关

`~/.wechat-auto-publisher/config.json`：

```json
{
  "require_frontmatter": true,
  "require_images": true,
  "min_images": 3
}
```

- `require_frontmatter`（v11，默认 `false`）开启后拒绝没 frontmatter 的 .md
- `require_images`（v12，默认 `true`）+ `min_images`（默认 `3`）控制配图硬约束

## 关键文件

```
wechat-auto-publisher/
├── SKILL.md                       # 给 Agent 看的技能说明（v12 加 4 步引导）
├── README.md                      # 本文件
├── CHANGELOG.md                   # 版本日志
├── LICENSE                        # MIT
├── package.json
├── .env.example                   # 凭证样例（v12：EXTERNAL_API_KEY）
├── .gitignore
├── agents/
│   └── openai.yaml                # Agent 平台元数据
├── references/
│   ├── image-policy.md            # 图片授权策略（v12 加 AI 生图章节）
│   ├── khazix-writing.md          # 卡兹克写作工作流
│   ├── wechat-layout.md           # 公众号排版规则
│   └── layout-prompt.md           # v12 新增：排版 prompt 单一源
└── scripts/
    ├── init-config.mjs            # v12：CLI flags 非交互初始化
    ├── config.mjs                 # 凭证/配置加载 + loadExternalApiKey（v12 加）
    ├── render-wechat-html.mjs     # 正则清洗器 + frontmatter + sanity check（v11）
    ├── layout-html.mjs            # AI 智能排版 + v12 三种 mode（external/prompt-only/postprocess）
    ├── generate-images.mjs        # v12 新增：AI 生图入口（external/self/manual）
    └── publish-draft.mjs          # 4 级元信息优先级 + 标题去重兜底 + 上传图 + 写草稿（v11）
```

## 安全红线（硬约束）

本技能**只写草稿箱**，不会：

- ❌ 群发
- ❌ 定时发布
- ❌ 自动发布
- ❌ 公开任何凭证到日志

图片授权不清就**跳过**，不硬塞。

## 凭证安全

- 真实凭证一律放本地 `.env` 或 `process.env`
- **不要 commit** 任何 `WECHAT_APP_ID` / `WECHAT_APP_SECRET` / `EXTERNAL_API_KEY` / `LAYOUT_API_KEY`
- `.gitignore` 已忽略 `.env` 和 `.wechat-auto-publisher/`
- 在 chat / issue / 文档里贴出的 key 视为已泄露，请测试完到对应后台 rotate

## 失败处理速查

| 错误 | 处理 |
| --- | --- |
| `Missing WECHAT_APP_ID or WECHAT_APP_SECRET` | 让 Agent 走 4 步引导，或直接 `node scripts/init-config.mjs --help` |
| `40164 invalid ip ... not in whitelist` | 脚本自动打印出口 IP 和加白页面，照着加 |
| 出口 IP 经常变 | 加一段 CIDR（如 `115.190.0.0/16`），或 `--show-ip` 先确认 |
| `❌ 排版模式 external，但没找到 API key` | `export EXTERNAL_API_KEY="..."` 或重跑 `init-config.mjs` |
| `❌ 配图不足` | AI 生图 / 手动找图 / `--no-images` / 改 `min_images`（4 选 1） |
| `require_frontmatter 已开启，但没找到 sidecar` | 在 .md 头部加 frontmatter，或临时 `--title`，或关闭开关 |
| 公众号上出现双标题 | 检查源稿是否有 `# 标题`，改用 frontmatter 工作流 |
| `render-wechat-html.mjs 不处理 .md 源稿` | `.md` 走 `layout-html.mjs` |
| `⚠️ HTML 结构不平衡` 警告 | 检查源稿里有没有写错的 `</div>`（应为 `</section>`）或漏闭合 |
| 图片上传失败 | 检查图是否损坏、格式是否 jpg/png/gif/webp |
| 跑脚本 silent exit 0 完全无输出 | v11 已修；如还遇到请确认在 v11 之后版本 |

## 许可

MIT — 详见 [LICENSE](./LICENSE)。

卡兹克写作风格 adapter 派生自 `KKKKhazix/khazix-skills`、`khazix-writer`（MIT）。

## 作者

chuanfan-ai — https://github.com/chuanfan-ai
