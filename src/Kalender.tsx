import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'

interface KalenderEintrag {
  id: string
  name: string | null
  erster_tag: string
  letzter_tag: string
  status: string
}

const WOCHENTAGE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
const MONATSNAMEN = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
]

function tagImBereich(tag: Date, start: string, ende: string) {
  const t = tag.toISOString().slice(0, 10)
  return t >= start && t <= ende
}

function farbeFuerStatus(status: string) {
  if (status === 'genehmigt') return { bg: 'var(--success-bg)', text: 'var(--success)' }
  return { bg: 'var(--warning-bg)', text: 'var(--warning)' }
}

export default function Kalender({ neuLadenAuslöser }: { neuLadenAuslöser: number }) {
  const [monat, setMonat] = useState(() => {
    const heute = new Date()
    return new Date(heute.getFullYear(), heute.getMonth(), 1)
  })
  const [eintraege, setEintraege] = useState<KalenderEintrag[]>([])

  useEffect(() => {
    async function laden() {
      const monatsStart = new Date(monat.getFullYear(), monat.getMonth(), 1)
        .toISOString()
        .slice(0, 10)
      const monatsEnde = new Date(monat.getFullYear(), monat.getMonth() + 1, 0)
        .toISOString()
        .slice(0, 10)

      const { data } = await supabase
        .from('urlaubsantraege')
        .select('id, name, erster_tag, letzter_tag, status')
        .lte('erster_tag', monatsEnde)
        .gte('letzter_tag', monatsStart)
        .in('status', ['offen', 'genehmigt'])

      setEintraege(data ?? [])
    }
    laden()
  }, [monat, neuLadenAuslöser])

  const ersterTagDesMonats = new Date(monat.getFullYear(), monat.getMonth(), 1)
  const letzterTagDesMonats = new Date(monat.getFullYear(), monat.getMonth() + 1, 0)
  const anzahlTage = letzterTagDesMonats.getDate()
  const startWochentag = (ersterTagDesMonats.getDay() + 6) % 7

  const tage: (Date | null)[] = []
  for (let i = 0; i < startWochentag; i++) tage.push(null)
  for (let tag = 1; tag <= anzahlTage; tag++) {
    tage.push(new Date(monat.getFullYear(), monat.getMonth(), tag))
  }

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}
      >
        <button
          onClick={() => setMonat(new Date(monat.getFullYear(), monat.getMonth() - 1, 1))}
          style={navigationsKnopfStil}
        >
          ←
        </button>
        <div style={{ fontWeight: 600 }}>
          {MONATSNAMEN[monat.getMonth()]} {monat.getFullYear()}
        </div>
        <button
          onClick={() => setMonat(new Date(monat.getFullYear(), monat.getMonth() + 1, 1))}
          style={navigationsKnopfStil}
        >
          →
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
        {WOCHENTAGE.map((tagName) => (
          <div
            key={tagName}
            style={{ textAlign: 'center', fontSize: 12, color: 'var(--text-muted)', fontWeight: 500 }}
          >
            {tagName}
          </div>
        ))}

        {tage.map((tag, index) => {
          if (!tag) return <div key={`leer-${index}`} />

          const eintraegeAmTag = eintraege.filter((e) => tagImBereich(tag, e.erster_tag, e.letzter_tag))

          return (
            <div
              key={tag.toISOString()}
              style={{
                minHeight: 64,
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: 4,
                background: 'var(--card)',
              }}
            >
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
                {tag.getDate()}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {eintraegeAmTag.map((eintrag) => {
                  const farben = farbeFuerStatus(eintrag.status)
                  return (
                    <div
                      key={eintrag.id}
                      title={eintrag.name ?? ''}
                      style={{
                        background: farben.bg,
                        color: farben.text,
                        fontSize: 11,
                        borderRadius: 4,
                        padding: '1px 4px',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {eintrag.name ?? '—'}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 12, color: 'var(--text-muted)' }}>
        <span>
          <span style={legendenPunktStil('var(--warning)')} /> In Prüfung
        </span>
        <span>
          <span style={legendenPunktStil('var(--success)')} /> Genehmigt
        </span>
      </div>
    </div>
  )
}

const navigationsKnopfStil: React.CSSProperties = {
  background: 'none',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '4px 10px',
  cursor: 'pointer',
  fontSize: 14,
}

function legendenPunktStil(farbe: string): React.CSSProperties {
  return {
    display: 'inline-block',
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: farbe,
    marginRight: 4,
  }
}