import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'

// Rolle des angemeldeten Nutzers: 'mitarbeiter', 'disponent', 'abrechnung' oder 'admin'
export function useRolle(aktiv: boolean): string | null {
  const [rolle, setRolle] = useState<string | null>(null)
  useEffect(() => {
    if (!aktiv) {
      setRolle(null)
      return
    }
    supabase.rpc('meine_rolle').then(({ data }) => setRolle((data as string | null) ?? null))
  }, [aktiv])
  return rolle
}
