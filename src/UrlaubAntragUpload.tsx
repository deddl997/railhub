import { useEffect, useRef, useState } from 'react'
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

function wortTeile(n: string): string[] {
  return n
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .split(/[\s\-,]+/)
    .filter((w) => w.length > 1)
}

function aehnlichkeit(a: string, b: string): number {
  const wa = wortTeile(a)
  const wb = wortTeile(b)
  if (wa.length === 0 || wb.length === 0) return 0
  let punkte = 0
  for (const x of wa) {
    let best = 0
    for (const y of wb) {
      if (x === y) best = Math.max(best, 1)
      else if (x.length >= 4 && y.length >= 4 && (x.startsWith(y) || y.startsWith(x))) best = Math.max(best, 0.8)
      else if (x.length >= 4 && y.length >= 4 && Math.abs(x.length - y.length) <= 2) {
        // einfache Tippfehler-Toleranz (Levenshtein <= 2)
        const d: number[][] = Array.from({ length: x.length + 1 }, (_, i) => [i, ...Array(y.length).fill(0)])
        for (let j = 1; j <= y.length; j++) d[0][j] = j
        for (let i = 1; i <= x.length; i++)
          for (let j = 1; j <= y.length; j++)
            d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1))
        if (d[x.length][y.length] <= 2) best = Math.max(best, 0.7)
      }
    }
    punkte += best
  }
  return punkte / Math.max(wa.length, wb.length)
}

export default function UrlaubAntragUpload({ onGespeichert }: { onGespeichert: () => void }) {
  const { mitarbeiter: eigenerMitarbeiter, istAdmin } = useAktuellerMitarbeiter()
  const [modus, setModus] = useState<Modus>('auswahl')
  const [ladeVorgang, setLadeVorgang] = useState(false)
  const [fehler, setFehler] = useState<string | null>(null)
  const [ausgelesenerAntrag, setAusgelesenerAntrag] = useState<AusgelesenerAntrag | null>(null)
  const [hochgeladeneDatei, setHochgeladeneDatei] = useState<File | null>(null)
  const [bilder, setBilder] = useState<File[]>([])
  const [alleMitarbeiterNamen, setAlleMitarbeiterNamen] = useState<{ id: string; name: string }[]>([])

  useEffect(() => {
    if (!istAdmin) return
    supabase
      .from('mitarbeiter')
      .select('id, name')
      .then(({ data }) => setAlleMitarbeiterNamen((data ?? []) as { id: string; name: string }[]))
  }, [istAdmin])

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
    setBilder([])
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
    setBilder([])
  }

  function abbrechen() {
    setModus('auswahl')
    setFehler(null)
    setAusgelesenerAntrag(null)
    setHochgeladeneDatei(null)
    setBilder([])
  }

  function handleDateiAuswahl(event: React.ChangeEvent<HTMLInputElement>) {
    const dateien = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (dateien.length > 0) dateienVerarbeiten(dateien)
  }

  // Screenshot per Strg+V einfügen oder Dateien per Drag & Drop ablegen.
  // Weitere Bilder werden zu den schon vorhandenen Seiten hinzugefügt.
  const verarbeiteRef = useRef<(dateien: File[], hinzufuegen: boolean) => void>(() => {})
  useEffect(() => {
    verarbeiteRef.current = (dateien, hinzufuegen) => dateienVerarbeiten(dateien, hinzufuegen)
  })
  useEffect(() => {
    if (modus !== 'upload') return
    function beimEinfuegen(e: ClipboardEvent) {
      const dateien = Array.from(e.clipboardData?.files ?? []).filter((d) => d.type.startsWith('image/') || d.type === 'application/pdf')
      if (dateien.length === 0) return
      e.preventDefault()
      const benannt = dateien.map((bild, i) => {
        const endung = bild.type === 'application/pdf' ? 'pdf' : (bild.type.split('/')[1] || 'png').replace('jpeg', 'jpg')
        const zeit = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
        return new File([bild], `Screenshot-${zeit}-${i + 1}.${endung}`, { type: bild.type })
      })
      verarbeiteRef.current(benannt, true)
    }
    document.addEventListener('paste', beimEinfuegen)
    return () => document.removeEventListener('paste', beimEinfuegen)
  }, [modus])

  function beimAblegen(e: React.DragEvent<HTMLLabelElement>) {
    e.preventDefault()
    if (ladeVorgang) return
    const dateien = Array.from(e.dataTransfer.files ?? [])
    if (dateien.length > 0) dateienVerarbeiten(dateien, true)
  }

  function bildEntfernen(index: number) {
    const rest = bilder.filter((_, i) => i !== index)
    if (rest.length === 0) {
      setBilder([])
      setHochgeladeneDatei(null)
      setBilder([])
    setBilder([])
      setAusgelesenerAntrag(null)
      setFehler(null)
    } else {
      dateienVerarbeiten(rest, false)
    }
  }

  function istExcelDatei(datei: File) {
    return (
      datei.name.toLowerCase().endsWith('.xlsx') ||
      datei.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )
  }

  // Mehrere Bilder (z. B. Vorder- und Rückseite) untereinander zu einem Bild für die Ablage zusammensetzen
  async function bilderZusammenfuegen(dateien: File[]): Promise<File> {
    const geladen = await Promise.all(dateien.map((d) => createImageBitmap(d)))
    const breite = Math.min(1600, Math.max(...geladen.map((g) => g.width)))
    const hoehen = geladen.map((g) => Math.round((g.height * breite) / g.width))
    const leinwand = document.createElement('canvas')
    leinwand.width = breite
    leinwand.height = hoehen.reduce((a, h) => a + h, 0)
    const ctx = leinwand.getContext('2d')
    if (!ctx) throw new Error('Bilder konnten nicht zusammengefügt werden')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, leinwand.width, leinwand.height)
    let y = 0
    geladen.forEach((g, i) => {
      ctx.drawImage(g, 0, y, breite, hoehen[i])
      y += hoehen[i]
    })
    const blob: Blob = await new Promise((ok, nein) => leinwand.toBlob((b) => (b ? ok(b) : nein(new Error('Bild konnte nicht erstellt werden'))), 'image/jpeg', 0.88))
    return new File([blob], `Antrag-${Date.now()}.jpg`, { type: 'image/jpeg' })
  }

  async function einzelnAuslesen(datei: File): Promise<AusgelesenerAntrag> {
    if (istExcelDatei(datei)) return excelAuswerten(datei)
    const base64 = await dateiZuBase64(datei)
    const response = await fetch('/api/urlaubsantrag-auswerten', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bildBase64: base64, mediaType: datei.type }),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Unbekannter Fehler')
    return data as AusgelesenerAntrag
  }

  async function dateienVerarbeiten(neu: File[], hinzufuegen = false) {
    // Excel-Dateien werden nicht mit Bildern gemischt: dann zählt die zuletzt gewählte Datei
    let liste = hinzufuegen && !neu.some(istExcelDatei) ? [...bilder.filter((d) => !istExcelDatei(d)), ...neu] : neu
    if (liste.some(istExcelDatei)) liste = [liste.filter(istExcelDatei).slice(-1)[0]]
    if (liste.length === 0) return

    setBilder(liste)
    setFehler(null)
    setLadeVorgang(true)
    setAusgelesenerAntrag(null)

    try {
      const ergebnisse: AusgelesenerAntrag[] = []
      for (const datei of liste) ergebnisse.push(await einzelnAuslesen(datei))

      // Zusammenführen: erster vorhandener Wert je Feld, alle Zeiträume ohne Doppelte
      const gemeinsam = { ...LEERE_GEMEINSAME_FELDER }
      const zeitraeume: Zeitraum[] = []
      for (const erg of ergebnisse) {
        for (const schluessel of Object.keys(gemeinsam) as (keyof GemeinsameFelder)[]) {
          if (gemeinsam[schluessel] === null || gemeinsam[schluessel] === undefined) {
            ;(gemeinsam as Record<string, unknown>)[schluessel] = erg.gemeinsam?.[schluessel] ?? null
          }
        }
        for (const z of erg.zeitraeume ?? []) {
          if (!zeitraeume.some((v) => v.erster_tag === z.erster_tag && v.letzter_tag === z.letzter_tag)) zeitraeume.push(z)
        }
      }
      if (!istAdmin && eigenerMitarbeiter) gemeinsam.name = eigenerMitarbeiter.name

      // Für die Ablage: ein Bild bleibt ein Bild, mehrere Bilder werden zu einem zusammengefügt
      const alleBilder = liste.every((d) => d.type.startsWith('image/'))
      setHochgeladeneDatei(liste.length > 1 && alleBilder ? await bilderZusammenfuegen(liste) : liste[0])
      setAusgelesenerAntrag({ gemeinsam, zeitraeume })
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Fehler beim Auslesen')
      setHochgeladeneDatei(liste[0])
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
      let kanonischerName: string | null = null
      if (istAdmin) {
        const name = ausgelesenerAntrag.gemeinsam.name
        if (name) {
          const { data: alleMitarbeiter } = await supabase.from('mitarbeiter').select('id, name')
          const signatur = namensSignatur(name)
          const treffer = (alleMitarbeiter ?? []).find((m) => namensSignatur(m.name) === signatur)
          mitarbeiterId = treffer?.id ?? null
          if (treffer) kanonischerName = treffer.name
        }
      }

      const gruppeId = crypto.randomUUID()

      const zeilen = gueltigeZeitraeume.map((z) => ({
        ...ausgelesenerAntrag.gemeinsam,
        ...(kanonischerName ? { name: kanonischerName } : {}),
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
      setBilder([])
    setBilder([])
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
            onDragOver={(e) => e.preventDefault()}
            onDrop={beimAblegen}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              textAlign: 'center',
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
            <span>{bilder.length > 0 ? 'Weitere Seite hinzufügen: Datei wählen, hierher ziehen oder Strg + V' : 'Datei(en) auswählen oder hierher ziehen'}</span>
            <span style={{ fontSize: 12 }}>📋 Screenshot in der Zwischenablage? Einfach <b>Strg + V</b> drücken – mehrere Bilder (z. B. 2 Seiten) sind möglich</span>
            <input
              type="file"
              accept="image/*,.pdf,.xlsx"
              multiple
              onChange={handleDateiAuswahl}
              disabled={ladeVorgang}
              style={{ display: 'none' }}
            />
          </label>

          {bilder.length > 0 && (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {bilder.map((b, i) => (
                <div key={b.name + i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, background: '#f3f5f8', borderRadius: 6, padding: '5px 10px' }}>
                  <span style={{ fontWeight: 600 }}>Seite {i + 1}</span>
                  <span style={{ color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{b.name}</span>
                  <button onClick={() => bildEntfernen(i)} disabled={ladeVorgang} title="Entfernen" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--danger)', fontSize: 15 }}>
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

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
          {istAdmin && (() => {
            const eingabe = (ausgelesenerAntrag.gemeinsam.name ?? '').trim()
            if (!eingabe || alleMitarbeiterNamen.length === 0) return null
            const sig = namensSignatur(eingabe)
            if (alleMitarbeiterNamen.some((m) => namensSignatur(m.name) === sig)) {
              return <div style={{ fontSize: 12, color: 'var(--success)', marginTop: -6 }}>✓ Mitarbeiter gefunden</div>
            }
            const vorschlaege = alleMitarbeiterNamen
              .map((m) => ({ m, w: aehnlichkeit(eingabe, m.name) }))
              .filter((x) => x.w >= 0.5)
              .sort((a, b) => b.w - a.w)
              .slice(0, 3)
            return (
              <div style={{ fontSize: 13, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, padding: '8px 10px', marginTop: -6 }}>
                <div style={{ color: '#92400e', fontWeight: 500 }}>
                  ⚠ „{eingabe}“ passt zu keinem Mitarbeiter – der Antrag bliebe ohne Zuordnung.
                </div>
                {vorschlaege.length > 0 && (
                  <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                    <span>Meintest du:</span>
                    {vorschlaege.map(({ m }) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => gemeinsamesFeldAendern('name', m.name)}
                        style={{ border: '1px solid var(--navy)', background: '#fff', color: 'var(--navy)', borderRadius: 999, padding: '3px 10px', cursor: 'pointer', fontSize: 13 }}
                      >
                        {m.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })()}

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
