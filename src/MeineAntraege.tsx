import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'

interface Antrag {
  id: string
  name: string | null
  erster_tag: string | null
  letzter_tag: string | null
  anzahl_tage: number | null
  status: string
  dokument_url: string | null
}

const SPALTEN = [
  { status: 'offen', titel: 'Nicht bearbeitet', farbe: 'var(--warning)' },
  { status: 'genehmigt', titel: 'Genehmigt', farbe: 'var(--success)' },
  { status: 'abgelehnt', titel: 'Abgelehnt', farbe: 'var(--danger)' },
]

export default function MeineAntraege({
  neuLadenAuslöser,
  onGeaendert,
}: {
  neuLadenAuslöser: number
  onGeaendert: () => void
}) {
  const [antraege, setAntraege] = useState<Antrag[]>([])
  const [ladeVorgang, setLadeVorgang] = useState(true)

  async function laden() {
    setLadeVorgang(true)
    const { data } = await supabase
      .from('urlaubsantraege')
      .select('id, name, erster_tag, letzter_tag, anzahl_tage, status, dokument_url')
      .order('erstellt_am', { ascending: false })
    setAntraege(data ?? [])
    setLadeVorgang(false)
  }

  useEffect(() => {
    laden()
  }, [neuLadenAuslöser])

  async function statusAendern(id: string, neuerStatus: string) {
    await supabase.from('urlaubsantraege').update({ status: neuerStatus }).eq('id', id)
    await laden()
    onGeaendert()
  }

  async function antragLoeschen(antrag: Antrag) {
    const bestaetigt = window.confirm(
      `Antrag von "${antrag.name ?? 'Ohne Namen'}" wirklich unwiderruflich löschen?`
    )
    if (!bestaetigt) return

    if (antrag.dokument_url) {
      await supabase.storage.from('urlaubsantraege-dokumente').remove([antrag.dokument_url])
    }
    await supabase.from('urlaubsantraege').delete().eq('id', antrag.id)
    await laden()
    onGeaendert()
  }

  if (ladeVorgang) {
    return <p style={{ color: 'var(--text-muted)' }}>Lade Anträge...</p>
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        gap: 16,
      }}
    >
      {SPALTEN.map((spalte) => {
        const eintraege = antraege.filter((a) => a.status === spalte.status)
        return (
          <div key={spalte.status}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 10,
                fontWeight: 600,
                fontSize: 14,
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: spalte.farbe,
                  display: 'inline-block',
                }}
              />
              {spalte.titel}
              <span
                style={{
                  fontSize: 12,
                  color: 'var(--text-muted)',
                  fontWeight: 400,
                }}
              >
                ({eintraege.length})
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {eintraege.length === 0 && (
                <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>—</p>
              )}

              {eintraege.map((antrag) => (
                <div
                  key={antrag.id}
                  style={{
                    padding: '12px 14px',
                    background: 'var(--card)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 500 }}>{antrag.name ?? 'Ohne Namen'}</div>
                      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>
                        {antrag.erster_tag} – {antrag.letzter_tag} ({antrag.anzahl_tage} Tage)
                      </div>
                    </div>
                    <button
                      onClick={() => antragLoeschen(antrag)}
                      title="Antrag löschen"
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--text-muted)',
                        cursor: 'pointer',
                        fontSize: 16,
                        lineHeight: 1,
                        padding: 2,
                      }}
                    >
                      ✕
                    </button>
                  </div>

                  {spalte.status === 'offen' && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        onClick={() => statusAendern(antrag.id, 'genehmigt')}
                        style={aktionsKnopfStil('var(--success)')}
                      >
                        Genehmigen
                      </button>
                      <button
                        onClick={() => statusAendern(antrag.id, 'abgelehnt')}
                        style={aktionsKnopfStil('var(--danger)')}
                      >
                        Ablehnen
                      </button>
                    </div>
                  )}

                  {spalte.status !== 'offen' && (
                    <button
                      onClick={() => statusAendern(antrag.id, 'offen')}
                      style={aktionsKnopfStil('var(--text-muted)')}
                    >
                      Zurücksetzen
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function aktionsKnopfStil(farbe: string): React.CSSProperties {
  return {
    background: 'none',
    border: `1px solid ${farbe}`,
    color: farbe,
    borderRadius: 6,
    padding: '4px 10px',
    fontSize: 12,
    cursor: 'pointer',
  }
}
