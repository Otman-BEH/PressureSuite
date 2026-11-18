import { useState } from 'react'
import { createJSONStorage, type StateStorage } from 'zustand/middleware'

// localStorage can be missing or throw (private windows, blocked storage); the app works without it.
export const safeStorage: StateStorage = {
  getItem: (key) => {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  },
  setItem: (key, value) => {
    try {
      localStorage.setItem(key, value)
    } catch {
      /* not persisted */
    }
  },
  removeItem: (key) => {
    try {
      localStorage.removeItem(key)
    } catch {
      /* nothing to remove */
    }
  },
}

/** JSON storage for a tool's persisted Zustand store (saved under `pressuresuite:<tool-id>`). */
export const toolStorage = () => createJSONStorage(() => safeStorage)

/** A per-browser on/off preference (e.g. a folded panel), remembered under `pressuresuite:ui:<key>`. */
export function useStoredFlag(key: string, initial: boolean): [boolean, (v: boolean) => void] {
  const full = `pressuresuite:ui:${key}`
  const [value, setValue] = useState(() => {
    const saved = safeStorage.getItem(full)
    return saved === null ? initial : saved === '1'
  })
  return [
    value,
    (v: boolean) => {
      setValue(v)
      safeStorage.setItem(full, v ? '1' : '0')
    },
  ]
}
