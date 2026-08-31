import { useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from './lib/supabase'

interface AusgelesenerAntrag {
  ua_nummer: number | null
  jahr: number | null
  name: string | null
  personalnummer: string | null
  kategorie: string | null
  urlaubsanspruch: number | null
  verplant: number | null
  rest: number | null
  resturlaub_vorjahr: number | null
  erster_tag: string | null
  letzter_tag: string | null
  anzahl_tage: number | null
  ort_antragsteller: string | null
  datum_antragsteller: string | null
}

function dateiZuBase64(datei: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const ergebnis = reader.result as string
      resolve(ergebnis.split(',')[1])
    }
    reader.onerror = reject
    reader.readAsDataURL(datei)
  })
}

function datumZuText(wert: unknown): string | null {
  if (!wert) return null
  if (wert instanceof Date) {
    const jahr = wert.getFullYear()
    const monat = String(wert.getMonth() + 1).padStart(2, '0')
    const tag = String(wert.getDate()).padStart(2, '0')
    return `${jahr}-${monat}-${tag}`
  }
  if (typeof wert === 'string') return wert
  return null
}

async function excelAuswerten(datei: File): Promise<AusgelesenerAntrag> {
  const puffer = await datei.arrayBuffer()
  const arbeitsmappe = XLSX.read(puffer, { type: 'array', cellDates: true })
  const blatt = arbeitsmappe.Sheets[arbeitsmappe.SheetNames[0]]

  function zelle(referenz: string) {
    return blatt[referenz]?.v ?? null
  }

  const kategorieFelder: [string, string][] = [
    ['A10', 'A9'],
    ['C10', 'C9'],
    ['E10', 'E9'],
    ['G10', 'G9'],
    ['I10', 'I9'],
  ]
  const ausgewaehlteKategorien = kategorieFelder
    .filter(([markierung]) => {
      const wert = zelle(markierung)
      return typeof wert === 'string' && wert.trim().toUpperCase() === 'X'
    })
    .map(([, label]) => zelle(label))
    .filter(Boolean)

  return {
    ua_nummer: (zelle('D5') as number) ?? null,
    jahr: (zelle('F5') as number) ?? null,
    name: (zelle('C12') as string) ?? null,
    personalnummer: zelle('C14') !== null ? String(zelle('C14')) : null,
    kategorie: ausgewaehlteKategorien.length > 0 ? ausgewaehlteKategorien.join(', ') : null,
    urlaubsanspruch: (zelle('C16') as number) ?? null,
    verplant: (zelle('F16') as number) ?? null,
    rest: (zelle('I16') as number) ?? null,
    resturlaub_vorjahr: (zelle('C18') as number) ?? null,
    erster_tag: datumZuText(zelle('C23')),
    letzter_tag: datumZuText(zelle('E23')),
    anzahl_tage: (zelle('G23') as number) ?? null,
    ort_antragsteller: (zelle('A36') as string) ?? null,
    datum_antragsteller: datumZuText(zelle('C36')),
  }
}

const eingabeStil: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  border: '1px solid var(--border)',
  borderRadius: 6,
  fontSize: 14,
  marginTop: 4,
}

const beschriftungStil: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
  color: 'var(--text-muted)',
}

export default function UrlaubAntragUpload({ onGespeichert }: { onGespeichert: () => void }) {
  const [ladeVorgang, setLadeVorgang] = useState(false)
  const [fehler, setFehler] = useState<string | null>(null)
  const [ausgelesenerAntrag, setAusgelesenerAntrag] = useState<AusgelesenerAntrag | null>(null)
  const [hochgeladeneDatei, setHochgeladeneDatei] = useState<File | null>(null)

  async function handleDateiAuswahl(event: React.ChangeEvent<HTMLInputElement>) {
    const datei = event.target.files?.[0]
    if (!datei) return

    setHochgeladeneDatei(datei)
    setFehler(null)
    setLadeVorgang(true)
    setAusgelesenerAntrag(null)

    const istExcel =
      datei.name.toLowerCase().endsWith('.xlsx') ||
      datei.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

    try {
      if (istExcel) {
        const ergebnis = await excelAuswerten(datei)
        setAusgelesenerAntrag(ergebnis)
      } else {
        const base64 = await dateiZuBase64(datei)

        const response = await fetch('/api/urlaubsantrag-auswerten', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ bildBase64: base64, mediaType: datei.type }),
        })

        const data = await response.json()
        if (!response.ok) throw new Error(data.error || 'Unbekannter Fehler')

        setAusgelesenerAntrag(data)
      }
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Fehler beim Auslesen')
    } finally {
      setLadeVorgang(false)
    }
  }

  function feldAendern(feld: keyof AusgelesenerAntrag, wert: string) {
    if (!ausgelesenerAntrag) return
    setAusgelesenerAntrag({ ...ausgelesenerAntrag, [feld]: wert })
  }

  async function antragSpeichern() {
    if (!ausgelesenerAntrag || !hochgeladeneDatei) return

    setLadeVorgang(true)
    setFehler(null)

    try {
      const dateiPfad = `${Date.now()}-${hochgeladeneDatei.name}`
      const { error: uploadFehler } = await supabase.storage
        .from('urlaubsantraege-dokumente')
        .upload(dateiPfad, hochgeladeneDatei)
      if (uploadFehler) throw new Error('Upload: ' + uploadFehler.message)

      const { error: einfuegenFehler } = await supabase
        .from('urlaubsantraege')
        .insert({ ...ausgelesenerAntrag, status: 'offen', dokument_url: dateiPfad })
      if (einfuegenFehler) throw new Error('Speichern: ' + einfuegenFehler.message)

      setAusgelesenerAntrag(null)
      setHochgeladeneDatei(null)
      onGespeichert()
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Fehler beim Speichern')
    } finally {
      setLadeVorgang(false)
    }
  }

  return (
    <div>
      <h2 style={{ marginTop: 0, fontSize: 18 }}>Urlaubsantrag einreichen</h2>
      <p style={{ color: 'var(--text-muted)', fontSize: 14, marginTop: -8 }}>
        Foto, Scan oder ausgefülltes Excel-Formular hochladen.
      </p>

      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '2px dashed var(--border)',
          borderRadius: 8,
          padding: 24,
          cursor: 'pointer',
          color: 'var(--text-muted)',
          fontSize: 14,
        }}
      >
        {hochgeladeneDatei ? hochgeladeneDatei.name : 'Datei auswählen'}
        <input
          type="file"
          accept="image/*,.pdf,.xlsx"
          onChange={handleDateiAuswahl}
          disabled={ladeVorgang}
          style={{ display: 'none' }}
        />
      </label>

      {ladeVorgang && <p style={{ color: 'var(--navy)' }}>Wird verarbeitet...</p>}
      {fehler && <p style={{ color: 'var(--danger)' }}>Fehler: {fehler}</p>}

      {ausgelesenerAntrag && (
        <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={beschriftungStil}>
            Name
            <input
              style={eingabeStil}
              value={ausgelesenerAntrag.name ?? ''}
              onChange={(e) => feldAendern('name', e.target.value)}
            />
          </label>

          <label style={beschriftungStil}>
            Personalnummer
            <input
              style={eingabeStil}
              value={ausgelesenerAntrag.personalnummer ?? ''}
              onChange={(e) => feldAendern('personalnummer', e.target.value)}
            />
          </label>

          <div style={{ display: 'flex', gap: 12 }}>
            <label style={{ ...beschriftungStil, flex: 1 }}>
              Erster Urlaubstag
              <input
                type="date"
                style={eingabeStil}
                value={ausgelesenerAntrag.erster_tag ?? ''}
                onChange={(e) => feldAendern('erster_tag', e.target.value)}
              />
            </label>

            <label style={{ ...beschriftungStil, flex: 1 }}>
              Letzter Urlaubstag
              <input
                type="date"
                style={eingabeStil}
                value={ausgelesenerAntrag.letzter_tag ?? ''}
                onChange={(e) => feldAendern('letzter_tag', e.target.value)}
              />
            </label>
          </div>

          <label style={beschriftungStil}>
            Anzahl Urlaubstage
            <input
              style={eingabeStil}
              value={ausgelesenerAntrag.anzahl_tage ?? ''}
              onChange={(e) => feldAendern('anzahl_tage', e.target.value)}
            />
          </label>

          <button
            onClick={antragSpeichern}
            disabled={ladeVorgang}
            style={{
              background: 'var(--navy)',
              color: '#ffffff',
              border: 'none',
              borderRadius: 6,
              padding: '10px 16px',
              fontSize: 14,
              fontWeight: 500,
              cursor: 'pointer',
              marginTop: 8,
            }}
          >
            Antrag einreichen
          </button>
        </div>
      )}
    </div>
  )
}
