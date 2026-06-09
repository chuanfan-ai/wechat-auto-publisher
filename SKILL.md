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
8. 排成公众号兼容的 HTML（inline-style）
9. 上传正文图 + 封面图到公众号
10. **只存草稿箱**——不群发、不发布、不定时

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

## 图片

按 `references/image-policy.md` 选图。

只使用授权清晰的图片。接受：Wikimedia Commons、Unsplash、Pexels、Pixabay、官方新闻稿/媒体素材包、其他明确声明可复用的页面。授权不清就跳过。

每张图都要记录：

- 本地路径或 URL
- 来源 URL
- 作者/创作者（如有）
- 授权平台/许可
- 图片下方的署名文案

送排版前用占位符：

```text
『IMG_PLACEHOLDER_0』
```

## 排版

按 `references/wechat-layout.md` 排。

排版阶段必须输出纯 HTML + inline-style + 单层 `<section>` 根。发布前过一遍清洗器：

```bash
node scripts/render-wechat-html.mjs input.html -o dist/wechat.html
```

> 如果要走 AI 智能排版（基于 Gemini 协议中转的视觉穿搭），用 `scripts/layout-html.mjs`，详见"自定义排版"小节。

## 草稿发布

最终 HTML 就绪、图到位之后再发：

```bash
node scripts/publish-draft.mjs dist/wechat.html \
  --title "文章标题" \
  --author "作者名" \
  --digest "摘要" \
  --cover path/to/cover.jpg \
  [--images-dir path/to/images] \
  [--show-ip]
```

脚本会自动：

- 加载本地公众号凭证（见下面的查找顺序）
- 拿 `access_token`
- 用 `media/uploadimg` 上传正文图
- 用 `material/add_material` 上传封面
- 用 `draft/add` 写入草稿
- 默认开启评论
- 遇到 `40164 invalid ip ... not in whitelist` → 自动检测调用方出口 IP 并打印白名单加白步骤
- 加 `--show-ip` 启动时先打印出口 IP，方便先确认再加白名单
- 加 `--images-dir <dir>` 指定 HTML 内 `<img src="...">` 的相对基准目录（默认用 HTML 所在目录，HTML 在 `dist/`、图在项目根 `images/` 时传项目根的 `images/`）

如果没指定封面，只有在图授权清晰的前提下，才从正文里挑一张合适的当封面。

### 凭证查找顺序

`scripts/config.mjs` 按这个顺序找 `WECHAT_APP_ID` / `WECHAT_APP_SECRET`（后面的覆盖前面的）：

1. `~/.wechat-auto-publisher/.env`（用户级）
2. `./.wechat-auto-publisher/.env`（项目级，相对 cwd）
3. `<skill_dir>/.wechat-auto-publisher/.env`（skill 级，跟着入口脚本走）
4. `process.env`

第 3 项的妙处：凭证文件可以放在 `publish-draft.mjs` 旁边，不管 cwd 在哪都能找到。彻底告别"复制 `.env` 到工作目录"的 workaround。

## 失败处理

- 缺凭证 → 跑首次运行
- IP 白名单错（`errcode: 40164`）→ 脚本会自动打印友好提示和当前出口 IP。到 **设置与开发 → 基本配置 → 公众号开发信息 → IP 白名单** 把那个 IP 加进去，再重跑（其他参数不用改）。不要瞎猜
- 云电脑/容器出口 IP 会变 → 白名单老翻车时，加一段 CIDR（如 `115.190.0.0/16`），或先用 `--show-ip` 确认再跑
- 图片授权不清 → 跳过这张
- 事实来源不清 → 标"不确定"或删掉
- 公众号 API 报错 → 把 `errcode` 和 `errmsg` 报出来，不要泄露凭证

## 自定义排版（Gemini 协议中转，v4 新增）

`scripts/layout-html.mjs` 是 v4 新增的 AI 智能排版入口。核心思路：

- **不调内置正则清洗器**——直接调 chuanfanai.com 的 Gemini 协议中转
- **system prompt 控制视觉**：阿里蓝 #1677ff + 日落橙 #FF7A00、4 套 UI 组件、6 条微信底层规范
- **图片走占位符协议**：用中文方括号 `【图片位_N】`，main 统一回填 `<section><img></section>`，不依赖原稿里的 `![](xxx)` 标记

### 用法

```bash
# 1. 准备 LAYOUT_API_KEY（不 commit 到 git，建议 export 临时用）
export LAYOUT_API_KEY="sk-xxxxxxxx"

# 2. 把图放 images/ 目录（脚本会自动按文件名排序编号）
#    images/01-cover.jpg  images/02-asean.jpg  images/03-tea.jpg ...

# 3. 跑排版
node scripts/layout-html.mjs \
  --input draft.md \
  --output dist/wechat.html \
  --images-dir images/

# 4. 跑发布（--images-dir 传项目根，不要传 images/）
node scripts/publish-draft.mjs \
  dist/wechat.html \
  --title "标题" \
  --digest "摘要" \
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

图片用中文方括号字面量：

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

## 脚本说明（给维护者看）

- `scripts/render-wechat-html.mjs` 用 `import.meta.url` 守卫，只在被当入口直接执行时才跑 CLI。被 import 时不会污染 stdout 或误读 publish 的 argv。旧版本顶层直接 `parseArgs(process.argv.slice(2))`，会把 publish 的 argv 误当 HTML 输入
- `scripts/publish-draft.mjs` 用 `process.cwd()` 解析封面路径（不是 HTML 所在目录），因为封面一般是相对启动目录的
- `scripts/layout-html.mjs` 同样用 `import.meta.url` 守卫；读 `config.json` 的 `layout_model` 段，没配就全用默认
