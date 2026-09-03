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
      const session = sessionData.session
      if (!session) {
        setMitarbeiter(null)
        setLadeVorgang(false)
        return
      }

      const userId = session.user.id

      let { data } = await supabase
        .from('mitarbeiter')
        .select('id, name, rolle')
        .eq('auth_user_id', userId)
        .maybeSingle()

      // Falls die Verknüpfung bei der Registrierung nicht sofort gespeichert
      // werden konnte (z.B. weil noch keine Sitzung bestand), hier nachholen.
      if (!data) {
        const ausstehendeMitarbeiterId = session.user.user_metadata?.mitarbeiter_id as
          | string
          | undefined

        if (ausstehendeMitarbeiterId) {
          await supabase
            .from('mitarbeiter')
            .update({ auth_user_id: userId })
            .eq('id', ausstehendeMitarbeiterId)
            .is('auth_user_id', null)

          const erneut = await supabase
            .from('mitarbeiter')
            .select('id, name, rolle')
            .eq('auth_user_id', userId)
            .maybeSingle()

          data = erneut.data
        }
      }

      setMitarbeiter(data ?? null)
      setLadeVorgang(false)
    }
    laden()
  }, [])

  return { mitarbeiter, istAdmin: mitarbeiter?.rolle === 'admin', ladeVorgang }
}
