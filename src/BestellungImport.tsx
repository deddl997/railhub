import { Fragment, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from './lib/supabase'
import { datumZuISO } from './datumUtils'

// Dienstbeginn liegt so viele Minuten vor der Abfahrt aus der Bestellung
const VORLAUF_MINUTEN = 60
// Mindest-Dienstdauer von Beginn bis Ende (die Pause ist darin enthalten), auch wenn die Fahrt in der Bestellung kuerzer ist
const MINDEST_DAUER_MINUTEN = 8 * 60
const SPOT_FARBE = '#8b1a1a'
const FARB_AUSWAHL = ['#8b1a1a', '#14325c', '#15803d', '#b45309', '#6d28d9', '#0e7490', '#be185d', '#475569']

// Pause nach Arbeitszeitgesetz (§ 4): mehr als 6 Std. = 30 Min., mehr als 9 Std. = 45 Min.
function pauseNachArbZG(bruttoMinuten: number): number {
  if (bruttoMinuten > 9 * 60) return 45
  if (bruttoMinuten > 6 * 60) return 30
  return 0
}

function bruttoMinuten(beginn: string, ende: string): number {
  let d = zeitInMinuten(ende) - zeitInMinuten(beginn)
  if (d <= 0) d += 1440
  return d
}

interface Fahrt {
  referenz: string
  referenznummer: string | null
  datum: string
  von: string
  von_zeit: string
  nach: string
  nach_zeit: string
  lok: string | null
  tf_hinweis?: string | null
}

interface Uebersprungen {
  zeile: string
  grund: string
}

interface Zeile {
  id: number
  aktiv: boolean
  name: string
  datum: string
  beginn: string
  ende: string
  dienstort: string
  info: string
  hinweise: string[]
  doppelt: boolean
  verlaengertVon: string | null
  fahrt: Fahrt
  pause: number
  pauseManuell: boolean
  farbe: string
  gruppe: number
  teil: number
  teile: number
}

function zeitInMinuten(zeit: string): number {
  const [h, m] = zeit.split(':').map(Number)
  return h * 60 + m
}

function minutenAlsZeit(minuten: number): string {
  const h = Math.floor(minuten / 60)
  const m = minuten % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function tagVorher(datumIso: string): string {
  const d = new Date(datumIso + 'T00:00:00')
  d.setDate(d.getDate() - 1)
  return datumZuISO(d)
}

function datumDeutsch(iso: string): string {
  return iso.split('-').reverse().join('.')
}

// Excel-Datei in lesbaren Text umwandeln (verbundene Zellen werden aufgefuellt)
async function excelAlsText(datei: File): Promise<string> {
  const arbeitsmappe = XLSX.read(await datei.arrayBuffer(), { type: 'array' })
  const teile: string[] = []
  for (const blattName of arbeitsmappe.SheetNames) {
    const blatt = arbeitsmappe.Sheets[blattName]
    if (!blatt || !blatt['!ref']) continue
    const bereich = XLSX.utils.decode_range(blatt['!ref'])
    const merges = blatt['!merges'] ?? []

    const wertAn = (zeile: number, spalte: number): unknown => {
      const zelle = blatt[XLSX.utils.encode_cell({ r: zeile, c: spalte })]
      if (zelle && zelle.v !== undefined && zelle.v !== null && zelle.v !== '') return zelle.v
      for (const m of merges) {
        if (zeile >= m.s.r && zeile <= m.e.r && spalte >= m.s.c && spalte <= m.e.c) {
          const start = blatt[XLSX.utils.encode_cell({ r: m.s.r, c: m.s.c })]
          return start ? start.v : ''
        }
      }
      return ''
    }

    const alsText = (wert: unknown): string => {
      if (wert === '' || wert === null || wert === undefined) return ''
      if (typeof wert === 'number') {
        if (wert >= 20000) {
          const tage = Math.floor(wert)
          return new Date(Date.UTC(1899, 11, 30) + tage * 86400000).toISOString().slice(0, 10)
        }
        if (wert >= 0 && wert < 1) return minutenAlsZeit(Math.round(wert * 1440) % 1440)
        return String(wert)
      }
      return String(wert).replace(/\s*\n\s*/g, ' / ').trim()
    }

    teile.push(`Blatt: ${blattName}`)
    for (let r = bereich.s.r; r <= bereich.e.r; r++) {
      const zellen: string[] = []
      for (let c = bereich.s.c; c <= bereich.e.c; c++) zellen.push(alsText(wertAn(r, c)))
      if (zellen.every((z) => z === '')) continue
      teile.push(`Zeile ${r + 1}: ` + zellen.join(' | '))
    }
  }
  return teile.join('\n')
}

function dateiAlsBase64(datei: File): Promise<string> {
  return new Promise((ok, fehler) => {
    const leser = new FileReader()
    leser.onload = () => ok(String(leser.result).split(',')[1] ?? '')
    leser.onerror = () => fehler(new Error('Datei konnte nicht gelesen werden'))
    leser.readAsDataURL(datei)
  })
}

// Absolute Minuten (Datum + Uhrzeit), fuer den Vergleich von Teilstrecken
function absMin(datum: string, zeit: string): number {
  const [j, m, t] = datum.split('-').map(Number)
  const [h, min] = zeit.split(':').map(Number)
  return Date.UTC(j, m - 1, t, h, min) / 60000
}

// Fahrten mit gleicher Referenz, die lueckenlos aneinander anschliessen (Nach = naechstes Von), sind ein Auftrag mit Personalwechsel
function fahrtenGruppieren(fahrten: Fahrt[]): Fahrt[][] {
  const gruppen: Fahrt[][] = []
  for (const f of fahrten) {
    const letzte = gruppen[gruppen.length - 1]
    const vorher = letzte ? letzte[letzte.length - 1] : null
    if (vorher && vorher.referenz === f.referenz && vorher.nach.trim().toLowerCase() === f.von.trim().toLowerCase()) {
      let ende = absMin(vorher.datum, vorher.nach_zeit)
      if (ende < absMin(vorher.datum, vorher.von_zeit)) ende += 1440
      const start = absMin(f.datum, f.von_zeit)
      if (start >= ende && start - ende <= 12 * 60) {
        letzte.push(f)
        continue
      }
    }
    gruppen.push([f])
  }
  return gruppen
}

function fahrtenZuZeilen(fahrten: Fahrt[]): Zeile[] {
  const gruppen = fahrtenGruppieren(fahrten)
  const zeilen: Zeile[] = []
  gruppen.forEach((legs, g) => {
    const tfHinweis = legs.map((l) => l.tf_hinweis).find(Boolean) ?? null
    legs.forEach((f, teil) => {
      const hinweise: string[] = tfHinweis ? [`In der Bestellung vermerkt: ${tfHinweis}`] : []
      let beginnMin = zeitInMinuten(f.von_zeit) - VORLAUF_MINUTEN
      let datum = f.datum
      if (beginnMin < 0) {
        beginnMin += 1440
        datum = tagVorher(datum)
      }
      const nummer = f.referenznummer ? ` (${f.referenznummer})` : ''
      let dauer = zeitInMinuten(f.nach_zeit) - beginnMin
      if (dauer <= 0) dauer += 1440
      let ende = f.nach_zeit
      let verlaengertVon: string | null = null
      if (dauer < MINDEST_DAUER_MINUTEN) {
        dauer = MINDEST_DAUER_MINUTEN
        ende = minutenAlsZeit((beginnMin + dauer) % 1440)
        verlaengertVon = f.nach_zeit
      }
      let wechsel = ''
      if (legs.length > 1) {
        const teile: string[] = []
        if (teil > 0) teile.push(`Übernahme von Kollegen in ${f.von} um ${f.von_zeit}.`)
        if (teil < legs.length - 1) teile.push(`Übergabe an Kollegen in ${f.nach} um ${f.nach_zeit}.`)
        wechsel = ' Personalwechsel: ' + teile.join(' ')
      }
      zeilen.push({
        id: 0,
        aktiv: !tfHinweis,
        name: `${f.referenz} ${f.von}–${f.nach}`,
        datum,
        beginn: minutenAlsZeit(beginnMin),
        ende,
        dienstort: f.von,
        info:
          `Zug ${f.referenz}${nummer}: ${f.von} ${f.von_zeit} → ${f.nach} ${f.nach_zeit}.` +
          (f.lok ? ` Geplante Lok: ${f.lok}.` : '') +
          wechsel,
        hinweise,
        doppelt: false,
        verlaengertVon,
        fahrt: f,
        pause: pauseNachArbZG(dauer),
        pauseManuell: false,
        farbe: SPOT_FARBE,
        gruppe: g,
        teil,
        teile: legs.length,
      })
    })
  })

  // Ausreisser beim Datum markieren (z.B. Tippfehler in der Bestellung)
  const tage = zeilen.map((z) => Date.parse(z.datum + 'T00:00:00Z') / 86400000).sort((a, b) => a - b)
  if (tage.length > 0) {
    const median = tage[Math.floor(tage.length / 2)]
    for (const z of zeilen) {
      const t = Date.parse(z.datum + 'T00:00:00Z') / 86400000
      if (Math.abs(t - median) > 4) z.hinweise.push('Datum prüfen: weicht stark von den übrigen ab')
    }
  }
  // Auftraege nach erstem Abfahrtstag sortieren, Teilstrecken bleiben zusammen
  const ersteZeit = new Map<number, string>()
  for (const z of zeilen) if (z.teil === 0) ersteZeit.set(z.gruppe, z.datum + z.beginn)
  zeilen.sort((a, b) => (ersteZeit.get(a.gruppe) ?? '').localeCompare(ersteZeit.get(b.gruppe) ?? '') || a.gruppe - b.gruppe || a.teil - b.teil)
  return zeilen.map((z, i) => ({ ...z, id: i }))
}

export default function BestellungImport({
  onFertig,
  onSchliessen,
}: {
  onFertig: (ersterTag: string | null) => void
  onSchliessen: () => void
}) {
  const [schritt, setSchritt] = useState<'wahl' | 'laden' | 'vorschau'>('wahl')
  const [fehler, setFehler] = useState<string | null>(null)
  const [zeilen, setZeilen] = useState<Zeile[]>([])
  const [uebersprungen, setUebersprungen] = useState<Uebersprungen[]>([])
  const [speichert, setSpeichert] = useState(false)
  const [mitSchichten, setMitSchichten] = useState(true)

  async function dateiWaehlen(datei: File | undefined) {
    if (!datei) return
    setFehler(null)
    setSchritt('laden')
    try {
      const name = datei.name.toLowerCase()
      let body: Record<string, string>
      if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
        body = { art: 'text', text: await excelAlsText(datei) }
      } else if (name.endsWith('.pdf') || datei.type.startsWith('image/')) {
        if (datei.size > 3_000_000) throw new Error('Die Datei ist zu groß (maximal 3 MB). Bitte verkleinern oder als Excel hochladen.')
        body = {
          art: 'datei',
          mime: name.endsWith('.pdf') ? 'application/pdf' : datei.type,
          daten: await dateiAlsBase64(datei),
        }
      } else {
        throw new Error('Bitte eine Excel-Datei (.xlsx), ein PDF oder ein Foto wählen.')
      }

      const { data } = await supabase.auth.getSession()
      const token = data.session?.access_token
      if (!token) throw new Error('Nicht angemeldet')
      const antwort = await fetch('/api/bestellung-auswerten', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      })
      const ergebnis = await antwort.json().catch(() => ({}))
      if (!antwort.ok) throw new Error(ergebnis.fehler ?? `Fehler ${antwort.status}`)

      const fahrten = (ergebnis.fahrten ?? []) as Fahrt[]
      if (fahrten.length === 0) throw new Error('Es wurden keine Fahrten mit Zeiten erkannt.')
      const neueZeilen = fahrtenZuZeilen(fahrten)

      // Schon vorhandene Spotschichten erkennen
      const ersterTag = neueZeilen.reduce((a, z) => (z.datum < a ? z.datum : a), neueZeilen[0].datum)
      const letzterTag = neueZeilen.reduce((a, z) => (z.datum > a ? z.datum : a), neueZeilen[0].datum)
      const [offen, belegt, auftraegeVorhanden] = await Promise.all([
        supabase.from('offene_spotschichten').select('name, datum, beginn_zeit').gte('datum', ersterTag).lte('datum', letzterTag),
        supabase
          .from('dienstplan_eintraege')
          .select('spot_name, datum, spot_beginn_zeit')
          .eq('ist_spotschicht', true)
          .gte('datum', ersterTag)
          .lte('datum', letzterTag),
        supabase
          .from('auftraege')
          .select('referenz, abfahrt_datum, abfahrt_soll')
          .gte('abfahrt_datum', datumZuISO(new Date(new Date(ersterTag + 'T00:00:00').getTime() - 86400000)))
          .lte('abfahrt_datum', datumZuISO(new Date(new Date(letzterTag + 'T00:00:00').getTime() + 2 * 86400000))),
      ])
      const auftragsSchluessel = new Set<string>(
        (auftraegeVorhanden.data ?? []).map(
          (a: { referenz: string | null; abfahrt_datum: string; abfahrt_soll: string | null }) =>
            `${a.abfahrt_datum}|${a.referenz}|${String(a.abfahrt_soll ?? '').slice(0, 5)}`
        )
      )
      const vorhanden = new Set<string>()
      for (const o of offen.data ?? []) vorhanden.add(`${o.datum}|${o.name}|${String(o.beginn_zeit).slice(0, 5)}`)
      for (const b of belegt.data ?? []) vorhanden.add(`${b.datum}|${b.spot_name}|${String(b.spot_beginn_zeit).slice(0, 5)}`)
      for (const z of neueZeilen) {
        const ersteFahrt = neueZeilen.find((x) => x.gruppe === z.gruppe && x.teil === 0)?.fahrt ?? z.fahrt
        if (auftragsSchluessel.has(`${ersteFahrt.datum}|${ersteFahrt.referenz}|${ersteFahrt.von_zeit}`)) {
          z.doppelt = true
          z.aktiv = false
          z.hinweise.push('Auftrag gibt es schon')
        } else if (vorhanden.has(`${z.datum}|${z.name}|${z.beginn}`)) {
          z.doppelt = true
          z.aktiv = false
          z.hinweise.push('Gibt es schon')
        }
      }

      setZeilen(neueZeilen)
      setUebersprungen((ergebnis.uebersprungen ?? []) as Uebersprungen[])
      setSchritt('vorschau')
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e))
      setSchritt('wahl')
    }
  }

  function zeileAendern(id: number, aenderung: Partial<Zeile>) {
    setZeilen((alt) =>
      alt.map((z) => {
        if (z.id !== id) return z
        const neu = { ...z, ...aenderung }
        // Pause automatisch nachziehen, solange sie nicht von Hand geaendert wurde
        if (!neu.pauseManuell && (aenderung.beginn !== undefined || aenderung.ende !== undefined)) {
          neu.pause = pauseNachArbZG(bruttoMinuten(neu.beginn, neu.ende))
        }
        return neu
      })
    )
  }

  function alleFarbeSetzen(farbe: string) {
    setZeilen((alt) => alt.map((z) => ({ ...z, farbe })))
  }

  const aktive = zeilen.filter((z) => z.aktiv)
  const gruppenIds = Array.from(new Set(zeilen.map((z) => z.gruppe)))
  const aktiveGruppen = Array.from(new Set(aktive.map((z) => z.gruppe)))

  async function anlegen() {
    if (aktive.length === 0) return
    setSpeichert(true)
    setFehler(null)
    // Ein Auftrag pro Referenz (auch mit Personalwechsel), dann die Schichten pro Teilstrecke
    const idJeGruppe = new Map<number, string>()
    for (const g of aktiveGruppen) idJeGruppe.set(g, crypto.randomUUID())
    const auftragsZeilen = aktiveGruppen.map((g) => {
      const legs = zeilen.filter((z) => z.gruppe === g).map((z) => z.fahrt)
      const erste = legs[0]
      const letzte = legs[legs.length - 1]
      let ankunftDatum = letzte.datum
      if (zeitInMinuten(letzte.nach_zeit) < zeitInMinuten(letzte.von_zeit)) {
        const d = new Date(letzte.datum + 'T00:00:00')
        d.setDate(d.getDate() + 1)
        ankunftDatum = datumZuISO(d)
      }
      const loks = Array.from(new Set(legs.map((l) => l.lok).filter(Boolean))) as string[]
      const mehrere = legs.length > 1
      const einzelneZeile = zeilen.find((z) => z.gruppe === g)
      return {
        id: idJeGruppe.get(g) as string,
        referenz: erste.referenz,
        zug_nr: erste.referenznummer,
        evu: 'RBL',
        abfahrt_ort: erste.von,
        abfahrt_datum: erste.datum,
        abfahrt_soll: erste.von_zeit,
        ankunft_ort: letzte.nach,
        ankunft_datum: ankunftDatum,
        ankunft_soll: letzte.nach_zeit,
        lok: loks.join(' / ') || null,
        mitarbeiter_info: mehrere ? null : (einzelneZeile?.info.trim() || null),
        fahrten: mehrere
          ? legs.map((l) => ({
              art: 'Zugfahrt',
              zug: [l.referenz, l.referenznummer ? `(${l.referenznummer})` : ''].filter(Boolean).join(' '),
              von: l.von,
              von_zeit: l.von_zeit,
              nach: l.nach,
              nach_zeit: l.nach_zeit,
              lok: l.lok ?? '',
              datum: l.datum,
            }))
          : [],
      }
    })
    const { error: auftragFehler } = await supabase.from('auftraege').insert(auftragsZeilen)
    if (auftragFehler) {
      setSpeichert(false)
      setFehler('Aufträge anlegen fehlgeschlagen: ' + auftragFehler.message)
      return
    }
    if (mitSchichten) {
      const { error } = await supabase.from('offene_spotschichten').insert(
        aktive.map((z) => ({
          datum: z.datum,
          bereich: 'Lokführer',
          name: z.name.trim() || 'Fahrt',
          beginn_zeit: z.beginn,
          ende_zeit: z.ende,
          pause_minuten: z.pause,
          dienstort: z.dienstort.trim() || null,
          farbe: z.farbe || SPOT_FARBE,
          info: z.info.trim() || null,
          auftrag_id: idJeGruppe.get(z.gruppe),
        }))
      )
      if (error) {
        setSpeichert(false)
        setFehler('Die Aufträge sind angelegt, die Schichten aber nicht: ' + error.message + ' (in der Auftragsliste kannst du sie nachträglich anlegen)')
        return
      }
    }
    setSpeichert(false)
    const ersterTag = aktive.reduce((a, z) => (z.datum < a ? z.datum : a), aktive[0].datum)
    onFertig(ersterTag)
  }

  const eingabe: React.CSSProperties = {
    padding: '4px 6px',
    border: '1px solid var(--border)',
    borderRadius: 4,
    fontSize: 12,
    boxSizing: 'border-box',
  }

  return (
    <div
      onClick={onSchliessen}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 20,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#ffffff',
          borderRadius: 12,
          padding: 20,
          width: 1060,
          maxWidth: '100%',
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
          <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--navy)' }}>Bestellung einlesen</div>
          <button
            onClick={onSchliessen}
            style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)', lineHeight: 1 }}
          >
            ✕
          </button>
        </div>

        {fehler && (
          <div style={{ background: '#fee2e2', color: '#991b1b', padding: '8px 12px', borderRadius: 8, margin: '8px 0', fontSize: 13 }}>
            {fehler}
          </div>
        )}

        {schritt === 'wahl' && (
          <div>
            <div style={{ fontSize: 13, color: '#475569', margin: '6px 0 14px' }}>
              Lade die Bestellung der Autoverkehre hoch (Excel, PDF oder Foto). Die KI liest die Fahrten aus. Aus jeder Referenz wird ein
              Auftrag in der Auftragsliste (mit Personalwechsel am Zwischenhalt, dann je Teilstrecke eine Schicht) und, wenn du möchtest, eine offene Spotschicht für Lokführer: Dienstbeginn {VORLAUF_MINUTEN} Minuten vor der Abfahrt, Dienstende zur Ankunftszeit, mindestens aber 8 Stunden Dienstdauer. Die Pause ist in der Dienstdauer enthalten und wird nach dem Arbeitszeitgesetz eingeplant (über 6 Std. = 30 Min., über 9 Std. = 45 Min.).
              Wagenmeister-Angaben werden nicht übernommen. Vor dem Anlegen siehst du eine Vorschau und kannst alles ändern.
            </div>
            <label
              style={{
                display: 'block',
                border: '2px dashed #cbd5e1',
                borderRadius: 10,
                padding: '28px 16px',
                textAlign: 'center',
                cursor: 'pointer',
                color: 'var(--navy)',
                fontWeight: 600,
              }}
            >
              Datei auswählen
              <input
                type="file"
                accept=".xlsx,.xls,.pdf,image/*"
                onChange={(e) => dateiWaehlen(e.target.files?.[0])}
                style={{ display: 'none' }}
              />
            </label>
          </div>
        )}

        {schritt === 'laden' && (
          <div style={{ padding: '30px 0', textAlign: 'center', color: '#475569' }}>Die KI liest die Bestellung ... das dauert einen Moment.</div>
        )}

        {schritt === 'vorschau' && (
          <div>
            <div style={{ fontSize: 13, color: '#475569', margin: '6px 0 10px' }}>
              {gruppenIds.length} Aufträge mit {zeilen.length} Schichten erkannt, {aktiveGruppen.length} Aufträge mit {aktive.length} Schichten werden angelegt. Fährt ein Zug mit gleicher Referenz über einen Zwischenhalt, ist das ein Auftrag mit Personalwechsel und jede Teilstrecke bekommt eine eigene Schicht. Du kannst Name, Datum, Zeiten, Dienstort und Info ändern oder Zeilen
              abwählen. Die Pause wird nach dem Arbeitszeitgesetz berechnet und passt sich bei geänderten Zeiten an. Wenn du sie von Hand änderst, bleibt dein
              Wert stehen.
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#475569', marginBottom: 8 }}>
              <input type="checkbox" checked={mitSchichten} onChange={(e) => setMitSchichten(e.target.checked)} />
              Zu jedem Auftrag auch eine offene Schicht im Dienstplan anlegen
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#475569' }}>Farbe für alle Schichten:</span>
              {FARB_AUSWAHL.map((f) => (
                <button
                  key={f}
                  onClick={() => alleFarbeSetzen(f)}
                  title={f}
                  style={{ width: 24, height: 24, borderRadius: 6, border: '2px solid #ffffff', outline: '1px solid #cbd5e1', background: f, cursor: 'pointer', padding: 0 }}
                />
              ))}
              <input type="color" onChange={(e) => alleFarbeSetzen(e.target.value)} title="Eigene Farbe wählen" style={{ width: 32, height: 28, padding: 0, border: 'none', background: 'none', cursor: 'pointer' }} />
              <span style={{ fontSize: 11, color: '#94a3b8' }}>Einzelne Farben änderst du in der Spalte „Farbe“.</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 1100, fontSize: 12 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: '#64748b' }}>
                    <th style={{ padding: '4px 6px' }}>
                      <input
                        type="checkbox"
                        checked={aktive.length === zeilen.length}
                        onChange={(e) => setZeilen((alt) => alt.map((z) => ({ ...z, aktiv: e.target.checked })))}
                      />
                    </th>
                    <th style={{ padding: '4px 6px' }}>Datum</th>
                    <th style={{ padding: '4px 6px' }}>Name</th>
                    <th style={{ padding: '4px 6px' }}>Beginn</th>
                    <th style={{ padding: '4px 6px' }}>Ende</th>
                    <th style={{ padding: '4px 6px' }}>Pause (Min.)</th>
                    <th style={{ padding: '4px 6px' }}>Dienstort</th>
                    <th style={{ padding: '4px 6px' }}>Farbe</th>
                    <th style={{ padding: '4px 6px' }}>Info</th>
                  </tr>
                </thead>
                <tbody>
                  {zeilen.map((z) => (
                    <Fragment key={z.id}>
                    {z.teil === 0 && z.teile > 1 && (
                      <tr>
                        <td colSpan={9} style={{ padding: '8px 6px 2px', background: '#f5f3ff', color: '#5b21b6', fontWeight: 700, fontSize: 12 }}>
                          {z.fahrt.referenz} · Personalwechsel in{' '}
                          {zeilen
                            .filter((x) => x.gruppe === z.gruppe && x.teil > 0)
                            .map((x) => x.fahrt.von)
                            .join(', ')}{' '}
                          · {z.teile} Schichten
                        </td>
                      </tr>
                    )}
                    <tr style={{ borderTop: '1px solid #eef2f8', opacity: z.aktiv ? 1 : 0.5, verticalAlign: 'top' }}>
                      <td style={{ padding: '5px 6px' }}>
                        <input type="checkbox" checked={z.aktiv} onChange={(e) => zeileAendern(z.id, { aktiv: e.target.checked })} />
                      </td>
                      <td style={{ padding: '5px 6px' }}>
                        <input type="date" value={z.datum} onChange={(e) => zeileAendern(z.id, { datum: e.target.value })} style={eingabe} />
                        {z.hinweise.map((h) => (
                          <div key={h} style={{ color: '#b45309', fontWeight: 600, fontSize: 11, marginTop: 2 }}>
                            ⚠ {h}
                          </div>
                        ))}
                      </td>
                      <td style={{ padding: '5px 6px' }}>
                        <input value={z.name} onChange={(e) => zeileAendern(z.id, { name: e.target.value })} style={{ ...eingabe, width: 230 }} />
                      </td>
                      <td style={{ padding: '5px 6px' }}>
                        <input type="time" value={z.beginn} onChange={(e) => zeileAendern(z.id, { beginn: e.target.value })} style={eingabe} />
                      </td>
                      <td style={{ padding: '5px 6px' }}>
                        <input type="time" value={z.ende} onChange={(e) => zeileAendern(z.id, { ende: e.target.value })} style={eingabe} />
                        {z.verlaengertVon && (
                          <div style={{ color: '#64748b', fontSize: 11, marginTop: 2 }}>auf 8 Std. verlängert (Bestellung: {z.verlaengertVon})</div>
                        )}
                      </td>
                      <td style={{ padding: '5px 6px' }}>
                        <input
                          type="number"
                          min={0}
                          max={240}
                          value={z.pause}
                          onChange={(e) => zeileAendern(z.id, { pause: Math.max(0, Number(e.target.value) || 0), pauseManuell: true })}
                          style={{ ...eingabe, width: 64 }}
                        />
                      </td>
                      <td style={{ padding: '5px 6px' }}>
                        <input value={z.dienstort} onChange={(e) => zeileAendern(z.id, { dienstort: e.target.value })} style={{ ...eingabe, width: 90 }} />
                      </td>
                      <td style={{ padding: '5px 6px' }}>
                        <input
                          type="color"
                          value={z.farbe}
                          onChange={(e) => zeileAendern(z.id, { farbe: e.target.value })}
                          style={{ width: 36, height: 28, padding: 0, border: 'none', background: 'none', cursor: 'pointer' }}
                        />
                      </td>
                      <td style={{ padding: '5px 6px' }}>
                        <textarea
                          value={z.info}
                          onChange={(e) => zeileAendern(z.id, { info: e.target.value })}
                          rows={2}
                          style={{ ...eingabe, width: 300, fontFamily: 'inherit', resize: 'vertical' }}
                        />
                      </td>
                    </tr>
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>

            {uebersprungen.length > 0 && (
              <details style={{ marginTop: 12, fontSize: 12, color: '#475569' }}>
                <summary style={{ cursor: 'pointer', fontWeight: 600 }}>{uebersprungen.length} Zeilen übersprungen (anzeigen)</summary>
                <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                  {uebersprungen.map((u, i) => (
                    <li key={i}>
                      {u.zeile}: {u.grund}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
              <button
                onClick={() => {
                  setSchritt('wahl')
                  setZeilen([])
                }}
                style={{
                  background: 'none',
                  border: '1px solid var(--navy)',
                  color: 'var(--navy)',
                  borderRadius: 6,
                  padding: '8px 14px',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                Andere Datei
              </button>
              <button
                onClick={anlegen}
                disabled={speichert || aktive.length === 0}
                style={{
                  background: 'var(--navy)',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: 6,
                  padding: '8px 14px',
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: 'pointer',
                  opacity: speichert || aktive.length === 0 ? 0.5 : 1,
                }}
              >
                {speichert ? 'Legt an ...' : `${aktiveGruppen.length} Aufträge mit ${aktive.length} Schichten anlegen`}
              </button>
            </div>
            {aktive.length > 0 && (
              <div style={{ fontSize: 11, color: '#94a3b8', textAlign: 'right', marginTop: 6 }}>
                Erste Schicht: {datumDeutsch(aktive[0].datum)}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
