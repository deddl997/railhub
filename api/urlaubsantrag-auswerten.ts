import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Nur POST erlaubt' })
  }

  const { bildBase64, mediaType } = req.body

  if (!bildBase64 || !mediaType) {
    return res.status(400).json({ error: 'Bild fehlt' })
  }

  const istPdf = mediaType === 'application/pdf'

  const inhaltsBlock = istPdf
    ? {
        type: 'document',
        source: {
          type: 'base64',
          media_type: 'application/pdf',
          data: bildBase64,
        },
      }
    : {
        type: 'image',
        source: {
          type: 'base64',
          media_type: mediaType,
          data: bildBase64,
        },
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
              inhaltsBlock,
              {
                type: 'text',
                text: `Das ist ein Foto/Scan eines "Urlaubsantrag" Formulars von Rail Bavaria Logistik (Personalwesen, Version 01). Das Formular kann MEHRERE Urlaubszeiträume enthalten (Tabelle mit Spalten Von/Bis, bis zu 4 Zeilen). Lies alle Felder aus und antworte AUSSCHLIESSLICH mit einem JSON-Objekt in genau dieser Struktur, ohne Markdown-Codeblock, ohne weiteren Text:

{
  "gemeinsam": {
    "jahr": Zahl oder null (aus den Urlaubsdaten abgeleitetes Jahr, falls nicht explizit angegeben),
    "name": Text - Vorname und Nachname zusammen, oder null,
    "vorgesetzter": Text - Name des eingetragenen Vorgesetzten, oder null,
    "funktion_bereich": Text aus dem Feld "Funktion / Bereich", oder null,
    "urlaubsart": EXAKT eine dieser Optionen, je nachdem welche Checkbox angekreuzt ist: "Erholungsurlaub", "Sonderurlaub", "Bildungsurlaub", "Unbezahlter Urlaub", "Sonstiges" - oder null falls keine angekreuzt,
    "urlaubsart_begruendung": Text - falls bei Sonderurlaub oder Sonstiges eine Begründung/Angabe eingetragen ist, sonst null,
    "urlaubsanspruch": Zahl aus "Urlaubsanspruch laufendes Jahr" oder null,
    "verplant": Zahl aus "Davon bereits genommen" oder null,
    "rest": Zahl aus "Verbleibender Resturlaub" oder null,
    "resturlaub_vorjahr": Zahl aus "Resturlaub Vorjahr" oder null,
    "datum_antragsteller": Datum im Format YYYY-MM-DD aus "Datum, Unterschrift Mitarbeiter" (Abschnitt 5), oder null,
    "bearbeitet_von": Text - Name des Vorgesetzten aus "Name in Blockbuchstaben" unter "Datum, Unterschrift Vorgesetzter" (Abschnitt 5), falls bereits ausgefüllt, sonst null,
    "datum_bearbeiter": Datum im Format YYYY-MM-DD aus "Datum, Unterschrift Vorgesetzter" (Abschnitt 5), falls bereits ausgefüllt, sonst null
  },
  "zeitraeume": [
    {
      "erster_tag": Datum im Format YYYY-MM-DD oder null,
      "letzter_tag": Datum im Format YYYY-MM-DD oder null,
      "anzahl_tage": Zahl oder null
    }
  ]
}

Gib in "zeitraeume" ein Array-Element PRO ausgefüllter Zeile der Von/Bis-Tabelle zurück (ignoriere leere Zeilen, es können bis zu 4 sein). Falls nur ein einzelner Zeitraum im Formular steht, enthält das Array genau ein Element.`,
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