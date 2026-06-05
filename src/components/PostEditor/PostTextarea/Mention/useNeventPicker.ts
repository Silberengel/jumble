import * as React from 'react'
import { NeventPickerContext } from './nevent-picker-context'

export function useNeventPicker() {
  return React.useContext(NeventPickerContext)
}
