# WeChat Layout Rules

These rules are mandatory and override user style preferences.

## Mandatory Compatibility Rules

1. Output pure HTML only.
2. Do not output Markdown fences or explanatory text.
3. Do not use external CSS, `<style>`, JavaScript, `iframe`, `form`, `button`, `input`, `canvas`, or complex interactive tags.
4. Put every visual style in each tag's `style` attribute.
5. The outermost element must be a single `<section>` root.
6. Root style must include:

```css
width: 100%; margin: 0; padding: 0; box-sizing: border-box;
```

7. Do not put page-level horizontal padding on the root. Put article spacing inside inner modules.
8. Use `<p>` for body paragraphs.
9. Use `<section>` for independent modules.
10. Do not simulate paragraphs with repeated `<br>`.
11. Preserve the article's meaning and main expression.
12. Preserve image placeholders exactly.

## Image Placeholder Rule

Before layout, images are represented as:

```text
『IMG_PLACEHOLDER_0』
```

The layout model must keep the exact text and place it in an independent block:

```html
<section style="text-align:center; margin:24px 0; padding:0;">『IMG_PLACEHOLDER_0』</section>
```

After WeChat upload, replace the placeholder with the final image HTML and attribution.

## Default Visual Seed

Unless the user overrides style:

- primary color: Alibaba Blue `#1677ff`
- accent color: sunset orange `#FF7A00`
- numbered sections can use large pale/outlined numerals plus compact dark titles
- paragraph titles can use white text on blue background, wrapped only around the title text
