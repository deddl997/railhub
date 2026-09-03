import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { supabase } from './lib/supabase'

const VERFALL_TAGE = 180 // Streckenkenntnis gilt 6 Monate ohne Befahrung als verfallen

interface Strecke {
  id: string
  name: string
  streckennummer: string | null
  punkte: [number, number][] | null
}

interface Mitarbeiter {
  id: string
  name: string
  kategorie: string | null
}

interface Kenntnis {
  mitarbeiter_id: string
  strecke_id: string
  zuletzt_befahren: string
}

function tageSeit(datum: string): number {
  const unterschied = Date.now() - new Date(datum).getTime()
  return Math.floor(unterschied / (1000 * 60 * 60 * 24))
}

function streckennummerSortWert(nummer: string | null): number {
  if (!nummer) return 999999
  const zahl = parseFloat(nummer)
  return isNaN(zahl) ? 999999 : zahl
}

export default function Streckenkunde() {
  const kartenRef = useRef<HTMLDivElement>(null)
  const kartenInstanz = useRef<L.Map | null>(null)
  const linienRef = useRef<Map<string, L.Polyline>>(new Map())

  const [strecken, setStrecken] = useState<Strecke[]>([])
  const [mitarbeiterListe, setMitarbeiterListe] = useState<Mitarbeiter[]>([])
  const [kenntnisse, setKenntnisse] = useState<Kenntnis[]>([])
  const [ausgewaehlterMitarbeiter, setAusgewaehlterMitarbeiter] = useState<string>('')
  const [ausgewaehlteStrecke, setAusgewaehlteStrecke] = useState<string | null>(null)

  const [zeichenModus, setZeichenModus] = useState(false)
  const [neuePunkte, setNeuePunkte] = useState<[number, number][]>([])
  const [neuerStreckenName, setNeuerStreckenName] = useState('')
  const neuePunkteLinieRef = useRef<L.Polyline | null>(null)
  const neuePunkteMarkerRef = useRef<L.CircleMarker[]>([])

  async function laden() {
    const [{ data: streckenData }, { data: mitarbeiterData }, { data: kenntnisData }] =
      await Promise.all([
        supabase.from('strecken').select('id, name, streckennummer, punkte').order('name'),
        supabase.from('mitarbeiter').select('id, name, kategorie').eq('kategorie', 'Lokführer').order('name'),
        supabase.from('streckenkenntnis').select('mitarbeiter_id, strecke_id, zuletzt_befahren'),
      ])
    setStrecken(streckenData ?? [])
    setMitarbeiterListe(mitarbeiterData ?? [])
    setKenntnisse(kenntnisData ?? [])
  }

  useEffect(() => {
    laden()
  }, [])

  useEffect(() => {
    if (!kartenRef.current || kartenInstanz.current) return

    const karte = L.map(kartenRef.current).setView([49.0, 11.5], 7)

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap-Mitwirkende',
      maxZoom: 19,
    }).addTo(karte)

    L.tileLayer('https://{s}.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png', {
      attribution: 'Style: © OpenRailwayMap (CC-BY-SA 2.0)',
      maxZoom: 19,
    }).addTo(karte)

    karte.on('click', (e: L.LeafletMouseEvent) => {
      setZeichenModus((aktuell) => {
        if (aktuell) {
          setNeuePunkte((vorher) => [...vorher, [e.latlng.lat, e.latlng.lng]])
        }
        return aktuell
      })
    })

    kartenInstanz.current = karte

    return () => {
      karte.remove()
      kartenInstanz.current = null
    }
  }, [])

  useEffect(() => {
    const karte = kartenInstanz.current
    if (!karte) return

    linienRef.current.forEach((linie) => linie.remove())
    linienRef.current.clear()

    strecken.forEach((strecke) => {
      if (!strecke.punkte || strecke.punkte.length < 2) return

      const kenntnisEintrag = kenntnisse.find(
        (k) => k.mitarbeiter_id === ausgewaehlterMitarbeiter && k.strecke_id === strecke.id
      )
      const bekannt = !!ausgewaehlterMitarbeiter && !!kenntnisEintrag
      const verfallen = kenntnisEintrag ? tageSeit(kenntnisEintrag.zuletzt_befahren) > VERFALL_TAGE : false

      let farbe = '#64748b'
      if (ausgewaehlterMitarbeiter) {
        farbe = bekannt ? (verfallen ? '#f59e0b' : '#16a34a') : '#94a3b8'
      }
      if (ausgewaehlteStrecke === strecke.id) farbe = '#14325c'

      const linie = L.polyline(strecke.punkte, {
        color: farbe,
        weight: ausgewaehlteStrecke === strecke.id ? 6 : 4,
        opacity: 0.85,
      })
        .bindTooltip(strecke.name, { sticky: true })
        .on('click', (e) => {
          L.DomEvent.stopPropagation(e)
          setAusgewaehlteStrecke(strecke.id)
        })
        .addTo(karte)

      linienRef.current.set(strecke.id, linie)
    })
  }, [strecken, kenntnisse, ausgewaehlterMitarbeiter, ausgewaehlteStrecke])

  useEffect(() => {
    const karte = kartenInstanz.current
    if (!karte) return

    neuePunkteMarkerRef.current.forEach((m) => m.remove())
    neuePunkteMarkerRef.current = []
    if (neuePunkteLinieRef.current) {
      neuePunkteLinieRef.current.remove()
      neuePunkteLinieRef.current = null
    }

    if (neuePunkte.length > 0) {
      neuePunkte.forEach((punkt) => {
        const marker = L.circleMarker(punkt, { radius: 5, color: '#dc2626', fillOpacity: 1 }).addTo(karte)
        neuePunkteMarkerRef.current.push(marker)
      })
    }
    if (neuePunkte.length > 1) {
      neuePunkteLinieRef.current = L.polyline(neuePunkte, { color: '#dc2626', weight: 3, dashArray: '6 6' }).addTo(karte)
    }
  }, [neuePunkte])

  function zeichnenStarten() {
    setZeichenModus(true)
    setNeuePunkte([])
    setNeuerStreckenName('')
  }

  function zeichnenAbbrechen() {
    setZeichenModus(false)
    setNeuePunkte([])
    setNeuerStreckenName('')
  }

  async function streckeSpeichern() {
    if (neuePunkte.length < 2 || !neuerStreckenName.trim()) return
    await supabase.from('strecken').insert({
      name: neuerStreckenName.trim(),
      punkte: neuePunkte,
    })
    zeichnenAbbrechen()
    await laden()
  }

  async function befahrungEintragen(mitarbeiterId?: string, streckeId?: string) {
    const m = mitarbeiterId ?? ausgewaehlterMitarbeiter
    const s = streckeId ?? ausgewaehlteStrecke
    if (!m || !s) return
    const heute = new Date().toISOString().slice(0, 10)

    await supabase
      .from('streckenkenntnis')
      .upsert(
        { mitarbeiter_id: m, strecke_id: s, zuletzt_befahren: heute },
        { onConflict: 'mitarbeiter_id,strecke_id' }
      )
    await laden()
  }

  const kenntnisseDesMitarbeiters = kenntnisse.filter((k) => k.mitarbeiter_id === ausgewaehlterMitarbeiter)
  const ausgewaehlteStreckeName = strecken.find((s) => s.id === ausgewaehlteStrecke)?.name

  const streckenSortiert = [...strecken].sort(
    (a, b) => streckennummerSortWert(a.streckennummer) - streckennummerSortWert(b.streckennummer)
  )

  function kenntnisFuer(mitarbeiterId: string, streckeId: string) {
    return kenntnisse.find((k) => k.mitarbeiter_id === mitarbeiterId && k.strecke_id === streckeId)
  }

  function zellFarbe(eintrag: Kenntnis | undefined) {
    if (!eintrag) return null
    return tageSeit(eintrag.zuletzt_befahren) > VERFALL_TAGE ? '#fed7aa' : '#dcfce7'
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <select
          value={ausgewaehlterMitarbeiter}
          onChange={(e) => setAusgewaehlterMitarbeiter(e.target.value)}
          style={eingabeStil}
        >
          <option value="">Lokführer auswählen...</option>
          {mitarbeiterListe.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>

        {!zeichenModus ? (
          <button onClick={zeichnenStarten} style={sekundaerKnopfStil}>
            + Neue Strecke einzeichnen
          </button>
        ) : (
          <span style={{ fontSize: 13, color: 'var(--warning)', fontWeight: 500 }}>
            Zeichenmodus aktiv - klicke Punkte entlang der Strecke auf der Karte
          </span>
        )}
      </div>

      {zeichenModus && (
        <div
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            marginBottom: 12,
            background: '#fef3c7',
            padding: 10,
            borderRadius: 6,
          }}
        >
          <input
            placeholder="Name der Strecke"
            value={neuerStreckenName}
            onChange={(e) => setNeuerStreckenName(e.target.value)}
            style={{ ...eingabeStil, flex: 1 }}
          />
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{neuePunkte.length} Punkte gesetzt</span>
          <button
            onClick={streckeSpeichern}
            disabled={neuePunkte.length < 2 || !neuerStreckenName.trim()}
            style={primaerKnopfStil}
          >
            Speichern
          </button>
          <button onClick={zeichnenAbbrechen} style={sekundaerKnopfStil}>
            Abbrechen
          </button>
        </div>
      )}

      <div
        ref={kartenRef}
        style={{ height: 500, borderRadius: 8, border: '1px solid var(--border)' }}
      />

      {ausgewaehlteStrecke && (
        <div
          style={{
            marginTop: 12,
            padding: 12,
            background: '#f8fafc',
            border: '1px solid var(--border)',
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 8,
          }}
        >
          <div>
            <strong>{ausgewaehlteStreckeName}</strong>
            {ausgewaehlterMitarbeiter && (
              <span style={{ marginLeft: 8, fontSize: 13, color: 'var(--text-muted)' }}>
                {(() => {
                  const eintrag = kenntnisseDesMitarbeiters.find((k) => k.strecke_id === ausgewaehlteStrecke)
                  if (!eintrag) return 'Noch nicht befahren'
                  const tage = tageSeit(eintrag.zuletzt_befahren)
                  return tage > VERFALL_TAGE
                    ? `Verfallen (zuletzt vor ${tage} Tagen)`
                    : `Zuletzt vor ${tage} Tagen befahren`
                })()}
              </span>
            )}
          </div>
          {ausgewaehlterMitarbeiter && (
            <button onClick={() => befahrungEintragen()} style={primaerKnopfStil}>
              Heute als befahren eintragen
            </button>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 12, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
        <span><span style={legendenPunktStil('#16a34a')} /> Aktuell bekannt</span>
        <span><span style={legendenPunktStil('#f59e0b')} /> Verfallen (&gt;{VERFALL_TAGE} Tage)</span>
        <span><span style={legendenPunktStil('#94a3b8')} /> Nicht befahren</span>
      </div>

      {mitarbeiterListe.length > 0 && (
        <div style={{ marginTop: 28 }}>
          <h4 style={{ marginBottom: 4 }}>Streckenkenntnis-Matrix</h4>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 0, marginBottom: 10 }}>
            Klick auf eine Zelle wählt Lokführer + Strecke oben aus. Grün = aktuell bekannt, Orange =
            verfallen, leer = noch nicht befahren.
          </p>

          <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
            <table style={{ borderCollapse: 'separate', borderSpacing: 0, fontSize: 11, width: '100%' }}>
              <thead>
                <tr>
                  <th
                    style={{
                      position: 'sticky',
                      left: 0,
                      top: 0,
                      background: 'var(--card)',
                      zIndex: 3,
                      padding: '6px 10px',
                      textAlign: 'left',
                      borderBottom: '1px solid var(--border)',
                      borderRight: '1px solid var(--border)',
                      minWidth: 150,
                    }}
                  >
                    Lokführer
                  </th>
                  {streckenSortiert.map((s) => (
                    <th
                      key={s.id}
                      title={s.name}
                      style={{
                        padding: '4px 2px',
                        borderBottom: '1px solid var(--border)',
                        color: 'var(--text-muted)',
                        fontWeight: 500,
                        minWidth: 26,
                        writingMode: 'vertical-rl',
                        textOrientation: 'mixed',
                        height: 60,
                      }}
                    >
                      {s.streckennummer ?? '–'}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {mitarbeiterListe.map((mitarbeiter, index) => (
                  <tr key={mitarbeiter.id}>
                    <td
                      style={{
                        position: 'sticky',
                        left: 0,
                        background: index % 2 === 0 ? 'var(--card)' : 'var(--bg)',
                        zIndex: 1,
                        padding: '4px 10px',
                        borderRight: '1px solid var(--border)',
                        borderBottom: '1px solid var(--border)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {mitarbeiter.name}
                    </td>
                    {streckenSortiert.map((s) => {
                      const eintrag = kenntnisFuer(mitarbeiter.id, s.id)
                      const farbe = zellFarbe(eintrag)
                      return (
                        <td
                          key={s.id}
                          title={
                            eintrag
                              ? `${s.name}: vor ${tageSeit(eintrag.zuletzt_befahren)} Tagen befahren`
                              : `${s.name}: noch nicht befahren`
                          }
                          onClick={() => {
                            setAusgewaehlterMitarbeiter(mitarbeiter.id)
                            setAusgewaehlteStrecke(s.id)
                          }}
                          style={{
                            borderBottom: '1px solid var(--border)',
                            background: farbe ?? (index % 2 === 0 ? 'var(--card)' : 'var(--bg)'),
                            height: 22,
                            cursor: 'pointer',
                            outline:
                              ausgewaehlterMitarbeiter === mitarbeiter.id && ausgewaehlteStrecke === s.id
                                ? '2px solid var(--navy)'
                                : 'none',
                            outlineOffset: -2,
                          }}
                        />
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

const eingabeStil: React.CSSProperties = {
  padding: '8px 10px',
  border: '1px solid var(--border)',
  borderRadius: 6,
  fontSize: 14,
}

const primaerKnopfStil: React.CSSProperties = {
  background: 'var(--navy)',
  color: '#ffffff',
  border: 'none',
  borderRadius: 6,
  padding: '8px 14px',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
}

const sekundaerKnopfStil: React.CSSProperties = {
  background: 'none',
  border: '1px solid var(--border)',
  color: 'var(--navy)',
  borderRadius: 6,
  padding: '8px 14px',
  fontSize: 13,
  cursor: 'pointer',
}

function legendenPunktStil(farbe: string): React.CSSProperties {
  return {
    display: 'inline-block',
    width: 10,
    height: 10,
    borderRadius: '50%',
    background: farbe,
    marginRight: 4,
  }
}
