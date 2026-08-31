import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'

interface MitarbeiterZeile {
  id: string
  name: string
  urlaubsanspruch: number | null
  resturlaub: number | null
}

export default function MitarbeiterVerwaltung({ neuLadenAuslöser }: { neuLadenAuslöser: number }) {
  const [mitarbeiter, setMitarbeiter] = useState<MitarbeiterZeile[]>([])
  const [ladeVorgang, setLadeVorgang] = useState(true)
  const [gespeichertId, setGespeichertId] = useState<string | null>(null)

  async function laden() {
    setLadeVorgang(true)
    const { data } = await supabase
      .from('mitarbeiter')
      .select('id, name, urlaubsanspruch, resturlaub')
      .order('name')
    setMitarbeiter(data ?? [])
    setLadeVorgang(false)
  }

  useEffect(() => {
    laden()
  }, [neuLadenAuslöser])

  function feldAendern(id: string, feld: 'urlaubsanspruch' | 'resturlaub', wert: string) {
    setMitarbeiter((vorher) =>
      vorher.map((m) => (m.id === id ? { ...m, [feld]: wert === '' ? null : Number(wert) } : m))
    )
  }

  async function speichern(zeile: MitarbeiterZeile) {
    await supabase
      .from('mitarbeiter')
      .update({ urlaubsanspruch: zeile.urlaubsanspruch, resturlaub: zeile.resturlaub })
      .eq('id', zeile.id)

    setGespeichertId(zeile.id)
    setTimeout(() => setGespeichertId(null), 1200)
  }

  if (ladeVorgang) {
    return <p style={{ color: 'var(--text-muted)' }}>Lade Mitarbeiter...</p>
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
        <thead>
          <tr>
            <th style={kopfZelleStil}>Name</th>
            <th style={kopfZelleStil}>Urlaubsanspruch</th>
            <th style={kopfZelleStil}>Resturlaub</th>
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
              <td style={{ ...zellStil, color: 'var(--success)', fontSize: 12 }}>
                {gespeichertId === zeile.id ? 'Gespeichert' : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
