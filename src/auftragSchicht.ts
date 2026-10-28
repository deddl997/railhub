import { datumZuISO } from './datumUtils'

export const VORLAUF_MINUTEN = 60
export const MINDEST_DAUER_MINUTEN = 8 * 60

// Pause nach Arbeitszeitgesetz (§ 4): mehr als 6 Std. = 30 Min., mehr als 9 Std. = 45 Min.
export function pauseNachArbZG(bruttoMinuten: number): number {
  if (bruttoMinuten > 9 * 60) return 45
  if (bruttoMinuten > 6 * 60) return 30
  return 0
}

export interface AuftragKern {
  referenz: string | null
  zug_nr: string | null
  abfahrt_ort: string | null
  abfahrt_datum: string
  abfahrt_soll: string | null
  ankunft_ort: string | null
  ankunft_datum: string | null
  ankunft_soll: string | null
  lok: string | null
  mitarbeiter_info: string | null
}

export interface SchichtDaten {
  datum: string
  name: string
  beginn_zeit: string
  ende_zeit: string
  pause_minuten: number
  dienstort: string | null
  info: string | null
}

function minutenSeit1970(datumIso: string, zeit: string): number {
  const [j, m, t] = datumIso.split('-').map(Number)
  const [h, min] = zeit.split(':').map(Number)
  return Date.UTC(j, m - 1, t, h, min) / 60000
}

function alsZeit(minuten: number): string {
  const rest = ((minuten % 1440) + 1440) % 1440
  return `${String(Math.floor(rest / 60)).padStart(2, '0')}:${String(rest % 60).padStart(2, '0')}`
}

function alsDatum(minuten: number): string {
  const d = new Date(minuten * 60000)
  return datumZuISO(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

// Dienstbeginn 60 Min. vor Abfahrt, Dienstende zur Ankunft, mindestens 8 Std., Pause nach ArbZG
export function schichtAusAuftrag(a: AuftragKern): SchichtDaten | null {
  if (!a.abfahrt_soll) return null
  const abfahrt = a.abfahrt_soll.slice(0, 5)
  const beginnAbs = minutenSeit1970(a.abfahrt_datum, abfahrt) - VORLAUF_MINUTEN
  let dauer = MINDEST_DAUER_MINUTEN
  if (a.ankunft_soll) {
    const ankunftAbs = minutenSeit1970(a.ankunft_datum ?? a.abfahrt_datum, a.ankunft_soll.slice(0, 5))
    let d = ankunftAbs - beginnAbs
    if (d <= 0) d += 1440
    if (d > dauer) dauer = d
  }
  const ref = a.referenz ?? 'Fahrt'
  const von = a.abfahrt_ort ?? ''
  const nach = a.ankunft_ort ?? ''
  const nummer = a.zug_nr ? ` (${a.zug_nr})` : ''
  const standardInfo =
    `Zug ${ref}${nummer}: ${von} ${abfahrt}` +
    (a.ankunft_soll ? ` → ${nach} ${a.ankunft_soll.slice(0, 5)}.` : '.') +
    (a.lok ? ` Geplante Lok: ${a.lok}.` : '')
  return {
    datum: alsDatum(beginnAbs),
    name: von || nach ? `${ref} ${von}–${nach}` : ref,
    beginn_zeit: alsZeit(beginnAbs),
    ende_zeit: alsZeit(beginnAbs + dauer),
    pause_minuten: pauseNachArbZG(dauer),
    dienstort: a.abfahrt_ort,
    info: (a.mitarbeiter_info && a.mitarbeiter_info.trim()) || standardInfo,
  }
}

// ============================================================
// Fahrten innerhalb einer Schicht (Zugfahrt, Lokzufuehrung, ...)
// ============================================================

export const FAHRT_ARTEN = ['Zugfahrt', 'Lokzuführung', 'Lokrückführung', 'Rangieren', 'Wartezeit', 'Sonstiges']

export interface Fahrtzeile {
  art: string
  zug: string
  von: string
  von_zeit: string
  nach: string
  nach_zeit: string
  lok: string
  datum?: string
}

export function leereFahrt(art = 'Zugfahrt'): Fahrtzeile {
  return { art, zug: '', von: '', von_zeit: '', nach: '', nach_zeit: '', lok: '' }
}

export function fahrtenAusAuftrag(a: AuftragKern): Fahrtzeile[] {
  return [
    {
      art: 'Zugfahrt',
      zug: [a.referenz, a.zug_nr ? `(${a.zug_nr})` : ''].filter(Boolean).join(' '),
      von: a.abfahrt_ort ?? '',
      von_zeit: a.abfahrt_soll ? a.abfahrt_soll.slice(0, 5) : '',
      nach: a.ankunft_ort ?? '',
      nach_zeit: a.ankunft_soll ? a.ankunft_soll.slice(0, 5) : '',
      lok: a.lok ?? '',
    },
  ]
}

export function fahrtenPruefen(roh: unknown): Fahrtzeile[] {
  if (!Array.isArray(roh)) return []
  return roh.map((f) => ({ ...leereFahrt(), ...(f as Partial<Fahrtzeile>) }))
}

function zeitInMinuten(z: string): number {
  const [h, m] = z.split(':').map(Number)
  return h * 60 + m
}

// Text fuer das Info-Feld der Schicht (wird dem Lokfuehrer angezeigt)
export function infoAusFahrten(fahrten: Fahrtzeile[], zusatz: string | null): string {
  const zeilen = fahrten
    .filter((f) => f.von || f.nach || f.von_zeit || f.nach_zeit)
    .map((f, i) => {
      const teile = [
        f.von_zeit && f.von ? `${f.von} ${f.von_zeit}` : f.von || f.von_zeit,
        f.nach_zeit && f.nach ? `${f.nach} ${f.nach_zeit}` : f.nach || f.nach_zeit,
      ].filter(Boolean)
      const kopf = f.zug ? `${f.art} ${f.zug}` : f.art
      return `${i + 1}. ${kopf}: ${teile.join(' → ')}${f.lok ? ` (Lok ${f.lok})` : ''}`
    })
  const text = zeilen.join('\n')
  return [text, zusatz?.trim() ?? ''].filter(Boolean).join('\n\n')
}

export interface ZeitenErgebnis {
  datum: string
  beginn: string
  ende: string
  brutto: number
  pause: number
}

// Dienstbeginn = erste Zeit der Fahrten minus Vorlauf, Dienstende = letzte Zeit (mindestens 8 Std.)
export function zeitenAusFahrten(abfahrtDatum: string, abfahrtSoll: string | null, fahrten: Fahrtzeile[]): ZeitenErgebnis | null {
  const zeiten: string[] = []
  for (const f of fahrten) {
    if (f.von_zeit) zeiten.push(f.von_zeit)
    if (f.nach_zeit) zeiten.push(f.nach_zeit)
  }
  if (zeiten.length === 0) return null
  const [j, m, t] = abfahrtDatum.split('-').map(Number)
  const tag0 = Date.UTC(j, m - 1, t) / 60000
  let versatz = 0
  // liegt die erste Zeit viel spaeter als die Abfahrt des Auftrags, war sie am Vortag (z. B. Lokzufuehrung abends)
  if (abfahrtSoll && zeitInMinuten(zeiten[0]) - zeitInMinuten(abfahrtSoll.slice(0, 5)) > 720) versatz = -1440
  const absolut: number[] = []
  let letzte = -Infinity
  for (const z of zeiten) {
    let a = tag0 + versatz + zeitInMinuten(z)
    while (a < letzte) a += 1440
    absolut.push(a)
    letzte = a
  }
  const beginnAbs = absolut[0] - VORLAUF_MINUTEN
  let brutto = absolut[absolut.length - 1] - beginnAbs
  if (brutto < MINDEST_DAUER_MINUTEN) brutto = MINDEST_DAUER_MINUTEN
  const d = new Date(beginnAbs * 60000)
  const rest = ((beginnAbs % 1440) + 1440) % 1440
  const alsZeitText = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
  const endeRest = (((beginnAbs + brutto) % 1440) + 1440) % 1440
  return {
    datum: datumZuISO(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())),
    beginn: alsZeitText(rest),
    ende: alsZeitText(endeRest),
    brutto,
    pause: pauseNachArbZG(brutto),
  }
}


// ============================================================
// Mehrere Teilstrecken mit Personalwechsel (z. B. MDIF -> FFU -> HBHSK)
// ============================================================

// Teilstrecken eines Auftrags: mindestens zwei Zugfahrten in der Liste. Zwischen ihnen ist Personalwechsel.
export function teilstrecken(fahrten: unknown): Fahrtzeile[] {
  const zug = fahrtenPruefen(fahrten).filter((f) => f.art === 'Zugfahrt' && f.von && f.nach)
  return zug.length >= 2 ? zug : []
}

export function teilName(f: Fahrtzeile): string {
  return `${f.von}–${f.nach}`
}

function wechselHinweis(i: number, legs: Fahrtzeile[]): string {
  const teile: string[] = []
  if (i > 0) teile.push(`Übernahme von Kollegen in ${legs[i].von} um ${legs[i].von_zeit}.`)
  if (i < legs.length - 1) teile.push(`Übergabe an Kollegen in ${legs[i].nach} um ${legs[i].nach_zeit}.`)
  return teile.length > 0 ? ' Personalwechsel: ' + teile.join(' ') : ''
}

// Eine Schicht pro Teilstrecke, oder eine einzelne Schicht bei normalen Aufträgen
export function schichtenAusAuftrag(a: AuftragKern & { fahrten: unknown }): SchichtDaten[] {
  const legs = teilstrecken(a.fahrten)
  if (legs.length === 0) {
    const s = schichtAusAuftrag(a)
    return s ? [s] : []
  }
  const ergebnis: SchichtDaten[] = []
  legs.forEach((leg, i) => {
    const s = schichtAusAuftrag({
      ...a,
      abfahrt_ort: leg.von,
      abfahrt_datum: leg.datum ?? a.abfahrt_datum,
      abfahrt_soll: leg.von_zeit || null,
      ankunft_ort: leg.nach,
      ankunft_datum: null,
      ankunft_soll: leg.nach_zeit || null,
      lok: leg.lok || a.lok,
      mitarbeiter_info: null,
    })
    if (s) ergebnis.push({ ...s, info: (s.info ?? '') + wechselHinweis(i, legs) })
  })
  return ergebnis
}

export { wechselHinweis }
