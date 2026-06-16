/** True when fetched page metadata is worth showing as an OpenGraph card. */
export function hasUsableOpenGraphMetadata(meta: {
  title?: string | null
  description?: string | null
  image?: string | null
}): boolean {
  return Boolean(meta.title?.trim() || meta.description?.trim() || meta.image?.trim())
}
