/** Chromium supports `fetchpriority` on `<video>`; @types/react may lag behind. */
import 'react'

declare module 'react' {
  interface VideoHTMLAttributes<T> {
    fetchPriority?: 'high' | 'low' | 'auto'
  }
}
