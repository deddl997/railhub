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
  naechste_untersuchung?: string | null
}

interface Sperre {
  id: string
  lok_id: string
  von: string
  bis: string
  art: string
  grund: string | null
}

interface Einsatz {
  id: string
  lok_id: string
  art: string
  standort: string
  von: string
  bis: string | null
  bemerkung: string | null
}

const EINSATZ_ARTEN = ['Rangierdienst', 'Streckendienst', 'Bereitstellung']
const UNBEGRENZT = 1e12

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
  ortStart: string
  ortEnde: string
  unbesetzt: boolean
  hinweise: string[]
}

function bloeckeAus(leistungen: Leistung[], tf: Map<string, string[]>, jetztAbs: number): Block[] {
  const karte = new Map<string, Leistung[]>()
  for (const l of leistungen) {
    const k = `${l.auftragId}|${l.lok}`
    karte.set(k, [...(karte.get(k) ?? []), l])
  }
  const ergebnis: Block[] = []
  for (const [key, teile] of karte) {
    teile.sort((a, b) => a.start - b.start)
    const zuege = Array.from(new Set(teile.filter((t) => t.art === 'Zugfahrt').map((t) => t.titel)))
    const ende = Math.max(...teile.map((t) => t.ende))
    ergebnis.push({
      key,
      auftragId: teile[0].auftragId,
      lok: teile[0].lok,
      titel: zuege.length > 0 ? zuege.join(' / ') : teile[0].titel,
      kunde: teile[0].kunde,
      start: teile[0].start,
      ende,
      teile,
      warnung: teile.some((t) => t.warnungen.length > 0),
      ortStart: teile[0].von,
      ortEnde: teile[teile.length - 1].nach,
      unbesetzt: teile.some((t) => t.art === 'Zugfahrt') && (tf.get(teile[0].auftragId) ?? []).length === 0 && ende > jetztAbs,
      hinweise: [],
    })
  }
  return ergebnis.sort((a, b) => a.start - b.start)
}

interface Hinweis {
  text: string
  ids: string[]
}

// Prüft pro eigener Lok: Doppelbelegung, zu kurze Wendezeit, Ortssprung
function pruefen(leistungen: Leistung[], eigene: Set<string>): Hinweis[] {
  const hinweise: Hinweis[] = []
  const proLok = new Map<string, Leistung[]>()
  for (const l of leistungen) {
    if (l.lok === OHNE_LOK || !eigene.has(l.lok)) continue // Fremdloks (z. B. Vectron Raaberbahn, Taurus ÖBB) werden nicht geprüft
    proLok.set(l.lok, [...(proLok.get(l.lok) ?? []), l])
  }
  for (const [lok, liste] of proLok) {
    liste.sort((a, b) => a.start - b.start)
    for (let i = 1; i < liste.length; i++) {
      const v = liste[i - 1]
      const n = liste[i]
      const ids = [v.auftragId, n.auftragId]
      const bezug = `Lok ${lok}: ${v.titel} (${minutenAlsUhr(v.start)}–${minutenAlsUhr(v.ende)}) und ${n.titel} (${minutenAlsUhr(n.start)}–${minutenAlsUhr(n.ende)}, ${datumDe(absAlsIso(n.start))})`
      if (n.start < v.ende && n.auftragId !== v.auftragId) {
        v.warnungen.push('Doppelbelegung')
        n.warnungen.push('Doppelbelegung')
        hinweise.push({ text: `${bezug}: Doppelbelegung, die Lok ist zweimal gleichzeitig eingeplant.`, ids })
      } else if (n.auftragId !== v.auftragId && n.start >= v.ende && n.start - v.ende < WENDE_MINUTEN) {
        v.warnungen.push('Wendezeit')
        n.warnungen.push('Wendezeit')
        hinweise.push({ text: `${bezug}: nur ${n.start - v.ende} Min. Wendezeit (Minimum ${WENDE_MINUTEN} Min.).`, ids })
      }
      if (v.nach && n.von && !ortGleich(v.nach, n.von) && n.start >= v.ende) {
        v.warnungen.push('Ortssprung')
        n.warnungen.push('Ortssprung')
        hinweise.push({ text: `Lok ${lok}: ${v.titel} endet in ${v.nach}, die nächste Leistung ${n.titel} beginnt in ${n.von}.`, ids })
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
const feldStil: React.CSSProperties = { padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 14 }

function kurzName(n: string): string {
  const t = n.trim().split(/\s+/)
  return t.length >= 2 ? `${t[0]} ${t[1][0]}.` : n
}

function kalenderwoche(iso: string): { kw: number; jahr: number } {
  const [j, m, t] = iso.split('-').map(Number)
  const d = new Date(Date.UTC(j, m - 1, t))
  const wt = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - wt + 3)
  const jahr = d.getUTCFullYear()
  const erster = new Date(Date.UTC(jahr, 0, 4))
  const kw = 1 + Math.round(((d.getTime() - erster.getTime()) / 86400000 - 3 + ((erster.getUTCDay() + 6) % 7)) / 7)
  return { kw, jahr }
}

// Zeitraum eines Einsatzes in Minuten (ohne Enddatum = dauerhaft)
function einsatzZeit(e: Einsatz): { a: number; b: number } {
  return { a: tagStart(e.von), b: e.bis ? tagStart(e.bis) + 1440 : UNBEGRENZT }
}
function einsaetzeIm(einsaetze: Einsatz[], lokId: string | undefined, von: number, bis: number): Einsatz[] {
  if (!lokId) return []
  return einsaetze.filter((e) => e.lok_id === lokId && einsatzZeit(e).a < bis && einsatzZeit(e).b > von)
}
function einsatzText(e: Einsatz): string {
  return `${e.art} ${e.standort}`
}

// Lok-Bezeichnungen wie "185-xxx" oder "(ohne Lok)" sind Platzhalter, keine echte Lok
function istOffen(lok: string): boolean {
  return lok === OHNE_LOK || /x{2,}/i.test(lok)
}

function referenzStamm(ref: string | null): string {
  return (ref ?? '').replace(/\(.*\)\s*$/, '').replace(/\d+\s*$/, '').trim().toLowerCase()
}

const wochentagVon = (iso: string) => new Date(iso).getDay()

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
  const [sperren, setSperren] = useState<Sperre[]>([])
  const [einsaetze, setEinsaetze] = useState<Einsatz[]>([])
  const [eintragForm, setEintragForm] = useState({ art: 'Werkstatt', text: '', von: heuteIso, bis: heuteIso, unbefristet: true, bemerkung: '' })
  const [verwalten, setVerwalten] = useState(false)
  const [auslastungAn, setAuslastungAn] = useState(false)
  const [neuName, setNeuName] = useState('')
  const [neuTyp, setNeuTyp] = useState('Diesel')
  const [meldung, setMeldung] = useState<string | null>(null)
  const [dragZiel, setDragZiel] = useState<string | null>(null)
  const [sperrForm, setSperrForm] = useState({ lokId: '', von: heuteIso, bis: heuteIso, art: 'Werkstatt', grund: '' })
  const [arbeitet, setArbeitet] = useState(false)
  const [lokDialogId, setLokDialogId] = useState<string | null>(null)

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

  const vonIso = ansicht === 'tag' ? tag : montagVon(tag)
  const bisIso = ansicht === 'tag' ? tag : isoPlus(montagVon(tag), 6)

  const laden = useCallback(async () => {
    const r = await supabase
      .from('auftraege')
      .select('id, kunde, referenz, zug_nr, abfahrt_ort, abfahrt_datum, abfahrt_soll, ankunft_ort, ankunft_datum, ankunft_soll, lok, fahrten, status, storno_datum')
      .gte('abfahrt_datum', isoPlus(vonIso, -2))
      .lte('abfahrt_datum', isoPlus(bisIso, 2))
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

    // Loks (mit Fristfeld, falls die Spalte schon existiert) und Sperren
    const sl1 = await supabase.from('loks').select('id, bezeichnung, typ, aktiv, sortierung, naechste_untersuchung').order('sortierung').order('bezeichnung')
    if (!sl1.error) setStamm((sl1.data ?? []) as StammLok[])
    else {
      const sl2 = await supabase.from('loks').select('id, bezeichnung, typ, aktiv, sortierung').order('sortierung').order('bezeichnung')
      if (!sl2.error) setStamm((sl2.data ?? []) as StammLok[])
    }
    const sp = await supabase.from('lok_sperren').select('id, lok_id, von, bis, art, grund').order('von')
    if (!sp.error) setSperren((sp.data ?? []) as Sperre[])
    const ei = await supabase.from('lok_einsaetze').select('id, lok_id, art, standort, von, bis, bemerkung').order('von')
    if (!ei.error) setEinsaetze((ei.data ?? []) as Einsatz[])
    setFehler(null)
    setLaedt(false)
  }, [vonIso, bisIso])

  useEffect(() => {
    setLaedt(true)
    void laden()
  }, [laden])
  useLiveAktualisierung(['auftraege', 'dienstplan_eintraege', 'loks', 'lok_sperren', 'lok_einsaetze'], laden)

  const fensterStart = tagStart(vonIso)
  const fensterEnde = tagStart(bisIso) + 1440
  const jetzt = new Date()
  const jetztAbs = tagStart(heuteIso) + jetzt.getHours() * 60 + jetzt.getMinutes()
  const stammVon = useMemo(() => new Map(stamm.map((x) => [x.bezeichnung, x])), [stamm])
  const typVon = useMemo(() => new Map(stamm.map((x) => [x.bezeichnung, x.typ])), [stamm])

  const sperreZeitraum = (s: Sperre) => ({ a: tagStart(s.von), b: tagStart(s.bis) + 1440 })

  // Alle Leistungen und Blöcke (auch außerhalb des Fensters, für Vorschläge), dazu alle Hinweise
  const { bloeckeAlle, hinweiseAlle } = useMemo(() => {
    const kanon = new Map(stamm.map((x) => [lokSchluessel(x.bezeichnung), x.bezeichnung]))
    const alle = leistungenAus(auftraege, kanon)
    const eigene = new Set(stamm.map((x) => x.bezeichnung))
    const hinw = pruefen(alle, eigene)
    const bl = bloeckeAus(alle, tfProAuftrag, jetztAbs)
    for (const b of bl) {
      const lok = stammVon.get(b.lok)
      if (!lok) continue
      for (const s of sperren) {
        if (s.lok_id !== lok.id) continue
        const z = sperreZeitraum(s)
        if (b.start < z.b && b.ende > z.a) {
          b.warnung = true
          b.hinweise.push(`${s.art}${s.grund ? ` (${s.grund})` : ''} ${datumDe(s.von)}–${datumDe(s.bis)}`)
          hinw.push({ text: `Lok ${b.lok}: ${b.titel} liegt in der Sperre „${s.art}${s.grund ? ': ' + s.grund : ''}“ (${datumDe(s.von)}–${datumDe(s.bis)}).`, ids: [b.auftragId] })
        }
      }
      for (const e of einsaetzeIm(einsaetze, lok.id, b.start, b.ende)) {
        b.warnung = true
        b.hinweise.push(`im Einsatz: ${einsatzText(e)}`)
        hinw.push({ text: `Lok ${b.lok}: ${b.titel} liegt im Dauereinsatz „${einsatzText(e)}“ (seit ${datumDe(e.von)}${e.bis ? ' bis ' + datumDe(e.bis) : ', unbefristet'}).`, ids: [b.auftragId] })
      }
      if (lok.naechste_untersuchung && b.start >= tagStart(lok.naechste_untersuchung) + 1440) {
        b.warnung = true
        b.hinweise.push(`Untersuchungsfrist ${datumDe(lok.naechste_untersuchung)} überschritten`)
        hinw.push({ text: `Lok ${b.lok}: ${b.titel} liegt nach der Untersuchungsfrist (${datumDe(lok.naechste_untersuchung)}).`, ids: [b.auftragId] })
      }
    }
    return { bloeckeAlle: bl, hinweiseAlle: hinw }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auftraege, stamm, sperren, einsaetze, tfProAuftrag])

  const bloecke = useMemo(() => bloeckeAlle.filter((b) => b.ende > fensterStart && b.start < fensterEnde), [bloeckeAlle, fensterStart, fensterEnde])
  const leistungen = useMemo(() => bloecke.flatMap((b) => b.teile).filter((l) => l.ende > fensterStart && l.start < fensterEnde), [bloecke, fensterStart, fensterEnde])
  const hinweise = useMemo(() => {
    const sichtbar = new Set(bloecke.map((b) => b.auftragId))
    return Array.from(new Set(hinweiseAlle.filter((h) => h.ids.some((i) => sichtbar.has(i))).map((h) => h.text)))
  }, [hinweiseAlle, bloecke])

  // Zeilen: erst "(ohne Lok)" (falls nötig), dann alle angelegten Loks, dann Loks aus Aufträgen, die noch nicht angelegt sind
  const loks = useMemo(() => {
    const angelegt = stamm.filter((x) => x.aktiv).map((x) => x.bezeichnung)
    const unbekannt = Array.from(new Set(bloecke.map((b) => b.lok))).filter((n) => n !== OHNE_LOK && !typVon.has(n)).sort((a, b) => a.localeCompare(b, 'de', { numeric: true }))
    const ohne = bloecke.some((b) => b.lok === OHNE_LOK) ? [OHNE_LOK] : []
    return [...ohne, ...angelegt, ...unbekannt]
  }, [stamm, bloecke, typVon])

  const ohneLokAnzahl = new Set(bloecke.filter((b) => b.lok === OHNE_LOK).map((b) => b.auftragId)).size
  const unbesetztAnzahl = new Set(bloecke.filter((b) => b.unbesetzt && b.ende > fensterStart).map((b) => b.auftragId)).size
  const gewaehlterBlock = bloecke.find((b) => b.key === gewaehlt) ?? null

  // ---------- Lok zuweisen ----------
  async function lokSchreiben(a: AuftragZeile, quelle: string, ziel: string): Promise<string | null> {
    const zielName = ziel === OHNE_LOK ? '' : ziel
    const q = lokSchluessel(quelle)
    const passt = (t: string | null | undefined) => lokSchluessel(lokName(t)) === q
    const update: { lok?: string | null; fahrten?: Fahrtzeile[] } = {}
    if (Array.isArray(a.fahrten) && a.fahrten.length > 0) {
      update.fahrten = fahrtenPruefen(a.fahrten).map((f) => (passt(f.lok || a.lok) ? { ...f, lok: zielName } : f))
    }
    if (passt(a.lok)) update.lok = zielName === '' ? null : zielName
    if (update.lok === undefined && update.fahrten === undefined) update.lok = zielName === '' ? null : zielName
    const r = await supabase.from('auftraege').update(update).eq('id', a.id)
    return r.error ? r.error.message : null
  }

  // Prüft, ob die Zuweisung auf die Ziel-Lok Probleme macht (Sperre, Frist, Doppelbelegung)
  function konflikteFuer(b: Block, ziel: string): string[] {
    const lok = stammVon.get(ziel)
    if (!lok) return []
    const liste: string[] = []
    for (const s of sperren) {
      if (s.lok_id !== lok.id) continue
      const z = sperreZeitraum(s)
      if (b.start < z.b && b.ende > z.a) liste.push(`gesperrt: ${s.art}${s.grund ? ` (${s.grund})` : ''}, ${datumDe(s.von)}–${datumDe(s.bis)}`)
    }
    for (const e of einsaetzeIm(einsaetze, lok.id, b.start, b.ende)) liste.push(`im Einsatz: ${einsatzText(e)} (seit ${datumDe(e.von)}${e.bis ? ' bis ' + datumDe(e.bis) : ', unbefristet'})`)
    if (lok.naechste_untersuchung && b.start >= tagStart(lok.naechste_untersuchung) + 1440) liste.push(`Untersuchungsfrist ${datumDe(lok.naechste_untersuchung)} ist dann überschritten`)
    for (const o of bloeckeAlle) {
      if (o.lok !== ziel || o.auftragId === b.auftragId) continue
      if (o.start < b.ende + WENDE_MINUTEN && o.ende > b.start - WENDE_MINUTEN) liste.push(`schon belegt durch ${o.titel} (${minutenAlsUhr(o.start)}–${minutenAlsUhr(o.ende)}, ${datumDe(absAlsIso(o.start))})`)
    }
    return liste
  }

  async function lokZuweisen(auftragId: string, quelle: string, ziel: string) {
    setDragZiel(null)
    if (quelle === ziel) return
    const a = auftraege.find((x) => x.id === auftragId)
    const b = bloeckeAlle.find((x) => x.auftragId === auftragId && x.lok === quelle)
    if (!a) return
    if (b) {
      const k = konflikteFuer(b, ziel)
      if (k.length > 0 && !window.confirm(`Lok ${ziel} ist für diesen Auftrag problematisch:\n\n- ${k.join('\n- ')}\n\nTrotzdem zuweisen?`)) return
    }
    const fehlerText = await lokSchreiben(a, quelle, ziel)
    setMeldung(fehlerText ? `Fehler beim Verschieben: ${fehlerText}` : `Verschoben auf ${ziel}.`)
    void laden()
  }

  // Freie Loks für einen Auftrag: keine Überschneidung, keine Sperre, Frist ok. Loks, die schon am Startort stehen, zuerst.
  function freieLoks(b: Block): { lok: StammLok; ort: string; passt: boolean }[] {
    const ergebnis: { lok: StammLok; ort: string; passt: boolean }[] = []
    for (const x of stamm.filter((s) => s.aktiv)) {
      if (x.bezeichnung === b.lok) continue
      if (konflikteFuer(b, x.bezeichnung).length > 0) continue
      const eigene = bloeckeAlle.filter((o) => o.lok === x.bezeichnung && o.ende <= b.start).sort((p, q) => p.ende - q.ende)
      const ort = eigene.length > 0 ? eigene[eigene.length - 1].ortEnde : ''
      ergebnis.push({ lok: x, ort, passt: ort !== '' && ortGleich(ort, b.ortStart) })
    }
    return ergebnis.sort((p, q) => Number(q.passt) - Number(p.passt) || p.lok.sortierung - q.lok.sortierung)
  }

  // ---------- Vorwoche übernehmen ----------
  async function vorwocheUebernehmen() {
    const woche = montagVon(tag)
    setArbeitet(true)
    try {
      const r = await supabase
        .from('auftraege')
        .select('id, kunde, referenz, zug_nr, abfahrt_ort, abfahrt_datum, abfahrt_soll, ankunft_ort, ankunft_datum, ankunft_soll, lok, fahrten, status, storno_datum')
        .gte('abfahrt_datum', isoPlus(woche, -8))
        .lte('abfahrt_datum', isoPlus(woche, 0))
      if (r.error) throw new Error(r.error.message)
      const vor = ((r.data ?? []) as AuftragZeile[]).filter((a) => !a.storno_datum && a.status !== 'storniert')
      const kanon = new Map(stamm.map((x) => [lokSchluessel(x.bezeichnung), x.bezeichnung]))
      const vorBloecke = bloeckeAus(leistungenAus(vor, kanon), new Map(), 0).filter((b) => !istOffen(b.lok))
      const vorAuftrag = new Map(vor.map((a) => [a.id, a]))
      const schluessel = (a: AuftragZeile | undefined, b: Block) => `${referenzStamm(a?.referenz ?? null)}|${wochentagVon(absAlsIso(b.start))}|${minutenAlsUhr(b.start)}|${b.ortStart.toLowerCase()}`
      const vorKarte = new Map<string, string>()
      for (const b of vorBloecke) {
        const k = schluessel(vorAuftrag.get(b.auftragId), b)
        if (!vorKarte.has(k)) vorKarte.set(k, b.lok)
      }
      const woStart = tagStart(woche)
      const aufgaben: { a: AuftragZeile; quelle: string; ziel: string }[] = []
      for (const b of bloeckeAlle) {
        if (!istOffen(b.lok) || b.start < woStart || b.start >= woStart + 7 * 1440) continue
        const a = auftraege.find((x) => x.id === b.auftragId)
        if (!a) continue
        const ziel = vorKarte.get(schluessel(a, b))
        if (ziel) aufgaben.push({ a, quelle: b.lok, ziel })
      }
      if (aufgaben.length === 0) {
        setMeldung('Keine passenden Aufträge aus der Vorwoche gefunden (gleiche Referenz-Reihe, gleicher Wochentag, gleiche Zeit und gleicher Startort).')
        return
      }
      const text = aufgaben.map((x) => `${x.a.referenz ?? x.a.id} → ${x.ziel}`).slice(0, 15).join('\n')
      if (!window.confirm(`${aufgaben.length} Aufträge bekommen die Lok aus der Vorwoche:\n\n${text}${aufgaben.length > 15 ? '\n…' : ''}\n\nÜbernehmen?`)) return
      let fehlerAnzahl = 0
      for (const x of aufgaben) if (await lokSchreiben(x.a, x.quelle, x.ziel)) fehlerAnzahl++
      setMeldung(fehlerAnzahl > 0 ? `${aufgaben.length - fehlerAnzahl} übernommen, ${fehlerAnzahl} Fehler.` : `${aufgaben.length} Aufträge mit Lok aus der Vorwoche belegt.`)
      void laden()
    } catch (e) {
      setMeldung(`Fehler: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setArbeitet(false)
    }
  }

  // ---------- Loks / Sperren verwalten ----------
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
    if (!window.confirm(`Lok „${l.bezeichnung}“ wirklich löschen? Bereits eingetragene Aufträge bleiben unverändert, Sperren dieser Lok werden mitgelöscht.`)) return
    const r = await supabase.from('loks').delete().eq('id', l.id)
    if (r.error) setMeldung(`Fehler: ${r.error.message}`)
    void laden()
  }
  async function sperreAnlegen() {
    if (!sperrForm.lokId) {
      setMeldung('Bitte zuerst eine Lok für die Sperre wählen.')
      return
    }
    if (sperrForm.bis < sperrForm.von) {
      setMeldung('„Bis“ darf nicht vor „Von“ liegen.')
      return
    }
    const r = await supabase.from('lok_sperren').insert({ lok_id: sperrForm.lokId, von: sperrForm.von, bis: sperrForm.bis, art: sperrForm.art, grund: sperrForm.grund.trim() || null })
    setMeldung(r.error ? `Fehler: ${r.error.message} (wurde das SQL „lokplan_ausbau.sql“ ausgeführt?)` : 'Sperre eingetragen.')
    if (!r.error) setSperrForm({ ...sperrForm, grund: '' })
    void laden()
  }
  async function sperreLoeschen(id: string) {
    const r = await supabase.from('lok_sperren').delete().eq('id', id)
    if (r.error) setMeldung(`Fehler: ${r.error.message}`)
    void laden()
  }

  async function eintragAnlegen() {
    if (!dialogLok) return
    const f = eintragForm
    const istEinsatz = EINSATZ_ARTEN.includes(f.art)
    const text = f.text.trim()
    const bemerkung = f.bemerkung.trim()
    if (istEinsatz && !text) {
      setMeldung('Bitte den Standort eintragen (z. B. NSL).')
      return
    }
    if ((!istEinsatz || !f.unbefristet) && f.bis < f.von) {
      setMeldung('„Bis“ darf nicht vor „Von“ liegen.')
      return
    }
    const r = istEinsatz
      ? await supabase.from('lok_einsaetze').insert({ lok_id: dialogLok.id, art: f.art, standort: text, von: f.von, bis: f.unbefristet ? null : f.bis, bemerkung: bemerkung || null })
      : await supabase.from('lok_sperren').insert({ lok_id: dialogLok.id, art: f.art, von: f.von, bis: f.bis, grund: [text, bemerkung].filter(Boolean).join(' – ') || null })
    setMeldung(r.error ? `Fehler: ${r.error.message} (wurden die SQL-Dateien „lokplan_ausbau.sql“ und „lok_einsaetze.sql“ ausgeführt?)` : 'Eingetragen.')
    if (!r.error) setEintragForm({ ...f, text: '', bemerkung: '' })
    void laden()
  }
  async function einsatzLoeschen(id: string) {
    const r = await supabase.from('lok_einsaetze').delete().eq('id', id)
    if (r.error) setMeldung(`Fehler: ${r.error.message}`)
    void laden()
  }
  async function einsatzBeenden(e: Einsatz) {
    const ende = heuteIso < e.von ? e.von : heuteIso
    const r = await supabase.from('lok_einsaetze').update({ bis: ende }).eq('id', e.id)
    setMeldung(r.error ? `Fehler: ${r.error.message}` : `Einsatz endet am ${datumDe(ende)}.`)
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
  const kw = kalenderwoche(montagVon(tag))
  const jetztText = `${datumDe(heuteIso)} ${String(jetzt.getHours()).padStart(2, '0')}:${String(jetzt.getMinutes()).padStart(2, '0')}`
  function lokOeffnen(name: string, datum?: string) {
    const l = stammVon.get(name)
    if (!l) return
    const d = datum ?? vonIso
    setSperrForm({ lokId: l.id, von: d, bis: d, art: 'Werkstatt', grund: '' })
    setEintragForm({ art: 'Werkstatt', text: '', von: d, bis: d, unbefristet: true, bemerkung: '' })
    setMeldung(null)
    setLokDialogId(l.id)
  }
  const dialogLok = stamm.find((x) => x.id === lokDialogId) ?? null
  const orteListe = Array.from(new Set([...auftraege.flatMap((a) => [a.abfahrt_ort, a.ankunft_ort]), ...einsaetze.map((e) => e.standort)].map((o) => (o ?? '').trim()).filter(Boolean))).sort()
  const daten = { onLokKlick: lokOeffnen, einsaetze, bloecke, loks, typVon, stammVon, sperren, tfProAuftrag, gewaehlt, onWahl: setGewaehlt, dragZiel, setDragZiel, onDrop: lokZuweisen }
  const gewaehlteLokSperre = stamm.find((x) => x.id === sperrForm.lokId)

  const druckTitel = ansicht === 'tag' ? `Tagesplan ${datumDe(tag)}` : `KW ${kw.kw}/${kw.jahr} · ${datumDe(vonIso)} – ${datumDe(bisIso)}`

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
        style={feldStil}
      />
      <button style={knopf(false)} onClick={() => springen(1)} aria-label="Weiter">▶</button>
      <button style={knopf(false)} onClick={() => (setTag(heuteIso), setGewaehlt(null))}>Heute</button>
      <span style={{ flex: 1 }} />
      <button style={knopf(auslastungAn)} onClick={() => setAuslastungAn(!auslastungAn)}>📊 Auslastung</button>
      <button style={knopf(false)} disabled={arbeitet} onClick={() => void vorwocheUebernehmen()} title="Aufträge ohne Lok bekommen die Lok, die der gleiche Umlauf in der Vorwoche hatte">⟲ Vorwoche übernehmen</button>
      <button style={knopf(verwalten)} onClick={() => setVerwalten(!verwalten)}>🚂 Loks &amp; Sperren</button>
      <button style={knopf(false)} onClick={excelExportieren}>⬇ Excel</button>
      <button style={knopf(false)} onClick={() => window.print()}>🖨 Drucken / PDF</button>
    </div>
  )

  return (
    <div id="lokplan-druck">
      <style>{`
        .lp-nurdruck { display: none; }
        @media print {
          @page { size: A4 landscape; margin: 10mm; }
          body * { visibility: hidden !important; }
          #lokplan-druck, #lokplan-druck * { visibility: visible !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          #lokplan-druck { position: absolute; left: 0; top: 0; width: 100%; }
          .lp-nodruck { display: none !important; }
          .lp-nurdruck { display: flex !important; }
          .lp-block { break-inside: avoid; }
        }
      `}</style>

      <div className="lp-nurdruck" style={{ justifyContent: 'space-between', alignItems: 'flex-end', borderBottom: '3px solid #14325c', paddingBottom: 6, marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 11, color: '#475569', letterSpacing: 1 }}>RAIL BAVARIA LOGISTIK GMBH</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#14325c' }}>Lokumlaufplan</div>
        </div>
        <div style={{ textAlign: 'right', fontSize: 13 }}>
          <div style={{ fontWeight: 700 }}>{druckTitel}</div>
          <div style={{ color: '#64748b', fontSize: 11 }}>Stand: {jetztText}</div>
        </div>
      </div>

      <div className="lp-nodruck">{kopf}</div>

      {verwalten && (
        <div className="lp-nodruck" style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 14, marginBottom: 16, background: '#f8fafc' }}>
          <div style={{ fontWeight: 700, marginBottom: 8 }}>Loks verwalten</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <input value={neuName} onChange={(e) => setNeuName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void lokAnlegen()} placeholder="Bezeichnung, z. B. 185-537" style={feldStil} />
            <select value={neuTyp} onChange={(e) => setNeuTyp(e.target.value)} style={feldStil}>
              <option>E-Lok</option>
              <option>Diesel</option>
            </select>
            <button style={knopf(true)} onClick={() => void lokAnlegen()}>+ Anlegen</button>
          </div>
          {(['E-Lok', 'Diesel'] as const).map((t) => (
            <div key={t} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', margin: '6px 0 4px' }}>{t === 'E-Lok' ? 'E-Loks' : 'Diesel-Loks'}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {stamm.filter((x) => x.typ === t).map((x) => (
                  <span key={x.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid var(--border)', borderRadius: 16, padding: '3px 6px 3px 10px', background: x.aktiv ? '#fff' : '#f1f5f9', color: x.aktiv ? 'inherit' : '#94a3b8', fontSize: 13 }}>
                    {x.bezeichnung}
                    <button title={x.aktiv ? 'Ausblenden' : 'Wieder einblenden'} onClick={() => void lokAendern(x.id, { aktiv: !x.aktiv })} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 13 }}>{x.aktiv ? '👁' : '🚫'}</button>
                    <button title="Löschen" onClick={() => void lokLoeschen(x)} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 13 }}>🗑</button>
                  </span>
                ))}
              </div>
            </div>
          ))}

          <div style={{ fontWeight: 700, margin: '16px 0 8px', borderTop: '1px solid var(--border)', paddingTop: 12 }}>Sperren &amp; Fristen (Werkstatt, Untersuchung …) <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--text-muted)' }}>– oder direkt im Plan auf den Lok-Namen klicken</span></div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
            <select value={sperrForm.lokId} onChange={(e) => setSperrForm({ ...sperrForm, lokId: e.target.value })} style={feldStil}>
              <option value="">Lok wählen …</option>
              {stamm.map((x) => (
                <option key={x.id} value={x.id}>{x.bezeichnung}</option>
              ))}
            </select>
            <input type="date" value={sperrForm.von} onChange={(e) => setSperrForm({ ...sperrForm, von: e.target.value, bis: sperrForm.bis < e.target.value ? e.target.value : sperrForm.bis })} style={feldStil} />
            <span>bis</span>
            <input type="date" value={sperrForm.bis} onChange={(e) => setSperrForm({ ...sperrForm, bis: e.target.value })} style={feldStil} />
            <select value={sperrForm.art} onChange={(e) => setSperrForm({ ...sperrForm, art: e.target.value })} style={feldStil}>
              <option>Werkstatt</option>
              <option>Untersuchung</option>
              <option>Defekt</option>
              <option>Sonstiges</option>
            </select>
            <input value={sperrForm.grund} onChange={(e) => setSperrForm({ ...sperrForm, grund: e.target.value })} placeholder="Grund (optional)" style={{ ...feldStil, width: 180 }} />
            <button style={knopf(true)} onClick={() => void sperreAnlegen()}>+ Sperre</button>
          </div>
          {gewaehlteLokSperre && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, marginBottom: 8, flexWrap: 'wrap' }}>
              Nächste Untersuchung / Frist von {gewaehlteLokSperre.bezeichnung}:
              <input type="date" value={gewaehlteLokSperre.naechste_untersuchung ?? ''} onChange={(e) => void lokAendern(gewaehlteLokSperre.id, { naechste_untersuchung: e.target.value || null })} style={feldStil} />
              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Aufträge nach diesem Tag werden als Warnung markiert.</span>
            </div>
          )}
          {meldung && <div style={{ fontSize: 13, margin: '8px 0', color: '#14325c' }}>{meldung}</div>}
          {sperren.filter((s) => s.bis >= heuteIso).length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Keine aktuellen oder kommenden Sperren.</div>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
              {sperren.filter((s) => s.bis >= heuteIso).map((s) => (
                <li key={s.id}>
                  <b>{stamm.find((x) => x.id === s.lok_id)?.bezeichnung ?? '?'}</b> · {s.art} · {datumDe(s.von)}–{datumDe(s.bis)}{s.grund ? ` · ${s.grund}` : ''}{' '}
                  <button title="Sperre löschen" onClick={() => void sperreLoeschen(s.id)} style={{ border: 'none', background: 'none', cursor: 'pointer' }}>🗑</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {dialogLok && (
        <div className="lp-nodruck" onClick={() => setLokDialogId(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: 16 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, padding: 18, width: 'min(560px, 100%)', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 18, color: 'var(--navy)' }}>🚂 {dialogLok.bezeichnung}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{dialogLok.typ} · Werkstatt, Sperren und Fristen</div>
              </div>
              <button onClick={() => setLokDialogId(null)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)' }}>✕</button>
            </div>

            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Neuer Eintrag für {dialogLok.bezeichnung}</div>
            <datalist id="lp-orte">
              {orteListe.map((o) => (
                <option key={o} value={o} />
              ))}
            </datalist>
            {(() => {
              const f = eintragForm
              const istEinsatz = EINSATZ_ARTEN.includes(f.art)
              return (
                <>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
                    <select value={f.art} onChange={(e) => setEintragForm({ ...f, art: e.target.value })} style={{ ...feldStil, fontWeight: 600 }}>
                      <optgroup label="Lok nicht verfügbar">
                        <option>Werkstatt</option>
                        <option>Untersuchung</option>
                        <option>Defekt</option>
                      </optgroup>
                      <optgroup label="Lok im Einsatz an einem Standort">
                        {EINSATZ_ARTEN.map((a) => (
                          <option key={a}>{a}</option>
                        ))}
                      </optgroup>
                    </select>
                    <input
                      list={istEinsatz ? 'lp-orte' : undefined}
                      value={f.text}
                      onChange={(e) => setEintragForm({ ...f, text: e.target.value })}
                      placeholder={istEinsatz ? 'Standort (Pflicht), z. B. NSL' : 'Werkstatt / Grund (optional)'}
                      style={{ ...feldStil, flex: 1, minWidth: 180 }}
                    />
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
                    <label style={{ fontSize: 12 }}>
                      {istEinsatz ? 'Ab' : 'Von'} <input type="date" value={f.von} onChange={(e) => setEintragForm({ ...f, von: e.target.value, bis: f.bis < e.target.value ? e.target.value : f.bis })} style={feldStil} />
                    </label>
                    {istEinsatz && (
                      <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <input type="checkbox" checked={f.unbefristet} onChange={(e) => setEintragForm({ ...f, unbefristet: e.target.checked })} />
                        dauerhaft (ohne Ende)
                      </label>
                    )}
                    {(!istEinsatz || !f.unbefristet) && (
                      <label style={{ fontSize: 12 }}>
                        Bis (inklusive) <input type="date" value={f.bis} min={f.von} onChange={(e) => setEintragForm({ ...f, bis: e.target.value })} style={feldStil} />
                      </label>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                    <input value={f.bemerkung} onChange={(e) => setEintragForm({ ...f, bemerkung: e.target.value })} placeholder="Bemerkung (optional)" style={{ ...feldStil, flex: 1, minWidth: 160 }} />
                    <button style={knopf(true)} onClick={() => void eintragAnlegen()}>+ Eintragen</button>
                  </div>
                </>
              )
            })()}
            {meldung && <div style={{ fontSize: 13, margin: '6px 0', color: '#14325c' }}>{meldung}</div>}

            <div style={{ fontWeight: 600, fontSize: 13, margin: '14px 0 6px' }}>Werkstatt &amp; Sperren</div>
            {sperren.filter((s) => s.lok_id === dialogLok.id && s.bis >= isoPlus(heuteIso, -30)).length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Keine Werkstatt- oder Sperr-Einträge.</div>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                {sperren.filter((s) => s.lok_id === dialogLok.id && s.bis >= isoPlus(heuteIso, -30)).map((s) => (
                  <li key={s.id} style={{ marginBottom: 3 }}>
                    <b>{s.art}</b> · {datumDe(s.von)}–{datumDe(s.bis)}{s.grund ? ` · ${s.grund}` : ''}{s.bis < heuteIso ? ' (vorbei)' : ''}{' '}
                    <button title="Löschen" onClick={() => void sperreLoeschen(s.id)} style={{ border: 'none', background: 'none', cursor: 'pointer' }}>🗑</button>
                  </li>
                ))}
              </ul>
            )}

            <div style={{ fontWeight: 600, fontSize: 13, margin: '14px 0 6px' }}>Einsätze an Standorten (Rangierdienst …)</div>
            {einsaetze.filter((e) => e.lok_id === dialogLok.id).length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Kein Einsatz eingetragen.</div>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                {einsaetze.filter((e) => e.lok_id === dialogLok.id).map((e) => (
                  <li key={e.id} style={{ marginBottom: 3 }}>
                    <b>{e.art} {e.standort}</b> · ab {datumDe(e.von)} {e.bis ? `bis ${datumDe(e.bis)}${e.bis < heuteIso ? ' (vorbei)' : ''}` : '· dauerhaft'}{e.bemerkung ? ` · ${e.bemerkung}` : ''}{' '}
                    {!e.bis && (
                      <button title="Einsatz heute beenden" onClick={() => void einsatzBeenden(e)} style={{ ...knopf(false), padding: '1px 6px', fontSize: 11 }}>beenden</button>
                    )}{' '}
                    <button title="Löschen" onClick={() => void einsatzLoeschen(e.id)} style={{ border: 'none', background: 'none', cursor: 'pointer' }}>🗑</button>
                  </li>
                ))}
              </ul>
            )}

            <div style={{ fontWeight: 600, fontSize: 13, margin: '14px 0 6px' }}>Nächste Untersuchung / Frist</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input type="date" value={dialogLok.naechste_untersuchung ?? ''} onChange={(e) => void lokAendern(dialogLok.id, { naechste_untersuchung: e.target.value || null })} style={feldStil} />
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Aufträge nach diesem Tag werden als Warnung markiert.</span>
            </div>
            <div style={{ textAlign: 'right', marginTop: 16 }}>
              <button style={knopf(false)} onClick={() => setLokDialogId(null)}>Schließen</button>
            </div>
          </div>
        </div>
      )}

      <div style={{ fontWeight: 600, marginBottom: 10, color: '#14325c' }} className="lp-nodruck">{druckTitel}</div>

      {fehler && <p style={{ color: 'var(--danger)' }}>Fehler: {fehler}</p>}
      {laedt ? (
        <p style={{ color: 'var(--text-muted)' }}>Lädt…</p>
      ) : loks.length === 0 ? (
        <p style={{ color: 'var(--text-muted)' }}>Noch keine Loks angelegt. Über „Loks &amp; Sperren“ kannst du welche hinzufügen.</p>
      ) : (
        <>
          {(ohneLokAnzahl > 0 || unbesetztAnzahl > 0 || hinweise.length > 0) && (
            <div className="lp-block" style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 12px', marginBottom: 14, fontSize: 13, color: '#92400e' }}>
              <b>Hinweise ({hinweise.length + (ohneLokAnzahl > 0 ? 1 : 0) + (unbesetztAnzahl > 0 ? 1 : 0)})</b>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {ohneLokAnzahl > 0 && <li>{ohneLokAnzahl} Auftrag/Aufträge ohne Lok (Zeile „{OHNE_LOK}“). Auf eine Lok ziehen oder im Auftrag eintragen.</li>}
                {unbesetztAnzahl > 0 && <li>{unbesetztAnzahl} Auftrag/Aufträge noch ohne Lokführer im Dienstplan (markiert mit 👤?).</li>}
                {hinweise.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>
            </div>
          )}

          {auslastungAn && <Auslastung stamm={stamm.filter((x) => x.aktiv)} bloecke={bloecke} sperren={sperren} einsaetze={einsaetze} von={fensterStart} bis={fensterEnde} />}

          {ansicht === 'tag' ? <TagesBalken tag={tag} {...daten} /> : <WochenTabelle tage={tageDerWoche} {...daten} />}

          <div className="lp-nodruck" style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
            Tipp: Einen Auftrag mit der Maus auf die Zeile einer anderen Lok ziehen, um ihn dieser Lok zuzuweisen. Zuführung und Rückführung wandern automatisch mit.
          </div>
          {meldung && !verwalten && <div className="lp-nodruck" style={{ fontSize: 13, marginTop: 6, color: '#14325c' }}>{meldung}</div>}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', marginTop: 12, fontSize: 12, color: 'var(--text-muted)' }}>
            <span><i style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, background: '#14325c', marginRight: 5, verticalAlign: -2 }} />Zugfahrt</span>
            <span><i style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, background: '#e2e8f0', border: '1px solid #94a3b8', marginRight: 5, verticalAlign: -2 }} />Lokzuführung / Rückführung</span>
            <span><i style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, background: '#fde68a', marginRight: 5, verticalAlign: -2 }} />Rangieren, Warten, Sonstiges</span>
            <span><i style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, background: 'repeating-linear-gradient(45deg,#cbd5e1,#cbd5e1 3px,#f1f5f9 3px,#f1f5f9 6px)', marginRight: 5, verticalAlign: -2 }} />Sperre (Werkstatt …)</span>
            <span><i style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, outline: '2px solid #b91c1c', marginRight: 5, verticalAlign: -2 }} />Warnung</span>
            <span><i style={{ display: 'inline-block', width: 12, height: 5, borderRadius: 3, background: '#14b8a6', marginRight: 5, verticalAlign: 2 }} />🏗 Dauereinsatz (Rangierdienst …)</span>
            <span>👤? = noch kein Lokführer</span>
            <span>📍 = Standort der Lok am Ende</span>
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
                  ⚠ {Array.from(new Set([...gewaehlterBlock.teile.flatMap((t) => t.warnungen), ...gewaehlterBlock.hinweise])).join(', ')}
                </div>
              )}
              {(istOffen(gewaehlterBlock.lok) || gewaehlterBlock.warnung) && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Freie Loks für diesen Auftrag:</div>
                  {(() => {
                    const frei = freieLoks(gewaehlterBlock).slice(0, 10)
                    if (frei.length === 0) return <div style={{ fontSize: 13, color: '#b45309' }}>Keine freie Lok im Zeitraum (alle belegt oder gesperrt).</div>
                    return (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {frei.map((f) => (
                          <button
                            key={f.lok.id}
                            onClick={() => void lokZuweisen(gewaehlterBlock.auftragId, gewaehlterBlock.lok, f.lok.bezeichnung)}
                            title={f.ort ? `Steht zuletzt in ${f.ort}` : 'keine frühere Leistung im Plan'}
                            style={{ ...knopf(false), borderColor: f.passt ? '#15803d' : 'var(--border)', color: f.passt ? '#15803d' : 'var(--navy)', background: f.passt ? '#f0fdf4' : '#fff' }}
                          >
                            {f.lok.bezeichnung} <span style={{ fontSize: 11, opacity: 0.8 }}>{f.lok.typ === 'E-Lok' ? 'E' : 'D'}{f.passt ? ` · steht in ${f.ort} ✓` : f.ort ? ` · zuletzt ${f.ort}` : ''}</span>
                          </button>
                        ))}
                      </div>
                    )
                  })()}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ---------- Auslastung ----------
function Auslastung({ stamm, bloecke, sperren, einsaetze, von, bis }: { stamm: StammLok[]; bloecke: Block[]; sperren: Sperre[]; einsaetze: Einsatz[]; von: number; bis: number }) {
  const gesamt = bis - von
  const klemm = (a: number, b: number) => Math.max(0, Math.min(b, bis) - Math.max(a, von))
  const zeilen = stamm.map((x) => {
    let zug = 0
    let fuehrung = 0
    let sonst = 0
    for (const b of bloecke) {
      if (b.lok !== x.bezeichnung) continue
      for (const t of b.teile) {
        const m = klemm(t.start, t.ende)
        if (t.art === 'Zugfahrt') zug += m
        else if (t.art === 'Lokzuführung' || t.art === 'Lokrückführung') fuehrung += m
        else sonst += m
      }
    }
    let dauer = 0
    for (const e of einsaetze) if (e.lok_id === x.id) dauer += klemm(einsatzZeit(e).a, einsatzZeit(e).b)
    let gesperrt = 0
    for (const s of sperren) if (s.lok_id === x.id) gesperrt += klemm(tagStart(s.von), tagStart(s.bis) + 1440)
    const verfuegbar = Math.max(gesamt - gesperrt, 1)
    return { x, zug, fuehrung, sonst, dauer, gesperrt, quote: Math.min(100, Math.round(((zug + fuehrung + sonst + dauer) / verfuegbar) * 100)) }
  })
  const h = (m: number) => `${(m / 60).toFixed(1).replace('.', ',')} h`
  return (
    <div className="lp-block" style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, marginBottom: 14, background: '#fff' }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>Auslastung im gewählten Zeitraum</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}>
            <th style={{ padding: 4 }}>Lok</th>
            <th style={{ padding: 4 }}>Zugfahrt</th>
            <th style={{ padding: 4 }}>Zu-/Rückführung (Leerfahrt)</th>
            <th style={{ padding: 4 }}>Sonstiges</th>
            <th style={{ padding: 4 }}>Dauereinsatz</th>
            <th style={{ padding: 4 }}>Gesperrt</th>
            <th style={{ padding: 4, width: '28%' }}>Auslastung</th>
          </tr>
        </thead>
        <tbody>
          {zeilen.map((z) => (
            <tr key={z.x.id} style={{ borderTop: '1px solid var(--border)' }}>
              <td style={{ padding: 4, fontWeight: 600 }}>{z.x.bezeichnung}</td>
              <td style={{ padding: 4 }}>{h(z.zug)}</td>
              <td style={{ padding: 4 }}>{h(z.fuehrung)}</td>
              <td style={{ padding: 4 }}>{h(z.sonst)}</td>
              <td style={{ padding: 4 }}>{z.dauer > 0 ? h(z.dauer) : '–'}</td>
              <td style={{ padding: 4 }}>{z.gesperrt > 0 ? h(z.gesperrt) : '–'}</td>
              <td style={{ padding: 4 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ flex: 1, height: 10, background: '#e2e8f0', borderRadius: 5, overflow: 'hidden' }}>
                    <div style={{ width: `${z.quote}%`, height: '100%', background: z.quote > 85 ? '#b91c1c' : z.quote < 15 ? '#94a3b8' : '#14325c' }} />
                  </div>
                  <span style={{ width: 34, textAlign: 'right' }}>{z.quote} %</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>Auslastung = Einsatzzeit im Verhältnis zur Zeit ohne Sperren.</div>
    </div>
  )
}

// ---------- Gemeinsame Drag-&-Drop-Hilfen ----------
interface DndProps {
  dragZiel: string | null
  setDragZiel: (z: string | null) => void
  onDrop: (auftragId: string, quelle: string, ziel: string) => void
}
interface Ansichtsdaten extends DndProps {
  einsaetze: Einsatz[]
  onLokKlick: (lok: string, datum?: string) => void
  bloecke: Block[]
  loks: string[]
  typVon: Map<string, string>
  stammVon: Map<string, StammLok>
  sperren: Sperre[]
  tfProAuftrag: Map<string, string[]>
  gewaehlt: string | null
  onWahl: (k: string | null) => void
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

const SCHRAFFUR = 'repeating-linear-gradient(45deg,#cbd5e1,#cbd5e1 4px,#f1f5f9 4px,#f1f5f9 8px)'

// Standort der Lok am Ende des Tages (letzter Block, der an diesem Tag beginnt oder davor)
function standortAm(bloecke: Block[], lok: string, tagEnde: number): string {
  const davor = bloecke.filter((b) => b.lok === lok && b.start < tagEnde).sort((a, b) => a.start - b.start)
  return davor.length > 0 ? davor[davor.length - 1].ortEnde : ''
}

function fristHinweis(l: StammLok | undefined, heute: number): { text: string; farbe: string } | null {
  if (!l?.naechste_untersuchung) return null
  const tage = Math.round((tagStart(l.naechste_untersuchung) - heute) / 1440)
  if (tage < 0) return { text: `⏰ Frist überschritten (${datumDe(l.naechste_untersuchung)})`, farbe: '#b91c1c' }
  if (tage <= 14) return { text: `⏰ Frist in ${tage} Tg. (${datumDe(l.naechste_untersuchung)})`, farbe: '#b45309' }
  return null
}

// ---------- Tagesansicht ----------
function TagesBalken({ tag, onLokKlick, einsaetze, bloecke, loks, typVon, stammVon, sperren, tfProAuftrag, gewaehlt, onWahl, dragZiel, setDragZiel, onDrop }: { tag: string } & Ansichtsdaten) {
  const start = tagStart(tag)
  const heute = tagStart(datumZuISO(new Date()))
  const klemmen = (min: number) => Math.min(Math.max(min, start), start + 1440)
  const prozent = (min: number) => ((klemmen(min) - start) / 1440) * 100
  return (
    <div style={{ fontSize: 12 }}>
      <div style={{ display: 'flex', marginLeft: 130, position: 'relative', height: 18, color: 'var(--text-muted)' }}>
        <div style={{ position: 'relative', flex: 1 }}>
          {[0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => (
            <span key={h} style={{ position: 'absolute', left: `${(h / 24) * 100}%`, transform: 'translateX(-50%)', fontSize: 11 }}>
              {String(h).padStart(2, '0')}:00
            </span>
          ))}
        </div>
      </div>
      {loks.map((lok) => {
        const meine = bloecke.filter((b) => b.lok === lok && b.ende > start && b.start < start + 1440).sort((a, b) => a.start - b.start)
        const ohne = lok === OHNE_LOK
        const aktiv = dragZiel === lok
        const stl = stammVon.get(lok)
        const meineEinsaetze = einsaetzeIm(einsaetze, stl?.id, start, start + 1440)
        const standort = stl ? standortAm(bloecke, lok, start + 1440) || (meineEinsaetze[0]?.standort ?? '') : ''
        const frist = fristHinweis(stl, heute)
        const meineSperren = stl ? sperren.filter((s) => s.lok_id === stl.id && tagStart(s.von) < start + 1440 && tagStart(s.bis) + 1440 > start) : []
        return (
          <div key={lok} {...dndZiel(lok, { dragZiel, setDragZiel, onDrop })} className="lp-block" style={{ display: 'flex', alignItems: 'center', borderTop: '1px solid var(--border)', minHeight: 48, background: aktiv ? '#dbeafe' : undefined }}>
            <div style={{ width: 130, flex: 'none', paddingRight: 6, cursor: stl ? 'pointer' : undefined }} onClick={() => stl && onLokKlick(lok)} title={stl ? 'Klicken: Werkstatt, Sperren und Fristen dieser Lok eintragen' : undefined}>
              <div style={{ fontWeight: 600, fontSize: 13, color: ohne ? '#b91c1c' : 'var(--text)', textDecoration: stl ? 'underline dotted' : undefined }}>
                {lok}
                {typVon.get(lok) ? <span style={{ fontWeight: 400, fontSize: 10, color: 'var(--text-muted)', marginLeft: 4 }}>{typVon.get(lok) === 'E-Lok' ? 'E' : 'D'}</span> : null}
              </div>
              {standort && <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>📍 {standort}</div>}
              {meineEinsaetze.map((e) => (
                <div key={e.id} style={{ fontSize: 10, color: '#0f766e', fontWeight: 600 }}>🏗 {einsatzText(e)}</div>
              ))}
              {frist && <div style={{ fontSize: 10, color: frist.farbe }}>{frist.text}</div>}
            </div>
            <div
              onClick={() => stl && onLokKlick(lok, tag)}
              title={stl ? 'Klicken: Werkstatt, Rangierdienst usw. für diese Lok eintragen' : undefined}
              style={{ position: 'relative', flex: 1, height: 34, background: ohne ? '#fef2f2' : '#f1f5f9', borderRadius: 4, cursor: stl ? 'pointer' : undefined }}
            >
              {[3, 6, 9, 12, 15, 18, 21].map((h) => (
                <div key={h} style={{ position: 'absolute', left: `${(h / 24) * 100}%`, top: 0, bottom: 0, borderLeft: '1px solid #e2e8f0' }} />
              ))}
              {meineEinsaetze.map((e) => {
                const z = einsatzZeit(e)
                return (
                  <div
                    key={`e-${e.id}`}
                    onClick={(ev) => {
                      ev.stopPropagation()
                      onLokKlick(lok, tag)
                    }}
                    title={`${einsatzText(e)} · ab ${datumDe(e.von)}${e.bis ? ' bis ' + datumDe(e.bis) : ' (dauerhaft)'}${e.bemerkung ? '\n' + e.bemerkung : ''}`}
                    style={{ position: 'absolute', left: `${prozent(z.a)}%`, width: `${prozent(Math.min(z.b, start + 1440)) - prozent(z.a)}%`, bottom: 0, height: 6, background: '#14b8a6', borderRadius: 3, cursor: 'pointer' }}
                  />
                )
              })}
              {meineSperren.map((s) => (
                <div
                  key={s.id}
                  onClick={(ev) => {
                    ev.stopPropagation()
                    onLokKlick(lok, tag)
                  }}
                  title={`${s.art}${s.grund ? ': ' + s.grund : ''} (${datumDe(s.von)}–${datumDe(s.bis)})`}
                  style={{ cursor: 'pointer', position: 'absolute', top: 0, bottom: 0, left: `${prozent(tagStart(s.von))}%`, width: `${prozent(tagStart(s.bis) + 1440) - prozent(tagStart(s.von))}%`, background: SCHRAFFUR, color: '#475569', fontSize: 11, lineHeight: '34px', paddingLeft: 6, overflow: 'hidden', whiteSpace: 'nowrap', borderRadius: 4 }}
                >
                  🔧 {s.art}{s.grund ? `: ${s.grund}` : ''}
                </div>
              ))}
              {meine.slice(1).map((b, i) => {
                const v = meine[i]
                if (b.start < v.ende) return null
                const l = prozent(v.ende)
                const r = prozent(b.start)
                if (r <= l) return null
                const bruch = v.ortEnde && b.ortStart && !ortGleich(v.ortEnde, b.ortStart)
                return (
                  <div key={`l-${b.key}`} style={{ position: 'absolute', left: `${l}%`, width: `${r - l}%`, top: 17, borderTop: `2px dashed ${bruch ? '#b91c1c' : '#94a3b8'}`, pointerEvents: 'none' }}>
                    {r - l > 6 && v.ortEnde && (
                      <span style={{ position: 'absolute', top: -15, left: '50%', transform: 'translateX(-50%)', fontSize: 10, color: bruch ? '#b91c1c' : '#64748b', background: ohne ? '#fef2f2' : '#f1f5f9', padding: '0 3px', whiteSpace: 'nowrap' }}>
                        {bruch ? `${v.ortEnde}≠${b.ortStart}` : v.ortEnde}
                      </span>
                    )}
                  </div>
                )
              })}
              {meine.map((b) => {
                const bs = klemmen(b.start)
                const be = klemmen(b.ende)
                const gesamt = Math.max(be - bs, 1)
                const tf = tfProAuftrag.get(b.auftragId) ?? []
                const tfText = tf.map(kurzName).join(', ')
                return (
                  <div
                    key={b.key}
                    {...dndQuelle(b)}
                    onClick={(e) => {
                      e.stopPropagation()
                      onWahl(gewaehlt === b.key ? null : b.key)
                    }}
                    title={`${b.titel}\n${b.teile.map((t) => `${t.art}: ${t.von} ${minutenAlsUhr(t.start)} → ${t.nach} ${minutenAlsUhr(t.ende)}`).join('\n')}\nLokführer: ${tf.length ? tf.join(', ') : 'noch niemand'}${b.hinweise.length ? '\n⚠ ' + b.hinweise.join(', ') : ''}`}
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
                          {t.art === 'Zugfahrt' ? (
                            <>
                              {b.unbesetzt && <span style={{ color: '#fde68a', fontWeight: 700 }}>👤? </span>}
                              {b.titel}
                              {tfText && <span style={{ opacity: 0.85 }}> · {tfText}</span>}
                            </>
                          ) : (
                            kurzArt(t.art)
                          )}
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
function WochenTabelle({ tage, onLokKlick, einsaetze, bloecke, loks, typVon, stammVon, sperren, tfProAuftrag, onWahl, dragZiel, setDragZiel, onDrop }: { tage: string[] } & Ansichtsdaten) {
  const heute = tagStart(datumZuISO(new Date()))
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: 900, fontSize: 12 }}>
        <colgroup>
          <col style={{ width: 120 }} />
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
          {loks.map((lok) => {
            const stl = stammVon.get(lok)
            const frist = fristHinweis(stl, heute)
            return (
              <tr key={lok} {...dndZiel(lok, { dragZiel, setDragZiel, onDrop })} className="lp-block" style={{ background: dragZiel === lok ? '#dbeafe' : undefined }}>
                <td onClick={() => stl && onLokKlick(lok)} title={stl ? 'Klicken: Werkstatt, Sperren und Fristen dieser Lok eintragen' : undefined} style={{ verticalAlign: 'top', padding: 6, borderBottom: '1px solid var(--border)', fontWeight: 600, color: lok === OHNE_LOK ? '#b91c1c' : 'var(--text)', cursor: stl ? 'pointer' : undefined }}>
                  <span style={{ textDecoration: stl ? 'underline dotted' : undefined }}>{lok}</span>
                  {typVon.get(lok) ? <span style={{ fontWeight: 400, fontSize: 10, color: 'var(--text-muted)', marginLeft: 4 }}>{typVon.get(lok) === 'E-Lok' ? 'E' : 'D'}</span> : null}
                  {frist && <div style={{ fontSize: 10, fontWeight: 400, color: frist.farbe }}>{frist.text}</div>}
                </td>
                {tage.map((t) => {
                  const ab = tagStart(t)
                  const zelle = bloecke.filter((b) => b.lok === lok && b.start >= ab && b.start < ab + 1440)
                  const tagSperren = stl ? sperren.filter((s) => s.lok_id === stl.id && tagStart(s.von) <= ab && tagStart(s.bis) >= ab) : []
                  const tagEinsaetze = einsaetzeIm(einsaetze, stl?.id, ab, ab + 1440)
                  const standort = stl && (zelle.length > 0 || tagEinsaetze.length > 0) ? standortAm(bloecke, lok, ab + 1440) || (tagEinsaetze[0]?.standort ?? '') : ''
                  return (
                    <td
                      key={t}
                      onClick={() => stl && onLokKlick(lok, t)}
                      title={stl ? 'Klicken: Werkstatt, Rangierdienst usw. für diese Lok eintragen' : undefined}
                      style={{ verticalAlign: 'top', padding: 4, borderBottom: '1px solid var(--border)', background: tagSperren.length > 0 ? SCHRAFFUR : undefined, cursor: stl ? 'pointer' : undefined, minHeight: 36 }}
                    >
                      {tagEinsaetze.map((e) => (
                        <div key={e.id} onClick={() => onLokKlick(lok, t)} title={e.bemerkung ?? ''} style={{ cursor: 'pointer', fontSize: 11, color: '#0f766e', background: '#ccfbf1', borderRadius: 4, padding: '1px 5px', marginBottom: 4 }}>
                          🏗 {einsatzText(e)}
                        </div>
                      ))}
                      {tagSperren.map((s) => (
                        <div key={s.id} onClick={() => onLokKlick(lok, t)} title={`${s.art}${s.grund ? ': ' + s.grund : ''}`} style={{ cursor: 'pointer', fontSize: 11, color: '#475569', marginBottom: 4 }}>
                          🔧 {s.art}{s.grund ? `: ${s.grund}` : ''}
                        </div>
                      ))}
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
                            onClick={(ev) => {
                              ev.stopPropagation()
                              onWahl(b.key)
                            }}
                            style={{ border: '1px solid #14325c', outline: b.warnung ? '2px solid #b91c1c' : undefined, outlineOffset: 1, borderRadius: 5, marginBottom: 5, overflow: 'hidden', cursor: 'grab', fontSize: 11, lineHeight: 1.35, background: '#fff' }}
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
                              {tf.length > 0 ? <div style={{ opacity: 0.9 }}>👤 {tf.map(kurzName).join(', ')}</div> : b.unbesetzt ? <div style={{ color: '#fde68a', fontWeight: 700 }}>👤? kein Lokführer</div> : null}
                            </div>
                            {nebenteile.filter((x) => x.start >= erste.start).map((x) => (
                              <div key={x.key} style={{ background: '#e2e8f0', color: '#334155', padding: '2px 5px' }}>
                                {kurzArt(x.art)} {minutenAlsUhr(x.start)}–{minutenAlsUhr(x.ende)} {x.von}→{x.nach}
                              </div>
                            ))}
                          </div>
                        )
                      })}
                      {standort && <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>📍 {standort}</div>}
                    </td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
