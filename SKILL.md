---
name: wechat-auto-publisher
description: 微信公众号端到端草稿创建技能。当用户想从选题开始生成公众号文章时使用：初始化公众号 API 凭证、检索近期资料、按"卡兹克"风格写长文、挑选可复用授权图片并标注来源、格式化为公众号兼容的内联样式 HTML、上传图片、保存到公众号草稿箱。本技能只创建草稿，绝不自动群发或定时发布。
---

# 微信公众号自动发布（wechat-auto-publisher）

从选题到公众号草稿箱，一站式完成。

## 默认流程

1. 首次运行 → 初始化本地凭证配置
2. 告诉用户默认检索窗口是近 7 天
3. 联网搜索近期有来源的资料
4. 按"数字生命卡兹克"风格写长文
5. 在送排版前，删掉卡兹克原文里的个人公众号引流尾巴（投稿邮箱、互推文案等）
6. 找可复用授权图片并记录来源
7. 在正文自然段插入图片占位符
8. **把标题/副标题/作者/摘要写到 frontmatter，正文不再写 H1 大标题**（v11 推荐）
9. 排成公众号兼容的 HTML（inline-style），同时写 sidecar `.meta.json`
10. 上传正文图 + 封面图到公众号
11. **只存草稿箱**——不群发、不发布、不定时

## 首次运行

如果 `~/.wechat-auto-publisher/config.json` 不存在，先跑：

```bash
node scripts/init-config.mjs
```

凭证存放在本地（**严禁提交到 git**）：

- 用户级配置：`~/.wechat-auto-publisher/config.json`
- 用户级密钥：`~/.wechat-auto-publisher/.env`
- 项目级兜底：`./.wechat-auto-publisher/config.json` 与 `./.wechat-auto-publisher/.env`

不要在生成的文档或记忆里打印、提交或保存真实的 `WECHAT_APP_ID`、`WECHAT_APP_SECRET`、access_token、API key。

默认配置：

- `publish_method`：`api`
- `source_window_days`：`7`
- `need_open_comment`：`1`
- `only_fans_can_comment`：`0`
- `require_frontmatter`：`false`（v11 新增；详见下方"强约束开关"）
- 图片策略：只用授权清晰的图片，必须标注来源

## 调研

本技能依赖近期资料，所以永远要先联网搜。先告诉用户：

> 默认检索近 7 天资料。

收集每条来源的元信息：

- 标题
- URL
- 媒体/网站
- 发布时间（如能拿到）
- 访问时间
- 一句话相关性说明

优先采信一手或权威来源。无法证实的说法不要写成事实。

## 写作

按 `references/khazix-writing.md` 里的卡兹克写作工作流来。

**红线**：

- 文笔、节奏、结构、判断都按卡兹克风格
- 送排版前删掉个人公众号引流尾巴
- 不要保留：`作者：卡兹克`、投稿邮箱、爆料邮箱、个人联系方式、固定的涨粉引导语
- **不要在正文写 H1 一级标题**（标题走 frontmatter，v11）

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

`layout-html.mjs` 会自动剥离 frontmatter、把 body（不含标题）传给模型，输出 HTML 时旁边写一份 sidecar `<output>.html.meta.json`，`publish-draft.mjs` 自动读取。

## 图片

按 `references/image-policy.md` 选图。

只使用授权清晰的图片。接受：Wikimedia Commons、Unsplash、Pexels、Pixabay、官方新闻稿/媒体素材包、其他明确声明可复用的页面。授权不清就跳过。

每张图都要记录：

- 本地路径或 URL
- 来源 URL
- 作者/创作者（如有）
- 授权平台/许可
- 图片下方的署名文案

送排版前用占位符（v11 统一为中文方括号格式，跟 `layout-html.mjs` 实际处理一致）：

```text
【图片位_0】
【图片位_1】
【图片位_2】
```

模型按编号挑图，不写 `<img>` 标签，main 流程统一回填。

## 排版

按 `references/wechat-layout.md` 排。

排版阶段必须输出纯 HTML + inline-style + 单层 `<section>` 根。

### 默认走 AI 排版（推荐）

```bash
node scripts/layout-html.mjs \
  --input draft.md \
  --output dist/wechat.html \
  --images-dir images/
```

输出：

- `dist/wechat.html` —— 排版后的 HTML，**不含 H1 大标题**
- `dist/wechat.html.meta.json` —— sidecar，从 frontmatter 提取的 title/subtitle/author/digest

### 手写 HTML 时走清洗器

```bash
node scripts/render-wechat-html.mjs input.html -o dist/wechat.html --title "标题"
```

`render-wechat-html.mjs` 在 v11 后**不再处理 `.md`**（不做 markdown→HTML 转换），传 `.md` 会被拒。`.md` 一律走 `layout-html.mjs`。

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

- 加载本地公众号凭证（见下面的查找顺序）
- 按 4 级优先级解析 title/subtitle/author/digest（详见下文）
- 加根 `<section>` + 剥危险标签
- **三层加固之第 3 层**：`stripLeadingTitle` 兜底（即使源稿写了 H1 也自动剥）
- **结构 sanity check**：检测 `<section>`/`<div>` 开闭不平衡，发现就警告（不阻断）
- 拿 `access_token`
- 用 `media/uploadimg` 上传正文图
- 用 `material/add_material` 上传封面
- 用 `draft/add` 写入草稿
- 默认开启评论
- 遇到 `40164 invalid ip ... not in whitelist` → 自动检测调用方出口 IP 并打印白名单加白步骤
- 加 `--show-ip` 启动时先打印出口 IP，方便先确认再加白名单
- 加 `--images-dir <dir>` 指定 HTML 内 `<img src="...">` 的相对基准目录（默认用 HTML 所在目录，HTML 在 `dist/`、图在项目根 `images/` 时传项目根的 `images/`）

如果没指定封面，只有在图授权清晰的前提下，才从正文里挑一张合适的当封面。

### 元信息 4 级优先级（v11）

| 优先级 | 来源 | 适用 |
|---|---|---|
| 1（最高） | CLI args（`--title` / `--subtitle` / `--author` / `--digest`） | 临时覆盖 |
| 2 | sidecar `<output>.html.meta.json` | 标准流程（`layout-html.mjs` 写） |
| 3 | HTML `<meta name="...">` 标签 | 兼容外部生成器 |
| 4 | HTML `<title>` / `<h1>` | 兜底 |
| 5 | 文件名 | 都没有时 |

发布时日志会标出每个字段的来源，方便诊断：

```text
[wechat-auto] meta 解析：
  title:    新茶饮出海 2.0：...    (来源: sidecar)
  author:   船帆   (来源: sidecar)
```

### 凭证查找顺序

`scripts/config.mjs` 按这个顺序找 `WECHAT_APP_ID` / `WECHAT_APP_SECRET`（后面的覆盖前面的）：

1. `~/.wechat-auto-publisher/.env`（用户级）
2. `./.wechat-auto-publisher/.env`（项目级，相对 cwd）
3. `<skill_dir>/.wechat-auto-publisher/.env`（skill 级，跟着入口脚本走）
4. `process.env`

第 3 项的妙处：凭证文件可以放在 `publish-draft.mjs` 旁边，不管 cwd 在哪都能找到。彻底告别"复制 `.env` 到工作目录"的 workaround。

## 强约束开关 require_frontmatter（v11 新增）

在 `~/.wechat-auto-publisher/config.json` 设置：

```json
{ "require_frontmatter": true }
```

开启后：

- `layout-html.mjs` 拒绝没有 `---` frontmatter 头的 `.md` 源稿，提示加 frontmatter
- `publish-draft.mjs` 拒绝既没有 sidecar `.meta.json`、也没有 `--title` 的发布请求

默认 `false`（向后兼容）。**建议团队稳定使用 frontmatter 工作流后开启**，作为最后一道"防遗漏"。

## 失败处理

- 缺凭证 → 跑首次运行
- IP 白名单错（`errcode: 40164`）→ 脚本会自动打印友好提示和当前出口 IP。到 **设置与开发 → 基本配置 → 公众号开发信息 → IP 白名单** 把那个 IP 加进去，再重跑（其他参数不用改）。不要瞎猜
- 云电脑/容器出口 IP 会变 → 白名单老翻车时，加一段 CIDR（如 `115.190.0.0/16`），或先用 `--show-ip` 确认再跑
- 图片授权不清 → 跳过这张
- 事实来源不清 → 标"不确定"或删掉
- 公众号 API 报错 → 把 `errcode` 和 `errmsg` 报出来，不要泄露凭证
- **公众号出现双标题** → 检查源稿是否有 `# 标题`，改用 frontmatter；publish 阶段已经有 `stripLeadingTitle` 兜底，如果还出现说明源稿层也漏了
- **HTML 结构不平衡警告** → 检查源稿里是否有写错的 `</div>`（应为 `</section>`）或漏闭合标签
- **render-wechat-html.mjs 拒绝处理 .md** → `.md` 走 `layout-html.mjs`，不要直接给 render

## 自定义排版（Gemini 协议中转，v4 新增、v11 升级）

`scripts/layout-html.mjs` 的核心思路：

- **不调内置正则清洗器**——直接调 chuanfanai.com 的 Gemini 协议中转
- **system prompt 控制视觉**：阿里蓝 #1677ff + 日落橙 #FF7A00、4 套 UI 组件、6 条微信底层规范
- **图片走占位符协议**：用中文方括号 `【图片位_N】`，main 统一回填 `<section><img></section>`，不依赖原稿里的 `![](xxx)` 标记
- **v11 frontmatter 剥离**：模型只看 body 不看标题，永远不生成 H1

### 用法

```bash
# 1. 准备 LAYOUT_API_KEY（不 commit 到 git，建议 export 临时用）
export LAYOUT_API_KEY="sk-xxxxxxxx"

# 2. 把图放 images/ 目录（脚本会自动按文件名排序编号）
#    images/01-cover.jpg  images/02-asean.jpg  images/03-tea.jpg ...

# 3. 跑排版（自动剥离 frontmatter + 写 sidecar）
node scripts/layout-html.mjs \
  --input draft.md \
  --output dist/wechat.html \
  --images-dir images/

# 4. 跑发布（--images-dir 传项目根，不要传 images/）
node scripts/publish-draft.mjs \
  dist/wechat.html \
  --cover images/01-cover.jpg \
  --images-dir .
```

### 参数

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `--input <file>` | 是 | Markdown 原稿路径（相对 cwd） |
| `--output <file>` | 是 | 排版后 HTML 输出路径（相对 cwd） |
| `--images-dir <dir>` | 否 | 图片目录（相对 cwd），默认 `draft.md` 同级 `images/` |
| `--cover <file>` | 否 | 封面文件名（仅用于打印提示） |
| `--stream` | 否 | 走流式端点（边生成边打印） |
| `--no-think` | 否 | 关闭思考（**默认就是关**，省 token） |

### 配置文件

`config.json` 的 `layout_model` 段可覆盖默认：

```json
{
  "layout_model": {
    "api_base": "https://chuanfanai.com",
    "model": "gemini-3.1-flash-lite",
    "api_key_env": "LAYOUT_API_KEY",
    "temperature": 1,
    "top_p": 1,
    "thinking_budget": 26240,
    "system_instruction": "（留空走默认）",
    "prompt_template": "（留空走默认）"
  }
}
```

### 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `LAYOUT_API_KEY` | 是 | chuanfanai.com 的 API key。不进 config.json、不 commit |

### 端点行为（2026-06-09 实测）

- 同步：`POST {api_base}/v1beta/models/{model}:generateContent`
- 流式：`POST {api_base}/v1beta/models/{model}:streamGenerateContent?alt=sse`
- 鉴权：`Authorization: Bearer <key>` 与 URL `?key=<key>` 二选一即可
- 思考片段：`candidates[0].content.parts[i].thought === true` → 跳过
- 真实文本：`candidates[0].content.parts[i].text`（无 thought 字段）
- 思考签名：`parts[i].thoughtSignature` 直接忽略

### 占位符协议

图片用中文方括号字面量（v11 统一约定）：

```text
【图片位_0】  →  images/01-cover.jpg
【图片位_1】  →  images/02-asean.jpg
【图片位_2】  →  images/03-tea.jpg
...
```

模型按编号挑图，**不写 `<img>` 标签**。main 拿到 HTML 后做统一回填：

```html
<section style="text-align:center;margin:24px 0;line-height:0;border-radius:12px;overflow:hidden;">
  <img src="images/01-cover.jpg" style="display:block;width:100%;height:auto;border-radius:12px;margin:0 auto;" alt="" />
</section>
```

为什么用中文方括号：英文 `IMG_PLACEHOLDER_X` 会被 Gemini 当成 src 路径直接写进 `<img src="IMG_PLACEHOLDER_X">`，中文括号不会。

### 字数硬约束

排版后**正文字数（剥标签后）必须 ≥ 原文清洗后字数的 95%**。模型被 prompt 明确禁止摘要、改写、合并段落。

## 三层加固内部细节（v11，给维护者看）

### 第 1 层：源稿层

- `parseFrontmatter(text)` 在 `render-wechat-html.mjs` 里实现，被 `layout-html.mjs` 导入
- 极简 YAML 解析：只支持 `key: value` 单行字符串，够标题/副标题/作者/摘要用
- 支持引号包裹（`title: "带：冒号的标题"`）

### 第 2 层：渲染层

- `stripLeadingTitle(html, title)` 在前 2000 字符里找第一个 `<h1>/<h2>/<h3>`
- 文本归一化对比："完全相同 / normalized 相同 / 一方是另一方子串（长度比 ≥ 0.6）"
- 命中就删除该 H 标签 + 紧随的 `<hr>` 装饰线 + 紧跟的短副标题 `<p>`（文本 < 80 字才删，避免误删正文）
- `checkStructureBalance(html)` 统计 `<section>` 和 `<div>` 开闭数量，不平衡就 warn 但不 throw
- self-test 覆盖 10 个 case，跑 `node scripts/render-wechat-html.mjs --self-test`

### 第 3 层：发布层

- `resolveMeta({ args, htmlPath, rawHtml })` 实现 4 级优先级解析，附带 `_sources` 标记每个字段来源
- 主流程在 `getAccessToken` **之前**调 `stripLeadingTitle` 和 `checkStructureBalance`，结构问题早暴露
- `require_frontmatter` 开关在 `loadConfig` 之后立即检查，没满足条件就 exit 2

## 脚本说明（给维护者看）

- `scripts/render-wechat-html.mjs` 用 `isMainModule()` 守卫（v11 修：原写法在 macOS symlink 路径下失效），只在被当入口直接执行时才跑 CLI
- `scripts/publish-draft.mjs` 同样用 `isMainModule()`；用 `process.cwd()` 解析封面路径（不是 HTML 所在目录），因为封面一般是相对启动目录的
- `scripts/layout-html.mjs` 同样用 `isMainModule()`；读 `config.json` 的 `layout_model` 段，没配就全用默认
- 所有脚本：`fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)` 是跨平台正确的 main guard 写法
