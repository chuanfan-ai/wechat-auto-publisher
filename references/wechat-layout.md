# 公众号排版规则

这些规则是硬约束，**压过用户的风格偏好**。

## 兼容性硬规则

1. 只输出纯 HTML
2. 不要输出 markdown code fence 或解释性文字
3. 禁止用外部 CSS、`<style>` 块、JavaScript、`<iframe>`、`<form>`、`<button>`、`<input>`、`<canvas>`、任何复杂交互标签
4. 所有视觉样式写在每个标签的 `style="..."` 属性里
5. 最外层必须且只能是一个 `<section>` 根
6. 根样式必须包含：

```css
width: 100%; margin: 0; padding: 0; box-sizing: border-box;
```

7. 根容器**不**加任何内边距，文章内边距放在内层模块
8. 正文段落用 `<p>`
9. 独立模块用 `<section>` 包裹
10. 严禁用连续 `<br>` 模拟段落间距
11. 保留文章的意思和主表达
12. 图片占位符必须原样保留

## 图片占位符规则

排版前图片表示为：

```text
『IMG_PLACEHOLDER_0』
```

排版模型必须**原样保留这段文字**，并放进独立块：

```html
<section style="text-align:center; margin:24px 0; padding:0;">『IMG_PLACEHOLDER_0』</section>
```

公众号上传完成后，再用真正的 `<img>` 标签和署名替换占位符。

## 默认视觉种子

除非用户另外指定风格：

- **主色**：阿里蓝 `#1677ff`
- **强调色**：日落橙 `#FF7A00`
- 数字章节：超大字号 + 空心描边（或极浅实心色）+ 并排紧凑的深色标题
- 段落标题：26 号白字阿里蓝实心背景圆角

## 字体 / 段落规范

- 正文：16px / line-height 1.8 / color #333333 / `text-align: justify; word-break: break-word;`
- 段落：`<p style="margin: 0 0 24px 0; padding: 0;">`
- 不出现任何斜体
- 全局字体样式 ≤ 3 种

## 自定义排版（v4 新增，AI 排版路径）

如果走 `scripts/layout-html.mjs` 的 AI 智能排版，**优先用**以下占位符协议：

- 用中文方括号：`【图片位_0】`、`【图片位_1】`……
- 不写 `<img>` 标签，由 main 统一回填
- 原因：英文 `IMG_PLACEHOLDER_X` 容易被模型误用为 src 路径

详细用法见 `SKILL.md` → "自定义排版"小节。
