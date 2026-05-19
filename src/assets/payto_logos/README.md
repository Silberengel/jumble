# Payto logos

Icons for payment types used by payto links in the app.

**Supported formats:** SVG, GIF, JPG/JPEG, PNG, WebP, etc.

**Catalog:** Each type’s `logoAssetPath` in [`src/data/payto-types.json`](../../data/payto-types.json) points at a file here (e.g. `src/assets/payto_logos/ethereum-eth-logo.svg`). Add or change logos by editing that JSON and placing the image in this folder.

Bundled via Vite `import.meta.glob` in [`src/lib/payto-logos.ts`](../../lib/payto-logos.ts); runtime URLs are under `/assets/…`.
