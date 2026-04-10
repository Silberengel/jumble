/** Chromium supports `fetchpriority` on `<video>` / `<img>`; @types/react may lag behind. */
import 'react'

declare module 'react' {
  interface VideoHTMLAttributes<T> {
    fetchPriority?: 'high' | 'low' | 'auto'
  }
  /** HTML `fetchpriority`; use on `<img>` — React warns on camelCase `fetchPriority` for DOM imgs. */
  interface ImgHTMLAttributes<T> {
    fetchpriority?: 'high' | 'low' | 'auto'
  }
}
