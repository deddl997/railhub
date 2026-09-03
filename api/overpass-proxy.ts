import type { VercelRequest, VercelResponse } from '@vercel/node'

const OVERPASS_SERVER = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
]

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Nur POST erlaubt' })
  }

  const { query } = req.body

  if (!query || typeof query !== 'string') {
    return res.status(400).json({ error: 'Kein gültiges Overpass-Query mitgeschickt' })
  }

  let letzterFehler: string | null = null

  for (const server of OVERPASS_SERVER) {
    try {
      const antwort = await fetch(server, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
      })

      const text = await antwort.text()

      if (!antwort.ok) {
        letzterFehler = `${server} antwortete mit Status ${antwort.status}: ${text.slice(0, 300)}`
        continue
      }

      const daten = JSON.parse(text)
      return res.status(200).json(daten)
    } catch (error) {
      letzterFehler = `${server}: ${String(error)}`
    }
  }

  return res.status(502).json({ error: 'Alle OpenStreetMap-Server nicht erreichbar', details: letzterFehler })
}
