/**
 * Erweiterte Namenssuche: fragt ALLE benannten Bahn-Objekte (Stationen,
 * Abzweigstellen, Betriebsstellen, Rangierbahnhof-Teile usw.) aus
 * OpenStreetMap ab und versucht, sie textuell in Streckenbeschreibungen
 * wiederzufinden - deutlich umfassender als die reine Reisebahnhof-Liste.
 */

interface BenannterPunkt {
  name: string
  lat: number
  lon: number
}

async function overpassAbfrage(query: string): Promise<any> {
  const antwort = await fetch('/api/overpass-proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const daten = await antwort.json()
  if (!antwort.ok) {
    throw new Error(daten.error ? `${daten.error}${daten.details ? ': ' + daten.details : ''}` : 'Fehler bei der Abfrage')
  }
  return daten
}

/**
 * Laedt einmalig alle benannten Bahn-Objekte in Bayern und angrenzenden
 * Gebieten. Kann je nach Auslastung des Servers 10-30 Sekunden dauern.
 */
export async function ladeAlleBenanntenBahnPunkte(): Promise<BenannterPunkt[]> {
  const query = `
    [out:json][timeout:60];
    (
      node["railway"]["name"](47.2,8.8,50.7,13.9);
      node["public_transport"="stop_position"]["railway"]["name"](47.2,8.8,50.7,13.9);
    );
    out body;
  `
  const daten = await overpassAbfrage(query)
  const punkte: BenannterPunkt[] = []
  for (const el of daten.elements) {
    if (el.type === 'node' && el.tags?.name && el.lat && el.lon) {
      punkte.push({ name: el.tags.name.trim(), lat: el.lat, lon: el.lon })
    }
  }
  return punkte
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Sucht bekannte Namen als Wortgrenzen-Treffer im Text, laengere/spezifischere
 * Namen zuerst, ueberlappende Treffer werden nicht doppelt gezaehlt.
 */
export function findeBenannteOrteInText(
  text: string,
  benanntePunkte: BenannterPunkt[]
): BenannterPunkt[] {
  const sortiert = [...benanntePunkte].sort((a, b) => b.name.length - a.name.length)
  const belegt = new Array(text.length).fill(false)
  const treffer: { pos: number; punkt: BenannterPunkt }[] = []
  const gesehen = new Set<string>()

  for (const punkt of sortiert) {
    if (punkt.name.length < 5 || gesehen.has(punkt.name.toLowerCase())) continue
    const muster = new RegExp(
      '(?<![A-Za-zÄÖÜäöüß])' + escapeRegExp(punkt.name) + '(?![A-Za-zÄÖÜäöüß])',
      'gi'
    )
    let treffer_match: RegExpExecArray | null
    while ((treffer_match = muster.exec(text)) !== null) {
      const start = treffer_match.index
      const ende = start + treffer_match[0].length
      let frei = true
      for (let i = start; i < ende; i++) {
        if (belegt[i]) {
          frei = false
          break
        }
      }
      if (frei) {
        for (let i = start; i < ende; i++) belegt[i] = true
        treffer.push({ pos: start, punkt })
        gesehen.add(punkt.name.toLowerCase())
      }
    }
  }

  treffer.sort((a, b) => a.pos - b.pos)
  return treffer.map((t) => t.punkt)
}

function entfernungKm(a: { lat: number; lon: number }, b: [number, number]): number {
  const erdradius = 6371
  const dLat = ((b[0] - a.lat) * Math.PI) / 180
  const dLon = ((b[1] - a.lon) * Math.PI) / 180
  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b[0] * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return 2 * erdradius * Math.asin(Math.sqrt(h))
}

/**
 * Laedt alle Bahnhoefe/Haltepunkte aus OpenStreetMap, die tatsaechlich in der
 * Naehe der uebergebenen Streckenlinie liegen (max. 1,5 km Abstand), sortiert
 * in der Reihenfolge, in der sie entlang der Strecke liegen. Deutlich
 * vollstaendiger als die reine Namens-Erkennung aus dem Streckentitel, da
 * auch kleine Zwischenhalte erfasst werden, die im offiziellen Streckennamen
 * nicht auftauchen.
 */
export async function ladeStationenEntlangRoute(
  punkte: [number, number][]
): Promise<BenannterPunkt[]> {
  const lats = punkte.map((p) => p[0])
  const lons = punkte.map((p) => p[1])
  const padding = 0.03
  const sued = Math.min(...lats) - padding
  const west = Math.min(...lons) - padding
  const nord = Math.max(...lats) + padding
  const ost = Math.max(...lons) + padding

  const query = `
    [out:json][timeout:30];
    node["railway"~"^(station|halt)$"]["name"](${sued},${west},${nord},${ost});
    out body;
  `
  const daten = await overpassAbfrage(query)

  const kandidaten: BenannterPunkt[] = []
  for (const el of daten.elements) {
    if (el.type === 'node' && el.tags?.name && el.lat && el.lon) {
      kandidaten.push({ name: el.tags.name.trim(), lat: el.lat, lon: el.lon })
    }
  }

  const mitIndex: { punkt: BenannterPunkt; index: number; distanz: number }[] = []
  for (const kandidat of kandidaten) {
    let besterIndex = 0
    let besteDistanz = Infinity
    punkte.forEach((p, i) => {
      const d = entfernungKm(kandidat, p)
      if (d < besteDistanz) {
        besteDistanz = d
        besterIndex = i
      }
    })
    if (besteDistanz <= 1.5) {
      mitIndex.push({ punkt: kandidat, index: besterIndex, distanz: besteDistanz })
    }
  }

  mitIndex.sort((a, b) => a.index - b.index)

  const gesehen = new Set<string>()
  const ergebnis: BenannterPunkt[] = []
  for (const eintrag of mitIndex) {
    if (gesehen.has(eintrag.punkt.name)) continue
    gesehen.add(eintrag.punkt.name)
    ergebnis.push(eintrag.punkt)
  }

  return ergebnis
}
