import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'

export interface AktuellerMitarbeiter {
  id: string
  name: string
  rolle: string
}

export function useAktuellerMitarbeiter() {
  const [mitarbeiter, setMitarbeiter] = useState<AktuellerMitarbeiter | null>(null)
  const [ladeVorgang, setLadeVorgang] = useState(true)

  useEffect(() => {
    async function laden() {
      const { data: sessionData } = await supabase.auth.getSession()
      const userId = sessionData.session?.user.id
      if (!userId) {
        setMitarbeiter(null)
        setLadeVorgang(false)
        return
      }
      const { data } = await supabase
        .from('mitarbeiter')
        .select('id, name, rolle')
        .eq('auth_user_id', userId)
        .maybeSingle()
      setMitarbeiter(data ?? null)
      setLadeVorgang(false)
    }
    laden()
  }, [])

  return { mitarbeiter, istAdmin: mitarbeiter?.rolle === 'admin', ladeVorgang }
}
