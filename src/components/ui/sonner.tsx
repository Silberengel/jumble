import { useThemeOptional } from '@/providers/ThemeProvider'
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Toaster as Sonner } from 'sonner'

type ToasterProps = React.ComponentProps<typeof Sonner>

const Toaster = ({ ...props }: ToasterProps) => {
  const themeCtx = useThemeOptional()
  const themeSetting = themeCtx?.themeSetting ?? 'system'
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) return null

  return createPortal(
    <>
      <style>{`
        /* Long messages + action/cancel buttons: keep text full-width (prevents 1-char-per-line strip). */
        [data-sonner-toast]:not([data-styled='false']) {
          flex-wrap: wrap !important;
          width: min(22rem, calc(100vw - 2rem)) !important;
          max-width: min(420px, calc(100vw - 2rem)) !important;
        }
        [data-sonner-toast]:not([data-styled='false']) [data-content] {
          flex: 1 1 100% !important;
          min-width: 0;
          max-width: 100%;
        }
        [data-sonner-toast]:not([data-styled='false']) [data-title],
        [data-sonner-toast]:not([data-styled='false']) [data-description] {
          white-space: normal;
          overflow-wrap: break-word;
          word-break: normal;
        }
        [data-sonner-toast]:not([data-styled='false']) [data-button] {
          flex-shrink: 0;
        }
      `}</style>
      <Sonner
        theme={themeSetting}
        className="toaster group"
        richColors
        mobileOffset={64}
        style={
          {
            '--width': '22rem',
            zIndex: 9999
          } as React.CSSProperties
        }
        toastOptions={{
          classNames: {
            toast:
              'group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg group-[.toaster]:min-w-[min(22rem,calc(100vw-2rem))]',
            description: 'group-[.toast]:text-muted-foreground',
            actionButton: 'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
            cancelButton: 'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground'
          },
          style: {
            maxWidth: 'min(420px, calc(100vw - 2rem))'
          }
        }}
        {...props}
      />
    </>,
    document.body
  )
}

export { Toaster }
