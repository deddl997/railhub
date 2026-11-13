import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase'
import { datumZuISO } from './datumUtils'
import { useLiveAktualisierung } from './liveAktualisierung'

// Wie viele Minuten nach Dienstbeginn gilt jemand als "nicht erschienen"
const KULANZ_MINUTEN = 15
// Ab wann vor Dienstbeginn eine Warnung "noch nicht angemeldet" kommt
const VORWARN_MINUTEN = 60
// Wie viele Tage zurück nicht erledigte Dienste angezeigt werden
const TAGE_ZURUECK = 3

interface VorlageZeile {
  id: string
  name: string
  beginn_zeit: string
  ende_zeit: string
  dienstort: string | null
}
interface EintragZeile {
  mitarbeiter_id: string
  datum: string
  schichtvorlage_id: string | null
  ist_spotschicht: boolean
  spot_name: string | null
  spot_beginn_zeit: string | null
  spot_ende_zeit: string | null
  spot_dienstort: string | null
  abw_beginn_zeit?: string | null
  abw_ende_zeit?: string | null
  abw_dienstort?: string | null
  status: string | null
}
interface MitarbeiterZeile {
  id: string
  name: string
  kategorie: string | null
}
interface AntrittZeile {
  mitarbeiter_id: string
  datum: string
  status: 'angemeldet' | 'nicht_erschienen' | 'verschoben'
  gemeldet_am: string | null
  gemeldet_von: string
  neuer_beginn: string | null
}

export type AntrittArt = 'vorbei' | 'zuspaet' | 'bald' | 'kommend' | 'laeuft' | 'angemeldet' | 'nicht_erschienen'

export interface AntrittReihe {
  key: string
  mitarbeiterId: string
  name: string
  kategorie: string
  datum: string
  titel: string
  ort: string
  beginn: string
  ende: string
  beginnAbs: number
  endeAbs: number
  art: AntrittArt
  text: string
  verschobenAuf: string | null
  gemeldetUm: string | null
}

export interface AntrittDaten {
  reihen: AntrittReihe[]
  probleme: number
  laedt: boolean
  fehler: string | null
  neuLaden: () => void
}

function tagStart(iso: string): number {
  const [j, m, t] = iso.split('-').map(Number)
  return Date.UTC(j, m - 1, t) / 60000
}
function zeitMin(z: string): number {
  const [h, m] = z.slice(0, 5).split(':').map(Number)
  return h * 60 + m
}
function isoPlus(iso: string, tage: number): string {
  const [j, m, t] = iso.split('-').map(Number)
  return datumZuISO(new Date(j, m - 1, t + tage))
}
function montagVon(iso: string): string {
  const [j, m, t] = iso.split('-').map(Number)
  const d = new Date(j, m - 1, t)
  return datumZuISO(new Date(j, m - 1, t - ((d.getDay() + 6) % 7)))
}
function datumKurz(iso: string): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`
}
function dauerText(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return h > 0 ? `${h} h ${m} min` : `${m} min`
}
function uhrzeitAusIso(ts: string | null): string | null {
  if (!ts) return null
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// Lädt Dienste der letzten Tage und die Anmeldungen und berechnet für jeden Dienst den Stand
export function useAntrittDaten(aktiv: boolean): AntrittDaten {
  const [vorlagen, setVorlagen] = useState<VorlageZeile[]>([])
  const [eintraege, setEintraege] = useState<EintragZeile[]>([])
  const [mitarbeiter, setMitarbeiter] = useState<MitarbeiterZeile[]>([])
  const [antritte, setAntritte] = useState<AntrittZeile[]>([])
  const [freigaben, setFreigaben] = useState<string[]>([])
  const [urlaube, setUrlaube] = useState<{ mitarbeiter_id: string; erster_tag: string; letzter_tag: string }[]>([])
  const [laedt, setLaedt] = useState(true)
  const [fehler, setFehler] = useState<string | null>(null)
  const [takt, setTakt] = useState(0)

  const laden = useCallback(async () => {
    if (!aktiv) return
    const heuteIso = datumZuISO(new Date())
    const von = isoPlus(heuteIso, -TAGE_ZURUECK)
    const [vor, ein, mit, ant, fre, urlaub] = await Promise.all([
      supabase.from('schichtvorlagen').select('id, name, beginn_zeit, ende_zeit, dienstort'),
      supabase
        .from('dienstplan_eintraege')
        .select('mitarbeiter_id, datum, schichtvorlage_id, ist_spotschicht, spot_name, spot_beginn_zeit, spot_ende_zeit, spot_dienstort, abw_beginn_zeit, abw_ende_zeit, abw_dienstort, status')
        .gte('datum', von)
        .lte('datum', heuteIso),
      supabase.from('mitarbeiter').select('id, name, kategorie'),
      supabase.from('dienst_antritt').select('mitarbeiter_id, datum, status, gemeldet_am, gemeldet_von, neuer_beginn').gte('datum', von).lte('datum', heuteIso),
      supabase.from('dienstplan_freigaben').select('woche_start').gte('woche_start', montagVon(von)).lte('woche_start', heuteIso),
      supabase.from('urlaubsantraege').select('mitarbeiter_id, erster_tag, letzter_tag').eq('status', 'genehmigt').lte('erster_tag', heuteIso).gte('letzter_tag', von),
    ])
    if (vor.error || ein.error || mit.error) {
      setFehler((vor.error ?? ein.error ?? mit.error)?.message ?? 'Fehler beim Laden')
      setLaedt(false)
      return
    }
    setVorlagen((vor.data ?? []) as VorlageZeile[])
    setEintraege((ein.data ?? []) as EintragZeile[])
    setMitarbeiter((mit.data ?? []) as MitarbeiterZeile[])
    if (!ant.error) setAntritte((ant.data ?? []) as AntrittZeile[])
    else setFehler('Tabelle „dienst_antritt“ fehlt. Bitte zuerst dienstantritt.sql in Supabase ausführen.')
    setFreigaben(((fre.data ?? []) as { woche_start: string }[]).map((f) => String(f.woche_start)))
    setUrlaube((urlaub.data ?? []) as { mitarbeiter_id: string; erster_tag: string; letzter_tag: string }[])
    if (!ant.error) setFehler(null)
    setLaedt(false)
  }, [aktiv])

  useEffect(() => {
    void laden()
  }, [laden])
  useLiveAktualisierung(['dienstplan_eintraege', 'dienst_antritt', 'dienstplan_freigaben', 'urlaubsantraege'], laden, aktiv)

  // Jede Minute neu bewerten, damit "nicht erschienen" von selbst auftaucht
  useEffect(() => {
    if (!aktiv) return
    const t = setInterval(() => setTakt((n) => n + 1), 60000)
    return () => clearInterval(t)
  }, [aktiv])

  const reihen = useMemo(() => {
    const jetzt = new Date()
    const heuteIso = datumZuISO(jetzt)
    const jetztAbs = tagStart(heuteIso) + jetzt.getHours() * 60 + jetzt.getMinutes()
    const ergebnis: AntrittReihe[] = []
    for (const e of eintraege) {
      if (e.status) continue
      if (!freigaben.includes(montagVon(e.datum))) continue
      if (urlaube.some((u) => u.mitarbeiter_id === e.mitarbeiter_id && e.datum >= u.erster_tag && e.datum <= u.letzter_tag)) continue
      const m = mitarbeiter.find((x) => x.id === e.mitarbeiter_id)
      if (!m) continue
      let titel = ''
      let beginn = ''
      let ende = ''
      let ort = ''
      if (e.ist_spotschicht && e.spot_beginn_zeit && e.spot_ende_zeit) {
        titel = e.spot_name ?? 'Spotschicht'
        beginn = e.spot_beginn_zeit
        ende = e.spot_ende_zeit
        ort = e.spot_dienstort ?? ''
      } else {
        const v = vorlagen.find((x) => x.id === e.schichtvorlage_id)
        if (!v) continue
        titel = v.name
        beginn = e.abw_beginn_zeit ?? v.beginn_zeit
        ende = e.abw_ende_zeit ?? v.ende_zeit
        ort = e.abw_dienstort ?? v.dienstort ?? ''
      }
      const basis = tagStart(e.datum)
      const beginnAbs = basis + zeitMin(beginn)
      let endeAbs = basis + zeitMin(ende)
      if (endeAbs <= beginnAbs) endeAbs += 1440
      const rec = antritte.find((a) => a.mitarbeiter_id === e.mitarbeiter_id && a.datum === e.datum)
      const verschobenAuf = rec?.status === 'verschoben' ? rec.neuer_beginn?.slice(0, 5) ?? null : null
      const beginnEff = verschobenAuf ? basis + zeitMin(verschobenAuf) : beginnAbs

      let art: AntrittArt
      let text: string
      if (rec?.status === 'angemeldet') {
        art = 'angemeldet'
        text = `Angemeldet um ${uhrzeitAusIso(rec.gemeldet_am) ?? '?'}${rec.gemeldet_von === 'planer' ? ' (vom Planer eingetragen)' : ''}`
      } else if (rec?.status === 'nicht_erschienen') {
        art = 'nicht_erschienen'
        text = 'Als nicht erschienen vermerkt'
      } else if (jetztAbs >= endeAbs) {
        art = 'vorbei'
        text = 'Dienst ohne Anmeldung vorbei'
      } else if (jetztAbs >= beginnEff + KULANZ_MINUTEN) {
        art = 'zuspaet'
        text = `Nicht zum Dienst erschienen, ${dauerText(jetztAbs - beginnEff)} nach Dienstbeginn${verschobenAuf ? ` (verschoben auf ${verschobenAuf})` : ''}`
      } else if (jetztAbs >= beginnEff - VORWARN_MINUTEN) {
        art = 'bald'
        text = jetztAbs >= beginnEff ? 'Dienstbeginn, noch nicht angemeldet' : `Dienstbeginn in ${dauerText(beginnEff - jetztAbs)}, noch nicht angemeldet`
      } else {
        art = 'kommend'
        text = `Dienstbeginn ${verschobenAuf ?? beginn.slice(0, 5)}${verschobenAuf ? ' (verschoben)' : ''}`
      }
      ergebnis.push({
        key: `${e.mitarbeiter_id}|${e.datum}`,
        mitarbeiterId: e.mitarbeiter_id,
        name: m.name,
        kategorie: m.kategorie ?? 'Ohne Kategorie',
        datum: e.datum,
        titel,
        ort,
        beginn: beginn.slice(0, 5),
        ende: ende.slice(0, 5),
        beginnAbs,
        endeAbs,
        art,
        text,
        verschobenAuf,
        gemeldetUm: rec ? uhrzeitAusIso(rec.gemeldet_am) : null,
      })
    }
    return ergebnis.sort((a, b) => a.beginnAbs - b.beginnAbs)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eintraege, vorlagen, mitarbeiter, antritte, freigaben, urlaube, takt])

  const probleme = reihen.filter((r) => r.kategorie === 'Lokführer' && (r.art === 'vorbei' || r.art === 'zuspaet')).length
  return { reihen, probleme, laedt, fehler, neuLaden: () => void laden() }
}

const KATEGORIE_FILTER = ['Lokführer', 'Wagenmeister', 'Alle'] as const

export default function Dienstantritt({ daten }: { daten: AntrittDaten }) {
  const [filter, setFilter] = useState<(typeof KATEGORIE_FILTER)[number]>('Lokführer')
  const [verschiebenFuer, setVerschiebenFuer] = useState<string | null>(null)
  const [neueZeit, setNeueZeit] = useState('')
  const [meldung, setMeldung] = useState<string | null>(null)
  const heuteIso = datumZuISO(new Date())

  const gefiltert = daten.reihen.filter((r) => filter === 'Alle' || r.kategorie === filter)
  const zaehler = (f: (typeof KATEGORIE_FILTER)[number]) => daten.reihen.filter((r) => (f === 'Alle' || r.kategorie === f) && (r.art === 'vorbei' || r.art === 'zuspaet' || r.art === 'bald')).length
  const aufmerksam = gefiltert.filter((r) => r.art === 'vorbei' || r.art === 'zuspaet' || r.art === 'bald')
  const aufmerksamSortiert = [...aufmerksam].sort((a, b) => Number(b.art === 'zuspaet' || b.art === 'vorbei') - Number(a.art === 'zuspaet' || a.art === 'vorbei') || a.beginnAbs - b.beginnAbs)
  const heute = gefiltert.filter((r) => !aufmerksam.includes(r) && (r.datum === heuteIso || r.endeAbs > Date.now() / 60000))
  const heuteGesamt = gefiltert.filter((r) => r.datum === heuteIso)
  const heuteAngemeldet = heuteGesamt.filter((r) => r.art === 'angemeldet').length
  const erledigt = gefiltert.filter((r) => !aufmerksam.includes(r) && r.datum < heuteIso && (r.art === 'angemeldet' || r.art === 'nicht_erschienen'))

  async function setzen(r: AntrittReihe, status: 'angemeldet' | 'nicht_erschienen' | 'verschoben', neuerBeginn?: string) {
    setMeldung(null)
    const { error } = await supabase.from('dienst_antritt').upsert(
      {
        mitarbeiter_id: r.mitarbeiterId,
        datum: r.datum,
        status,
        gemeldet_am: new Date().toISOString(),
        gemeldet_von: 'planer',
        neuer_beginn: status === 'verschoben' ? neuerBeginn ?? null : null,
      },
      { onConflict: 'mitarbeiter_id,datum' }
    )
    if (error) setMeldung(`Fehler: ${error.message}`)
    setVerschiebenFuer(null)
    daten.neuLaden()
  }
  async function zuruecknehmen(r: AntrittReihe) {
    const { error } = await supabase.from('dienst_antritt').delete().eq('mitarbeiter_id', r.mitarbeiterId).eq('datum', r.datum)
    if (error) setMeldung(`Fehler: ${error.message}`)
    daten.neuLaden()
  }

  const knopfKlein: React.CSSProperties = { border: '1px solid var(--border)', background: '#fff', borderRadius: 8, padding: '7px 12px', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }

  function zeile(r: AntrittReihe) {
    const rot = r.art === 'vorbei' || r.art === 'zuspaet'
    const gelb = r.art === 'bald'
    const gruen = r.art === 'angemeldet'
    const rahmen = rot ? '#fca5a5' : gelb ? '#fcd34d' : gruen ? '#86efac' : 'var(--border)'
    const hinter = rot ? '#fef2f2' : gelb ? '#fffbeb' : gruen ? '#f0fdf4' : '#fff'
    const farbe = rot ? '#b91c1c' : gelb ? '#b45309' : gruen ? '#166534' : 'var(--text-muted)'
    const offen = r.art !== 'angemeldet' && r.art !== 'nicht_erschienen'
    return (
      <div key={r.key} style={{ border: `1px solid ${rahmen}`, background: hinter, borderRadius: 12, padding: '10px 14px', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ width: 14, height: 14, borderRadius: 999, background: farbe, flex: 'none', boxShadow: `0 0 0 4px ${rot ? '#fecaca' : gelb ? '#fde68a' : gruen ? '#bbf7d0' : '#e2e8f0'}` }} />
          <div style={{ minWidth: 200, flex: '1 1 220px' }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{r.name}{filter === 'Alle' && <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--text-muted)' }}> · {r.kategorie}</span>}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {datumKurz(r.datum)} {r.beginn}–{r.ende}{r.titel ? ` · ${r.titel}` : ''}{r.ort ? ` · ${r.ort}` : ''}
            </div>
          </div>
          <div style={{ flex: '2 1 240px', fontWeight: 600, color: farbe, fontSize: 14 }}>{r.text}</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {offen ? (
              <>
                <button style={knopfKlein} onClick={() => void setzen(r, 'angemeldet')}>✓ Ist da</button>
                <button style={knopfKlein} onClick={() => (setVerschiebenFuer(verschiebenFuer === r.key ? null : r.key), setNeueZeit(r.verschobenAuf ?? r.beginn))}>🕐 Verschieben</button>
                <button style={knopfKlein} onClick={() => window.confirm(`${r.name} als nicht erschienen vermerken?`) && void setzen(r, 'nicht_erschienen')}>Nicht erschienen</button>
              </>
            ) : (
              <button style={knopfKlein} onClick={() => void zuruecknehmen(r)}>↶ Zurücknehmen</button>
            )}
          </div>
        </div>
        {verschiebenFuer === r.key && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--border)', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13 }}>Neuer Dienstbeginn:</span>
            <input type="time" value={neueZeit} onChange={(e) => setNeueZeit(e.target.value)} style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 14 }} />
            <button style={{ ...knopfKlein, background: 'var(--navy)', color: '#fff', border: 'none' }} disabled={!neueZeit} onClick={() => void setzen(r, 'verschoben', neueZeit)}>Speichern</button>
            <button style={knopfKlein} onClick={() => setVerschiebenFuer(null)}>Abbrechen</button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>Anzeigen</span>
        {KATEGORIE_FILTER.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{ border: '1px solid var(--navy)', background: filter === f ? 'var(--navy)' : '#fff', color: filter === f ? '#fff' : 'var(--navy)', borderRadius: 999, padding: '5px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
          >
            {f}
            {zaehler(f) > 0 && <span style={{ marginLeft: 6, background: '#dc2626', color: '#fff', borderRadius: 999, padding: '0 7px', fontSize: 11 }}>{zaehler(f)}</span>}
          </button>
        ))}
      </div>

      {daten.fehler && <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', color: '#b91c1c', borderRadius: 8, padding: 10, marginBottom: 12, fontSize: 13 }}>{daten.fehler}</div>}
      {meldung && <div style={{ color: '#b91c1c', fontSize: 13, marginBottom: 8 }}>{meldung}</div>}
      {daten.laedt && <p style={{ color: 'var(--text-muted)' }}>Lädt …</p>}

      {!daten.laedt && aufmerksamSortiert.length === 0 && (
        <div style={{ background: '#f0fdf4', border: '1px solid #86efac', color: '#166534', borderRadius: 12, padding: '12px 16px', marginBottom: 14, fontWeight: 600 }}>
          ✓ Alles in Ordnung, niemand fehlt.
        </div>
      )}
      {aufmerksamSortiert.length > 0 && (
        <>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#b91c1c', margin: '4px 0 8px' }}>Braucht Aufmerksamkeit ({aufmerksamSortiert.length})</div>
          {aufmerksamSortiert.map(zeile)}
        </>
      )}

      {heute.length > 0 && (
        <>
          <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-muted)', margin: '16px 0 8px' }}>Heute und laufende Dienste ({heute.length})</div>
          {heute.map(zeile)}
        </>
      )}

      {erledigt.length > 0 && (
        <details style={{ marginTop: 16 }}>
          <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--text-muted)' }}>Zuletzt erledigt ({erledigt.length})</summary>
          <div style={{ marginTop: 8 }}>{erledigt.map(zeile)}</div>
        </details>
      )}

      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 16 }}>
        Dienstantritt heute: {heuteAngemeldet} von {heuteGesamt.length} angemeldet. Als „nicht erschienen“ gilt, wer {KULANZ_MINUTEN} Minuten nach Dienstbeginn nicht angemeldet ist. Die Lokführer melden sich in „Mein Dienstplan“ mit „Dienstantritt melden“ an.
      </div>
    </div>
  )
}
