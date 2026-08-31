import { datumZuISO } from './datumUtils'

export interface Feiertag {
  datum: string
  name: string
}

function osterSonntag(jahr: number): Date {
  const a = jahr % 19
  const b = Math.floor(jahr / 100)
  const c = jahr % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const monat = Math.floor((h + l - 7 * m + 114) / 31)
  const tag = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(jahr, monat - 1, tag)
}

function tagePlus(datum: Date, tage: number): Date {
  const neu = new Date(datum)
  neu.setDate(neu.getDate() + tage)
  return neu
}

/**
 * Gesetzliche Feiertage in Bayern. Mariä Himmelfahrt (15. August) ist
 * genaugenommen nur in Gemeinden mit überwiegend katholischer Bevölkerung
 * ein gesetzlicher Feiertag - hier der Einfachheit halber landesweit
 * mitgezählt. Bei Bedarf kann diese Zeile entfernt werden.
 */
export function feiertageBayern(jahr: number): Feiertag[] {
  const ostern = osterSonntag(jahr)

  return [
    { datum: `${jahr}-01-01`, name: 'Neujahr' },
    { datum: `${jahr}-01-06`, name: 'Heilige Drei Könige' },
    { datum: datumZuISO(tagePlus(ostern, -2)), name: 'Karfreitag' },
    { datum: datumZuISO(tagePlus(ostern, 1)), name: 'Ostermontag' },
    { datum: `${jahr}-05-01`, name: 'Tag der Arbeit' },
    { datum: datumZuISO(tagePlus(ostern, 39)), name: 'Christi Himmelfahrt' },
    { datum: datumZuISO(tagePlus(ostern, 50)), name: 'Pfingstmontag' },
    { datum: datumZuISO(tagePlus(ostern, 60)), name: 'Fronleichnam' },
    { datum: `${jahr}-08-15`, name: 'Mariä Himmelfahrt' },
    { datum: `${jahr}-10-03`, name: 'Tag der Deutschen Einheit' },
    { datum: `${jahr}-11-01`, name: 'Allerheiligen' },
    { datum: `${jahr}-12-25`, name: '1. Weihnachtsfeiertag' },
    { datum: `${jahr}-12-26`, name: '2. Weihnachtsfeiertag' },
  ]
}
