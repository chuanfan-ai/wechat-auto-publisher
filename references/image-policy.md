# 图片授权策略

只用授权清晰的图，不确定就跳过。

## 推荐来源

- Wikimedia Commons（维基共享资源）
- Unsplash
- Pexels
- Pixabay
- 公司/产品官方新闻稿素材包
- 政府、博物馆、大学、公共领域合集（前提是授权明确）

## 不能用

- 没有明确授权文字的随机搜图结果
- 没有复用授权的新闻图
- 社交媒体图（除非帖子明确授予复用）
- 带水印的图
- 找不到作者 / 授权 / 来源的图

## 每张图必填的元信息

```json
{
  "placeholder": "『IMG_PLACEHOLDER_0』",
  "path": "images/example.jpg",
  "source_url": "https://...",
  "author": "作者名或平台名",
  "license": "CC BY 4.0 / Unsplash License / Pexels License / Public Domain",
  "attribution": "图片来源：作者 / 平台 / 授权"
}
```

## 署名格式

图片下方用小号灰色字：

```html
<p style="margin:8px 0 0; font-size:12px; line-height:1.6; color:#8a8f99; text-align:center;">图片来源：作者 / 平台 / 授权</p>
```
