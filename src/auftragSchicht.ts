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
