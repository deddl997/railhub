import * as XLSX from 'xlsx'
import { feiertageBayern } from './feiertage'

export interface Block {
  von: string
  bis: string
  tage: number
}

export interface ExcelPerson {
  zeile: number
  name: string
  vorjahr: number
  anspruch: number
  genommen: number
  rest: number
  bloecke: Block[]
  tageKalender: number
  krankTage: number
  sonderTage: number
}

export interface ExcelErgebnis {
  jahr: number
  personen: ExcelPerson[]
  hinweise: string[]
}

function serialZuIso(n: number): string {
  return new Date(Math.round((n - 25569) * 86400000)).toISOString().slice(0, 10)
}

function zuIso(v: unknown): string | null {
  if (v instanceof Date) {
    const y = v.getFullYear()
    return `${y}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
  }
  if (typeof v === 'number' && v > 30000 && v < 80000) return serialZuIso(v)
  return null
}

function zahl(v: unknown): number {
  if (typeof v === 'number') return v
  if (typeof v === 'string') {
    const n = Number(v.replace(',', '.'))
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

function istArbeitsfrei(iso: string, feiertage: Set<string>): boolean {
  const tag = new Date(iso + 'T00:00:00Z').getUTCDay()
  return tag === 0 || tag === 6 || feiertage.has(iso)
}

function plusTag(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// Urlaubstage zu Bloecken zusammenfassen: Wochenenden und Feiertage zwischen zwei Urlaubstagen unterbrechen den Block nicht
export function blockeBilden(tage: { datum: string; wert: number }[], feiertage: Set<string>): Block[] {
  const sortiert = [...tage].sort((a, b) => a.datum.localeCompare(b.datum))
  const ergebnis: Block[] = []
  let aktuell: Block | null = null
  for (const t of sortiert) {
    if (aktuell) {
      let luecke = true
      for (let d = plusTag(aktuell.bis, 1); d < t.datum; d = plusTag(d, 1)) {
        if (!istArbeitsfrei(d, feiertage)) {
          luecke = false
          break
        }
      }
      if (luecke) {
        aktuell.bis = t.datum
        aktuell.tage += t.wert
        continue
      }
      ergebnis.push(aktuell)
    }
    aktuell = { von: t.datum, bis: t.datum, tage: t.wert }
  }
  if (aktuell) ergebnis.push(aktuell)
  return ergebnis
}

export function excelLesen(daten: ArrayBuffer): ExcelErgebnis {
  const wb = XLSX.read(daten, { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  const zeilen = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null }) as unknown[][]
  const hinweise: string[] = []

  // Kopfzeile finden: die Zeile mit "Mitarbeiter"
  let kopf = -1
  for (let r = 0; r < Math.min(zeilen.length, 15); r++) {
    if ((zeilen[r] ?? []).some((c) => typeof c === 'string' && c.toLowerCase().includes('mitarbeiter'))) {
      kopf = r
      break
    }
  }
  if (kopf === -1) throw new Error('Die Kopfzeile mit „Mitarbeiter“ wurde nicht gefunden. Ist das die richtige Datei?')
  const k = zeilen[kopf]
  const text = (c: unknown) => (typeof c === 'string' ? c.toLowerCase().replace(/\s+/g, ' ') : '')
  const spalte = (test: (t: string) => boolean) => k.findIndex((c) => test(text(c)))
  const sName = spalte((t) => t.includes('mitarbeiter'))
  const sVorjahr = spalte((t) => t.includes('resturlaub') && t.includes('letzt'))
  const sAnspruch = spalte((t) => t.includes('anspruch'))
  const sGenommen = spalte((t) => t.includes('genommen'))
  const sRest = spalte((t) => t.startsWith('resturlaub') && !t.includes('letzt'))
  if (sName === -1 || sAnspruch === -1) throw new Error('Die Spalten „Mitarbeiter“ und „Urlaubsanspruch“ wurden nicht gefunden.')

  // Datumsspalten
  const datumSpalten: { spalte: number; iso: string }[] = []
  for (let c = 0; c < k.length; c++) {
    const iso = zuIso(k[c])
    if (iso && c > sName) datumSpalten.push({ spalte: c, iso })
  }
  if (datumSpalten.length === 0) throw new Error('Keine Datumsspalten in der Kopfzeile gefunden.')
  const jahr = Number(datumSpalten[0].iso.slice(0, 4))
  const feiertage = new Set(feiertageBayern(jahr).map((f) => f.datum))

  const personen: ExcelPerson[] = []
  for (let r = kopf + 1; r < zeilen.length; r++) {
    const z = zeilen[r] ?? []
    const nameRoh = z[sName]
    const marken = datumSpalten.filter((d) => typeof z[d.spalte] === 'string' && String(z[d.spalte]).trim() !== '')
    const hatAnspruch = typeof z[sAnspruch] === 'number'
    if (typeof nameRoh !== 'string' || nameRoh.trim() === '') {
      if (hatAnspruch && marken.length > 0) hinweise.push(`Zeile ${r + 1}: Urlaubstage eingetragen, aber kein Name. Diese Zeile wird ignoriert.`)
      continue
    }
    if (!hatAnspruch) continue // Legende, Links usw.

    const urlaub: { datum: string; wert: number }[] = []
    let krank = 0
    let sonder = 0
    for (const d of marken) {
      const m = String(z[d.spalte]).trim()
      if (m === 'U') urlaub.push({ datum: d.iso, wert: 1 })
      else if (m === 'u') urlaub.push({ datum: d.iso, wert: 0.5 })
      else if (m === 'K') krank += 1
      else if (m === 'k') krank += 0.5
      else if (m === 'S') sonder += 1
      else if (m === 's') sonder += 0.5
      else hinweise.push(`${nameRoh.trim()}: unbekanntes Zeichen „${m}“ am ${d.iso.split('-').reverse().join('.')} wurde ignoriert.`)
    }
    const tageKalender = urlaub.reduce((s, t) => s + t.wert, 0)
    personen.push({
      zeile: r + 1,
      name: nameRoh.trim().replace(/\s+/g, ' '),
      vorjahr: sVorjahr === -1 ? 0 : zahl(z[sVorjahr]),
      anspruch: zahl(z[sAnspruch]),
      genommen: sGenommen === -1 ? tageKalender : zahl(z[sGenommen]),
      rest: sRest === -1 ? 0 : zahl(z[sRest]),
      bloecke: blockeBilden(urlaub, feiertage),
      tageKalender,
      krankTage: krank,
      sonderTage: sonder,
    })
  }
  return { jahr, personen, hinweise }
}

// Wie wird der Urlaub auf Vorjahr und laufendes Jahr verteilt? Vorjahresurlaub wird zuerst verbraucht.
export function resturlaubVerteilen(p: { vorjahr: number; anspruch: number; genommen: number }) {
  const ausVorjahr = Math.min(p.vorjahr, p.genommen)
  return {
    restVorjahr: p.vorjahr - ausVorjahr,
    restAktuell: p.anspruch - (p.genommen - ausVorjahr),
  }
}

// ---- Namen zuordnen ----
function tokens(name: string): string[] {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((t) => t.length > 0)
}

export function trefferGuete(excelName: string, dbName: string): number {
  const a = tokens(excelName)
  const b = tokens(dbName)
  if (a.length === 0 || b.length === 0) return 0
  const gleich = a.length === b.length && a.every((t) => b.includes(t))
  if (gleich) return 3
  const praefix = (x: string[], y: string[]) => x.every((t) => y.some((u) => u.startsWith(t) || t.startsWith(u)))
  if ((a.length >= 2 && praefix(a, b)) || (b.length >= 2 && praefix(b, a))) return 2
  const gemeinsam = a.filter((t) => t.length >= 4 && b.includes(t)).length
  return gemeinsam >= 1 ? 1 : 0
}

export function bestenTreffer<T extends { id: string; name: string }>(excelName: string, kandidaten: T[]): { person: T | null; guete: number } {
  let beste: T | null = null
  let guete = 0
  let eindeutig = true
  for (const c of kandidaten) {
    const g = trefferGuete(excelName, c.name)
    if (g > guete) {
      beste = c
      guete = g
      eindeutig = true
    } else if (g === guete && g > 0) {
      eindeutig = false
    }
  }
  if (!eindeutig) return { person: null, guete: 0 }
  return { person: beste, guete }
}
