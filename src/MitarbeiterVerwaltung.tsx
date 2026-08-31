import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'

interface MitarbeiterZeile {
  id: string
  name: string
  urlaubsanspruch: number | null
  resturlaub: number | null
  resturlaub_vorjahr: number | null
}

export default function MitarbeiterVerwaltung({ neuLadenAuslöser }: { neuLadenAuslöser: number }) {
  const [mitarbeiter, setMitarbeiter] = useState<MitarbeiterZeile[]>([])
  const [ladeVorgang, setLadeVorgang] = useState(true)
  const [gespeichertId, setGespeichertId] = useState<string | null>(null)
  const [neuerName, setNeuerName] = useState('')
  const [wirdHinzugefuegt, setWirdHinzugefuegt] = useState(false)

  async function laden() {
    setLadeVorgang(true)
    const { data } = await supabase
      .from('mitarbeiter')
      .select('id, name, urlaubsanspruch, resturlaub, resturlaub_vorjahr')
      .order('name')
    setMitarbeiter(data ?? [])
    setLadeVorgang(false)
  }

  useEffect(() => {
    laden()
  }, [neuLadenAuslöser])

  function feldAendern(
    id: string,
    feld: 'urlaubsanspruch' | 'resturlaub' | 'resturlaub_vorjahr',
    wert: string
  ) {
    setMitarbeiter((vorher) =>
      vorher.map((m) => (m.id === id ? { ...m, [feld]: wert === '' ? null : Number(wert) } : m))
    )
  }

  async function speichern(zeile: MitarbeiterZeile) {
    await supabase
      .from('mitarbeiter')
      .update({
        urlaubsanspruch: zeile.urlaubsanspruch,
        resturlaub: zeile.resturlaub,
        resturlaub_vorjahr: zeile.resturlaub_vorjahr,
      })
      .eq('id', zeile.id)

    setGespeichertId(zeile.id)
    setTimeout(() => setGespeichertId(null), 1200)
  }

  async function mitarbeiterHinzufuegen() {
    const name = neuerName.trim()
    if (!name) return

    setWirdHinzugefuegt(true)
    await supabase.from('mitarbeiter').insert({
      name,
      urlaubsanspruch: 30,
      resturlaub: 30,
      resturlaub_vorjahr: 0,
    })
    setNeuerName('')
    setWirdHinzugefuegt(false)
    await laden()
  }

  if (ladeVorgang) {
    return <p style={{ color: 'var(--text-muted)' }}>Lade Mitarbeiter...</p>
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          type="text"
          placeholder="Name des neuen Mitarbeiters"
          value={neuerName}
          onChange={(e) => setNeuerName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && mitarbeiterHinzufuegen()}
          style={{
            flex: 1,
            padding: '8px 10px',
            border: '1px solid var(--border)',
            borderRadius: 6,
            fontSize: 14,
          }}
        />
        <button
          onClick={mitarbeiterHinzufuegen}
          disabled={wirdHinzugefuegt || !neuerName.trim()}
          style={{
            background: 'var(--navy)',
            color: '#ffffff',
            border: 'none',
            borderRadius: 6,
            padding: '8px 16px',
            fontSize: 14,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          + Hinzufügen
        </button>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={kopfZelleStil}>Name</th>
              <th style={kopfZelleStil}>Resturlaub Vorjahr</th>
              <th style={kopfZelleStil}>Urlaubsanspruch</th>
              <th style={kopfZelleStil}>Resturlaub</th>
              <th style={kopfZelleStil}>Gesamt verfügbar</th>
              <th style={kopfZelleStil}></th>
            </tr>
          </thead>
          <tbody>
            {mitarbeiter.map((zeile) => (
              <tr key={zeile.id}>
                <td style={zellStil}>{zeile.name}</td>
                <td style={zellStil}>
                  <input
                    type="number"
                    value={zeile.resturlaub_vorjahr ?? ''}
                    onChange={(e) => feldAendern(zeile.id, 'resturlaub_vorjahr', e.target.value)}
                    onBlur={() => speichern(zeile)}
                    style={eingabeStil}
                  />
                </td>
                <td style={zellStil}>
                  <input
                    type="number"
                    value={zeile.urlaubsanspruch ?? ''}
                    onChange={(e) => feldAendern(zeile.id, 'urlaubsanspruch', e.target.value)}
                    onBlur={() => speichern(zeile)}
                    style={eingabeStil}
                  />
                </td>
                <td style={zellStil}>
                  <input
                    type="number"
                    value={zeile.resturlaub ?? ''}
                    onChange={(e) => feldAendern(zeile.id, 'resturlaub', e.target.value)}
                    onBlur={() => speichern(zeile)}
                    style={eingabeStil}
                  />
                </td>
                <td style={{ ...zellStil, fontWeight: 600 }}>
                  {(zeile.resturlaub ?? 0) + (zeile.resturlaub_vorjahr ?? 0)}
                </td>
                <td style={{ ...zellStil, color: 'var(--success)', fontSize: 12 }}>
                  {gespeichertId === zeile.id ? 'Gespeichert' : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const kopfZelleStil: React.CSSProperties = {
  textAlign: 'left',
  padding: '6px 10px',
  borderBottom: '1px solid var(--border)',
  color: 'var(--text-muted)',
  fontWeight: 500,
}

const zellStil: React.CSSProperties = {
  padding: '4px 10px',
  borderBottom: '1px solid var(--border)',
}

const eingabeStil: React.CSSProperties = {
  width: 80,
  padding: '4px 6px',
  border: '1px solid var(--border)',
  borderRadius: 4,
  fontSize: 13,
}
