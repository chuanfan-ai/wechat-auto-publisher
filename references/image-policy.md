# 图片授权策略

公众号文章的图必须授权清晰，否则跳过。本文件覆盖 v12 起的三种来源：AI 生图、网络授权图片、原创图。

## v12 三条来源的优先级

`image_mode` 在 `~/.wechat-auto-publisher/config.json` 里设：

| 模式 | 谁来出图 | 适用场景 |
|---|---|---|
| `external`（默认） | `scripts/generate-images.mjs` 调 chuanfanai.com 生图 | 有 EXTERNAL_API_KEY 的用户，最省事 |
| `self` | Agent 用自己的模型尝试生图，或写描述清单给用户对照人工配图 | Agent 平台自带生图能力 |
| `manual` | Agent 按本文档"网络授权图片"那节去找 | 没 API、不依赖 Agent 生图能力 |

不管哪条路径，最终落到 `images/` 目录的图都要满足下面的"署名格式"。

## ① AI 生图（image_mode=external）

### prompts.json 怎么写

Agent 在调 `generate-images.mjs` 之前，要根据 `draft.md` 内容写出 `images/prompts.json`：

```json
[
  {
    "name": "01-cover.jpg",
    "prompt": "霸王茶姬店面在曼谷开幕的盛大场面，写实摄影风格，黄昏暖色调，4K 高清"
  },
  {
    "name": "02-asean.jpg",
    "prompt": "东南亚地图与茶饮品牌 logo 拼接，扁平插画风，明亮色调"
  },
  {
    "name": "03-tea.jpg",
    "prompt": "一杯茉莉绿茶特写，茶汤透亮，茶杯放在木质桌面，光线自然"
  }
]
```

### 文件命名规范

- 字母序就是 layout 的图片编号顺序：`01-cover.jpg` → `【图片位_0】`，`02-asean.jpg` → `【图片位_1】`，依此类推
- 建议数字前缀两位：`01-`、`02-`、…、`10-`，超 10 张也别错位
- 后缀必须是 `jpg / jpeg / png / gif / webp`，其他会被 `layout-html.mjs` 跳过

### Prompt 写作建议

- 一句话说清"主体 + 场景 + 风格"
- 风格关键词建议固定一套（写实摄影 / 扁平插画 / 水墨 / 杂志封面感等），全文统一
- 避免敏感人物、品牌商标、强政治标识
- 单张 prompt 控制在 50-150 汉字

### 调用

```bash
node scripts/generate-images.mjs \
  --output-dir images/ \
  [--prompts images/prompts.json] \
  [--max 5]
```

生成后会按 `name` 字段保存到 `images/`，自动满足 `layout-html.mjs` 的占位符顺序。

### 署名（AI 生图）

公众号文章里图下方建议加：

```html
<p style="margin:8px 0 0; font-size:12px; line-height:1.6; color:#8a8f99; text-align:center;">图片说明 · AI 生成（chuanfanai.com / gpt-image-2）</p>
```

`layout-html.mjs` 的 `图片说明文字` 槽位默认是空的，agent 写 draft.md 时可在占位符附近留一句配图说明。

## ② 网络授权图片（image_mode=manual）

### 推荐来源

- Wikimedia Commons（维基共享资源）
- Unsplash
- Pexels
- Pixabay
- 公司/产品官方新闻稿素材包
- 政府、博物馆、大学、公共领域合集（前提是授权明确）

### 不能用

- 没有明确授权文字的随机搜图结果
- 没有复用授权的新闻图
- 社交媒体图（除非帖子明确授予复用）
- 带水印的图
- 找不到作者 / 授权 / 来源的图

### 每张图必填的元信息

```json
{
  "placeholder": "【图片位_0】",
  "path": "images/01-cover.jpg",
  "source_url": "https://commons.wikimedia.org/wiki/...",
  "author": "作者名或平台名",
  "license": "CC BY 4.0 / Unsplash License / Pexels License / Public Domain",
  "attribution": "图片来源：作者 / 平台 / 授权"
}
```

### 署名格式（网络授权）

图片下方用小号灰色字：

```html
<p style="margin:8px 0 0; font-size:12px; line-height:1.6; color:#8a8f99; text-align:center;">图片来源：作者 / 平台 / 授权</p>
```

## ③ Agent 自己生图（image_mode=self）

适用：Agent 平台自带生图能力（如内置 image generation tool）。

`generate-images.mjs` 在 self 模式下不调任何 API，而是把 `prompts.json` 转写为 `images/descriptions.md`，agent 可以：

- 用自带工具按这份 descriptions 生图，存到 `images/<name>`
- 或者把 descriptions 交给用户，人工找图

署名按生图来源对应：自带工具生的图按"AI 生成"署，人工找的图按"网络授权"署。

## 配图硬约束（v12）

`layout-html.mjs` 启动时检查 `config.require_images` 和 `config.min_images`：

- 默认 `require_images: true` + `min_images: 3`
- 图不够 → 报错并打印 4 种修复方式（AI 生图 / 手动找图 / `--no-images` 跳过 / 改阈值）
- `--no-images` 是显式跳过，agent 仅在用户明确说"这篇不要图"时才传

理由：纯文字公众号文章可读性差，强制 ≥ 3 张图是体感最低门槛。
