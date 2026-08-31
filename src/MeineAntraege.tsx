import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'

interface Antrag {
  id: string
  name: string | null
  erster_tag: string | null
  letzter_tag: string | null
  anzahl_tage: number | null
  status: string
}

function statusFarben(status: string) {
  if (status === 'genehmigt') return { bg: 'var(--success-bg)', text: 'var(--success)' }
  if (status === 'abgelehnt') return { bg: 'var(--danger-bg)', text: 'var(--danger)' }
  return { bg: 'var(--warning-bg)', text: 'var(--warning)' }
}

function statusText(status: string) {
  if (status === 'genehmigt') return 'Genehmigt'
  if (status === 'abgelehnt') return 'Abgelehnt'
  return 'In Prüfung'
}

export default function MeineAntraege({ neuLadenAuslöser }: { neuLadenAuslöser: number }) {
  const [antraege, setAntraege] = useState<Antrag[]>([])
  const [ladeVorgang, setLadeVorgang] = useState(true)

  useEffect(() => {
    async function laden() {
      setLadeVorgang(true)
      const { data } = await supabase
        .from('urlaubsantraege')
        .select('id, name, erster_tag, letzter_tag, anzahl_tage, status')
        .order('erstellt_am', { ascending: false })
      setAntraege(data ?? [])
      setLadeVorgang(false)
    }
    laden()
  }, [neuLadenAuslöser])

  if (ladeVorgang) {
    return <p style={{ color: 'var(--text-muted)' }}>Lade Anträge...</p>
  }

  if (antraege.length === 0) {
    return <p style={{ color: 'var(--text-muted)' }}>Noch keine Anträge eingereicht.</p>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {antraege.map((antrag) => {
        const farben = statusFarben(antrag.status)
        return (
          <div
            key={antrag.id}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: '12px 16px',
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 8,
            }}
          >
            <div>
              <div style={{ fontWeight: 500 }}>{antrag.name ?? 'Ohne Namen'}</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                {antrag.erster_tag} – {antrag.letzter_tag} ({antrag.anzahl_tage} Tage)
              </div>
            </div>
            <span
              style={{
                background: farben.bg,
                color: farben.text,
                padding: '4px 10px',
                borderRadius: 999,
                fontSize: 13,
                fontWeight: 500,
              }}
            >
              {statusText(antrag.status)}
            </span>
          </div>
        )
      })}
    </div>
  )
}