# 微信公众号自动发布（wechat-auto-publisher）

从选题到公众号草稿箱，一站式跑完的 Agent 技能。

## 能力

- 🔍 **联网调研**：近 7 天资料自动检索 + 来源溯源
- ✍️ **AI 长文写作**：默认按"数字生命卡兹克"风格写（可换）
- 🖼️ **合规配图**：只挑授权清晰的图，强制署名
- 🎨 **AI 智能排版**（v4+）：Gemini 协议中转，输出公众号兼容的 inline-style HTML
- ✨ **frontmatter 工作流**（v11 新增）：标题/副标题/作者/摘要走 `.md` 头部 frontmatter，**不再混进正文**
- 🔒 **三层加固**（v11 新增）：源稿层剥离 + 渲染层 sanity check + 发布层标题去重兜底，杜绝"正文 H1 + 后台标题"双标题
- 📤 **草稿发布**：上传图 → 写草稿箱（**不群发、不发布、不定时**）

## 快速开始

### 1. 安装

```bash
git clone https://github.com/chuanfan-ai/wechat-auto-publisher.git
cd wechat-auto-publisher
npm init -y   # 可选，scripts 是纯 ESM 不需要依赖
```

### 2. 初始化凭证

```bash
node scripts/init-config.mjs
```

按提示输入：

- `WECHAT_APP_ID`（公众号 AppID）
- `WECHAT_APP_SECRET`(公众号 AppSecret)

凭证存在 `~/.wechat-auto-publisher/.env`，**不要 commit**。

### 3. 写 .md 源稿（v11 推荐 frontmatter 格式）

```markdown
---
title: 新茶饮出海 2.0：霸王茶姬向左，喜茶向右
subtitle: 2026 年中国茶饮全球化的三个真相
author: 船帆
digest: 上周一篇文章刷屏，讲新茶饮出海。
---

上周有篇文章刷屏……（从这里开始才是正文，**不要再写 # 一级标题**）

## 一、霸王茶姬的本土化路线

文化先行，店面深度本地化……
```

**关键**：标题等元信息全部进 frontmatter，正文里不要写 H1 大标题——避免最终在公众号上出现"正文 H1 + 后台标题字段"的双重显示。

### 4. 走 AI 排版（v4+ 推荐流程）

```bash
# 准备 LAYOUT_API_KEY（不 commit 到 git，建议 export 临时用）
export LAYOUT_API_KEY="sk-xxxxxxxx"

# 把图放 images/ 目录（脚本会自动按文件名排序编号）
#   images/01-cover.jpg  images/02-asean.jpg  images/03-tea.jpg ...

# 跑 AI 排版（自动剥离 frontmatter + 写 sidecar）
node scripts/layout-html.mjs \
  --input draft.md \
  --output dist/wechat.html \
  --images-dir images/

# 输出会同时生成：
#   dist/wechat.html              排版后 HTML（不含 H1）
#   dist/wechat.html.meta.json    sidecar（title / subtitle / author / digest）

# 跑发布（自动读 sidecar，不需要 --title）
node scripts/publish-draft.mjs \
  dist/wechat.html \
  --cover images/01-cover.jpg \
  --images-dir .
```

输出会带 `media_id`（草稿的 media_id，不是发布后的），到公众号后台草稿箱里能看到。

### 5. 走正则清洗器（手写 HTML 时用）

```bash
# 自己写好 HTML（可在头部加 <meta name="title" content="...">）
node scripts/render-wechat-html.mjs input.html -o dist/wechat.html --title "标题"
node scripts/publish-draft.mjs dist/wechat.html --cover cover.jpg
```

`render-wechat-html.mjs` **不处理 .md**（不做 markdown→HTML 转换），传 `.md` 会被拒。`.md` 一律走 `layout-html.mjs`。

## 元信息优先级（v11）

`publish-draft.mjs` 按 4 级优先级解析 title/subtitle/author/digest：

| 优先级 | 来源 | 适用场景 |
|---|---|---|
| 1（最高） | CLI args（`--title` / `--subtitle` / `--author` / `--digest`） | 临时覆盖 |
| 2 | sidecar `<output>.html.meta.json` | 标准流程（`layout-html.mjs` 自动写） |
| 3 | HTML `<meta name="...">` 标签 | 兼容外部生成器 |
| 4 | HTML `<title>` / `<h1>` 兜底 | 老 HTML，没元信息 |
| 5 | 文件名兜底 | 都没有时 |

发布时日志会标出每个字段的来源：

```text
[wechat-auto] meta 解析：
  title:    新茶饮出海 2.0：霸王茶姬向左，喜茶向右    (来源: sidecar)
  author:   船帆   (来源: sidecar)
  digest:   上周一篇文章刷屏，讲新茶饮出海。    (来源: sidecar)
```

## 三层加固（v11）

杜绝"正文 H1 + 后台标题"双标题的三道防线：

| 层 | 文件 | 做什么 |
|---|---|---|
| 1. 源稿层 | `.md` 头部 frontmatter | 标题/副标题/作者/摘要物理上不进正文 |
| 2. 渲染层 | `layout-html.mjs` | 解析 frontmatter，body 不含标题再喂给 Gemini，模型看不到标题就不会生成 H1 |
| 3. 发布层 | `publish-draft.mjs` | `stripLeadingTitle` 兜底：扫前 2000 字符的 H1/H2/H3，文本跟 title 相似就删（含紧随的 `<hr>` 和短副标题 `<p>`） |

附加：`checkStructureBalance` 检测 `<section>`/`<div>` 开闭不平衡，捕获 `</div>` 错位、漏闭合等 bug（不阻断，只警告）。

## 强约束开关 require_frontmatter

在 `~/.wechat-auto-publisher/config.json` 设置：

```json
{ "require_frontmatter": true }
```

开启后：

- `layout-html.mjs` 拒绝没有 `---` frontmatter 头的 `.md` 源稿
- `publish-draft.mjs` 拒绝既没有 sidecar `.meta.json`、也没有 `--title` 的发布请求

默认 `false`（向后兼容）。**建议团队稳定使用 frontmatter 工作流后开启**。

## 关键文件

```
wechat-auto-publisher/
├── SKILL.md                       # 给 Agent 看的技能说明
├── README.md                      # 本文件
├── CHANGELOG.md                   # 版本日志
├── LICENSE                        # MIT
├── package.json
├── .env.example                   # 凭证样例（中文注释）
├── .gitignore
├── agents/
│   └── openai.yaml                # Agent 平台元数据
├── references/
│   ├── image-policy.md            # 图片授权策略（中文）
│   ├── khazix-writing.md          # 卡兹克写作工作流（中文）
│   └── wechat-layout.md           # 公众号排版规则（中文）
└── scripts/
    ├── init-config.mjs            # 首次运行配置
    ├── config.mjs                 # 凭证/配置加载 + defaultConfig（v11：加 require_frontmatter）
    ├── render-wechat-html.mjs     # 正则清洗器 + frontmatter + sanity check（v11 升级）
    ├── layout-html.mjs            # AI 智能排版 + frontmatter 剥离 + sidecar 写入（v11 升级）
    └── publish-draft.mjs          # 4 级元信息优先级 + 标题去重兜底 + 上传图 + 写草稿（v11 升级）
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
- **不要 commit** 任何 `WECHAT_APP_ID` / `WECHAT_APP_SECRET` / API key
- `.gitignore` 已经忽略 `.env` 和 `.wechat-auto-publisher/`
- 在 chat / issue / 文档里贴出的 key 视为已泄露，请测试完到对应后台 rotate

## 失败处理速查

| 错误 | 处理 |
| --- | --- |
| `Missing WECHAT_APP_ID or WECHAT_APP_SECRET` | 跑 `node scripts/init-config.mjs` |
| `40164 invalid ip ... not in whitelist` | 脚本会自动打印当前出口 IP 和白名单加白页面 URL，照着加白 |
| 出口 IP 经常变 | 加一段 CIDR（如 `115.190.0.0/16`）或用 `--show-ip` 先确认再跑 |
| `Missing LAYOUT_API_KEY` | `export LAYOUT_API_KEY="sk-xxxx"` 后重跑 |
| `require_frontmatter 已开启，但没有找到 .meta.json sidecar` | 在 `.md` 头部加 frontmatter，或临时 `--title`，或关闭开关 |
| 公众号上出现双标题 | 检查源稿是否有 `# 标题`，改用 frontmatter 工作流 |
| `render-wechat-html.mjs 不处理 .md 源稿` | `.md` 走 `layout-html.mjs`，不要直接给 render |
| `⚠️ HTML 结构不平衡` 警告 | 检查源稿里有没有写错的 `</div>`（应为 `</section>`）或漏闭合标签 |
| 图片上传失败 | 检查图是否被本地损坏、格式是否 jpg/png/gif/webp |
| 跑脚本 silent exit 0 完全无输出 | v11 已修；如果还遇到请确认在 v11 之后版本 |

## 许可

MIT — 详见 [LICENSE](./LICENSE)。

卡兹克写作风格 adapter 派生自 `KKKKhazix/khazix-skills`、`khazix-writer`（MIT）。

## 作者

chuanfan-ai — https://github.com/chuanfan-ai
