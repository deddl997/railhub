import { useCallback, useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from './lib/supabase'
import { useLiveAktualisierung } from './liveAktualisierung'
import { datumZuISO } from './datumUtils'
import { fahrtenAusAuftrag, fahrtenPruefen } from './auftragSchicht'
import type { Fahrtzeile } from './auftragSchicht'

// Mindest-Wendezeit zwischen zwei Leistungen derselben Lok (Minuten). Darunter gibt es eine Warnung.
const WENDE_MINUTEN = 15
const OHNE_LOK = '(ohne Lok)'
const WOCHENTAGE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']

interface AuftragZeile {
  id: string
  kunde: string | null
  referenz: string | null
  zug_nr: string | null
  abfahrt_ort: string | null
  abfahrt_datum: string
  abfahrt_soll: string | null
  ankunft_ort: string | null
  ankunft_datum: string | null
  ankunft_soll: string | null
  lok: string | null
  fahrten: unknown
  status: string | null
  storno_datum: string | null
}

interface Leistung {
  key: string
  auftragId: string
  lok: string
  art: string
  titel: string
  kunde: string
  von: string
  nach: string
  start: number // Minuten seit 1970 (lokale Zeit als UTC gelesen)
  ende: number
  warnungen: string[]
}

type Ansicht = 'tag' | 'woche'

interface StammLok {
  id: string
  bezeichnung: string
  typ: string
  aktiv: boolean
  sortierung: number
}

// Schreibweise-unabhängiger Vergleich: "185 537", "185-537" und "185537" gelten als dieselbe Lok
function lokSchluessel(t: string): string {
  return t.toLowerCase().replace(/[\s\-_.]/g, '')
}

// ---------- Hilfen ----------
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
  const wt = (d.getDay() + 6) % 7
  return datumZuISO(new Date(j, m - 1, t - wt))
}
function minutenAlsUhr(abs: number): string {
  const rest = ((abs % 1440) + 1440) % 1440
  return `${String(Math.floor(rest / 60)).padStart(2, '0')}:${String(rest % 60).padStart(2, '0')}`
}
function absAlsIso(abs: number): string {
  const d = new Date(abs * 60000)
  return datumZuISO(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}
function datumDe(iso: string): string {
  const [j, m, t] = iso.split('-')
  return `${t}.${m}.${j}`
}
function ortGleich(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}
function lokName(roh: string | null | undefined): string {
  const t = (roh ?? '').replace(/\s+/g, ' ').trim()
  return t === '' ? OHNE_LOK : t
}

// Zerlegt die Aufträge in einzelne Leistungen (Lokzuführung, Zugfahrt, Rückführung, Rangieren ...) mit absoluten Zeiten
function leistungenAus(auftraege: AuftragZeile[], kanon: Map<string, string>): Leistung[] {
  const ergebnis: Leistung[] = []
  for (const a of auftraege) {
    let fahrten: Fahrtzeile[] = fahrtenPruefen(a.fahrten).filter((f) => f.von_zeit && f.nach_zeit)
    if (fahrten.length === 0) {
      fahrten = fahrtenAusAuftrag({
        referenz: a.referenz,
        zug_nr: a.zug_nr,
        abfahrt_ort: a.abfahrt_ort,
        abfahrt_datum: a.abfahrt_datum,
        abfahrt_soll: a.abfahrt_soll,
        ankunft_ort: a.ankunft_ort,
        ankunft_datum: a.ankunft_datum,
        ankunft_soll: a.ankunft_soll,
        lok: a.lok,
        mitarbeiter_info: null,
      }).filter((f) => f.von_zeit && f.nach_zeit)
    }
    if (fahrten.length === 0) continue

    const basis = tagStart(a.abfahrt_datum)
    let versatz = 0
    // liegt die erste Zeit viel später als die Abfahrt des Auftrags, war sie am Vortag (z. B. Lokzuführung am Abend)
    if (a.abfahrt_soll && zeitMin(fahrten[0].von_zeit) - zeitMin(a.abfahrt_soll) > 720) versatz = -1440
    let letzte = -Infinity
    fahrten.forEach((f, i) => {
      let start = (f.datum ? tagStart(f.datum) : basis + versatz) + zeitMin(f.von_zeit)
      while (start < letzte) start += 1440
      let ende = start - zeitMin(f.von_zeit) + zeitMin(f.nach_zeit)
      while (ende < start) ende += 1440
      letzte = ende
      const titel = f.zug || [a.referenz, a.zug_nr ? `(${a.zug_nr})` : ''].filter(Boolean).join(' ') || f.art
      ergebnis.push({
        key: `${a.id}-${i}`,
        auftragId: a.id,
        lok: (() => {
          const n = lokName(f.lok || a.lok)
          return kanon.get(lokSchluessel(n)) ?? n
        })(),
        art: f.art,
        titel,
        kunde: a.kunde ?? '',
        von: f.von,
        nach: f.nach,
        start,
        ende,
        warnungen: [],
      })
    })
  }
  return ergebnis
}

// Ein Block = ein Auftrag auf einer Lok: Lokzuführung + Zugfahrt(en) + Rückführung verschmolzen
interface Block {
  key: string
  auftragId: string
  lok: string
  titel: string
  kunde: string
  start: number
  ende: number
  teile: Leistung[]
  warnung: boolean
}

function bloeckeAus(leistungen: Leistung[]): Block[] {
  const karte = new Map<string, Leistung[]>()
  for (const l of leistungen) {
    const k = `${l.auftragId}|${l.lok}`
    karte.set(k, [...(karte.get(k) ?? []), l])
  }
  const ergebnis: Block[] = []
  for (const [key, teile] of karte) {
    teile.sort((a, b) => a.start - b.start)
    const zuege = Array.from(new Set(teile.filter((t) => t.art === 'Zugfahrt').map((t) => t.titel)))
    ergebnis.push({
      key,
      auftragId: teile[0].auftragId,
      lok: teile[0].lok,
      titel: zuege.length > 0 ? zuege.join(' / ') : teile[0].titel,
      kunde: teile[0].kunde,
      start: teile[0].start,
      ende: Math.max(...teile.map((t) => t.ende)),
      teile,
      warnung: teile.some((t) => t.warnungen.length > 0),
    })
  }
  return ergebnis.sort((a, b) => a.start - b.start)
}

// Prüft pro Lok: Doppelbelegung, zu kurze Wendezeit, Ortssprung
function pruefen(leistungen: Leistung[]): string[] {
  const hinweise: string[] = []
  const proLok = new Map<string, Leistung[]>()
  for (const l of leistungen) {
    if (l.lok === OHNE_LOK) continue
    proLok.set(l.lok, [...(proLok.get(l.lok) ?? []), l])
  }
  for (const [lok, liste] of proLok) {
    liste.sort((a, b) => a.start - b.start)
    for (let i = 1; i < liste.length; i++) {
      const v = liste[i - 1]
      const n = liste[i]
      const bezug = `Lok ${lok}: ${v.titel} (${minutenAlsUhr(v.start)}–${minutenAlsUhr(v.ende)}) und ${n.titel} (${minutenAlsUhr(n.start)}–${minutenAlsUhr(n.ende)}, ${datumDe(absAlsIso(n.start))})`
      if (n.start < v.ende && n.auftragId !== v.auftragId) {
        v.warnungen.push('Doppelbelegung')
        n.warnungen.push('Doppelbelegung')
        hinweise.push(`${bezug}: Doppelbelegung, die Lok ist zweimal gleichzeitig eingeplant.`)
      } else if (n.auftragId !== v.auftragId && n.start >= v.ende && n.start - v.ende < WENDE_MINUTEN) {
        v.warnungen.push('Wendezeit')
        n.warnungen.push('Wendezeit')
        hinweise.push(`${bezug}: nur ${n.start - v.ende} Min. Wendezeit (Minimum ${WENDE_MINUTEN} Min.).`)
      }
      if (v.nach && n.von && !ortGleich(v.nach, n.von) && n.start >= v.ende) {
        v.warnungen.push('Ortssprung')
        n.warnungen.push('Ortssprung')
        hinweise.push(`Lok ${lok}: ${v.titel} endet in ${v.nach}, die nächste Leistung ${n.titel} beginnt in ${n.von}.`)
      }
    }
  }
  return hinweise
}

function farbe(art: string): { bg: string; fg: string; rand: string } {
  if (art === 'Zugfahrt') return { bg: '#14325c', fg: '#ffffff', rand: '#14325c' }
  if (art === 'Lokzuführung' || art === 'Lokrückführung') return { bg: '#e2e8f0', fg: '#334155', rand: '#94a3b8' }
  return { bg: '#fde68a', fg: '#92400e', rand: '#f59e0b' }
}

const knopf = (primaer: boolean): React.CSSProperties => ({
  border: '1px solid var(--navy)',
  background: primaer ? 'var(--navy)' : '#fff',
  color: primaer ? '#fff' : 'var(--navy)',
  borderRadius: 6,
  padding: '6px 12px',
  fontSize: 13,
  cursor: 'pointer',
})

export default function LokPlan() {
  const heuteIso = datumZuISO(new Date())
  const [ansicht, setAnsicht] = useState<Ansicht>('tag')
  const [tag, setTag] = useState(heuteIso)
  const [auftraege, setAuftraege] = useState<AuftragZeile[]>([])
  const [tfProAuftrag, setTfProAuftrag] = useState<Map<string, string[]>>(new Map())
  const [laedt, setLaedt] = useState(true)
  const [fehler, setFehler] = useState<string | null>(null)
  const [gewaehlt, setGewaehlt] = useState<string | null>(null)
  const [stamm, setStamm] = useState<StammLok[]>([])
  const [verwalten, setVerwalten] = useState(false)
  const [neuName, setNeuName] = useState('')
  const [neuTyp, setNeuTyp] = useState('Diesel')
  const [meldung, setMeldung] = useState<string | null>(null)

  const vonIso = ansicht === 'tag' ? tag : montagVon(tag)
  const bisIso = ansicht === 'tag' ? tag : isoPlus(montagVon(tag), 6)

  const laden = useCallback(async () => {
    const r = await supabase
      .from('auftraege')
      .select('id, kunde, referenz, zug_nr, abfahrt_ort, abfahrt_datum, abfahrt_soll, ankunft_ort, ankunft_datum, ankunft_soll, lok, fahrten, status, storno_datum')
      .gte('abfahrt_datum', isoPlus(vonIso, -1))
      .lte('abfahrt_datum', isoPlus(bisIso, 1))
    if (r.error) {
      setFehler(r.error.message)
      setLaedt(false)
      return
    }
    const liste = ((r.data ?? []) as AuftragZeile[]).filter((a) => !a.storno_datum && a.status !== 'storniert')
    setAuftraege(liste)

    // Eingeteilte Lokführer aus dem Dienstplan
    const ids = liste.map((a) => a.id)
    const eintraege: { auftrag_id: string; mitarbeiter_id: string }[] = []
    for (let i = 0; i < ids.length; i += 80) {
      const e = await supabase.from('dienstplan_eintraege').select('auftrag_id, mitarbeiter_id').in('auftrag_id', ids.slice(i, i + 80))
      if (!e.error) eintraege.push(...((e.data ?? []) as { auftrag_id: string; mitarbeiter_id: string }[]))
    }
    const m = await supabase.from('mitarbeiter').select('id, name')
    const namen = new Map(((m.data ?? []) as { id: string; name: string }[]).map((x) => [x.id, x.name]))
    const karte = new Map<string, string[]>()
    for (const e of eintraege) {
      const n = namen.get(e.mitarbeiter_id)
      if (!n) continue
      const alt = karte.get(e.auftrag_id) ?? []
      if (!alt.includes(n)) karte.set(e.auftrag_id, [...alt, n])
    }
    setTfProAuftrag(karte)
    const sl = await supabase.from('loks').select('id, bezeichnung, typ, aktiv, sortierung').order('sortierung').order('bezeichnung')
    if (!sl.error) setStamm((sl.data ?? []) as StammLok[])
    setFehler(null)
    setLaedt(false)
  }, [vonIso, bisIso])

  useEffect(() => {
    setLaedt(true)
    void laden()
  }, [laden])
  useLiveAktualisierung(['auftraege', 'dienstplan_eintraege', 'loks'], laden)

  // Alle Leistungen, die das gewählte Zeitfenster berühren
  const fensterStart = tagStart(vonIso)
  const fensterEnde = tagStart(bisIso) + 1440
  const { leistungen, hinweise } = useMemo(() => {
    const kanon = new Map(stamm.map((x) => [lokSchluessel(x.bezeichnung), x.bezeichnung]))
    const alle = leistungenAus(auftraege, kanon)
    const hinw = pruefen(alle)
    const imFenster = alle.filter((l) => l.ende > fensterStart && l.start < fensterEnde)
    // Hinweise nur für Leistungen im Fenster
    const relevant = hinw.filter((h) => imFenster.some((l) => h.includes(l.titel)))
    return { leistungen: imFenster, hinweise: Array.from(new Set(relevant)) }
  }, [auftraege, stamm, fensterStart, fensterEnde])

  // Zeilen: erst "(ohne Lok)" (falls nötig), dann alle angelegten Loks, dann Loks aus Aufträgen, die noch nicht angelegt sind
  const typVon = useMemo(() => new Map(stamm.map((x) => [x.bezeichnung, x.typ])), [stamm])
  const loks = useMemo(() => {
    const angelegt = stamm.filter((x) => x.aktiv).map((x) => x.bezeichnung)
    const unbekannt = Array.from(new Set(leistungen.map((l) => l.lok))).filter((n) => n !== OHNE_LOK && !typVon.has(n)).sort((a, b) => a.localeCompare(b, 'de', { numeric: true }))
    const ohne = leistungen.some((l) => l.lok === OHNE_LOK) ? [OHNE_LOK] : []
    return [...ohne, ...angelegt, ...unbekannt]
  }, [stamm, leistungen, typVon])

  async function lokAnlegen() {
    const name = neuName.trim()
    if (!name) return
    if (stamm.some((x) => lokSchluessel(x.bezeichnung) === lokSchluessel(name))) {
      setMeldung(`„${name}“ gibt es schon.`)
      return
    }
    const sort = Math.max(0, ...stamm.map((x) => x.sortierung)) + 10
    const r = await supabase.from('loks').insert({ bezeichnung: name, typ: neuTyp, sortierung: sort })
    setMeldung(r.error ? `Fehler: ${r.error.message}` : `„${name}“ angelegt.`)
    if (!r.error) setNeuName('')
    void laden()
  }
  async function lokAendern(id: string, felder: Partial<StammLok>) {
    const r = await supabase.from('loks').update(felder).eq('id', id)
    if (r.error) setMeldung(`Fehler: ${r.error.message}`)
    void laden()
  }
  async function lokLoeschen(l: StammLok) {
    if (!window.confirm(`Lok „${l.bezeichnung}“ wirklich löschen? Bereits eingetragene Aufträge bleiben unverändert.`)) return
    const r = await supabase.from('loks').delete().eq('id', l.id)
    if (r.error) setMeldung(`Fehler: ${r.error.message}`)
    void laden()
  }

  const ohneLokAnzahl = new Set(leistungen.filter((l) => l.lok === OHNE_LOK).map((l) => l.auftragId)).size
  const bloecke = useMemo(() => bloeckeAus(leistungen), [leistungen])
  const gewaehlterBlock = bloecke.find((b) => b.key === gewaehlt) ?? null
  const [dragZiel, setDragZiel] = useState<string | null>(null)

  // Beim Ziehen am oberen oder unteren Rand scrollt die Seite automatisch mit
  useEffect(() => {
    function scrollbarerVorfahr(start: EventTarget | null): HTMLElement | null {
      let el = start instanceof HTMLElement ? start : null
      while (el && el !== document.body) {
        const oy = getComputedStyle(el).overflowY
        if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight) return el
        el = el.parentElement
      }
      return null
    }
    function beimZiehen(e: DragEvent) {
      const rand = 100
      const behaelter = scrollbarerVorfahr(e.target)
      const oben = behaelter ? behaelter.getBoundingClientRect().top : 0
      const unten = behaelter ? behaelter.getBoundingClientRect().bottom : window.innerHeight
      let schritt = 0
      if (e.clientY < oben + rand) schritt = -Math.ceil(((oben + rand - e.clientY) / rand) * 25)
      else if (e.clientY > unten - rand) schritt = Math.ceil(((e.clientY - (unten - rand)) / rand) * 25)
      if (schritt === 0) return
      if (behaelter) behaelter.scrollBy(0, schritt)
      window.scrollBy(0, schritt)
    }
    document.addEventListener('dragover', beimZiehen)
    return () => document.removeEventListener('dragover', beimZiehen)
  }, [])

  // Auftrag per Drag & Drop auf eine andere Lok legen: Lok im Auftrag und in allen passenden Fahrtzeilen (Zuführung, Zug, Rückführung) ändern
  async function lokZuweisen(auftragId: string, quelle: string, ziel: string) {
    setDragZiel(null)
    if (quelle === ziel) return
    const a = auftraege.find((x) => x.id === auftragId)
    if (!a) return
    const zielName = ziel === OHNE_LOK ? '' : ziel
    const q = lokSchluessel(quelle)
    const passt = (t: string | null | undefined) => lokSchluessel(lokName(t)) === q
    const update: { lok?: string | null; fahrten?: Fahrtzeile[] } = {}
    if (Array.isArray(a.fahrten) && a.fahrten.length > 0) {
      update.fahrten = fahrtenPruefen(a.fahrten).map((f) => (passt(f.lok || a.lok) ? { ...f, lok: zielName } : f))
    }
    if (passt(a.lok)) update.lok = zielName === '' ? null : zielName
    if (update.lok === undefined && update.fahrten === undefined) update.lok = zielName === '' ? null : zielName
    const r = await supabase.from('auftraege').update(update).eq('id', auftragId)
    setMeldung(r.error ? `Fehler beim Verschieben: ${r.error.message}` : `Verschoben auf ${ziel}.`)
    void laden()
  }

  function springen(tage: number) {
    setTag(isoPlus(tag, ansicht === 'tag' ? tage : tage * 7))
    setGewaehlt(null)
  }

  // ---------- Excel ----------
  function excelExportieren() {
    const zeilen = [...leistungen]
      .sort((a, b) => a.lok.localeCompare(b.lok, 'de', { numeric: true }) || a.start - b.start)
      .map((l) => ({
        Datum: datumDe(absAlsIso(l.start)),
        Lok: l.lok,
        Art: l.art,
        Zug: l.titel,
        Kunde: l.kunde,
        Von: l.von,
        Nach: l.nach,
        Beginn: minutenAlsUhr(l.start),
        Ende: minutenAlsUhr(l.ende),
        Lokführer: (tfProAuftrag.get(l.auftragId) ?? []).join(', '),
        Hinweis: Array.from(new Set(l.warnungen)).join(', '),
      }))
    const mappe = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(mappe, XLSX.utils.json_to_sheet(zeilen), 'Lokplan')
    XLSX.writeFile(mappe, `Lokplan_${vonIso}${vonIso === bisIso ? '' : '_bis_' + bisIso}.xlsx`)
  }

  const tageDerWoche = Array.from({ length: 7 }, (_, i) => isoPlus(montagVon(tag), i))

  // ---------- Darstellung ----------
  const kopf = (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
      <button style={knopf(ansicht === 'tag')} onClick={() => setAnsicht('tag')}>Tag</button>
      <button style={knopf(ansicht === 'woche')} onClick={() => setAnsicht('woche')}>Woche</button>
      <span style={{ width: 8 }} />
      <button style={knopf(false)} onClick={() => springen(-1)} aria-label="Zurück">◀</button>
      <input
        type="date"
        value={tag}
        onChange={(e) => e.target.value && (setTag(e.target.value), setGewaehlt(null))}
        style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 14 }}
      />
      <button style={knopf(false)} onClick={() => springen(1)} aria-label="Weiter">▶</button>
      <button style={knopf(false)} onClick={() => (setTag(heuteIso), setGewaehlt(null))}>Heute</button>
      <span style={{ flex: 1 }} />
      <button style={knopf(verwalten)} onClick={() => setVerwalten(!verwalten)}>🚂 Loks verwalten</button>
      <button style={knopf(false)} onClick={excelExportieren}>⬇ Excel</button>
      <button style={knopf(false)} onClick={() => window.print()}>🖨 Drucken / PDF</button>
    </div>
  )

  return (
    <div id="lokplan-druck">
      <style>{`@media print { body * { visibility: hidden !important; } #lokplan-druck, #lokplan-druck * { visibility: visible !important; } #lokplan-druck { position: absolute; left: 0; top: 0; width: 100%; } .lp-nodruck { display: none !important; } }`}</style>
      <div className="lp-nodruck">{kopf}</div>
      {verwalten && (
        <div className="lp-nodruck" style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 14, marginBottom: 16, background: '#f8fafc' }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Loks verwalten</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <input value={neuName} onChange={(e) => setNeuName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void lokAnlegen()} placeholder="Bezeichnung, z. B. 185-537" style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 14 }} />
            <select value={neuTyp} onChange={(e) => setNeuTyp(e.target.value)} style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 14 }}>
              <option>E-Lok</option>
              <option>Diesel</option>
            </select>
            <button style={knopf(true)} onClick={() => void lokAnlegen()}>+ Anlegen</button>
          </div>
          {meldung && <div style={{ fontSize: 13, marginBottom: 8, color: '#14325c' }}>{meldung}</div>}
          {(['E-Lok', 'Diesel'] as const).map((t) => (
            <div key={t} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', margin: '6px 0 4px' }}>{t === 'E-Lok' ? 'E-Loks' : 'Diesel-Loks'}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {stamm.filter((x) => x.typ === t).map((x) => (
                  <span key={x.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid var(--border)', borderRadius: 16, padding: '3px 6px 3px 10px', background: x.aktiv ? '#fff' : '#f1f5f9', color: x.aktiv ? 'inherit' : '#94a3b8', fontSize: 13 }}>
                    {x.bezeichnung}
                    <button title={x.aktiv ? 'Ausblenden (z. B. Werkstatt/verkauft)' : 'Wieder einblenden'} onClick={() => void lokAendern(x.id, { aktiv: !x.aktiv })} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 13 }}>{x.aktiv ? '👁' : '🚫'}</button>
                    <button title="Löschen" onClick={() => void lokLoeschen(x)} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 13 }}>🗑</button>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      <div style={{ fontWeight: 600, marginBottom: 10, color: '#14325c' }}>
        {ansicht === 'tag' ? `${WOCHENTAGE[new Date(tag).getDay()]}, ${datumDe(tag)}` : `Woche ${datumDe(vonIso)} – ${datumDe(bisIso)}`}
      </div>

      {fehler && <p style={{ color: 'var(--danger)' }}>Fehler: {fehler}</p>}
      {laedt ? (
        <p style={{ color: 'var(--text-muted)' }}>Lädt…</p>
      ) : loks.length === 0 ? (
        <p style={{ color: 'var(--text-muted)' }}>Noch keine Loks angelegt. Über „Loks verwalten“ kannst du welche hinzufügen.</p>
      ) : (
        <>
          {(ohneLokAnzahl > 0 || hinweise.length > 0) && (
            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 12px', marginBottom: 14, fontSize: 13, color: '#92400e' }}>
              <b>Hinweise ({hinweise.length + (ohneLokAnzahl > 0 ? 1 : 0)})</b>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {ohneLokAnzahl > 0 && <li>{ohneLokAnzahl} Auftrag/Aufträge ohne Lok (Zeile „{OHNE_LOK}“). Die Lok wird im Auftrag eingetragen.</li>}
                {hinweise.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>
            </div>
          )}

          {ansicht === 'tag' ? (
            <TagesBalken tag={tag} bloecke={bloecke} loks={loks} typVon={typVon} gewaehlt={gewaehlt} onWahl={setGewaehlt} dragZiel={dragZiel} setDragZiel={setDragZiel} onDrop={lokZuweisen} />
          ) : (
            <WochenTabelle tage={tageDerWoche} bloecke={bloecke} loks={loks} tfProAuftrag={tfProAuftrag} onWahl={setGewaehlt} dragZiel={dragZiel} setDragZiel={setDragZiel} onDrop={lokZuweisen} />
          )}
          <div className="lp-nodruck" style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
            Tipp: Einen Auftrag mit der Maus auf die Zeile einer anderen Lok ziehen, um ihn dieser Lok zuzuweisen. Zuführung und Rückführung wandern automatisch mit.
          </div>
          {meldung && !verwalten && <div className="lp-nodruck" style={{ fontSize: 13, marginTop: 6, color: '#14325c' }}>{meldung}</div>}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', marginTop: 12, fontSize: 12, color: 'var(--text-muted)' }} className="lp-nodruck">
            <span><i style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, background: '#14325c', marginRight: 5, verticalAlign: -2 }} />Zugfahrt</span>
            <span><i style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, background: '#e2e8f0', border: '1px dashed #94a3b8', marginRight: 5, verticalAlign: -2 }} />Lokzuführung / Rückführung</span>
            <span><i style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, background: '#fde68a', marginRight: 5, verticalAlign: -2 }} />Rangieren, Warten, Sonstiges</span>
            <span><i style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, outline: '2px solid #b91c1c', marginRight: 5, verticalAlign: -2 }} />Warnung</span>
          </div>

          {gewaehlterBlock && (
            <div className="lp-nodruck" style={{ marginTop: 14, border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px', background: '#f8fafc', fontSize: 14 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>{gewaehlterBlock.titel}</div>
              <div>Lok: <b>{gewaehlterBlock.lok}</b>{gewaehlterBlock.kunde && <span style={{ color: 'var(--text-muted)' }}> · Kunde: {gewaehlterBlock.kunde}</span>}</div>
              <ul style={{ margin: '6px 0', paddingLeft: 18 }}>
                {gewaehlterBlock.teile.map((t) => (
                  <li key={t.key}>
                    {t.art}{t.art !== 'Zugfahrt' ? '' : ` ${t.titel}`}: {t.von || '?'} {minutenAlsUhr(t.start)} → {t.nach || '?'} {minutenAlsUhr(t.ende)}
                    <span style={{ color: 'var(--text-muted)' }}> · {datumDe(absAlsIso(t.start))}</span>
                  </li>
                ))}
              </ul>
              <div>
                Lokführer im Dienstplan:{' '}
                {(tfProAuftrag.get(gewaehlterBlock.auftragId) ?? []).length > 0 ? (
                  <b>{(tfProAuftrag.get(gewaehlterBlock.auftragId) ?? []).join(', ')}</b>
                ) : (
                  <span style={{ color: '#b45309' }}>noch niemand eingeteilt</span>
                )}
              </div>
              {gewaehlterBlock.warnung && (
                <div style={{ color: '#b91c1c', marginTop: 4 }}>
                  ⚠ {Array.from(new Set(gewaehlterBlock.teile.flatMap((t) => t.warnungen))).join(', ')}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ---------- Gemeinsame Drag-&-Drop-Hilfen ----------
interface DndProps {
  dragZiel: string | null
  setDragZiel: (z: string | null) => void
  onDrop: (auftragId: string, quelle: string, ziel: string) => void
}
function dndQuelle(b: Block) {
  return {
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData('text/plain', JSON.stringify({ auftragId: b.auftragId, lok: b.lok }))
      e.dataTransfer.effectAllowed = 'move'
    },
  }
}
function dndZiel(lok: string, p: DndProps) {
  return {
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      if (p.dragZiel !== lok) p.setDragZiel(lok)
    },
    onDragLeave: () => p.setDragZiel(null),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      try {
        const d = JSON.parse(e.dataTransfer.getData('text/plain')) as { auftragId: string; lok: string }
        p.onDrop(d.auftragId, d.lok, lok)
      } catch {
        p.setDragZiel(null)
      }
    },
  }
}
const kurzArt = (art: string) => (art === 'Lokzuführung' ? 'Zuf.' : art === 'Lokrückführung' ? 'Rück' : art === 'Zugfahrt' ? '' : art)

// ---------- Tagesansicht ----------
function TagesBalken({
  tag,
  bloecke,
  loks,
  typVon,
  gewaehlt,
  onWahl,
  dragZiel,
  setDragZiel,
  onDrop,
}: {
  tag: string
  bloecke: Block[]
  loks: string[]
  typVon: Map<string, string>
  gewaehlt: string | null
  onWahl: (k: string | null) => void
} & DndProps) {
  const start = tagStart(tag)
  const klemmen = (min: number) => Math.min(Math.max(min, start), start + 1440)
  const prozent = (min: number) => ((klemmen(min) - start) / 1440) * 100
  return (
    <div style={{ fontSize: 12 }}>
      <div style={{ display: 'flex', marginLeft: 120, position: 'relative', height: 18, color: 'var(--text-muted)' }}>
        <div style={{ position: 'relative', flex: 1 }}>
          {[0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => (
            <span key={h} style={{ position: 'absolute', left: `${(h / 24) * 100}%`, transform: 'translateX(-50%)', fontSize: 11 }}>
              {String(h).padStart(2, '0')}:00
            </span>
          ))}
        </div>
      </div>
      {loks.map((lok) => {
        const meine = bloecke.filter((b) => b.lok === lok && b.ende > start && b.start < start + 1440)
        const ohne = lok === OHNE_LOK
        const aktiv = dragZiel === lok
        return (
          <div key={lok} {...dndZiel(lok, { dragZiel, setDragZiel, onDrop })} style={{ display: 'flex', alignItems: 'center', borderTop: '1px solid var(--border)', minHeight: 44, background: aktiv ? '#dbeafe' : undefined }}>
            <div style={{ width: 120, flex: 'none', fontWeight: 600, fontSize: 13, color: ohne ? '#b91c1c' : 'var(--text)' }}>
              {lok}
              {typVon.get(lok) ? <span style={{ fontWeight: 400, fontSize: 10, color: 'var(--text-muted)', marginLeft: 4 }}>{typVon.get(lok) === 'E-Lok' ? 'E' : 'D'}</span> : null}
            </div>
            <div style={{ position: 'relative', flex: 1, height: 34, background: ohne ? '#fef2f2' : '#f1f5f9', borderRadius: 4 }}>
              {[3, 6, 9, 12, 15, 18, 21].map((h) => (
                <div key={h} style={{ position: 'absolute', left: `${(h / 24) * 100}%`, top: 0, bottom: 0, borderLeft: '1px solid #e2e8f0' }} />
              ))}
              {meine.map((b) => {
                const bs = klemmen(b.start)
                const be = klemmen(b.ende)
                const gesamt = Math.max(be - bs, 1)
                return (
                  <div
                    key={b.key}
                    {...dndQuelle(b)}
                    onClick={() => onWahl(gewaehlt === b.key ? null : b.key)}
                    title={`${b.titel}\n${b.teile.map((t) => `${t.art}: ${t.von} ${minutenAlsUhr(t.start)} → ${t.nach} ${minutenAlsUhr(t.ende)}`).join('\n')}`}
                    style={{
                      position: 'absolute',
                      top: 3,
                      height: 28,
                      left: `${prozent(b.start)}%`,
                      width: `${Math.max(prozent(b.ende) - prozent(b.start), 0.8)}%`,
                      borderRadius: 5,
                      overflow: 'hidden',
                      boxSizing: 'border-box',
                      outline: b.warnung ? '2px solid #b91c1c' : gewaehlt === b.key ? '2px solid #f59e0b' : undefined,
                      outlineOffset: 1,
                      cursor: 'grab',
                    }}
                  >
                    {b.teile.map((t) => {
                      const f = farbe(t.art)
                      const l = ((klemmen(t.start) - bs) / gesamt) * 100
                      const w = ((klemmen(t.ende) - klemmen(t.start)) / gesamt) * 100
                      return (
                        <div
                          key={t.key}
                          style={{ position: 'absolute', top: 0, bottom: 0, left: `${l}%`, width: `${w}%`, background: f.bg, color: f.fg, fontSize: 11, lineHeight: '28px', padding: '0 4px', whiteSpace: 'nowrap', overflow: 'hidden', boxSizing: 'border-box', borderLeft: l > 0 ? '1px solid rgba(255,255,255,0.7)' : undefined }}
                        >
                          {t.art === 'Zugfahrt' ? b.titel : kurzArt(t.art)}
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ---------- Wochenansicht ----------
function WochenTabelle({
  tage,
  bloecke,
  loks,
  tfProAuftrag,
  onWahl,
  dragZiel,
  setDragZiel,
  onDrop,
}: {
  tage: string[]
  bloecke: Block[]
  loks: string[]
  tfProAuftrag: Map<string, string[]>
  onWahl: (k: string | null) => void
} & DndProps) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: 900, fontSize: 12 }}>
        <colgroup>
          <col style={{ width: 110 }} />
          {tage.map((t) => (
            <col key={t} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: '6px', borderBottom: '1px solid var(--border-strong, #cbd5e1)', color: 'var(--text-muted)' }}>Lok</th>
            {tage.map((t) => (
              <th key={t} style={{ textAlign: 'left', padding: '6px', borderBottom: '1px solid var(--border-strong, #cbd5e1)', color: 'var(--text-muted)', fontWeight: 600 }}>
                {WOCHENTAGE[new Date(t).getDay()]} {t.slice(8, 10)}.{t.slice(5, 7)}.
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loks.map((lok) => (
            <tr key={lok} {...dndZiel(lok, { dragZiel, setDragZiel, onDrop })} style={{ background: dragZiel === lok ? '#dbeafe' : undefined }}>
              <td style={{ verticalAlign: 'top', padding: 6, borderBottom: '1px solid var(--border)', fontWeight: 600, color: lok === OHNE_LOK ? '#b91c1c' : 'var(--text)' }}>{lok}</td>
              {tage.map((t) => {
                const ab = tagStart(t)
                const zelle = bloecke.filter((b) => b.lok === lok && b.start >= ab && b.start < ab + 1440)
                return (
                  <td key={t} style={{ verticalAlign: 'top', padding: 4, borderBottom: '1px solid var(--border)', minHeight: 40 }}>
                    {zelle.map((b) => {
                      const tf = tfProAuftrag.get(b.auftragId) ?? []
                      const zug = b.teile.filter((x) => x.art === 'Zugfahrt')
                      const erste = zug[0] ?? b.teile[0]
                      const letzte = zug[zug.length - 1] ?? b.teile[b.teile.length - 1]
                      const nebenteile = b.teile.filter((x) => x.art !== 'Zugfahrt')
                      return (
                        <div
                          key={b.key}
                          {...dndQuelle(b)}
                          onClick={() => onWahl(b.key)}
                          style={{ border: '1px solid #14325c', outline: b.warnung ? '2px solid #b91c1c' : undefined, outlineOffset: 1, borderRadius: 5, marginBottom: 5, overflow: 'hidden', cursor: 'grab', fontSize: 11, lineHeight: 1.35 }}
                        >
                          {nebenteile.filter((x) => x.start < erste.start).map((x) => (
                            <div key={x.key} style={{ background: '#e2e8f0', color: '#334155', padding: '2px 5px' }}>
                              {kurzArt(x.art)} {minutenAlsUhr(x.start)}–{minutenAlsUhr(x.ende)} {x.von}→{x.nach}
                            </div>
                          ))}
                          <div style={{ background: '#14325c', color: '#fff', padding: '3px 5px' }}>
                            <b>{b.titel}</b>
                            <div>
                              {minutenAlsUhr(erste.start)}–{minutenAlsUhr(letzte.ende)} · {erste.von}→{letzte.nach}
                            </div>
                            {tf.length > 0 && <div style={{ opacity: 0.9 }}>{tf.join(', ')}</div>}
                          </div>
                          {nebenteile.filter((x) => x.start >= erste.start).map((x) => (
                            <div key={x.key} style={{ background: '#e2e8f0', color: '#334155', padding: '2px 5px' }}>
                              {kurzArt(x.art)} {minutenAlsUhr(x.start)}–{minutenAlsUhr(x.ende)} {x.von}→{x.nach}
                            </div>
                          ))}
                        </div>
                      )
                    })}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
