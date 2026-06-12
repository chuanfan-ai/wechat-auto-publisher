# 更新日志

## v11 · 2026-06-12

### 修复（关键）

- **三层加固：根治"正文 H1 + 后台标题"双标题问题**
  - 根因：`.md` 源稿第一行 `# 标题` 被 `layout-html.mjs` 让 Gemini 渲染成 `<h1>`，`publish-draft.mjs` 又从 `<h1>` 提取作为公众号后台标题，造成在公众号上"正文 H1 + 后台标题"的双重显示。
- **macOS main guard 失效**（隐藏 bug）
  - 原写法 `process.argv[1] === fileURLToPath(import.meta.url)` 和 `import.meta.url === \`file://${process.argv[1]}\`` 在 `/var/folders`、`/tmp` 等 symlink 路径下都返回 false。
  - 现象：脚本 silent exit 0，main 函数从不执行。
  - 修复：改用 `fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)`，render / publish / layout 三个脚本统一用 `isMainModule()` 函数。

### 新增（三层加固方案落地）

#### 第 1 层：源稿层 frontmatter（layout-html.mjs）

- 解析 `.md` 头部 `---` 包围的 YAML frontmatter，提取 `title` / `subtitle` / `author` / `digest` 4 字段
- **只把 body（不含 frontmatter）传给模型** —— 模型看不到标题就不会生成 H1
- prompt 同步更新：删掉"# 标题 → H1"那条规则，明确告知"本次输入不含正文标题"
- 自动写 sidecar `<output>.html.meta.json` 把元信息传给 `publish-draft.mjs`

#### 第 2 层：渲染层（render-wechat-html.mjs）

- 新增 `parseFrontmatter` / `extractMetaFromHtml` / `stripLeadingTitle` / `checkStructureBalance` / `loadSourceWithMeta` / `writeMetaSidecar` / `readMetaSidecar` 7 个工具函数
- render CLI 现在拒绝处理 `.md`（明确提示用 `layout-html.mjs`）
- 加 `--title` 参数触发 `stripLeadingTitle` 兜底
- self-test 扩展到 10 个 case（frontmatter / 标题等价 / 兜底剥离 / 结构平衡 / sidecar 读写 / 别名归一）

#### 第 3 层：发布层（publish-draft.mjs）

- 新增 `resolveMeta`：**4 级元信息优先级** = CLI args → sidecar `.meta.json` → HTML `<meta>` 标签 → `<title>` / `<h1>` 兜底
- 新增 `--subtitle` CLI 参数
- 主流程加 `stripLeadingTitle` 兜底（即使源稿写了 H1 也能自动剥）
- 主流程加 `checkStructureBalance` 警告（捕获 `</div>` 错位、漏闭合 `<section>` 等结构 bug）
- 本地 HTML 处理提前到 fetch access_token 之前，**结构问题早暴露**，不再被 token / 网络错误掩盖

#### 配置开关

- `config.json` 新增 `require_frontmatter`（默认 `false` 向后兼容）
  - 开 `true` 后：`layout-html.mjs` 拒绝没 frontmatter 的 `.md`，`publish-draft.mjs` 拒绝既没 sidecar 也没 `--title` 的发布
  - 建议团队稳定使用 frontmatter 工作流后开启

### 文档

- README 重写：加 frontmatter 工作流、4 级元信息优先级表、`require_frontmatter` 开关说明、失败处理速查表
- SKILL.md 同步：占位符约定从 `『IMG_PLACEHOLDER_N』` 统一到 `【图片位_N】`（跟 `layout-html.mjs` 实际一致），加 v11 frontmatter 流程

### v5 ~ v10 渐进迭代（仅 commit log 有记，CHANGELOG 略）

- v5/v6：khazix-writing 升级为分层结构 + 默认字数规则
- v7：H2 改 modern 描边样式 + 金句标注必做每篇 ≥ 3 处
- v8：H2 彻底删掉实心圆角（v7 漏改 line 62）
- v9：重新设计排版系统（导读 / 要点提示 / 图片说明 3 个新组件）
- v10：章节标题加小标题规则（H2 格式 = 编号+空格+5-12字小标题）

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
