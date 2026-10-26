export function zeitMin(zeit: string): number {
  const [h, m] = zeit.split(':').map(Number)
  return h * 60 + m
}

export function zeitKurz(zeit: string | null): string {
  return zeit ? zeit.slice(0, 5) : '–'
}

// Arbeitszeit in Minuten (ueber Mitternacht moeglich), abzueglich Pause
export function arbeitsMinuten(beginn: string, ende: string, pause: number): number {
  let d = zeitMin(ende) - zeitMin(beginn)
  if (d <= 0) d += 1440
  return Math.max(0, d - (pause || 0))
}

export function stundenText(min: number): string {
  const vorzeichen = min < 0 ? '-' : ''
  const a = Math.abs(min)
  return `${vorzeichen}${Math.floor(a / 60)}:${String(a % 60).padStart(2, '0')} Std.`
}

export function differenzText(min: number): string {
  if (min === 0) return 'wie geplant'
  return `${min > 0 ? '+' : '-'}${stundenText(Math.abs(min))}`
}

export function datumDeutsch(iso: string): string {
  return iso.split('-').reverse().join('.')
}

export interface Zeitkorrektur {
  id: string
  mitarbeiter_id: string
  datum: string
  schicht_name: string | null
  geplant_beginn: string | null
  geplant_ende: string | null
  geplant_pause: number
  ist_beginn: string
  ist_ende: string
  ist_pause: number
  grund: string
  status: 'offen' | 'genehmigt' | 'abgelehnt'
  planer_notiz: string | null
  entschieden_am: string | null
  created_at: string
}

export function mehrzeitMinuten(k: Zeitkorrektur): number {
  if (!k.geplant_beginn || !k.geplant_ende) return 0
  return (
    arbeitsMinuten(k.ist_beginn, k.ist_ende, k.ist_pause) -
    arbeitsMinuten(k.geplant_beginn, k.geplant_ende, k.geplant_pause)
  )
}
