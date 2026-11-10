import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase'
import { useLiveAktualisierung } from './liveAktualisierung'

interface Eintrag {
  id: number
  zeit: string
  tabelle: string
  aktion: 'INSERT' | 'UPDATE' | 'DELETE'
  person: string | null
  geaendert_von_name: string | null
  felder: string[] | null
  alt: Record<string, unknown> | null
  neu: Record<string, unknown> | null
}

const TABELLEN: Record<string, string> = {
  urlaubsantraege: 'Urlaub',
  mitarbeiter: 'Mitarbeiter',
  mitarbeiter_jahresdaten: 'Jahresdaten',
  dienstplan_eintraege: 'Dienstplan',
  wunschfrei: 'Wunschfrei',
}

const FELDNAMEN: Record<string, string> = {
  name: 'Name', email: 'E-Mail', rolle: 'Rolle', kategorie: 'Kategorie', lok_typen: 'Lok-Typen',
  status: 'Status', erster_tag: 'Von', letzter_tag: 'Bis', anzahl_tage: 'Tage', brauchbare_tage: 'Brauchbare Tage',
  mitarbeiter_id: 'Zuordnung', urlaubsanspruch: 'Urlaubsanspruch', resturlaub: 'Resturlaub',
  resturlaub_vorjahr: 'Resturlaub Vorjahr', rfu_datum: 'Termin RFU', simulator_datum: 'Termin Simulator',
  datum: 'Datum', schichtvorlage_id: 'Schicht', auth_user_id: 'Konto-Verknüpfung',
}

const wert = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return '–'
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v.split('-').reverse().join('.')
  if (Array.isArray(v)) return v.join(', ') || '–'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function beschreibung(e: Eintrag): string {
  const t = TABELLEN[e.tabelle] ?? e.tabelle
  if (e.aktion === 'INSERT') {
    const n = e.neu ?? {}
    if (e.tabelle === 'urlaubsantraege') return `Urlaubsantrag angelegt: ${wert(n.erster_tag)} – ${wert(n.letzter_tag)}`
    if (e.tabelle === 'mitarbeiter') return 'Mitarbeiter angelegt'
    return `${t}: Eintrag angelegt`
  }
  if (e.aktion === 'DELETE') {
    const a = e.alt ?? {}
    if (e.tabelle === 'urlaubsantraege') return `Urlaubsantrag gelöscht: ${wert(a.erster_tag)} – ${wert(a.letzter_tag)}`
    if (e.tabelle === 'mitarbeiter') return 'Mitarbeiter gelöscht'
    return `${t}: Eintrag gelöscht`
  }
  const felder = (e.felder ?? []).filter((f) => f !== 'created_at')
  if (e.tabelle === 'urlaubsantraege' && felder.length === 1 && felder[0] === 'status') {
    const s = String(e.neu?.status ?? '')
    return s === 'genehmigt' ? 'Urlaub genehmigt' : s === 'abgelehnt' ? 'Urlaub abgelehnt' : `Urlaubsstatus: ${wert(e.alt?.status)} → ${wert(e.neu?.status)}`
  }
  return felder.map((f) => `${FELDNAMEN[f] ?? f}: ${wert(e.alt?.[f])} → ${wert(e.neu?.[f])}`).join(' · ') || `${t}: geändert`
}

const ZEITRAEUME = [
  { id: '1', label: 'Heute', tage: 1 },
  { id: '7', label: '7 Tage', tage: 7 },
  { id: '30', label: '30 Tage', tage: 30 },
  { id: '365', label: 'Jahr', tage: 365 },
]

export default function PersonalProtokoll() {
  const [eintraege, setEintraege] = useState<Eintrag[]>([])
  const [laedt, setLaedt] = useState(true)
  const [fehler, setFehler] = useState<string | null>(null)
  const [tabelle, setTabelle] = useState('alle')
  const [zeitraum, setZeitraum] = useState('30')
  const [suche, setSuche] = useState('')

  const laden = useCallback(async () => {
    const ab = new Date()
    ab.setDate(ab.getDate() - Number(zeitraum) + 1)
    ab.setHours(0, 0, 0, 0)
    const r = await supabase
      .from('personal_protokoll')
      .select('id, zeit, tabelle, aktion, person, geaendert_von_name, felder, alt, neu')
      .gte('zeit', ab.toISOString())
      .order('zeit', { ascending: false })
      .limit(1000)
    if (r.error) setFehler(r.error.message)
    else {
      setFehler(null)
      setEintraege((r.data ?? []) as Eintrag[])
    }
    setLaedt(false)
  }, [zeitraum])

  useEffect(() => {
    setLaedt(true)
    void laden()
  }, [laden])
  useLiveAktualisierung(['personal_protokoll'], laden)

  const sichtbar = useMemo(() => {
    const q = suche.trim().toLowerCase()
    return eintraege.filter((e) => {
      if (tabelle !== 'alle' && e.tabelle !== tabelle) return false
      if (!q) return true
      return `${e.person ?? ''} ${e.geaendert_von_name ?? ''} ${beschreibung(e)}`.toLowerCase().includes(q)
    })
  }, [eintraege, tabelle, suche])

  const chip = (aktiv: boolean): React.CSSProperties => ({
    border: '1px solid ' + (aktiv ? 'var(--navy)' : 'var(--border)'),
    background: aktiv ? 'var(--navy)' : '#fff',
    color: aktiv ? '#fff' : 'var(--text)',
    borderRadius: 999,
    padding: '5px 12px',
    fontSize: 13,
    cursor: 'pointer',
  })

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <input
          value={suche}
          onChange={(e) => setSuche(e.target.value)}
          placeholder="Suche (Person, Bearbeiter, Text)…"
          style={{ padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 14, minWidth: 220 }}
        />
        {ZEITRAEUME.map((z) => (
          <button key={z.id} style={chip(zeitraum === z.id)} onClick={() => setZeitraum(z.id)}>{z.label}</button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
        <button style={chip(tabelle === 'alle')} onClick={() => setTabelle('alle')}>Alle</button>
        {Object.entries(TABELLEN).map(([k, l]) => (
          <button key={k} style={chip(tabelle === k)} onClick={() => setTabelle(k)}>{l}</button>
        ))}
      </div>

      {fehler && <p style={{ color: 'var(--danger)' }}>Fehler: {fehler} (SQL „personal_protokoll.sql“ schon ausgeführt?)</p>}
      {laedt ? (
        <p style={{ color: 'var(--text-muted)' }}>Lädt…</p>
      ) : sichtbar.length === 0 ? (
        <p style={{ color: 'var(--text-muted)' }}>Keine Einträge im gewählten Zeitraum.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="rbl-tabelle" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}>
                <th style={{ padding: '6px 8px' }}>Zeit</th>
                <th style={{ padding: '6px 8px' }}>Bereich</th>
                <th style={{ padding: '6px 8px' }}>Person</th>
                <th style={{ padding: '6px 8px' }}>Änderung</th>
                <th style={{ padding: '6px 8px' }}>Durch</th>
              </tr>
            </thead>
            <tbody>
              {sichtbar.map((e) => (
                <tr key={e.id} style={{ borderTop: '1px solid var(--border)', verticalAlign: 'top' }}>
                  <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                    {new Date(e.zeit).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td style={{ padding: '6px 8px' }}>{TABELLEN[e.tabelle] ?? e.tabelle}</td>
                  <td style={{ padding: '6px 8px', fontWeight: 500 }}>{e.person ?? '–'}</td>
                  <td style={{ padding: '6px 8px' }}>{beschreibung(e)}</td>
                  <td style={{ padding: '6px 8px', color: 'var(--text-muted)' }}>{e.geaendert_von_name ?? 'System'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
