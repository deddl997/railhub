import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'

interface AuftragZeile {
  id: string
  kunde: string | null
  status: string
  abfahrt_datum: string
  preis: number | null
  abrechnung_status: string
}

interface DienstZeile {
  mitarbeiter_id: string
  datum: string
  spot_beginn_zeit: string | null
  spot_ende_zeit: string | null
  spot_pause_minuten: number | null
}

const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
const euro = (v: number) => v.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })
const prozent = (v: number) => `${v.toLocaleString('de-DE', { maximumFractionDigits: 1 })} %`

function zuMinuten(z: string): number {
  const [h, m] = z.split(':').map(Number)
  return h * 60 + m
}

function dienstMinuten(d: DienstZeile): number {
  if (!d.spot_beginn_zeit || !d.spot_ende_zeit) return 0
  const b = zuMinuten(d.spot_beginn_zeit)
  let e = zuMinuten(d.spot_ende_zeit)
  if (e <= b) e += 1440
  return Math.max(0, e - b - (d.spot_pause_minuten ?? 0))
}

async function allesLaden<T>(abfrage: (von: number, bis: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>): Promise<T[]> {
  const ergebnis: T[] = []
  for (let von = 0; von < 20000; von += 1000) {
    const { data, error } = await abfrage(von, von + 999)
    if (error) throw new Error(error.message)
    ergebnis.push(...((data ?? []) as T[]))
    if ((data ?? []).length < 1000) break
  }
  return ergebnis
}

export default function Kennzahlen() {
  const heute = new Date()
  const [jahr, setJahr] = useState(heute.getFullYear())
  const [monat, setMonat] = useState(heute.getMonth()) // -1 = ganzes Jahr
  const [auftraege, setAuftraege] = useState<AuftragZeile[]>([])
  const [dienste, setDienste] = useState<DienstZeile[]>([])
  const [namen, setNamen] = useState<Record<string, string>>({})
  const [laedt, setLaedt] = useState(true)
  const [fehler, setFehler] = useState<string | null>(null)
  const [dienstHinweis, setDienstHinweis] = useState(false)

  useEffect(() => {
    async function laden() {
      setLaedt(true)
      setFehler(null)
      setDienstHinweis(false)
      const von = `${jahr}-01-01`
      const bis = `${jahr}-12-31`
      try {
        const a = await allesLaden<AuftragZeile>((v, b) =>
          supabase
            .from('auftraege')
            .select('id, kunde, status, abfahrt_datum, preis, abrechnung_status')
            .gte('abfahrt_datum', von)
            .lte('abfahrt_datum', bis)
            .order('abfahrt_datum')
            .range(v, b)
        )
        setAuftraege(a)
      } catch (e) {
        setFehler((e as Error).message)
        setLaedt(false)
        return
      }
      try {
        const d = await allesLaden<DienstZeile>((v, b) =>
          supabase
            .from('dienstplan_eintraege')
            .select('mitarbeiter_id, datum, spot_beginn_zeit, spot_ende_zeit, spot_pause_minuten')
            .eq('ist_spotschicht', true)
            .not('auftrag_id', 'is', null)
            .gte('datum', von)
            .lte('datum', bis)
            .order('datum')
            .range(v, b)
        )
        setDienste(d)
        const p = await supabase.from('mitarbeiter').select('id, name')
        setNamen(Object.fromEntries(((p.data ?? []) as { id: string; name: string }[]).map((x) => [x.id, x.name])))
      } catch {
        setDienste([])
        setDienstHinweis(true)
      }
      setLaedt(false)
    }
    laden()
  }, [jahr])

  const imMonat = (iso: string) => monat === -1 || Number(iso.slice(5, 7)) - 1 === monat
  const liste = auftraege.filter((a) => imMonat(a.abfahrt_datum))
  const abrechenbar = (a: AuftragZeile) => a.status === 'gefahren' || a.status === 'storniert'

  const gefahren = liste.filter((a) => a.status === 'gefahren').length
  const storniert = liste.filter((a) => a.status === 'storniert').length
  const offenAnz = liste.length - gefahren - storniert
  const stornoQuote = gefahren + storniert > 0 ? (storniert / (gefahren + storniert)) * 100 : 0
  const umsatz = liste.filter(abrechenbar).reduce((s, a) => s + (a.preis ?? 0), 0)
  const nochNichtAbgerechnet = liste.filter((a) => abrechenbar(a) && a.abrechnung_status !== 'abgerechnet').reduce((s, a) => s + (a.preis ?? 0), 0)
  const ohnePreis = liste.filter((a) => abrechenbar(a) && a.preis == null).length

  const kundenMap = new Map<string, { gef: number; sto: number; umsatz: number; anz: number }>()
  for (const a of liste) {
    const k = a.kunde ?? '(ohne Kunde)'
    const z = kundenMap.get(k) ?? { gef: 0, sto: 0, umsatz: 0, anz: 0 }
    z.anz += 1
    if (a.status === 'gefahren') z.gef += 1
    if (a.status === 'storniert') z.sto += 1
    if (abrechenbar(a)) z.umsatz += a.preis ?? 0
    kundenMap.set(k, z)
  }
  const kunden = Array.from(kundenMap.entries()).sort((a, b) => b[1].umsatz - a[1].umsatz || b[1].anz - a[1].anz)

  const monatsUmsatz = MONATE.map((_, i) =>
    auftraege.filter((a) => Number(a.abfahrt_datum.slice(5, 7)) - 1 === i && abrechenbar(a)).reduce((s, a) => s + (a.preis ?? 0), 0)
  )
  const maxMonat = Math.max(1, ...monatsUmsatz)

  const personen = new Map<string, { dienste: number; minuten: number }>()
  for (const d of dienste.filter((x) => imMonat(x.datum))) {
    const z = personen.get(d.mitarbeiter_id) ?? { dienste: 0, minuten: 0 }
    z.dienste += 1
    z.minuten += dienstMinuten(d)
    personen.set(d.mitarbeiter_id, z)
  }
  const personenListe = Array.from(personen.entries())
    .map(([id, z]) => ({ name: namen[id] ?? 'Unbekannt', ...z }))
    .sort((a, b) => b.dienste - a.dienste || a.name.localeCompare(b.name, 'de'))

  const kachel: React.CSSProperties = { background: '#f1f5f9', borderRadius: 10, padding: '10px 14px', minWidth: 140, flex: '1 1 140px' }
  const zelle: React.CSSProperties = { padding: '7px 10px', borderBottom: '1px solid #eef2f8', fontSize: 13, textAlign: 'left' }
  const rechts: React.CSSProperties = { ...zelle, textAlign: 'right' }
  const feld: React.CSSProperties = { padding: '5px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13 }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14, alignItems: 'center' }}>
        <select value={jahr} onChange={(e) => setJahr(Number(e.target.value))} style={feld}>
          {[heute.getFullYear() - 2, heute.getFullYear() - 1, heute.getFullYear(), heute.getFullYear() + 1].map((j) => (
            <option key={j} value={j}>
              {j}
            </option>
          ))}
        </select>
        <select value={monat} onChange={(e) => setMonat(Number(e.target.value))} style={feld}>
          <option value={-1}>Ganzes Jahr</option>
          {MONATE.map((m, i) => (
            <option key={m} value={i}>
              {m}
            </option>
          ))}
        </select>
        {laedt && <span style={{ fontSize: 12, color: '#64748b' }}>Lade...</span>}
      </div>
      {fehler && <div style={{ background: '#fee2e2', color: '#991b1b', padding: '8px 12px', borderRadius: 8, fontSize: 13, marginBottom: 10 }}>{fehler}</div>}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 18 }}>
        <div style={kachel}>
          <div style={{ fontSize: 11, color: '#64748b' }}>Umsatz (gefahren + storniert)</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--navy)' }}>{euro(umsatz)}</div>
        </div>
        <div style={kachel}>
          <div style={{ fontSize: 11, color: '#64748b' }}>Noch nicht abgerechnet</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#b45309' }}>{euro(nochNichtAbgerechnet)}</div>
        </div>
        <div style={kachel}>
          <div style={{ fontSize: 11, color: '#64748b' }}>Gefahren</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#15803d' }}>{gefahren}</div>
        </div>
        <div style={kachel}>
          <div style={{ fontSize: 11, color: '#64748b' }}>Storniert (Quote)</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#b91c1c' }}>
            {storniert} <span style={{ fontSize: 13, fontWeight: 600 }}>({prozent(stornoQuote)})</span>
          </div>
        </div>
        <div style={kachel}>
          <div style={{ fontSize: 11, color: '#64748b' }}>Noch offen / geplant</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#334155' }}>{offenAnz}</div>
        </div>
      </div>
      {ohnePreis > 0 && (
        <div style={{ background: '#fef3c7', color: '#92400e', padding: '8px 12px', borderRadius: 8, fontSize: 13, marginBottom: 14 }}>
          Bei {ohnePreis} gefahrenen oder stornierten Aufträgen fehlt noch der Preis. Sie fehlen im Umsatz.
        </div>
      )}

      <div style={{ fontWeight: 700, color: 'var(--navy)', fontSize: 14, margin: '4px 0 8px' }}>Umsatz pro Monat {jahr}</div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', height: 130, marginBottom: 22 }}>
        {monatsUmsatz.map((u, i) => (
          <div
            key={i}
            onClick={() => setMonat(i)}
            title={`${MONATE[i]}: ${euro(u)}`}
            style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%', cursor: 'pointer' }}
          >
            <div style={{ fontSize: 9, color: '#64748b', marginBottom: 2 }}>{u > 0 ? Math.round(u / 1000) + ' T€' : ''}</div>
            <div
              style={{
                width: '100%',
                height: `${(u / maxMonat) * 80}%`,
                minHeight: u > 0 ? 3 : 0,
                background: monat === i ? '#14325c' : '#7c9cc8',
                borderRadius: '4px 4px 0 0',
              }}
            />
            <div style={{ fontSize: 10, color: monat === i ? '#14325c' : '#64748b', fontWeight: monat === i ? 700 : 400, marginTop: 3 }}>
              {MONATE[i].slice(0, 3)}
            </div>
          </div>
        ))}
      </div>

      <div style={{ fontWeight: 700, color: 'var(--navy)', fontSize: 14, margin: '4px 0 8px' }}>Pro Kunde</div>
      <div style={{ overflowX: 'auto', marginBottom: 22 }}>
        <table className="rbl-tabelle" style={{ borderCollapse: 'collapse', width: '100%', minWidth: 520 }}>
          <thead>
            <tr style={{ background: '#f1f5f9' }}>
              <th style={zelle}>Kunde</th>
              <th style={rechts}>Aufträge</th>
              <th style={rechts}>Gefahren</th>
              <th style={rechts}>Storniert</th>
              <th style={rechts}>Stornoquote</th>
              <th style={rechts}>Umsatz</th>
            </tr>
          </thead>
          <tbody>
            {kunden.length === 0 && (
              <tr>
                <td style={zelle} colSpan={6}>
                  <span style={{ color: '#94a3b8' }}>Keine Aufträge im Zeitraum.</span>
                </td>
              </tr>
            )}
            {kunden.map(([k, z]) => (
              <tr key={k}>
                <td style={zelle}>{k}</td>
                <td style={rechts}>{z.anz}</td>
                <td style={rechts}>{z.gef}</td>
                <td style={rechts}>{z.sto}</td>
                <td style={rechts}>{z.gef + z.sto > 0 ? prozent((z.sto / (z.gef + z.sto)) * 100) : '–'}</td>
                <td style={{ ...rechts, fontWeight: 600 }}>{euro(z.umsatz)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ fontWeight: 700, color: 'var(--navy)', fontSize: 14, margin: '4px 0 8px' }}>Auftragsschichten pro Person</div>
      {dienstHinweis && <div style={{ fontSize: 12, color: '#92400e', marginBottom: 6 }}>Die Schichtdaten konnten mit deiner Rolle nicht geladen werden.</div>}
      <div style={{ overflowX: 'auto' }}>
        <table className="rbl-tabelle" style={{ borderCollapse: 'collapse', width: '100%', minWidth: 420 }}>
          <thead>
            <tr style={{ background: '#f1f5f9' }}>
              <th style={zelle}>Person</th>
              <th style={rechts}>Schichten</th>
              <th style={rechts}>Stunden (ohne Pause)</th>
            </tr>
          </thead>
          <tbody>
            {personenListe.length === 0 && (
              <tr>
                <td style={zelle} colSpan={3}>
                  <span style={{ color: '#94a3b8' }}>Keine Auftragsschichten im Zeitraum.</span>
                </td>
              </tr>
            )}
            {personenListe.map((p) => (
              <tr key={p.name}>
                <td style={zelle}>{p.name}</td>
                <td style={rechts}>{p.dienste}</td>
                <td style={rechts}>{(p.minuten / 60).toLocaleString('de-DE', { maximumFractionDigits: 1 })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 10 }}>
        Gezählt werden nur Schichten, die aus einem Auftrag entstanden sind (Spotschichten mit Auftragsbezug). Normale Schichten aus dem Dienstplan sind hier nicht enthalten.
      </p>
    </div>
  )
}
