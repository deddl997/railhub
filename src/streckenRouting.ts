interface Punkt {
  lat: number
  lon: number
}

const OVERPASS_SERVER = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
]

async function overpassAbfrage(query: string): Promise<any> {
  let letzterFehler: unknown = null

  for (const server of OVERPASS_SERVER) {
    try {
      const antwort = await fetch(server, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
      })
      if (!antwort.ok) {
        letzterFehler = new Error(`${server} antwortete mit Status ${antwort.status}`)
        continue
      }
      return await antwort.json()
    } catch (err) {
      letzterFehler = err
    }
  }

  throw new Error(
    'Alle OpenStreetMap-Server nicht erreichbar: ' +
      (letzterFehler instanceof Error ? letzterFehler.message : String(letzterFehler))
  )
}

function entfernungKm(a: Punkt, b: Punkt): number {
  const erdradius = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLon = ((b.lon - a.lon) * Math.PI) / 180
  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2)
  return 2 * erdradius * Math.asin(Math.sqrt(h))
}

async function segmentRouten(start: Punkt, ziel: Punkt): Promise<Punkt[] | null> {
  const padding = 0.15
  const suedGrenze = Math.min(start.lat, ziel.lat) - padding
  const westGrenze = Math.min(start.lon, ziel.lon) - padding
  const nordGrenze = Math.max(start.lat, ziel.lat) + padding
  const ostGrenze = Math.max(start.lon, ziel.lon) + padding

  const query = `
    [out:json][timeout:25];
    way["railway"~"^(rail|light_rail)$"]["service"!~"yard|siding|spur"](${suedGrenze},${westGrenze},${nordGrenze},${ostGrenze});
    (._;>;);
    out body;
  `

  const daten = await overpassAbfrage(query)

  const knoten = new Map<number, Punkt>()
  for (const el of daten.elements) {
    if (el.type === 'node') knoten.set(el.id, { lat: el.lat, lon: el.lon })
  }
  if (knoten.size === 0) return null

  const nachbarn = new Map<number, { ziel: number; distanz: number }[]>()
  function kanteHinzufuegen(a: number, b: number) {
    const pa = knoten.get(a)
    const pb = knoten.get(b)
    if (!pa || !pb) return
    const d = entfernungKm(pa, pb)
    if (!nachbarn.has(a)) nachbarn.set(a, [])
    if (!nachbarn.has(b)) nachbarn.set(b, [])
    nachbarn.get(a)!.push({ ziel: b, distanz: d })
    nachbarn.get(b)!.push({ ziel: a, distanz: d })
  }

  for (const el of daten.elements) {
    if (el.type === 'way' && Array.isArray(el.nodes)) {
      for (let i = 0; i < el.nodes.length - 1; i++) {
        kanteHinzufuegen(el.nodes[i], el.nodes[i + 1])
      }
    }
  }

  function naechsterKnoten(punkt: Punkt): number | null {
    let bester: number | null = null
    let besteDistanz = Infinity
    for (const [id, p] of knoten) {
      const d = entfernungKm(punkt, p)
      if (d < besteDistanz) {
        besteDistanz = d
        bester = id
      }
    }
    return bester
  }

  const startId = naechsterKnoten(start)
  const zielId = naechsterKnoten(ziel)
  if (startId === null || zielId === null) return null

  // Einfacher Dijkstra-Algorithmus (kuerzester Weg im Gleisnetz)
  const distanzen = new Map<number, number>()
  const vorgaenger = new Map<number, number>()
  const besucht = new Set<number>()
  distanzen.set(startId, 0)

  while (true) {
    let aktuell: number | null = null
    let besteDistanz = Infinity
    for (const [id, d] of distanzen) {
      if (!besucht.has(id) && d < besteDistanz) {
        besteDistanz = d
        aktuell = id
      }
    }
    if (aktuell === null || aktuell === zielId) break
    besucht.add(aktuell)

    for (const kante of nachbarn.get(aktuell) ?? []) {
      if (besucht.has(kante.ziel)) continue
      const neueDistanz = besteDistanz + kante.distanz
      if (neueDistanz < (distanzen.get(kante.ziel) ?? Infinity)) {
        distanzen.set(kante.ziel, neueDistanz)
        vorgaenger.set(kante.ziel, aktuell)
      }
    }
  }

  if (!distanzen.has(zielId)) return null

  const pfad: number[] = []
  let schritt: number | undefined = zielId
  while (schritt !== undefined) {
    pfad.unshift(schritt)
    schritt = vorgaenger.get(schritt)
  }

  return pfad.map((id) => knoten.get(id)).filter((p): p is Punkt => !!p)
}

/**
 * Berechnet eine Route entlang des echten Gleisnetzes (via OpenStreetMap/Overpass)
 * durch mehrere Wegpunkte. Gibt null zurueck, wenn keine Verbindung gefunden wurde.
 * Kann bei grossen Kartenausschnitten mehrere Sekunden dauern.
 */
export async function routeUeberMehrereStationen(
  ankerPunkte: [number, number][]
): Promise<[number, number][] | null> {
  if (ankerPunkte.length < 2) return null

  const gesamtPfad: Punkt[] = []
  for (let i = 0; i < ankerPunkte.length - 1; i++) {
    const start = { lat: ankerPunkte[i][0], lon: ankerPunkte[i][1] }
    const ziel = { lat: ankerPunkte[i + 1][0], lon: ankerPunkte[i + 1][1] }
    const segment = await segmentRouten(start, ziel)
    if (!segment || segment.length === 0) return null
    if (gesamtPfad.length > 0) segment.shift()
    gesamtPfad.push(...segment)
  }

  return gesamtPfad.map((p) => [p.lat, p.lon])
}
