/**
 * Standalone HTTP server: same contract as legacy aitherboard `POST /api/piper-tts`
 * (JSON `{ text, speed?, voice? }` → `audio/wav`), forwarding to Wyoming Piper over TCP.
 */
import http from 'node:http'
import { handlePiperTtsPost } from './server'

const PORT = Number(process.env.PORT || 9876)

function cors(res: http.ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

const server = http.createServer(async (req, res) => {
  cors(res)
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end()
    return
  }
  const rawPath = req.url?.split('?')[0] || ''
  const path = rawPath.replace(/\/$/, '') || '/'
  if (req.method !== 'POST' || path !== '/api/piper-tts') {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found')
    return
  }

  const chunks: Buffer[] = []
  for await (const c of req) {
    chunks.push(c as Buffer)
  }
  const bodyBuf = Buffer.concat(chunks)

  const request = new Request(`http://127.0.0.1:${PORT}${rawPath}`, {
    method: 'POST',
    headers: { 'content-type': req.headers['content-type'] || 'application/json' },
    body: bodyBuf
  })

  try {
    const out = await handlePiperTtsPost(request)
    res.statusCode = out.status
    out.headers.forEach((value, key) => {
      res.setHeader(key, value)
    })
    const ab = await out.arrayBuffer()
    res.end(Buffer.from(ab))
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[piper-tts-proxy]', msg)
    res.statusCode = 500
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: msg }))
  }
})

server.listen(PORT, '0.0.0.0', () => {
  const host = process.env.PIPER_TTS_HOST || '(default)'
  console.log(`[piper-tts-proxy] http://0.0.0.0:${PORT}/api/piper-tts → Wyoming ${host}:${process.env.PIPER_TTS_PORT || '10200'}`)
})
