import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Nur POST erlaubt' })
  }

  const { bildBase64, mediaType } = req.body

  if (!bildBase64 || !mediaType) {
    return res.status(400).json({ error: 'Bild fehlt' })
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mediaType,
                  data: bildBase64,
                },
              },
              {
                type: 'text',
                text: `Das ist ein Foto/Scan eines "Urlaubsantrag - Betriebsdienst" Formulars von Rail Bavaria Logistik. Das Formular kann MEHRERE Urlaubszeiträume enthalten (Tabelle mit Spalten Von/Bis/Anzahl Tage, bis zu 6 Zeilen). Lies alle Felder aus und antworte AUSSCHLIESSLICH mit einem JSON-Objekt in genau dieser Struktur, ohne Markdown-Codeblock, ohne weiteren Text:

{
  "gemeinsam": {
    "jahr": Zahl oder null,
    "name": Text oder null,
    "kategorie": Text (Lokführer/Dienstleister/Wagenmeister/Disposition/Betriebsleitung - welche Option ausgewählt/angekreuzt ist) oder null,
    "urlaubsanspruch": Zahl oder null,
    "verplant": Zahl oder null,
    "rest": Zahl oder null,
    "resturlaub_vorjahr": Zahl oder null,
    "ort_antragsteller": Text oder null,
    "datum_antragsteller": Datum im Format YYYY-MM-DD oder null,
    "bearbeitet_von": Text - falls im Bereich "Bearbeitung" bereits ein Name/Vermerk eingetragen ist, sonst null,
    "ort_bearbeiter": Text - Ort im Bearbeitungsbereich, falls vorhanden, sonst null,
    "datum_bearbeiter": Datum im Format YYYY-MM-DD - Datum im Bearbeitungsbereich, falls vorhanden, sonst null
  },
  "zeitraeume": [
    {
      "erster_tag": Datum im Format YYYY-MM-DD oder null,
      "letzter_tag": Datum im Format YYYY-MM-DD oder null,
      "anzahl_tage": Zahl oder null
    }
  ]
}

Gib in "zeitraeume" ein Array-Element PRO ausgefüllter Zeile der Zeitraum-Tabelle zurück (ignoriere leere Zeilen, es können bis zu 6 sein). Falls nur ein einzelner Zeitraum im Formular steht, enthält das Array genau ein Element.`,
              },
            ],
          },
        ],
      }),
    })

    const data = await response.json()

    if (!response.ok) {
      return res.status(500).json({ error: 'Claude API Fehler', details: data })
    }

    const textAntwort = data.content[0].text
    const bereinigt = textAntwort.replace(/```json|```/g, '').trim()
    const ausgelesenerAntrag = JSON.parse(bereinigt)

    return res.status(200).json(ausgelesenerAntrag)
  } catch (error) {
    return res.status(500).json({ error: 'Serverfehler', details: String(error) })
  }
}
