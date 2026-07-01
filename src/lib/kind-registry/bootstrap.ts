import { registerAllKindHandlers } from './handlers/register-all'

let booted = false

export function initKindRegistry(): void {
  if (booted) return
  registerAllKindHandlers()
  booted = true
}

initKindRegistry()
