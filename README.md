# 微信公众号自动发布（wechat-auto-publisher）

从选题到公众号草稿箱，一站式跑完的 Agent 技能。

## 能力

- 🔍 **联网调研**：近 7 天资料自动检索 + 来源溯源
- ✍️ **AI 长文写作**：默认按"数字生命卡兹克"风格写（可换）
- 🖼️ **合规配图**：只挑授权清晰的图，强制署名
- 🎨 **AI 智能排版**（v4 新增）：Gemini 协议中转，输出公众号兼容的 inline-style HTML
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
- `WECHAT_APP_SECRET`（公众号 AppSecret）

凭证存在 `~/.wechat-auto-publisher/.env`，**不要 commit**。

### 3. 走 AI 排版（v4 推荐流程）

```bash
# 1. 准备文章 + 图
#    ├── draft.md        # Markdown 原稿
#    └── images/         # 图片目录
#        ├── 01-cover.jpg
#        ├── 02-asean.jpg
#        └── ...

# 2. 设置排版 API key（不 commit，建议临时 export）
export LAYOUT_API_KEY="sk-xxxxxxxx"

# 3. 跑 AI 排版
node scripts/layout-html.mjs \
  --input draft.md \
  --output dist/wechat.html \
  --images-dir images/

# 4. 上传 + 写草稿
node scripts/publish-draft.mjs \
  dist/wechat.html \
  --title "文章标题" \
  --author "作者名" \
  --digest "摘要" \
  --cover images/01-cover.jpg \
  --images-dir .
```

输出会带 `media_id`（草稿的 media_id，不是发布后的），到公众号后台草稿箱里能看到。

### 4. 走正则清洗器（老流程，v1-v3 用过）

```bash
# 自己写好 HTML（或用 v1 那种简单规则生成）
node scripts/render-wechat-html.mjs input.html -o dist/wechat.html
node scripts/publish-draft.mjs dist/wechat.html --title "..." --cover cover.jpg
```

## 关键文件

```
wechat-auto-publisher/
├── SKILL.md                       # 给 Agent 看的技能说明
├── README.md                      # 本文件
├── CHANGELOG.md                   # 版本日志
├── LICENSE                        # MIT（含卡兹克写作风格 adapter 声明）
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
    ├── config.mjs                 # 凭证/配置加载
    ├── render-wechat-html.mjs     # 正则清洗器（v1 用的）
    ├── layout-html.mjs            # AI 智能排版（v4 新增，Gemini 协议）
    └── publish-draft.mjs          # 上传图 + 写草稿
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
| 图片上传失败 | 检查图是否被本地损坏、格式是否 jpg/png/gif/webp |

## 许可

MIT — 详见 [LICENSE](./LICENSE)。

卡兹克写作风格 adapter 派生自 `KKKKhazix/khazix-skills`、`khazix-writer`（MIT）。

## 作者

chuanfan-ai — https://github.com/chuanfan-ai
