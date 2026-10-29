import { useMemo, useState } from 'react'
import { anlage8Lesen, dateiNameFuer, serialZuText, serialZuZeit, vorlageBefuellen } from './bahnstromErzeugen'
import type { Anlage8, TraktionsZeile } from './bahnstromErzeugen'

// Erwartete Stammdaten der Vorlage (stehen dort fest in Zeile 3 und 5)
const MARKTPARTNER = '1900100303074'
const ZAEHLPUNKT = 'DE00758760326VIRT0000000000000443'

function serialZuISO(serial: number): string {
  const [t, m, j] = serialZuText(serial).split('.')
  return `${j}-${m}-${t}`
}

function isoZuSerial(iso: string): number {
  const [j, m, t] = iso.split('-').map(Number)
  return Date.UTC(j, m - 1, t) / 86400000 + 25569
}

export default function Bahnstrom() {
  const [daten, setDaten] = useState<Anlage8 | null>(null)
  const [dateiName, setDateiName] = useState('')
  const [fehler, setFehler] = useState<string | null>(null)
  const [laedt, setLaedt] = useState(false)
  const [erzeugt, setErzeugt] = useState(false)
  const [von, setVon] = useState('')
  const [bis, setBis] = useState('')
  const [alleZeigen, setAlleZeigen] = useState(false)

  async function dateiWaehlen(datei: File | undefined) {
    if (!datei) return
    setFehler(null)
    setErzeugt(false)
    setLaedt(true)
    try {
      const gelesen = await anlage8Lesen(await datei.arrayBuffer())
      setDaten(gelesen)
      setDateiName(datei.name)
      const tage = gelesen.zeilen.map((z) => z.verkehrstag)
      setVon(serialZuISO(Math.min(...tage)))
      setBis(serialZuISO(Math.max(...tage)))
    } catch (e) {
      setDaten(null)
      setFehler(e instanceof Error ? e.message : String(e))
    }
    setLaedt(false)
  }

  const gefiltert: TraktionsZeile[] = useMemo(() => {
    if (!daten) return []
    const a = von ? isoZuSerial(von) : -Infinity
    const b = bis ? isoZuSerial(bis) : Infinity
    return daten.zeilen.filter((z) => z.verkehrstag >= a && z.verkehrstag <= b)
  }, [daten, von, bis])

  const hinweise: string[] = []
  if (daten) {
    if (daten.marktpartner && daten.marktpartner !== MARKTPARTNER) hinweise.push(`Marktpartner-ID in der Anlage 8 (${daten.marktpartner}) weicht von der Vorlage (${MARKTPARTNER}) ab.`)
    if (daten.zaehlpunkt && daten.zaehlpunkt !== ZAEHLPUNKT) hinweise.push(`Zählpunkt in der Anlage 8 weicht von der Vorlage ab.`)
    hinweise.push(...daten.warnungen)
  }

  async function erzeugen() {
    if (gefiltert.length === 0) return
    setFehler(null)
    setErzeugt(false)
    setLaedt(true)
    try {
      const antwort = await fetch('/vorlagen/bahnstrom_vorlage.xlsx', { cache: 'no-store' })
      if (!antwort.ok) throw new Error('Die Vorlage wurde nicht gefunden (public/vorlagen/bahnstrom_vorlage.xlsx).')
      const ergebnis = await vorlageBefuellen(await antwort.arrayBuffer(), gefiltert)
      const blob = new Blob([ergebnis as unknown as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = dateiNameFuer(gefiltert)
      link.click()
      URL.revokeObjectURL(url)
      setErzeugt(true)
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e))
    }
    setLaedt(false)
  }

  const knopf: React.CSSProperties = { background: 'none', border: '1px solid var(--navy)', color: 'var(--navy)', borderRadius: 8, padding: '8px 14px', fontSize: 13, cursor: 'pointer' }
  const eingabe: React.CSSProperties = { border: '1px solid var(--border)', borderRadius: 6, padding: '7px 9px', fontSize: 14, fontFamily: 'inherit' }
  const th: React.CSSProperties = { textAlign: 'left', padding: '6px 8px', fontSize: 12, color: '#475569', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', background: '#f8fafc' }
  const td: React.CSSProperties = { padding: '5px 8px', fontSize: 12.5, borderBottom: '1px solid #eef2f8', whiteSpace: 'nowrap' }
  const kachel = (titel: string, wert: string) => (
    <div style={{ background: '#f1f5f9', borderRadius: 8, padding: '8px 14px', minWidth: 120 }}>
      <div style={{ fontSize: 11, color: '#64748b' }}>{titel}</div>
      <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--navy)' }}>{wert}</div>
    </div>
  )

  const sichtbareZeilen = alleZeigen ? gefiltert : gefiltert.slice(0, 15)
  const kmSumme = gefiltert.reduce((s, z) => s + z.strecke, 0)

  return (
    <div>
      <div style={{ fontSize: 13, color: '#475569', marginBottom: 12, maxWidth: 820 }}>
        Lade die <b>Anlage 8</b> von DB Energie (Meldeformular Fahrplandaten Triebfahrzeuge) hoch. Die Daten werden in die Vorlage
        „Traktionsleistungen“ übernommen. Aussehen, Spaltenbreiten, Logo und Auswahllisten der Vorlage bleiben unverändert, es werden nur die Datenzeilen ersetzt.
      </div>

      <label
        style={{ display: 'inline-block', border: '2px dashed #cbd5e1', borderRadius: 10, padding: '18px 28px', cursor: 'pointer', color: 'var(--navy)', fontWeight: 600, marginBottom: 14 }}
      >
        {daten ? 'Andere Anlage 8 wählen' : 'Anlage 8 auswählen (.xlsx)'}
        <input type="file" accept=".xlsx" onChange={(e) => dateiWaehlen(e.target.files?.[0])} style={{ display: 'none' }} />
      </label>
      {dateiName && <span style={{ marginLeft: 12, fontSize: 13, color: '#64748b' }}>{dateiName}</span>}

      {laedt && <div style={{ fontSize: 14, color: '#64748b', marginBottom: 10 }}>Einen Moment …</div>}
      {fehler && <div style={{ background: '#fee2e2', color: '#991b1b', padding: '8px 12px', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>{fehler}</div>}

      {daten && (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            {kachel('Monat', daten.monat ? `${String(daten.monat).slice(4, 6)}/${String(daten.monat).slice(0, 4)}` : '–')}
            {kachel('Zeilen', `${gefiltert.length}${gefiltert.length !== daten.zeilen.length ? ` von ${daten.zeilen.length}` : ''}`)}
            {kachel('Gesamtstrecke', `${kmSumme.toLocaleString('de-DE')} km`)}
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12, fontSize: 13, color: '#475569' }}>
            <span>Verkehrstage von</span>
            <input type="date" value={von} onChange={(e) => setVon(e.target.value)} style={eingabe} />
            <span>bis</span>
            <input type="date" value={bis} onChange={(e) => setBis(e.target.value)} style={eingabe} />
            <span style={{ color: '#94a3b8' }}>(Standard: alles aus der Datei. Für eine Halbmonatsmeldung hier den Zeitraum einschränken.)</span>
          </div>

          {hinweise.length > 0 && (
            <div style={{ background: '#fef3c7', border: '1px solid #fcd34d', color: '#92400e', borderRadius: 8, padding: '8px 12px', fontSize: 13, marginBottom: 12 }}>
              {hinweise.map((h) => (
                <div key={h}>⚠ {h}</div>
              ))}
            </div>
          )}

          <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 10, background: '#ffffff', marginBottom: 8 }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 900 }}>
              <thead>
                <tr>
                  <th style={th}>Tfz</th>
                  <th style={th}>Abfahrt</th>
                  <th style={th}>Von</th>
                  <th style={th}>Ankunft</th>
                  <th style={th}>Nach</th>
                  <th style={th}>km</th>
                  <th style={th}>Last</th>
                  <th style={th}>Zug</th>
                  <th style={th}>Verw.</th>
                  <th style={th}>V max</th>
                  <th style={th}>Verkehrstag</th>
                </tr>
              </thead>
              <tbody>
                {sichtbareZeilen.map((z, i) => (
                  <tr key={i}>
                    <td style={td}>{z.tfz}</td>
                    <td style={td}>
                      {serialZuText(z.abfahrt).slice(0, 6)} {serialZuZeit(z.abfahrt)}
                    </td>
                    <td style={td}>{z.abOrt}</td>
                    <td style={td}>
                      {serialZuText(z.ankunft).slice(0, 6)} {serialZuZeit(z.ankunft)}
                    </td>
                    <td style={td}>{z.anOrt}</td>
                    <td style={td}>{z.strecke}</td>
                    <td style={td}>{z.last}</td>
                    <td style={td}>{z.zug}</td>
                    <td style={td}>{z.verwendung}</td>
                    <td style={td}>{z.vmax}</td>
                    <td style={td}>{serialZuText(z.verkehrstag)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {gefiltert.length > 15 && (
            <button onClick={() => setAlleZeigen(!alleZeigen)} style={{ ...knopf, padding: '4px 10px', fontSize: 12, marginBottom: 12 }}>
              {alleZeigen ? 'Nur die ersten 15 zeigen' : `Alle ${gefiltert.length} Zeilen zeigen`}
            </button>
          )}

          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
            <button
              onClick={erzeugen}
              disabled={laedt || gefiltert.length === 0}
              style={{ ...knopf, background: 'var(--navy)', color: '#ffffff', opacity: laedt || gefiltert.length === 0 ? 0.5 : 1 }}
            >
              Vorlage befüllen und herunterladen
            </button>
            {gefiltert.length > 0 && <span style={{ fontSize: 12, color: '#64748b' }}>Dateiname: {dateiNameFuer(gefiltert)}</span>}
          </div>
          {erzeugt && (
            <div style={{ background: '#dcfce7', color: '#166534', borderRadius: 8, padding: '8px 12px', fontSize: 13, marginTop: 12 }}>
              Die Datei wurde erzeugt und heruntergeladen ({gefiltert.length} Zeilen).
            </div>
          )}
        </>
      )}
    </div>
  )
}
