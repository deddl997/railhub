import { feiertageBayern } from './feiertage'

export function berechneBrauchbareTage(
  ersterTag: string | null,
  letzterTag: string | null
): number | null {
  if (!ersterTag || !letzterTag) return null

  const start = new Date(ersterTag)
  const ende = new Date(letzterTag)
  if (isNaN(start.getTime()) || isNaN(ende.getTime()) || start > ende) return null

  const feiertagsCache = new Map<number, Set<string>>()
  function feiertageDesJahres(jahr: number) {
    if (!feiertagsCache.has(jahr)) {
      feiertagsCache.set(jahr, new Set(feiertageBayern(jahr).map((f) => f.datum)))
    }
    return feiertagsCache.get(jahr)!
  }

  let brauchbareTage = 0
  const aktuellerTag = new Date(start)

  while (aktuellerTag <= ende) {
    const wochentag = aktuellerTag.getDay()
    const jahr = aktuellerTag.getFullYear()
    const monat = String(aktuellerTag.getMonth() + 1).padStart(2, '0')
    const tag = String(aktuellerTag.getDate()).padStart(2, '0')
    const iso = `${jahr}-${monat}-${tag}`

    const istWochenende = wochentag === 0 || wochentag === 6
    const istFeiertag = feiertageDesJahres(jahr).has(iso)

    if (!istWochenende && !istFeiertag) {
      brauchbareTage++
    }

    aktuellerTag.setDate(aktuellerTag.getDate() + 1)
  }

  return brauchbareTage
}
