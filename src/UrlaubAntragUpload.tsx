import { useEffect, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from './lib/supabase'
import { berechneBrauchbareTage } from './urlaubsberechnung'
import { namensSignatur } from './namensAbgleich'
import { useAktuellerMitarbeiter } from './useAktuellerMitarbeiter'

interface GemeinsameFelder {
  jahr: number | null
  name: string | null
  kategorie: string | null
  urlaubsanspruch: number | null
  verplant: number | null
  rest: number | null
  resturlaub_vorjahr: number | null
  ort_antragsteller: string | null
  datum_antragsteller: string | null
  bearbeitet_von: string | null
  ort_bearbeiter: string | null
  datum_bearbeiter: string | null
}

interface Zeitraum {
  erster_tag: string | null
  letzter_tag: string | null
  anzahl_tage: number | null
}

interface AusgelesenerAntrag {
  gemeinsam: GemeinsameFelder
  zeitraeume: Zeitraum[]
}

const LEERE_GEMEINSAME_FELDER: GemeinsameFelder = {
  jahr: null,
  name: null,
  kategorie: null,
  urlaubsanspruch: null,
  verplant: null,
  rest: null,
  resturlaub_vorjahr: null,
  ort_antragsteller: null,
  datum_antragsteller: null,
  bearbeitet_von: null,
  ort_bearbeiter: null,
  datum_bearbeiter: null,
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

  const gemeinsam: GemeinsameFelder = {
    jahr: (zelle('B5') as number) ?? null,
    kategorie: (zelle('B7') as string) ?? null,
    name: (zelle('B9') as string) ?? null,
    urlaubsanspruch: (zelle('C12') as number) ?? null,
    verplant: (zelle('F12') as number) ?? null,
    rest: (zelle('C13') as number) ?? null,
    resturlaub_vorjahr: (zelle('F13') as number) ?? null,
    ort_antragsteller: (zelle('B26') as string) ?? null,
    datum_antragsteller: datumZuText(zelle('E26')),
    bearbeitet_von: (zelle('B29') as string) ?? null,
    ort_bearbeiter: (zelle('B30') as string) ?? null,
    datum_bearbeiter: datumZuText(zelle('E30')),
  }

  const zeitraeume: Zeitraum[] = []
  for (let zeile = 17; zeile <= 22; zeile++) {
    const von = datumZuText(zelle(`B${zeile}`))
    const bis = datumZuText(zelle(`C${zeile}`))
    const tage = zelle(`D${zeile}`) as number | null
    if (von && bis) {
      zeitraeume.push({ erster_tag: von, letzter_tag: bis, anzahl_tage: tage })
    }
  }

  return { gemeinsam, zeitraeume }
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

type Modus = 'auswahl' | 'upload' | 'manuell'

export default function UrlaubAntragUpload({ onGespeichert }: { onGespeichert: () => void }) {
  const { mitarbeiter: eigenerMitarbeiter, istAdmin } = useAktuellerMitarbeiter()
  const [modus, setModus] = useState<Modus>('auswahl')
  const [ladeVorgang, setLadeVorgang] = useState(false)
  const [fehler, setFehler] = useState<string | null>(null)
  const [ausgelesenerAntrag, setAusgelesenerAntrag] = useState<AusgelesenerAntrag | null>(null)
  const [hochgeladeneDatei, setHochgeladeneDatei] = useState<File | null>(null)

  const [brauchbareTageProZeitraum, setBrauchbareTageProZeitraum] = useState<(number | null)[]>([])
  const [verfuegbarerResturlaub, setVerfuegbarerResturlaub] = useState<number | null>(null)
  const [mitarbeiterGefunden, setMitarbeiterGefunden] = useState(false)

  useEffect(() => {
    if (!ausgelesenerAntrag) {
      setBrauchbareTageProZeitraum([])
      setVerfuegbarerResturlaub(null)
      setMitarbeiterGefunden(false)
      return
    }

    const berechnet = ausgelesenerAntrag.zeitraeume.map((z) =>
      berechneBrauchbareTage(z.erster_tag, z.letzter_tag)
    )
    setBrauchbareTageProZeitraum(berechnet)

    async function pruefeMitarbeiter() {
      const name = ausgelesenerAntrag?.gemeinsam.name
      const ersterZeitraumMitDatum = ausgelesenerAntrag?.zeitraeume.find((z) => z.erster_tag)

      if (!name || !ersterZeitraumMitDatum?.erster_tag) {
        setVerfuegbarerResturlaub(null)
        setMitarbeiterGefunden(false)
        return
      }

      const jahr = new Date(ersterZeitraumMitDatum.erster_tag).getFullYear()

      const { data: alleMitarbeiter } = await supabase.from('mitarbeiter').select('id, name')
      const signatur = namensSignatur(name)
      const mitarbeiter = (alleMitarbeiter ?? []).find((m) => namensSignatur(m.name) === signatur)

      if (!mitarbeiter) {
        setVerfuegbarerResturlaub(null)
        setMitarbeiterGefunden(false)
        return
      }
      setMitarbeiterGefunden(true)

      const { data: jahresdaten } = await supabase
        .from('mitarbeiter_jahresdaten')
        .select('resturlaub, resturlaub_vorjahr')
        .eq('mitarbeiter_id', mitarbeiter.id)
        .eq('jahr', jahr)
        .maybeSingle()

      const resturlaub = jahresdaten?.resturlaub ?? 30
      const resturlaubVorjahr = jahresdaten?.resturlaub_vorjahr ?? 0
      setVerfuegbarerResturlaub(resturlaub + resturlaubVorjahr)
    }

    pruefeMitarbeiter()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ausgelesenerAntrag])

  function manuellStarten() {
    setModus('manuell')
    setFehler(null)
    setHochgeladeneDatei(null)
    setAusgelesenerAntrag({
      gemeinsam: {
        ...LEERE_GEMEINSAME_FELDER,
        name: istAdmin ? null : eigenerMitarbeiter?.name ?? null,
      },
      zeitraeume: [{ erster_tag: null, letzter_tag: null, anzahl_tage: null }],
    })
  }

  function uploadStarten() {
    setModus('upload')
    setFehler(null)
    setAusgelesenerAntrag(null)
    setHochgeladeneDatei(null)
  }

  function abbrechen() {
    setModus('auswahl')
    setFehler(null)
    setAusgelesenerAntrag(null)
    setHochgeladeneDatei(null)
  }

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
        if (!istAdmin && eigenerMitarbeiter) {
          ergebnis.gemeinsam.name = eigenerMitarbeiter.name
        }
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

        if (!istAdmin && eigenerMitarbeiter) {
          data.gemeinsam.name = eigenerMitarbeiter.name
        }
        setAusgelesenerAntrag(data)
      }
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Fehler beim Auslesen')
    } finally {
      setLadeVorgang(false)
    }
  }

  function gemeinsamesFeldAendern(feld: keyof GemeinsameFelder, wert: string) {
    if (!ausgelesenerAntrag) return
    setAusgelesenerAntrag({
      ...ausgelesenerAntrag,
      gemeinsam: { ...ausgelesenerAntrag.gemeinsam, [feld]: wert },
    })
  }

  function zeitraumFeldAendern(index: number, feld: keyof Zeitraum, wert: string) {
    if (!ausgelesenerAntrag) return
    const neueZeitraeume = ausgelesenerAntrag.zeitraeume.map((z, i) =>
      i === index ? { ...z, [feld]: wert } : z
    )
    setAusgelesenerAntrag({ ...ausgelesenerAntrag, zeitraeume: neueZeitraeume })
  }

  function zeitraumHinzufuegen() {
    if (!ausgelesenerAntrag) return
    setAusgelesenerAntrag({
      ...ausgelesenerAntrag,
      zeitraeume: [
        ...ausgelesenerAntrag.zeitraeume,
        { erster_tag: null, letzter_tag: null, anzahl_tage: null },
      ],
    })
  }

  function zeitraumEntfernen(index: number) {
    if (!ausgelesenerAntrag) return
    setAusgelesenerAntrag({
      ...ausgelesenerAntrag,
      zeitraeume: ausgelesenerAntrag.zeitraeume.filter((_, i) => i !== index),
    })
  }

  const gesamtBrauchbareTage = brauchbareTageProZeitraum.reduce<number>(
    (summe, tage) => summe + (tage ?? 0),
    0
  )

  async function antragSpeichern() {
    if (!ausgelesenerAntrag) return
    if (modus === 'upload' && !hochgeladeneDatei) return

    const gueltigeZeitraeume = ausgelesenerAntrag.zeitraeume.filter(
      (z) => z.erster_tag && z.letzter_tag
    )
    if (gueltigeZeitraeume.length === 0) {
      setFehler('Bitte mindestens einen vollständigen Urlaubszeitraum angeben.')
      return
    }
    if (!ausgelesenerAntrag.gemeinsam.name) {
      setFehler('Bitte einen Namen angeben.')
      return
    }

    setLadeVorgang(true)
    setFehler(null)

    try {
      let dateiPfad: string | null = null

      if (modus === 'upload' && hochgeladeneDatei) {
        dateiPfad = `${Date.now()}-${hochgeladeneDatei.name}`
        const { error: uploadFehler } = await supabase.storage
          .from('urlaubsantraege-dokumente')
          .upload(dateiPfad, hochgeladeneDatei)
        if (uploadFehler) throw new Error('Upload: ' + uploadFehler.message)
      }

      let mitarbeiterId: string | null = eigenerMitarbeiter?.id ?? null
      if (istAdmin) {
        const name = ausgelesenerAntrag.gemeinsam.name
        if (name) {
          const { data: alleMitarbeiter } = await supabase.from('mitarbeiter').select('id, name')
          const signatur = namensSignatur(name)
          const treffer = (alleMitarbeiter ?? []).find((m) => namensSignatur(m.name) === signatur)
          mitarbeiterId = treffer?.id ?? null
        }
      }

      const gruppeId = crypto.randomUUID()

      const zeilen = gueltigeZeitraeume.map((z) => ({
        ...ausgelesenerAntrag.gemeinsam,
        mitarbeiter_id: mitarbeiterId,
        erster_tag: z.erster_tag,
        letzter_tag: z.letzter_tag,
        anzahl_tage: z.anzahl_tage,
        brauchbare_tage: berechneBrauchbareTage(z.erster_tag, z.letzter_tag),
        status: 'offen',
        dokument_url: dateiPfad,
        gruppe_id: gruppeId,
      }))

      const { error: einfuegenFehler } = await supabase.from('urlaubsantraege').insert(zeilen)
      if (einfuegenFehler) throw new Error('Speichern: ' + einfuegenFehler.message)

      setModus('auswahl')
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

      {modus === 'auswahl' && (
        <div>
          <p style={{ color: 'var(--text-muted)', fontSize: 14, marginTop: -8 }}>
            Wähle, wie der Antrag erfasst werden soll.
          </p>
          <div style={{ display: 'flex', gap: 12 }}>
            <button onClick={uploadStarten} style={auswahlKnopfStil}>
              📄 Foto, Scan oder Excel hochladen
            </button>
            <button onClick={manuellStarten} style={auswahlKnopfStil}>
              ✏️ Manuell eingeben
            </button>
          </div>
        </div>
      )}

      {modus === 'upload' && (
        <div>
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

          {!ausgelesenerAntrag && (
            <button onClick={abbrechen} style={{ ...zurueckKnopfStil, marginTop: 12 }}>
              ← Zurück
            </button>
          )}
        </div>
      )}

      {ladeVorgang && <p style={{ color: 'var(--navy)' }}>Wird verarbeitet...</p>}
      {fehler && <p style={{ color: 'var(--danger)' }}>Fehler: {fehler}</p>}

      {ausgelesenerAntrag && (modus === 'upload' || modus === 'manuell') && (
        <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={beschriftungStil}>
            Name
            <input
              style={{ ...eingabeStil, background: istAdmin ? undefined : '#f1f5f9' }}
              value={ausgelesenerAntrag.gemeinsam.name ?? ''}
              onChange={(e) => gemeinsamesFeldAendern('name', e.target.value)}
              placeholder="Vor- und Nachname"
              readOnly={!istAdmin}
            />
          </label>

          <div>
            <div style={{ ...beschriftungStil, marginBottom: 6 }}>Urlaubszeiträume</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {ausgelesenerAntrag.zeitraeume.map((zeitraum, index) => (
                <div
                  key={index}
                  style={{
                    display: 'flex',
                    gap: 8,
                    alignItems: 'flex-end',
                    background: '#f8fafc',
                    padding: 8,
                    borderRadius: 6,
                  }}
                >
                  <label style={{ ...beschriftungStil, flex: 1 }}>
                    Von
                    <input
                      type="date"
                      style={eingabeStil}
                      value={zeitraum.erster_tag ?? ''}
                      onChange={(e) => zeitraumFeldAendern(index, 'erster_tag', e.target.value)}
                    />
                  </label>
                  <label style={{ ...beschriftungStil, flex: 1 }}>
                    Bis
                    <input
                      type="date"
                      style={eingabeStil}
                      value={zeitraum.letzter_tag ?? ''}
                      onChange={(e) => zeitraumFeldAendern(index, 'letzter_tag', e.target.value)}
                    />
                  </label>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', minWidth: 90, paddingBottom: 8 }}>
                    {brauchbareTageProZeitraum[index] ?? '–'} Arbeitstage
                  </div>
                  {ausgelesenerAntrag.zeitraeume.length > 1 && (
                    <button
                      onClick={() => zeitraumEntfernen(index)}
                      title="Zeitraum entfernen"
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--danger)',
                        cursor: 'pointer',
                        fontSize: 16,
                        paddingBottom: 8,
                      }}
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
            {ausgelesenerAntrag.zeitraeume.length < 6 && (
              <button
                onClick={zeitraumHinzufuegen}
                style={{
                  marginTop: 8,
                  background: 'none',
                  border: '1px dashed var(--border)',
                  borderRadius: 6,
                  padding: '6px 12px',
                  fontSize: 13,
                  color: 'var(--navy)',
                  cursor: 'pointer',
                }}
              >
                + Zeitraum hinzufügen
              </button>
            )}
          </div>

          <div
            style={{
              background: '#f1f5f9',
              borderRadius: 6,
              padding: 10,
              fontSize: 13,
            }}
          >
            <div>
              Gesamt berechnete Arbeitstage (ohne Wochenende/bayerische Feiertage):{' '}
              <strong>{gesamtBrauchbareTage}</strong>
            </div>

            {mitarbeiterGefunden && verfuegbarerResturlaub !== null && (
              <div style={{ marginTop: 4 }}>
                Verfügbarer Resturlaub: <strong>{verfuegbarerResturlaub}</strong> Tage
                {gesamtBrauchbareTage > verfuegbarerResturlaub && (
                  <div style={{ color: 'var(--danger)', marginTop: 4 }}>
                    Achtung: Antrag übersteigt den verfügbaren Resturlaub!
                  </div>
                )}
              </div>
            )}

            {!mitarbeiterGefunden && (
              <div style={{ color: 'var(--text-muted)', marginTop: 4 }}>
                Mitarbeiter nicht in der Liste gefunden - kein Abgleich möglich.
              </div>
            )}
          </div>

          {(ausgelesenerAntrag.gemeinsam.bearbeitet_von ||
            ausgelesenerAntrag.gemeinsam.ort_bearbeiter ||
            ausgelesenerAntrag.gemeinsam.datum_bearbeiter) && (
            <div
              style={{
                background: '#f8fafc',
                border: '1px solid var(--border)',
                borderRadius: 6,
                padding: 10,
                fontSize: 13,
                color: 'var(--text-muted)',
              }}
            >
              <div style={{ fontWeight: 500, marginBottom: 4, color: 'var(--text)' }}>
                Im Formular bereits ausgefüllte Bearbeitung
              </div>
              {ausgelesenerAntrag.gemeinsam.bearbeitet_von && (
                <div>Bearbeitet von: {ausgelesenerAntrag.gemeinsam.bearbeitet_von}</div>
              )}
              {ausgelesenerAntrag.gemeinsam.ort_bearbeiter && (
                <div>Ort: {ausgelesenerAntrag.gemeinsam.ort_bearbeiter}</div>
              )}
              {ausgelesenerAntrag.gemeinsam.datum_bearbeiter && (
                <div>Datum: {ausgelesenerAntrag.gemeinsam.datum_bearbeiter}</div>
              )}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
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
            <button onClick={abbrechen} style={{ ...zurueckKnopfStil, marginTop: 8 }}>
              Abbrechen
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

const auswahlKnopfStil: React.CSSProperties = {
  flex: 1,
  padding: '20px 16px',
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: '#f8fafc',
  fontSize: 14,
  fontWeight: 500,
  color: 'var(--navy)',
  cursor: 'pointer',
  textAlign: 'center',
}

const zurueckKnopfStil: React.CSSProperties = {
  background: 'none',
  border: '1px solid var(--border)',
  color: 'var(--text-muted)',
  borderRadius: 6,
  padding: '10px 16px',
  fontSize: 14,
  cursor: 'pointer',
}
