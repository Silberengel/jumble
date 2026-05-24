import { cn } from '@/lib/utils'
import QRCodeStyling from 'qr-code-styling'
import { useEffect, useRef, useState } from 'react'

/** Standard black-on-white QR (square modules, no logo) for broad wallet/scanner compatibility. */
export default function QrCode({
  value,
  size = 180,
  fill = false
}: {
  value: string
  size?: number
  /** Size the QR to fill the white container (responsive). */
  fill?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const shellRef = useRef<HTMLDivElement>(null)
  const [measuredSize, setMeasuredSize] = useState(fill ? 0 : size)
  const renderSize = fill ? measuredSize : size

  useEffect(() => {
    if (!fill || !shellRef.current) return
    const el = shellRef.current
    const measure = () => {
      const next = Math.floor(Math.min(el.clientWidth, el.clientHeight))
      if (next > 0) setMeasuredSize(next)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [fill])

  useEffect(() => {
    if (!value.trim() || renderSize <= 0) return

    const pixelRatio = window.devicePixelRatio || 2
    const qrCode = new QRCodeStyling({
      width: renderSize * pixelRatio,
      height: renderSize * pixelRatio,
      data: value,
      margin: fill ? 4 : 8,
      qrOptions: {
        errorCorrectionLevel: 'M'
      },
      dotsOptions: {
        type: 'square',
        color: '#000000'
      },
      backgroundOptions: {
        color: '#ffffff'
      },
      cornersSquareOptions: {
        type: 'square',
        color: '#000000'
      },
      cornersDotOptions: {
        type: 'square',
        color: '#000000'
      }
    })

    const container = ref.current
    if (!container) return

    container.innerHTML = ''
    qrCode.append(container)
    const canvas = container.querySelector('canvas')
    if (canvas) {
      if (fill) {
        canvas.style.width = '100%'
        canvas.style.height = '100%'
        canvas.style.maxWidth = 'none'
      } else {
        canvas.style.width = `${renderSize}px`
        canvas.style.height = `${renderSize}px`
        canvas.style.maxWidth = '100%'
      }
      canvas.style.display = 'block'
    }

    return () => {
      container.innerHTML = ''
    }
  }, [value, renderSize, fill])

  if (!value.trim()) return null

  return (
    <div
      ref={fill ? shellRef : undefined}
      className={cn(
        'rounded-lg border border-border/40 bg-white',
        fill ? 'aspect-square w-full' : 'p-3'
      )}
    >
      <div ref={ref} className={cn(fill ? 'size-full' : 'mx-auto w-fit')} />
    </div>
  )
}
