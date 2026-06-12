---
name: wechat-auto-publisher
description: 微信公众号端到端草稿创建技能。当用户想从选题开始生成公众号文章时使用：首次运行用 4 步中文引导收集配置（公众号凭证 + 排版模式 + 生图模式 + 可选 API key）、检索近期资料、按"卡兹克"风格写长文、调外部 API 或自带模型生图、调外部 API 或自带模型排版、上传图片、保存到公众号草稿箱。本技能只创建草稿，绝不自动群发或定时发布。
---

# 微信公众号自动发布（wechat-auto-publisher）

从选题到公众号草稿箱，一站式完成。

## 角色与对话风格

你是用户的写作 + 排版助手。所有对用户的对话**一律用中文**，不要把 `external` / `self` / `manual` 等英文枚举值直接抛给用户——内部用，对外用中文说。

## 启动检查（每次会话开头都做）

读 `~/.wechat-auto-publisher/config.json`：

- **不存在 或 `setup_completed != true`** → 进入下面的"首次配置 4 步引导"
- **已存在且 setup_completed=true** → 跳过引导，按下面的"默认流程"走

## 首次配置（4 步中文引导）

这 4 个问题按顺序问，每问一个等用户答完再问下一个。回答中给用户清晰的选择 + 一句话解释，**永远不要丢英文枚举值**。

### 第 1 步：公众号凭证

> 请粘贴你的公众号 AppID 和 AppSecret。
>
> 在微信公众号后台 → **设置与开发 → 基本配置 → 公众号开发信息** 里能找到。两者都是字符串，分两行发给我即可。

收集：`WECHAT_APP_ID` / `WECHAT_APP_SECRET`

### 第 2 步：排版模式

> 排版用哪一种？
>
> **① 调外部 API（推荐）**：用一个 API key 调 chuanfanai.com 的 Gemini 中转网关，自动排好，省事；
> **② 我自己排**：我（Agent）用当前对话的模型按规则手工排成 HTML，不调外部，但耗你这边对话 token。
>
> 选 ① 还是 ②？

- 用户选 ①（推荐）→ 内部值 `external`
- 用户选 ②（自排）→ 内部值 `self`

### 第 3 步：生图模式

> 配图用哪一种？默认要求每篇文章至少 3 张图。
>
> **① 调外部 API 生图（推荐）**：跟排版同一个 API key，调 chuanfanai.com 的 gpt-image-2 自动生图；
> **② 我自己生图**：我（Agent）用自带的生图能力或写描述清单让你对照配图；
> **③ 我手动配图**：我按授权清晰的网络图源（Wikimedia/Unsplash/Pexels 等）找好图。

- 用户选 ① → 内部值 `external`
- 用户选 ② → 内部值 `self`
- 用户选 ③ → 内部值 `manual`

### 第 4 步：外部 API key（仅当 2/3 题里有任意一题选了 ①）

> 排版或生图你选了"调外部 API"，请粘贴 chuanfanai.com 的 API key（一把 key 同时管两件事）。
>
> 没有就到 https://chuanfanai.com 申请一个，再回来发给我。

收集：`EXTERNAL_API_KEY`

如果两道题都没选外部，则跳过这一步。

### 收集完落盘

把上面收到的字段拼成 CLI 调用：

```bash
node scripts/init-config.mjs \
  --wechat-app-id "$APP_ID" \
  --wechat-app-secret "$APP_SECRET" \
  --layout-mode <external|self> \
  --image-mode <external|self|manual> \
  [--external-api-key "$KEY"]
```

或走 stdin JSON 模式：

```bash
echo '{
  "wechat_app_id": "...",
  "wechat_app_secret": "...",
  "layout_mode": "external",
  "image_mode": "external",
  "external_api_key": "..."
}' | node scripts/init-config.mjs --write -
```

落盘后告诉用户：

> 已配好。`~/.wechat-auto-publisher/` 下生成了 `config.json` 和 `.env`，含敏感信息不要 commit 到 git。

## 默认流程（已配置完成后）

1. 告诉用户默认检索窗口是近 7 天
2. 联网搜索近期有来源的资料
3. 按"数字生命卡兹克"风格写长文（`references/khazix-writing.md`）
4. 删掉卡兹克原文里的个人公众号引流尾巴
5. **配图先行**（v12 顺序调整）：根据 draft 内容写 `images/prompts.json`，再按 `image_mode` 跑 `generate-images.mjs`
6. **排版后置**：图齐了再 `layout-html.mjs`（默认 `require_images: true` + `min_images: 3`，不够会报错）
7. 把标题/副标题/作者/摘要写到 .md frontmatter，正文不再写 H1 大标题（v11 三层加固）
8. 排成公众号兼容的 HTML（inline-style），同时写 sidecar `.meta.json`
9. 上传正文图 + 封面图到公众号
10. **只存草稿箱**——不群发、不发布、不定时

## 决策矩阵

每一步该跑哪个脚本，按 `config.json` 里的 mode 决定：

| 步骤 | layout_mode | image_mode | 脚本 |
|---|---|---|---|
| 生图 | — | external | `node scripts/generate-images.mjs --output-dir images/` |
| 生图 | — | self | `node scripts/generate-images.mjs` → 转写 `images/descriptions.md`，agent 自带工具生图或人工 |
| 生图 | — | manual | agent 按 `references/image-policy.md` 找网络授权图 |
| 排版 | external | — | `node scripts/layout-html.mjs --input draft.md --output dist/wechat.html --images-dir images/` |
| 排版 | self | — | 两阶段：先 `--mode prompt-only` 吐 prompt → agent 自排 → `--mode postprocess --raw <agent写的HTML>` |
| 发布 | — | — | `node scripts/publish-draft.mjs dist/wechat.html --cover images/01-cover.jpg --images-dir .` |

## frontmatter 协议（v11 关键）

`.md` 源稿必须使用 frontmatter 协议，否则会出现"正文 H1 + 公众号后台标题"双重显示：

```markdown
---
title: 新茶饮出海 2.0：霸王茶姬向左，喜茶向右
subtitle: 2026 年中国茶饮全球化的三个真相
author: 船帆
digest: 上周一篇文章刷屏，讲新茶饮出海。
---

上周有篇文章刷屏……（从这里开始才是正文）

## 一、霸王茶姬的本土化路线

文化先行……
```

四个字段含义：

| 字段 | 用途 | 必填 |
|---|---|---|
| `title` | 公众号后台标题字段 | 强烈推荐 |
| `subtitle` | 副标题（可选，未来扩展用） | 否 |
| `author` | 公众号后台作者字段 | 否 |
| `digest` | 公众号后台摘要字段（≤ 120 字，超出按标点智能截断） | 否 |

`layout-html.mjs` 自动剥离 frontmatter、把 body（不含标题）传给模型，输出 HTML 时旁边写一份 sidecar `<output>.html.meta.json`，`publish-draft.mjs` 自动读取。

## 配图（v12 重写）

**默认硬约束**：每篇文章至少 3 张图，不够 `layout-html.mjs` 会拒绝排版。如用户明确说"这篇不要图"，在 `layout-html.mjs` 加 `--no-images`。

### image_mode = external（推荐）

agent 工作流：

1. 读完 draft.md 后，根据章节内容写 `images/prompts.json`（数组，每项含 `name` 和 `prompt`）
2. 跑 `node scripts/generate-images.mjs --output-dir images/`
3. 检查 `images/` 里有 ≥ 3 张图

prompts.json 怎么写见 `references/image-policy.md` 的 ① AI 生图章节。

### image_mode = self

`generate-images.mjs` 不调任何 API，只把 prompts.json 转成 `images/descriptions.md`。

agent 工作流：

1. 写 `images/prompts.json`，跑 `generate-images.mjs` 转成 `descriptions.md`
2. 用 agent 自带的生图工具按 descriptions 生图，每张图按 `name` 字段命名存到 `images/`
3. 如果 agent 没有生图能力，把 descriptions 告诉用户，让用户对照人工配图

### image_mode = manual

agent 按 `references/image-policy.md` 的"② 网络授权图片"那节，找授权清晰的图：Wikimedia Commons、Unsplash、Pexels、Pixabay、官方素材包。

每张图记录：

- 本地路径或 URL
- 来源 URL
- 作者/创作者
- 授权平台/许可
- 图片下方的署名文案

## 排版（v12 重写）

排版阶段必须输出纯 HTML + inline-style + 单层 `<section>` 根。

### layout_mode = external（推荐）

```bash
node scripts/layout-html.mjs \
  --input draft.md \
  --output dist/wechat.html \
  --images-dir images/
```

输出：

- `dist/wechat.html` —— 排版后的 HTML，不含 H1 大标题
- `dist/wechat.html.meta.json` —— sidecar，从 frontmatter 提取的 title/subtitle/author/digest

### layout_mode = self（两阶段）

**阶段 1**：吐 prompt 给 agent

```bash
node scripts/layout-html.mjs --mode prompt-only \
  --input draft.md \
  --images-dir images/
```

stdout 会输出两段：`=== SYSTEM INSTRUCTION ===` 和 `=== USER PROMPT ===`。

agent 把这两段送给自己的模型，让模型按规则把 markdown 排成 HTML，写到 `dist/wechat.html.raw`。

**阶段 2**：脚本接 agent 的草稿，回填占位符 + 写 sidecar

```bash
node scripts/layout-html.mjs --mode postprocess \
  --input draft.md \
  --raw dist/wechat.html.raw \
  --output dist/wechat.html \
  --images-dir images/
```

排版规则是 `references/layout-prompt.md` 的单一源——脚本和 agent 自排都从这个文件读，永远不脱节。

### 手写 HTML 时走清洗器

```bash
node scripts/render-wechat-html.mjs input.html -o dist/wechat.html --title "标题"
```

`render-wechat-html.mjs` 在 v11 后不再处理 `.md`，传 `.md` 会被拒。

## 草稿发布

最终 HTML 就绪、图到位之后再发：

```bash
# 标准流程（自动读 sidecar，不需要 --title）
node scripts/publish-draft.mjs dist/wechat.html \
  --cover path/to/cover.jpg \
  [--images-dir path/to/images] \
  [--show-ip]

# 临时覆盖元信息
node scripts/publish-draft.mjs dist/wechat.html \
  --title "临时标题" \
  --author "作者" \
  --digest "摘要" \
  --cover path/to/cover.jpg
```

脚本会自动：

- 加载本地公众号凭证（用户级 → 项目级 → skill 级 → process.env）
- 按 4 级优先级解析 title/subtitle/author/digest（详见下文）
- 加根 `<section>` + 剥危险标签
- 三层加固之第 3 层：`stripLeadingTitle` 兜底
- 结构 sanity check：检测 `<section>`/`<div>` 不平衡（不阻断）
- 拿 `access_token` → 上传图 → 写草稿
- 遇到 `40164 invalid ip` → 自动检测出口 IP 并打印白名单加白步骤
- 加 `--show-ip` 启动时先打印出口 IP

### 元信息 4 级优先级

| 优先级 | 来源 | 适用 |
|---|---|---|
| 1（最高） | CLI args（`--title` / `--subtitle` / `--author` / `--digest`） | 临时覆盖 |
| 2 | sidecar `<output>.html.meta.json` | 标准流程（`layout-html.mjs` 写） |
| 3 | HTML `<meta name="...">` 标签 | 兼容外部生成器 |
| 4 | HTML `<title>` / `<h1>` | 兜底 |
| 5 | 文件名 | 都没有时 |

## 强约束开关

`~/.wechat-auto-publisher/config.json`：

```json
{
  "require_frontmatter": true,
  "require_images": true,
  "min_images": 3
}
```

- `require_frontmatter`（v11 加，默认 `false`）开启后 `layout-html.mjs` 拒绝没 frontmatter 的 .md
- `require_images`（v12 加，默认 `true`）和 `min_images`（默认 `3`）控制配图硬约束，`--no-images` 显式跳过

## 失败处理

- 缺凭证 → 走首次配置 4 步引导
- IP 白名单错（`errcode: 40164`）→ 脚本自动打印出口 IP 和加白页面，照着加
- 出口 IP 经常变 → 加一段 CIDR（如 `115.190.0.0/16`），或先 `--show-ip` 确认
- 图片授权不清 → 跳过这张
- 缺 `EXTERNAL_API_KEY` → 重跑 `init-config.mjs` 或 `export EXTERNAL_API_KEY="..."`
- 公众号 API 报错 → 把 `errcode` 和 `errmsg` 报给用户，不要泄露凭证
- 公众号出现双标题 → 检查源稿是否有 `# 标题`，改用 frontmatter；publish 阶段已有 stripLeadingTitle 兜底
- HTML 结构不平衡警告 → 检查源稿里有写错的 `</div>`（应为 `</section>`）或漏闭合
- `render-wechat-html.mjs` 拒绝处理 `.md` → `.md` 走 `layout-html.mjs`
- 图不够 3 张 → AI 生图 / 手动找图 / `--no-images` / 改 `min_images`（4 选 1）
- 脚本 silent exit 0 完全无输出 → v11 已修 macOS symlink main guard

## 自定义排版细节（给维护者）

### 单一信任源：references/layout-prompt.md

`layout-html.mjs` 启动时按二级标题切片，读 `## SYSTEM INSTRUCTION` 和 `## USER PROMPT TEMPLATE` 两段。

self 模式下 agent 也读这份文件，两端共享同一份规则。

### 占位符协议

图片用中文方括号字面量：

```text
【图片位_0】  →  images/01-cover.jpg
【图片位_1】  →  images/02-asean.jpg
...
```

模型按编号挑图，不写 `<img>` 标签。main 拿到 HTML 后做统一回填。

为什么用中文方括号：英文 `IMG_PLACEHOLDER_X` 会被 Gemini 当成 src 路径直接写进 `<img src="IMG_PLACEHOLDER_X">`，中文括号不会。

### 字数硬约束

排版后正文字数（剥标签后）必须 ≥ 原文清洗后字数的 95%。模型被 prompt 明确禁止摘要、改写、合并段落。

### 配置文件覆盖

`~/.wechat-auto-publisher/config.json`：

```json
{
  "layout_mode": "external",
  "image_mode": "external",
  "external_api": {
    "api_base": "https://chuanfanai.com",
    "api_key_env": "EXTERNAL_API_KEY",
    "layout_model": "gemini-3.1-flash-lite",
    "image_gen_model": "gpt-image-2",
    "image_gen_endpoint": "/v1/images/generations",
    "image_gen_size": "1024x1024",
    "image_gen_quality": "low",
    "image_gen_format": "jpeg"
  }
}
```

### 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `WECHAT_APP_ID` / `WECHAT_APP_SECRET` | 是 | 公众号 API |
| `EXTERNAL_API_KEY` | 当 layout 或 image mode 选 external 时 | chuanfanai.com 一把 key 管两件事 |
| `LAYOUT_API_KEY` | 否 | v11 老变量名，v12 仍兼容作为兜底 |

## 三层加固内部细节（v11，给维护者看）

### 第 1 层：源稿层

- `parseFrontmatter(text)` 在 `render-wechat-html.mjs` 里实现
- 极简 YAML 解析：只支持 `key: value` 单行字符串
- 支持引号包裹

### 第 2 层：渲染层

- `stripLeadingTitle(html, title)` 在前 2000 字符里找第一个 `<h1>/<h2>/<h3>`
- 文本归一化对比："完全相同 / normalized 相同 / 一方是另一方子串（长度比 ≥ 0.6）"
- 命中就删除该 H 标签 + 紧随的 `<hr>` 装饰线 + 紧跟的短副标题 `<p>`
- `checkStructureBalance(html)` 统计 `<section>` 和 `<div>` 开闭数量，不平衡就 warn 但不 throw
- self-test 覆盖 10 个 case：`node scripts/render-wechat-html.mjs --self-test`

### 第 3 层：发布层

- `resolveMeta` 实现 4 级优先级，附带 `_sources` 标记每个字段来源
- 主流程在 `getAccessToken` 之前调 `stripLeadingTitle` 和 `checkStructureBalance`
- `require_frontmatter` 开关在 `loadConfig` 之后立即检查

## 脚本说明（给维护者看）

- `scripts/init-config.mjs` v12 改非交互 CLI flags，agent 来收集字段后调
- `scripts/render-wechat-html.mjs` 用 `isMainModule()` 守卫，只在被入口直接执行时跑 CLI
- `scripts/publish-draft.mjs` 同样用 `isMainModule()`；封面路径相对 cwd 解析
- `scripts/layout-html.mjs` v12 加 `--mode external/prompt-only/postprocess` 三种子模式，prompt 从 `references/layout-prompt.md` 读
- `scripts/generate-images.mjs` v12 新增，按 `image_mode` 分 external/self/manual 三条路径
- 所有脚本：`fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)` 是跨平台正确的 main guard 写法
