import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'

interface AuftragKurz {
  referenz: string | null
  kunde: string | null
  zug_nr: string | null
  abfahrt_datum: string | null
}

interface Eintrag {
  id: string
  zeitpunkt: string
  benutzer: string | null
  aktion: string
  aenderungen: Record<string, { alt: unknown; neu: unknown }> | null
  auftraege: AuftragKurz | AuftragKurz[] | null
}

const FELDNAMEN: Record<string, string> = {
  kunde: 'Kunde',
  referenz: 'Referenz',
  zug_nr: 'Zugnummer',
  evu: 'EVU',
  status: 'Status',
  abfahrt_ort: 'Abfahrt Ort',
  abfahrt_datum: 'Abfahrt Datum',
  abfahrt_soll: 'Abfahrt Soll',
  abfahrt_ist: 'Abfahrt Ist',
  ankunft_ort: 'Ankunft Ort',
  ankunft_datum: 'Ankunft Datum',
  ankunft_soll: 'Ankunft Soll',
  ankunft_ist: 'Ankunft Ist',
  anzahl_wagen: 'Anzahl Wagen',
  ggk: 'Last/Leer, Zuschläge',
  lok: 'Lok',
  wgm_info: 'Wagenmeister',
  infos: 'Infos',
  mitarbeiter_info: 'Mitarbeiter-Info',
  abrechnung_status: 'Abrechnung',
  kuerzel_planung: 'Kürzel Planung',
  kuerzel_abrechnung: 'Kürzel Abrechnung',
  kontrolle: 'Kontrolle',
  preis: 'Preis',
  rechnungsnr: 'Rechnungsnr.',
  info_abrechnung: 'Info Abrechnung',
  storno_datum: 'Storno Datum',
  storno_zeit: 'Storno Zeit',
  storno_grund: 'Storno Grund',
  fahrten: 'Fahrten',
}

function wert(v: unknown): string {
  if (v === null || v === undefined || v === '') return '–'
  if (typeof v === 'object') return 'geändert'
  return String(v)
}

function auftragVon(e: Eintrag): AuftragKurz | null {
  if (!e.auftraege) return null
  return Array.isArray(e.auftraege) ? e.auftraege[0] ?? null : e.auftraege
}

export default function Protokoll() {
  const [tage, setTage] = useState(7)
  const [eintraege, setEintraege] = useState<Eintrag[]>([])
  const [laedt, setLaedt] = useState(true)
  const [fehler, setFehler] = useState<string | null>(null)
  const [suche, setSuche] = useState('')
  const [benutzer, setBenutzer] = useState('alle')
  const [nurAenderungen, setNurAenderungen] = useState(false)

  useEffect(() => {
    async function laden() {
      setLaedt(true)
      setFehler(null)
      const ab = new Date()
      ab.setDate(ab.getDate() - tage)
      const antwort = await supabase
        .from('auftrag_historie')
        .select('id, zeitpunkt, benutzer, aktion, aenderungen, auftraege(referenz, kunde, zug_nr, abfahrt_datum)')
        .gte('zeitpunkt', ab.toISOString())
        .order('zeitpunkt', { ascending: false })
        .limit(500)
      if (antwort.error) setFehler(antwort.error.message)
      else setEintraege((antwort.data ?? []) as unknown as Eintrag[])
      setLaedt(false)
    }
    laden()
  }, [tage])

  const benutzerListe = Array.from(new Set(eintraege.map((e) => e.benutzer ?? 'Unbekannt'))).sort()
  const gefiltert = eintraege.filter((e) => {
    if (benutzer !== 'alle' && (e.benutzer ?? 'Unbekannt') !== benutzer) return false
    if (nurAenderungen && e.aktion === 'angelegt') return false
    const t = suche.trim().toLowerCase()
    if (t === '') return true
    const a = auftragVon(e)
    return [a?.referenz, a?.kunde, a?.zug_nr, e.benutzer].some((x) => (x ?? '').toLowerCase().includes(t))
  })

  const nachTag: { tag: string; liste: Eintrag[] }[] = []
  for (const e of gefiltert) {
    const tag = new Date(e.zeitpunkt).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })
    const letzte = nachTag[nachTag.length - 1]
    if (letzte && letzte.tag === tag) letzte.liste.push(e)
    else nachTag.push({ tag, liste: [e] })
  }

  const feld: React.CSSProperties = { padding: '5px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13 }

  return (
    <div>
      <p style={{ fontSize: 13, color: '#475569', marginTop: 0 }}>
        Alle Änderungen an Aufträgen: wer hat wann was geändert. Für einen einzelnen Auftrag steht das Protokoll weiter im Auftrag selbst.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
        <select value={tage} onChange={(e) => setTage(Number(e.target.value))} style={feld}>
          <option value={1}>Letzte 24 Stunden</option>
          <option value={7}>Letzte 7 Tage</option>
          <option value={30}>Letzte 30 Tage</option>
          <option value={90}>Letzte 90 Tage</option>
        </select>
        <select value={benutzer} onChange={(e) => setBenutzer(e.target.value)} style={feld}>
          <option value="alle">Alle Benutzer</option>
          {benutzerListe.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
        <input value={suche} onChange={(e) => setSuche(e.target.value)} placeholder="Referenz, Kunde, Zug oder Benutzer" style={{ ...feld, minWidth: 240 }} />
        <label style={{ fontSize: 13, display: 'flex', gap: 4, alignItems: 'center' }}>
          <input type="checkbox" checked={nurAenderungen} onChange={(e) => setNurAenderungen(e.target.checked)} />
          neu angelegte ausblenden
        </label>
        <span style={{ fontSize: 12, color: '#64748b' }}>{gefiltert.length} Einträge{eintraege.length >= 500 ? ' (max. 500 geladen)' : ''}</span>
      </div>
      {fehler && <div style={{ background: '#fee2e2', color: '#991b1b', padding: '8px 12px', borderRadius: 8, fontSize: 13 }}>{fehler}</div>}
      {laedt && <p style={{ color: '#64748b' }}>Lade...</p>}
      {!laedt && gefiltert.length === 0 && <p style={{ color: '#94a3b8', fontSize: 13 }}>Keine Einträge im gewählten Zeitraum.</p>}
      {nachTag.map((g) => (
        <div key={g.tag} style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 700, color: 'var(--navy)', fontSize: 13, margin: '8px 0 4px' }}>{g.tag}</div>
          {g.liste.map((e) => {
            const a = auftragVon(e)
            return (
              <div key={e.id} style={{ padding: '6px 0', borderBottom: '1px solid #f1f5f9', fontSize: 12.5, color: '#334155' }}>
                <b>{new Date(e.zeitpunkt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</b> · {e.benutzer ?? 'Unbekannt'} ·{' '}
                {e.aktion === 'angelegt' ? 'hat angelegt' : 'hat geändert'}:{' '}
                <b>{a?.referenz || a?.zug_nr || 'Auftrag'}</b>
                {a?.kunde ? ` (${a.kunde})` : ''}
                {a?.abfahrt_datum ? ` · Fahrt am ${a.abfahrt_datum.split('-').reverse().join('.')}` : ''}
                {Object.entries(e.aenderungen ?? {}).map(([k, v]) => (
                  <div key={k} style={{ marginLeft: 14, color: '#475569' }}>
                    {FELDNAMEN[k] ?? k}: {wert(v.alt)} → {wert(v.neu)}
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
