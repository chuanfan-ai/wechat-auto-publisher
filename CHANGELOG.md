# 更新日志

## v4 · 2026-06-09

### 新增

- **AI 智能排版入口** `scripts/layout-html.mjs`
  - 调 chuanfanai.com 的 Gemini 协议中转网关（`gemini-3.1-flash-lite`）
  - system prompt + user prompt 双层控制视觉
  - 中文方括号占位符协议 `【图片位_N】`，避免被模型误用为 src 路径
  - 预建 placeholderMap，main 统一回填 `<section><img></section>`（不依赖原稿 `![](xxx)` 标记）
  - 支持同步 + 流式两种端点
  - `--no-think` 默认开，省 token + 让模型专注排版
- **配置文件扩展** `config.json` 的 `layout_model` 段（api_base / model / api_key_env / temperature / top_p / thinking_budget / system_instruction / prompt_template）
- **环境变量** `LAYOUT_API_KEY`，不进 config 文件

### 视觉规范

- 主题色：阿里蓝 `#1677ff` + 日落橙 `#FF7A00`
- 字体：16px / line-height 1.8 / #333 / text-align justify
- 段间距：24px（`<p style="margin: 0 0 24px 0;">`）
- 章节：H2 用 26px 白字阿里蓝实心背景圆角
- 图片：`<section>` 包裹 + 12px 圆角 + 24px 上下外边距
- 全局字体样式 ≤ 3 种
- 根 `<section>`：`width: 100%; margin: 0; padding: 0; box-sizing: border-box;`

### 修复

- 占位符回填逻辑重写：原 `injectPlaceholders` 依赖原稿的 `![](xxx)` 标记，改成基于 `imageList` 预建 N 个条目的 placeholderMap
- prompt 明确禁止写 `<img>` 标签
- 思考片段剥离：`candidates[0].content.parts[i].thought === true` 跳过
- 思考签名 `thoughtSignature` 直接忽略
- safetySettings 全部 `OFF` / `BLOCK_NONE`

### 文档

- 全部中文化：SKILL.md、README.md、CHANGELOG.md、package.json、.env.example、references/*.md、agents/openai.yaml
- SKILL.md 新增"自定义排版"小节（环境变量、参数、占位符协议、字数硬约束）

## v3 · 2026-06-08

### 修复

- `publish-draft.mjs` 修 4 个跑通必备问题：
  1. 入口脚本目录加入凭证查找链
  2. `--images-dir` 显式指定 HTML 内 `<img>` 相对基准目录
  3. `--show-ip` 启动时打印出口 IP
  4. 40164 白名单错误时自动打印友好提示和当前出口 IP
- `render-wechat-html.mjs` 加 `import.meta.url` 守卫，避免被 import 时误读 argv
