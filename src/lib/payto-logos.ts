/**
 * Resolves payto logo paths from {@link ../data/payto-types.json} `logoAssetPath` values.
 * All files under `src/assets/payto_logos/` are bundled via Vite `import.meta.glob`.
 */

const logoModules = import.meta.glob<string>('../assets/payto_logos/*', {
  eager: true,
  query: '?url',
  import: 'default'
})

/** Repo-relative path or basename → bundled URL (e.g. `/assets/…`). */
const URL_BY_ASSET_PATH = new Map<string, string>()

for (const [modulePath, url] of Object.entries(logoModules)) {
  const filename = modulePath.split('/payto_logos/')[1]
  if (!filename || !url) continue
  const assetPath = `src/assets/payto_logos/${filename}`
  URL_BY_ASSET_PATH.set(assetPath, url)
  URL_BY_ASSET_PATH.set(filename, url)
}

/**
 * Resolve a catalog `logoAssetPath` (or legacy basename) to the app asset URL.
 */
export function resolvePaytoLogoAssetPath(assetPathOrFilename: string | undefined): string | null {
  if (!assetPathOrFilename?.trim()) return null
  const key = assetPathOrFilename.trim()
  return URL_BY_ASSET_PATH.get(key) ?? URL_BY_ASSET_PATH.get(key.split('/').pop() ?? '') ?? null
}

/** @deprecated Use {@link resolvePaytoLogoAssetPath} with catalog `logoAssetPath`. */
export const PAYTO_LOGO_URL_BY_FILENAME: Record<string, string> = Object.fromEntries(
  [...URL_BY_ASSET_PATH.entries()].filter(([k]) => !k.startsWith('src/'))
)
