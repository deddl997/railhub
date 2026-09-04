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
