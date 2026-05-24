import QRCodeStyling from 'qr-code-styling'
import { useEffect, useRef } from 'react'

/** Standard black-on-white QR (square modules, no logo) for broad wallet/scanner compatibility. */
export default function QrCode({ value, size = 180 }: { value: string; size?: number }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!value.trim()) return

    const pixelRatio = window.devicePixelRatio || 2
    const qrCode = new QRCodeStyling({
      width: size * pixelRatio,
      height: size * pixelRatio,
      data: value,
      margin: 8,
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
      canvas.style.width = `${size}px`
      canvas.style.height = `${size}px`
      canvas.style.maxWidth = '100%'
      canvas.style.display = 'block'
    }

    return () => {
      container.innerHTML = ''
    }
  }, [value, size])

  if (!value.trim()) return null

  return (
    <div className="rounded-lg border border-border/40 bg-white p-3">
      <div ref={ref} className="mx-auto w-fit" />
    </div>
  )
}
