// @ts-nocheck
// Liest eine Bestellung (Zugfahrten) per KI aus. Nur fuer angemeldete Planer (Admins).
import { createClient } from '@supabase/supabase-js'

const PROMPT = `Du liest eine Bestellung von Autoverkehren (Zugfahrten) der Rail Bavaria Logistik GmbH aus.

Jede Fahrt steht in einer Zeile mit: Referenz (Zugname, oft mit Nummer in einer zweiten Zeile), Datum, Von (Ort), Zeit (Abfahrt), Nach (Ort), Zeit (Ankunft). Weitere Spalten (Tf, Wagenmeister, Bedienung Saal, Wagenmeister extern, Slot BHV, geplante Lok) gehören zur Fahrt oder sind Zusatzinfos.

Aufgabe:
- Gib jede Fahrt mit Abfahrts- UND Ankunftszeit als Eintrag in "fahrten" aus.
- Datum im Format YYYY-MM-DD (so wie in der Bestellung angegeben, nicht umrechnen oder korrigieren).
- Zeiten im Format HH:MM (24 Stunden).
- "referenz" ist der Zugname (z.B. "MilDiBHV4401"), "referenznummer" die zweite Zeile/Nummer (z.B. "98045666"), sonst null. Ist die Nummer nur "xxx", dann null.
- "lok" ist die geplante Lok dieser Fahrt (z.B. "185-xxx", "Vectron Raaberbahn"), sonst null. Die geplante Lok gilt oft für mehrere Zeilen eines Blocks.
- "tf_hinweis": steht in der Spalte "Tf" ein Text (z.B. "bereits bekannt aus Vorwoche", "RBL KW 45"), gib ihn hier wörtlich an, sonst null. Ein "-" oder eine leere Zelle ist null.
- Wagenmeister-Angaben (WTU, Bolle, Spieß, Slot) NICHT in die Fahrten übernehmen.
- Zeilen ohne Abfahrts- und Ankunftszeit (z.B. "Bedienung NSL", "Slot 1") gehören NICHT zu "fahrten", sondern in "uebersprungen" mit kurzer Begründung.
- Erfinde nichts. Nichts erkennbar: leere Listen.

Antworte AUSSCHLIESSLICH mit JSON in genau diesem Format, ohne Text davor oder danach:
{"fahrten":[{"referenz":"","referenznummer":null,"datum":"YYYY-MM-DD","von":"","von_zeit":"HH:MM","nach":"","nach_zeit":"HH:MM","lok":null,"tf_hinweis":null}],"uebersprungen":[{"zeile":"","grund":""}]}`

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ fehler: 'Nur POST erlaubt' })

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!supabaseUrl || !anonKey || !apiKey) {
    return res.status(500).json({ fehler: 'Server nicht vollständig eingerichtet (Umgebungsvariablen fehlen).' })
  }

  const authKopf = req.headers.authorization || ''
  if (!authKopf.startsWith('Bearer ')) return res.status(401).json({ fehler: 'Nicht angemeldet' })

  const client = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authKopf } },
    auth: { persistSession: false },
  })
  const { data: istAdmin, error: adminFehler } = await client.rpc('ist_disponent')
  if (adminFehler || istAdmin !== true) return res.status(403).json({ fehler: 'Nur Planer und Disponenten dürfen Bestellungen einlesen' })

  const { art, text, mime, daten } = req.body || {}
  const inhalt = []
  if (art === 'datei' && daten) {
    if (mime === 'application/pdf') {
      inhalt.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: daten } })
    } else {
      inhalt.push({ type: 'image', source: { type: 'base64', media_type: mime || 'image/jpeg', data: daten } })
    }
    inhalt.push({ type: 'text', text: PROMPT })
  } else if (art === 'text' && text) {
    inhalt.push({ type: 'text', text: PROMPT + '\n\nBESTELLUNG (Zeilen als Text, Spalten mit | getrennt):\n' + text })
  } else {
    return res.status(400).json({ fehler: 'Keine Daten übergeben' })
  }

  let antwort
  try {
    antwort = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
        max_tokens: 12000,
        messages: [{ role: 'user', content: inhalt }],
      }),
    })
  } catch (e) {
    return res.status(502).json({ fehler: 'KI nicht erreichbar: ' + (e && e.message ? e.message : String(e)) })
  }
  if (!antwort.ok) {
    const t = await antwort.text()
    return res.status(502).json({ fehler: `Claude API Fehler ${antwort.status}: ${t.slice(0, 300)}` })
  }

  const ergebnis = await antwort.json()
  const rohText = (ergebnis.content || []).map((b) => b.text || '').join('')
  const von = rohText.indexOf('{')
  const bis = rohText.lastIndexOf('}')
  let json
  try {
    json = JSON.parse(rohText.slice(von, bis + 1))
  } catch {
    return res.status(502).json({ fehler: 'Die KI-Antwort konnte nicht gelesen werden. Bitte nochmal versuchen.' })
  }

  const zeitOk = (z) => typeof z === 'string' && /^\d{1,2}:\d{2}$/.test(z)
  const datumOk = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)
  const fuehrend = (z) => (z.length === 4 ? '0' + z : z)

  const fahrten = []
  const uebersprungen = Array.isArray(json.uebersprungen) ? json.uebersprungen.map((u) => ({ zeile: String(u.zeile || ''), grund: String(u.grund || '') })) : []
  for (const f of Array.isArray(json.fahrten) ? json.fahrten : []) {
    if (!datumOk(f.datum) || !zeitOk(f.von_zeit) || !zeitOk(f.nach_zeit)) {
      uebersprungen.push({ zeile: `${f.referenz || '?'} ${f.datum || ''}`, grund: 'Datum oder Zeit nicht lesbar' })
      continue
    }
    fahrten.push({
      referenz: String(f.referenz || 'Fahrt'),
      referenznummer: f.referenznummer ? String(f.referenznummer) : null,
      datum: f.datum,
      von: String(f.von || ''),
      von_zeit: fuehrend(f.von_zeit),
      nach: String(f.nach || ''),
      nach_zeit: fuehrend(f.nach_zeit),
      lok: f.lok ? String(f.lok) : null,
      tf_hinweis: f.tf_hinweis && String(f.tf_hinweis).trim() !== '-' ? String(f.tf_hinweis) : null,
    })
  }

  return res.status(200).json({ fahrten, uebersprungen })
}
