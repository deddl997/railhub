import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import { useAktuellerMitarbeiter } from './useAktuellerMitarbeiter'

interface Antrag {
  id: string
  erster_tag: string | null
  letzter_tag: string | null
  anzahl_tage: number | null
  brauchbare_tage: number | null
  status: string
  gruppe_id: string | null
}

interface Gruppe {
  schluessel: string
  status: string
  zeilen: Antrag[]
}

function statusFarbe(status: string) {
  if (status === 'genehmigt') return { bg: 'var(--success-bg, #dcfce7)', text: 'var(--success)' }
  if (status === 'abgelehnt') return { bg: 'var(--danger-bg, #fee2e2)', text: 'var(--danger)' }
  return { bg: 'var(--warning-bg, #fef3c7)', text: 'var(--warning)' }
}

function statusText(status: string) {
  if (status === 'genehmigt') return 'Genehmigt'
  if (status === 'abgelehnt') return 'Abgelehnt'
  return 'In Prüfung'
}

export default function MeineEigenenAntraege() {
  const { mitarbeiter, ladeVorgang: ladeMitarbeiter } = useAktuellerMitarbeiter()
  const [antraege, setAntraege] = useState<Antrag[]>([])
  const [ladeVorgang, setLadeVorgang] = useState(true)

  useEffect(() => {
    if (ladeMitarbeiter) return
    if (!mitarbeiter) {
      setLadeVorgang(false)
      return
    }

    supabase
      .from('urlaubsantraege')
      .select('id, erster_tag, letzter_tag, anzahl_tage, brauchbare_tage, status, gruppe_id')
      .eq('mitarbeiter_id', mitarbeiter.id)
      .order('erster_tag', { ascending: false })
      .then(({ data }) => {
        setAntraege(data ?? [])
        setLadeVorgang(false)
      })
  }, [mitarbeiter, ladeMitarbeiter])

  if (ladeMitarbeiter || ladeVorgang) {
    return <p style={{ color: 'var(--text-muted)' }}>Lade deine Anträge...</p>
  }

  const gruppenMap = new Map<string, Antrag[]>()
  for (const antrag of antraege) {
    const schluessel = antrag.gruppe_id ?? antrag.id
    if (!gruppenMap.has(schluessel)) gruppenMap.set(schluessel, [])
    gruppenMap.get(schluessel)!.push(antrag)
  }
  const gruppen: Gruppe[] = Array.from(gruppenMap.entries()).map(([schluessel, zeilen]) => ({
    schluessel,
    status: zeilen[0].status,
    zeilen: zeilen.sort((a, b) => (a.erster_tag ?? '').localeCompare(b.erster_tag ?? '')),
  }))

  if (gruppen.length === 0) {
    return <p style={{ color: 'var(--text-muted)' }}>Du hast noch keine Urlaubsanträge eingereicht.</p>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {gruppen.map((gruppe) => {
        const farben = statusFarbe(gruppe.status)
        const gesamtTage = gruppe.zeilen.reduce(
          (summe, z) => summe + (z.brauchbare_tage ?? z.anzahl_tage ?? 0),
          0
        )
        return (
          <div
            key={gruppe.schluessel}
            style={{
              padding: '12px 14px',
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: 12,
            }}
          >
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              {gruppe.zeilen.map((z) => (
                <div key={z.id}>
                  {z.erster_tag} – {z.letzter_tag} ({z.brauchbare_tage ?? z.anzahl_tage} Arbeitstage)
                </div>
              ))}
              {gruppe.zeilen.length > 1 && (
                <div style={{ fontWeight: 500, marginTop: 2 }}>Gesamt: {gesamtTage} Arbeitstage</div>
              )}
            </div>
            <span
              style={{
                background: farben.bg,
                color: farben.text,
                padding: '4px 10px',
                borderRadius: 999,
                fontSize: 13,
                fontWeight: 500,
                whiteSpace: 'nowrap',
              }}
            >
              {statusText(gruppe.status)}
            </span>
          </div>
        )
      })}
    </div>
  )
}
