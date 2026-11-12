import { useCallback, useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import { bestaetigen, useToast } from './ui'

interface Sperre {
  id: string
  von: string
  bis: string
  grund: string | null
}
interface Gruppe {
  kategorie: string
  anzahl: number
}

const datumDe = (iso: string) => iso.split('-').reverse().join('.')

const eingabe: React.CSSProperties = { padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 14 }
const knopf = (primaer: boolean): React.CSSProperties => ({
  border: '1px solid var(--navy)',
  background: primaer ? 'var(--navy)' : '#fff',
  color: primaer ? '#fff' : 'var(--navy)',
  borderRadius: 6,
  padding: '7px 14px',
  fontSize: 14,
  cursor: 'pointer',
})
const karte: React.CSSProperties = { background: 'var(--card, #fff)', border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginBottom: 16 }

export default function Urlaubsregeln() {
  const toast = useToast()
  const [sperren, setSperren] = useState<Sperre[]>([])
  const [gruppen, setGruppen] = useState<Gruppe[]>([])
  const [minimum, setMinimum] = useState<Record<string, string>>({})
  const [von, setVon] = useState('')
  const [bis, setBis] = useState('')
  const [grund, setGrund] = useState('')
  const [laedt, setLaedt] = useState(true)
  const [fehler, setFehler] = useState<string | null>(null)

  const laden = useCallback(async () => {
    const [s, m, p] = await Promise.all([
      supabase.from('urlaubssperren').select('id, von, bis, grund').order('von'),
      supabase.from('mindestbesetzung').select('kategorie, minimum'),
      supabase.from('mitarbeiter').select('kategorie'),
    ])
    if (s.error || m.error || p.error) {
      setFehler((s.error ?? m.error ?? p.error)!.message + ' (SQL „urlaubsregeln.sql“ schon ausgeführt?)')
      setLaedt(false)
      return
    }
    setFehler(null)
    setSperren((s.data ?? []) as Sperre[])
    const zaehler = new Map<string, number>()
    for (const x of (p.data ?? []) as { kategorie: string | null }[]) {
      if (x.kategorie) zaehler.set(x.kategorie, (zaehler.get(x.kategorie) ?? 0) + 1)
    }
    setGruppen([...zaehler.entries()].map(([kategorie, anzahl]) => ({ kategorie, anzahl })).sort((a, b) => a.kategorie.localeCompare(b.kategorie, 'de')))
    setMinimum(Object.fromEntries(((m.data ?? []) as { kategorie: string; minimum: number }[]).map((x) => [x.kategorie, String(x.minimum)])))
    setLaedt(false)
  }, [])

  useEffect(() => {
    void laden()
  }, [laden])

  async function sperreAnlegen() {
    if (!von || !bis) {
      toast.fehler('Bitte Von- und Bis-Datum angeben.')
      return
    }
    if (bis < von) {
      toast.fehler('Das Bis-Datum liegt vor dem Von-Datum.')
      return
    }
    const { error } = await supabase.from('urlaubssperren').insert({ von, bis, grund: grund.trim() || null })
    if (error) {
      toast.fehler('Speichern fehlgeschlagen: ' + error.message)
      return
    }
    setVon('')
    setBis('')
    setGrund('')
    toast.erfolg('Urlaubssperre gespeichert.')
    void laden()
  }

  async function sperreLoeschen(s: Sperre) {
    const ok = await bestaetigen(`Sperre ${datumDe(s.von)} – ${datumDe(s.bis)}${s.grund ? ` (${s.grund})` : ''} löschen?`, {
      titel: 'Sperre löschen',
      jaText: 'Löschen',
      gefahr: true,
    })
    if (!ok) return
    const { error } = await supabase.from('urlaubssperren').delete().eq('id', s.id)
    if (error) toast.fehler('Löschen fehlgeschlagen: ' + error.message)
    else void laden()
  }

  async function minimumSpeichern(kategorie: string) {
    const roh = (minimum[kategorie] ?? '').trim()
    if (roh === '') {
      const { error } = await supabase.from('mindestbesetzung').delete().eq('kategorie', kategorie)
      if (error) toast.fehler('Speichern fehlgeschlagen: ' + error.message)
      return
    }
    const zahl = Number(roh)
    if (!Number.isInteger(zahl) || zahl < 0) {
      toast.fehler('Bitte eine ganze Zahl eintragen (0 oder mehr).')
      return
    }
    const { error } = await supabase.from('mindestbesetzung').upsert({ kategorie, minimum: zahl }, { onConflict: 'kategorie' })
    if (error) toast.fehler('Speichern fehlgeschlagen: ' + error.message)
    else toast.erfolg(`Mindestbesetzung für „${kategorie}“ gespeichert.`)
  }

  const heute = new Date().toISOString().slice(0, 10)

  if (laedt) return <p style={{ color: 'var(--text-muted)' }}>Lädt…</p>
  if (fehler) return <p style={{ color: 'var(--danger)' }}>Fehler: {fehler}</p>

  return (
    <div>
      <section style={karte}>
        <h3 style={{ margin: '0 0 4px', color: '#14325c' }}>Urlaubssperren</h3>
        <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 12 }}>
          In diesen Zeiträumen ist Urlaub nicht vorgesehen (z. B. Weihnachten, Großbaustelle). Mitarbeiter sehen beim Antrag einen Hinweis, und du
          bekommst beim Genehmigen eine Warnung. Genehmigen kannst du trotzdem.
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
          <label style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Von
            <br />
            <input type="date" value={von} onChange={(e) => setVon(e.target.value)} style={eingabe} />
          </label>
          <label style={{ fontSize: 13, color: 'var(--text-muted)' }}>
            Bis
            <br />
            <input type="date" value={bis} onChange={(e) => setBis(e.target.value)} style={eingabe} />
          </label>
          <label style={{ fontSize: 13, color: 'var(--text-muted)', flex: 1, minWidth: 180 }}>
            Grund (optional)
            <br />
            <input value={grund} onChange={(e) => setGrund(e.target.value)} placeholder="z. B. Streckensperrung, Jahresende" style={{ ...eingabe, width: '100%' }} />
          </label>
          <button style={knopf(true)} onClick={sperreAnlegen}>
            Sperre hinzufügen
          </button>
        </div>
        {sperren.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>Keine Sperren eingetragen.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {sperren.map((s) => (
              <div
                key={s.id}
                style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, background: '#f8fafc', opacity: s.bis < heute ? 0.5 : 1 }}
              >
                <b>
                  {datumDe(s.von)} – {datumDe(s.bis)}
                </b>
                <span style={{ flex: 1, color: 'var(--text-muted)' }}>{s.grund ?? ''}</span>
                {s.bis < heute && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>vorbei</span>}
                <button style={{ ...knopf(false), borderColor: '#b91c1c', color: '#b91c1c', padding: '4px 10px' }} onClick={() => sperreLoeschen(s)}>
                  Löschen
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section style={karte}>
        <h3 style={{ margin: '0 0 4px', color: '#14325c' }}>Mindestbesetzung</h3>
        <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 12 }}>
          Wie viele einer Qualifikation müssen an jedem Tag mindestens <b>nicht</b> im Urlaub sein? Beim Genehmigen prüft die App jeden Tag des Antrags und
          warnt, wenn das Minimum unterschritten würde. Leer lassen = keine feste Regel (dann gilt wie bisher die Warnung bei 40 % gleichzeitig im Urlaub).
        </div>
        {gruppen.length === 0 ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>Noch keine Qualifikationen bei den Mitarbeitern eingetragen.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {gruppen.map((g) => (
              <div key={g.kategorie} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, background: '#f8fafc' }}>
                <b style={{ minWidth: 160 }}>{g.kategorie}</b>
                <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{g.anzahl} Mitarbeiter</span>
                <span style={{ flex: 1 }} />
                <label style={{ fontSize: 13 }}>
                  Minimum anwesend{' '}
                  <input
                    type="number"
                    min={0}
                    max={g.anzahl}
                    value={minimum[g.kategorie] ?? ''}
                    onChange={(e) => setMinimum((v) => ({ ...v, [g.kategorie]: e.target.value }))}
                    onBlur={() => minimumSpeichern(g.kategorie)}
                    style={{ ...eingabe, width: 70 }}
                  />
                </label>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
