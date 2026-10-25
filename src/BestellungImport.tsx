import { useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from './lib/supabase'
import { datumZuISO } from './datumUtils'

// Dienstbeginn liegt so viele Minuten vor der Abfahrt aus der Bestellung
const VORLAUF_MINUTEN = 60
const SPOT_FARBE = '#8b1a1a'

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

function fahrtenZuZeilen(fahrten: Fahrt[]): Zeile[] {
  const zeilen: Zeile[] = fahrten.map((f, i) => {
    const hinweise: string[] = f.tf_hinweis ? [`In der Bestellung vermerkt: ${f.tf_hinweis}`] : []
    let beginnMin = zeitInMinuten(f.von_zeit) - VORLAUF_MINUTEN
    let datum = f.datum
    if (beginnMin < 0) {
      beginnMin += 1440
      datum = tagVorher(datum)
    }
    const nummer = f.referenznummer ? ` (${f.referenznummer})` : ''
    return {
      id: i,
      aktiv: !f.tf_hinweis,
      name: `${f.referenz} ${f.von}–${f.nach}`,
      datum,
      beginn: minutenAlsZeit(beginnMin),
      ende: f.nach_zeit,
      dienstort: f.von,
      info:
        `Zug ${f.referenz}${nummer}: ${f.von} ${f.von_zeit} → ${f.nach} ${f.nach_zeit}. ` +
        `Dienstbeginn ${VORLAUF_MINUTEN} Min. vor Abfahrt.` +
        (f.lok ? ` Geplante Lok: ${f.lok}.` : ''),
      hinweise,
      doppelt: false,
    }
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
  return zeilen.sort((a, b) => (a.datum + a.beginn).localeCompare(b.datum + b.beginn)).map((z, i) => ({ ...z, id: i }))
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
      const [offen, belegt] = await Promise.all([
        supabase.from('offene_spotschichten').select('name, datum, beginn_zeit').gte('datum', ersterTag).lte('datum', letzterTag),
        supabase
          .from('dienstplan_eintraege')
          .select('spot_name, datum, spot_beginn_zeit')
          .eq('ist_spotschicht', true)
          .gte('datum', ersterTag)
          .lte('datum', letzterTag),
      ])
      const vorhanden = new Set<string>()
      for (const o of offen.data ?? []) vorhanden.add(`${o.datum}|${o.name}|${String(o.beginn_zeit).slice(0, 5)}`)
      for (const b of belegt.data ?? []) vorhanden.add(`${b.datum}|${b.spot_name}|${String(b.spot_beginn_zeit).slice(0, 5)}`)
      for (const z of neueZeilen) {
        if (vorhanden.has(`${z.datum}|${z.name}|${z.beginn}`)) {
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
    setZeilen((alt) => alt.map((z) => (z.id === id ? { ...z, ...aenderung } : z)))
  }

  const aktive = zeilen.filter((z) => z.aktiv)

  async function anlegen() {
    if (aktive.length === 0) return
    setSpeichert(true)
    setFehler(null)
    const { error } = await supabase.from('offene_spotschichten').insert(
      aktive.map((z) => ({
        datum: z.datum,
        bereich: 'Lokführer',
        name: z.name.trim() || 'Fahrt',
        beginn_zeit: z.beginn,
        ende_zeit: z.ende,
        pause_minuten: 0,
        dienstort: z.dienstort.trim() || null,
        farbe: SPOT_FARBE,
        info: z.info.trim() || null,
      }))
    )
    setSpeichert(false)
    if (error) {
      setFehler('Anlegen fehlgeschlagen: ' + error.message)
      return
    }
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
              Lade die Bestellung der Autoverkehre hoch (Excel, PDF oder Foto). Die KI liest die Fahrten aus. Aus jeder Fahrt wird eine
              offene Spotschicht für Lokführer: Dienstbeginn {VORLAUF_MINUTEN} Minuten vor der Abfahrt, Dienstende zur Ankunftszeit.
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
              {zeilen.length} Fahrten erkannt, {aktive.length} werden angelegt. Du kannst Name, Datum, Zeiten, Dienstort und Info ändern oder Zeilen
              abwählen.
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 960, fontSize: 12 }}>
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
                    <th style={{ padding: '4px 6px' }}>Dienstort</th>
                    <th style={{ padding: '4px 6px' }}>Info</th>
                  </tr>
                </thead>
                <tbody>
                  {zeilen.map((z) => (
                    <tr key={z.id} style={{ borderTop: '1px solid #eef2f8', opacity: z.aktiv ? 1 : 0.5, verticalAlign: 'top' }}>
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
                      </td>
                      <td style={{ padding: '5px 6px' }}>
                        <input value={z.dienstort} onChange={(e) => zeileAendern(z.id, { dienstort: e.target.value })} style={{ ...eingabe, width: 90 }} />
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
                {speichert ? 'Legt an ...' : `${aktive.length} offene Schichten anlegen`}
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
