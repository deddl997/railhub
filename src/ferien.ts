// Schulferien in Bayern (Quelle: Bayerisches Kultusministerium, km.bayern.de, Stand November 2026).
// Neue Jahre einfach unten in der Liste ergaenzen: von / bis jeweils einschliesslich (JJJJ-MM-TT).

export type FerienArt = 'Winter' | 'Ostern' | 'Pfingsten' | 'Sommer' | 'Herbst' | 'Weihnachten'

export interface Ferien {
  art: FerienArt
  name: string
  von: string
  bis: string
}

export const FERIEN_FARBEN: Record<FerienArt, { hell: string; kraeftig: string }> = {
  Winter: { hell: '#e0f2fe', kraeftig: '#38bdf8' },
  Ostern: { hell: '#fef9c3', kraeftig: '#eab308' },
  Pfingsten: { hell: '#dcfce7', kraeftig: '#22c55e' },
  Sommer: { hell: '#ffedd5', kraeftig: '#f97316' },
  Herbst: { hell: '#f3e8ff', kraeftig: '#a855f7' },
  Weihnachten: { hell: '#fee2e2', kraeftig: '#ef4444' },
}

export const FERIEN_BAYERN: Ferien[] = [
  { art: 'Weihnachten', name: 'Weihnachtsferien', von: '2025-12-22', bis: '2026-01-05' },
  { art: 'Winter', name: 'Winterferien', von: '2026-02-16', bis: '2026-02-20' },
  { art: 'Ostern', name: 'Osterferien', von: '2026-03-30', bis: '2026-04-10' },
  { art: 'Pfingsten', name: 'Pfingstferien', von: '2026-05-26', bis: '2026-06-05' },
  { art: 'Sommer', name: 'Sommerferien', von: '2026-08-03', bis: '2026-09-14' },
  { art: 'Herbst', name: 'Herbstferien (unterrichtsfreie Tage)', von: '2026-11-02', bis: '2026-11-06' },
  { art: 'Herbst', name: 'Buß- und Bettag (schulfrei)', von: '2026-11-18', bis: '2026-11-18' },
  { art: 'Weihnachten', name: 'Weihnachtsferien', von: '2026-12-24', bis: '2027-01-08' },
  { art: 'Winter', name: 'Winterferien', von: '2027-02-08', bis: '2027-02-12' },
  { art: 'Ostern', name: 'Osterferien', von: '2027-03-22', bis: '2027-04-02' },
  { art: 'Pfingsten', name: 'Pfingstferien', von: '2027-05-18', bis: '2027-05-28' },
  { art: 'Sommer', name: 'Sommerferien', von: '2027-08-02', bis: '2027-09-13' },
  { art: 'Herbst', name: 'Herbstferien (unterrichtsfreie Tage)', von: '2027-11-02', bis: '2027-11-05' },
  { art: 'Herbst', name: 'Buß- und Bettag (schulfrei)', von: '2027-11-17', bis: '2027-11-17' },
  { art: 'Weihnachten', name: 'Weihnachtsferien', von: '2027-12-24', bis: '2028-01-07' },
]

export function ferienFuerTag(iso: string): Ferien | undefined {
  return FERIEN_BAYERN.find((f) => iso >= f.von && iso <= f.bis)
}
