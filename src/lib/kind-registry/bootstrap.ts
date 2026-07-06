import { registerAllKindHandlers } from './handlers/register-all'

let booted = false
/** Guards re-entrant `initKindRegistry` while `registerAllKindHandlers` is still loading handler modules. */
let registering = false

export function initKindRegistry(): void {
  if (booted || registering) return
  registering = true
  try {
    registerAllKindHandlers()
    booted = true
  } finally {
    registering = false
  }
}

initKindRegistry()
