# Atrium brand assets

Flat, minimal logo and icon kit for Atrium, a multi-tenant captive portal project.
Mark concept: a diamond skylight viewed from below, evoking an open atrium roof.

## Colors

| Name        | Hex       | Use                                  |
|-------------|-----------|---------------------------------------|
| Atrium navy | `#1e3a5f` | Primary mark, wordmark, light bg text |
| Deep navy   | `#13233a` | Dark banner / social preview backdrop |
| Slate       | `#64748b` | Tagline text on light backgrounds     |
| Slate light | `#94a3b8` | Tagline text on dark backgrounds      |
| White       | `#ffffff` | Icon strokes, dark-background wordmark|

## Files

```
svg/    Vector source files - edit these, or drop straight into a web page
png/    Flattened raster exports of the logos and banners, transparent where applicable
icons/  App icon / favicon raster set, plus favicon.ico
```

### svg/
- `icon-mark.svg` - primary square icon, navy tile + white skylight diamond
- `icon-mark-simple.svg` - solid-diamond version for very small sizes (used to build the 16px/32px favicons; the cross detail in the full mark disappears below ~40px)
- `icon-mark-outline-navy.svg` / `icon-mark-outline-white.svg` - icon with no background tile, for stamping onto colored surfaces
- `wordmark-navy.svg` / `wordmark-white.svg` - text-only logotype
- `logo-horizontal-navy.svg` - icon + wordmark side by side, primary lockup for README headers and light UI
- `logo-horizontal-white.svg` - same lockup in white, for dark backgrounds
- `logo-stacked-navy.svg` - icon above wordmark, for square placements (social profile image, splash screen)
- `readme-banner-light.svg` / `readme-banner-dark.svg` - 1200×300 banner with tagline, for the top of a README (pair with GitHub's `prefers-color-scheme` picture tag - see below)
- `social-preview.svg` - 1280×640, GitHub's repo social preview image size

### icons/
PNG exports of the icon mark at 16, 32, 48, 64, 128, 256, 512, and 1024px, plus `favicon.ico` (bundles 16/32/48). Use the larger sizes for installer/app icons (macOS, Windows, Linux .desktop) and `favicon.ico` for web favicons.

## README usage

Drop this near the top of the README to show the right banner in light and dark GitHub themes:

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/readme-banner-dark.png">
  <img src="assets/readme-banner-light.png" alt="Atrium - multi-tenant captive portal">
</picture>
```

For the GitHub repo social preview image, upload `png/social-preview.png` under Settings → General → Social preview.

## Notes
- The wordmark uses a generic bold sans fallback (`DejaVu Sans, Arial, Helvetica, sans-serif`) so it renders consistently without needing a web font license. Swap in a brand typeface later if you adopt one.
- All marks are flat fills/strokes with no gradients or shadows, so they reproduce cleanly at 1-bit/single-color (e.g. laser-etched hardware, t-shirt printing) using the outline variants.
