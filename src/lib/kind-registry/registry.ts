import type { KindHandler } from './types'

const handlers = new Map<number, KindHandler>()
let fallbackHandler: KindHandler | null = null

export function registerKindHandler(handler: KindHandler): void {
  for (const kind of handler.kinds) {
    handlers.set(kind, handler)
  }
}

export function registerFallbackHandler(handler: KindHandler): void {
  fallbackHandler = handler
}

export function handlerFor(kind: number): KindHandler | undefined {
  return handlers.get(kind) ?? fallbackHandler ?? undefined
}

export function registeredHandlerFor(kind: number): KindHandler | undefined {
  return handlers.get(kind)
}

export function registeredKinds(): number[] {
  return [...handlers.keys()].sort((a, b) => a - b)
}

export function renderableKinds(): number[] {
  const kinds = new Set<number>()
  for (const [kind, handler] of handlers) {
    if (handler.renderable !== false) kinds.add(kind)
  }
  return [...kinds].sort((a, b) => a - b)
}

export function isHighlightableKind(kind: number): boolean {
  return handlers.get(kind)?.highlightable === true
}

export function isReaderKind(kind: number): boolean {
  return handlers.get(kind)?.reader === true
}

export function typeNameForKind(kind: number): string | undefined {
  return handlers.get(kind)?.typeName ?? fallbackHandler?.typeName
}

export function actionsForKind(kind: number): KindHandler['actions'] | undefined {
  return handlers.get(kind)?.actions
}
