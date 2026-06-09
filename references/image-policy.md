# Image Policy

Use images only when reuse rights are explicit.

## Preferred Sources

- Wikimedia Commons
- Unsplash
- Pexels
- Pixabay
- Official company/product press kits
- Government, museum, university, or public-domain collections when license is explicit

## Do Not Use

- Random image search results without license text
- News images without reuse permission
- Social media images unless the post clearly grants reuse
- Watermarked images
- Images where author/license/source cannot be recorded

## Required Metadata

For each image:

```json
{
  "placeholder": "『IMG_PLACEHOLDER_0』",
  "path": "images/example.jpg",
  "source_url": "https://...",
  "author": "Name or platform",
  "license": "CC BY 4.0 / Unsplash License / Pexels License / Public Domain",
  "attribution": "图片来源：..."
}
```

## Caption Format

Use small muted text below each image:

```html
<p style="margin:8px 0 0; font-size:12px; line-height:1.6; color:#8a8f99; text-align:center;">图片来源：Source / Author / License</p>
```
