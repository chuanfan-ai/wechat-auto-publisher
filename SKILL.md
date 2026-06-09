---
name: wechat-auto-publisher
description: WeChat Official Account end-to-end draft creation skill. Use when the user wants to generate a public-account article from a topic: initialize WeChat API credentials, search recent news, write a long-form article in the Digital Life Khazix style, choose reusable licensed images with attribution, format as WeChat-compatible inline-style HTML, upload images, and save a draft in the WeChat Official Account backend. This skill creates drafts only and never mass-sends or publishes automatically.
---

# WeChat Auto Publisher

Create WeChat Official Account article drafts from a topic.

The default v1 flow is:

1. Initialize local config if missing.
2. Tell the user the default source window is the last 7 days.
3. Search the web for recent, source-backed information.
4. Write a long-form article in the Digital Life Khazix style.
5. Remove Khazix's personal footer/contact block from the final article.
6. Find reusable licensed images and record attribution.
7. Insert image placeholders at natural article positions.
8. Format the article as WeChat-compatible HTML.
9. Upload body images and cover image through the WeChat API.
10. Save the article to the WeChat draft box only.

Never mass-send, publish, or schedule the article.

## First-Run Setup

If config is missing, run:

```bash
node scripts/init-config.mjs
```

Credentials are local-only:

- User config: `~/.wechat-auto-publisher/config.json`
- User secrets: `~/.wechat-auto-publisher/.env`
- Project fallback: `./.wechat-auto-publisher/config.json` and `./.wechat-auto-publisher/.env`

Do not print, commit, or store real `WECHAT_APP_ID`, `WECHAT_APP_SECRET`, tokens, or API keys in generated docs or memory.

Default config:

- `publish_method`: `api`
- `source_window_days`: `7`
- `need_open_comment`: `1`
- `only_fans_can_comment`: `0`
- image policy: use only clearly reusable licensed images and include attribution

## Research

Always browse for current information because the skill depends on recent news. Tell the user:

> 默认检索近 7 天资料。

Collect source metadata:

- title
- URL
- publisher/site
- publication date if available
- accessed date
- one-line relevance note

Prefer primary or authoritative sources. Do not turn unsupported claims into facts.

## Writing

Use the Khazix writing workflow in `references/khazix-writing.md`.

Important boundary:

- Write as Digital Life Khazix in voice, rhythm, structure, and judgment.
- Remove the personal footer/contact block before formatting or publishing.
- Do not include `作者：卡兹克`,投稿邮箱,爆料邮箱, personal contact details, or fixed account-growth footer text.

## Images

Use `references/image-policy.md`.

Only use images with clear reuse rights. Acceptable sources include Wikimedia Commons, Unsplash, Pexels, Pixabay, official press/media kits, and other pages that explicitly grant reuse rights. If rights are unclear, skip the image.

For every image, keep:

- local path or URL
- source URL
- author/creator if available
- license/platform permission
- attribution text to render below the image

Use placeholders before layout:

```text
『IMG_PLACEHOLDER_0』
```

## Layout

Use `references/wechat-layout.md`.

The layout stage must output pure HTML with inline styles and a single outer `<section>` root. Run the cleaner before publishing:

```bash
node scripts/render-wechat-html.mjs input.html -o dist/wechat.html
```

## Draft Publishing

Publish only after the final HTML is ready and images are available:

```bash
node scripts/publish-draft.mjs dist/wechat.html \
  --title "文章标题" \
  --author "作者名" \
  --digest "摘要" \
  --cover path/to/cover.jpg \
  [--images-dir path/to/images] \
  [--show-ip]
```

The script:

- loads local WeChat credentials (see credential lookup order below)
- fetches `access_token`
- uploads non-WeChat body images with `media/uploadimg`
- uploads the cover with `material/add_material`
- creates a draft with `draft/add`
- enables comments by default
- on `40164 invalid ip ... not in whitelist`, auto-detects the caller's egress IP and prints a step-by-step help block pointing to the WeChat backend whitelist page
- with `--show-ip`, prints the egress IP at startup so you can confirm it before adding to the whitelist
- with `--images-dir <dir>`, treats that directory as the base for resolving `<img src="...">` paths inside the HTML (default: the directory of the HTML file). Use this when the HTML is in `dist/` but images live in the project root `images/`.

If there is no explicit cover, choose a suitable article image as cover only when its license is clear.

### Credential Lookup Order

`scripts/config.mjs` looks for `WECHAT_APP_ID` / `WECHAT_APP_SECRET` in this order (later wins):

1. `~/.wechat-auto-publisher/.env` (user-level)
2. `./.wechat-auto-publisher/.env` (project-level, relative to cwd)
3. `<skill_dir>/.wechat-auto-publisher/.env` (skill-level, follows the entry script)
4. `process.env`

The skill-level entry (3) means the credential file can sit next to `publish-draft.mjs` and work regardless of cwd. This removes the "copy `.env` into the working directory" workaround.

## Failure Rules

- Missing credentials: run first-run setup.
- IP whitelist error (`errcode: 40164`): the script auto-prints a help block with the current egress IP and the backend URL. Add that IP under **设置与开发 → 基本配置 → 公众号开发信息 → IP 白名单**, then re-run with the same command. Do not invent a workaround.
- Cloud/container egress IPs can change between runs. If the whitelist keeps flipping, add a CIDR range (e.g. `115.190.0.0/16`) or use `--show-ip` to confirm the IP before adding.
- Image license unclear: do not use that image.
- Fact source unclear: mark the claim as uncertain or remove it.
- WeChat API errors: report `errcode` and `errmsg`, without exposing credentials.

## Script Internals (for maintainers)

- `scripts/render-wechat-html.mjs` uses an entry-only CLI guard (`if (import.meta.url === file://${process.argv[1]}`)`) so it is safe to import from other scripts without polluting stdout or accidentally reading files. The previous version had a top-level `parseArgs(process.argv.slice(2))` that caused `publish-draft.mjs` to mis-read the publish command's argv.
- `scripts/publish-draft.mjs` resolves the cover path against `process.cwd()` (not the HTML directory) because covers are typically specified relative to where the user runs the command.

