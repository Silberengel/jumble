/**
 * Resolves payto logo paths from {@link ../data/payto-types.json} `logoAssetPath` values.
 * Logo files under `src/assets/payto_logos/` load on demand via Vite `import.meta.glob`.
 */

const logoLoaders = import.meta.glob<string>('../assets/payto_logos/*', {
  query: '?url',
  import: 'default'
})

const URL_BY_ASSET_PATH = new Map<string, string>()
const pendingLoads = new Map<string, Promise<string | null>>()

function cacheLogoUrl(assetPath: string, url: string) {
  URL_BY_ASSET_PATH.set(assetPath, url)
  const filename = assetPath.split('/').pop()
  if (filename) URL_BY_ASSET_PATH.set(filename, url)
}

function findLoaderForAssetPath(assetPathOrFilename: string): string | null {
  const key = assetPathOrFilename.trim()
  const basename = key.split('/').pop() ?? key
  for (const modulePath of Object.keys(logoLoaders)) {
    const filename = modulePath.split('/payto_logos/')[1]
    if (!filename) continue
    if (
      key === `src/assets/payto_logos/${filename}` ||
      key === filename ||
      basename === filename
    ) {
      return modulePath
    }
  }
  return null
}

/**
 * Resolve a catalog `logoAssetPath` (or legacy basename) to the app asset URL.
 * Returns null until {@link loadPaytoLogoAssetPath} has loaded the asset.
 */
export function resolvePaytoLogoAssetPath(assetPathOrFilename: string | undefined): string | null {
  if (!assetPathOrFilename?.trim()) return null
  const key = assetPathOrFilename.trim()
  return URL_BY_ASSET_PATH.get(key) ?? URL_BY_ASSET_PATH.get(key.split('/').pop() ?? '') ?? null
}

/** Load a payto logo into the sync cache; safe to call repeatedly. */
export function loadPaytoLogoAssetPath(assetPathOrFilename: string | undefined): Promise<string | null> {
  if (!assetPathOrFilename?.trim()) return Promise.resolve(null)

  const cached = resolvePaytoLogoAssetPath(assetPathOrFilename)
  if (cached) return Promise.resolve(cached)

  const modulePath = findLoaderForAssetPath(assetPathOrFilename)
  if (!modulePath) return Promise.resolve(null)

  const pending = pendingLoads.get(modulePath)
  if (pending) return pending

  const loader = logoLoaders[modulePath]
  if (!loader) return Promise.resolve(null)

  const promise = loader().then((url) => {
    pendingLoads.delete(modulePath)
    if (!url) return null
    cacheLogoUrl(assetPathOrFilename.trim(), url)
    const filename = modulePath.split('/payto_logos/')[1]
    if (filename) cacheLogoUrl(`src/assets/payto_logos/${filename}`, url)
    return url
  })

  pendingLoads.set(modulePath, promise)
  return promise
}
