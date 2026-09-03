import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { supabase } from './lib/supabase'
import { namensSignatur } from './namensAbgleich'

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

  // Karte einmalig initialisieren
  useEffect(() => {
    if (!kartenRef.current || kartenInstanz.current) return

    const karte = L.map(kartenRef.current).setView([49.0, 11.5], 7)

    L.tileLayer('https://{s}.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png', {
      attribution:
        'Kartendaten: © OpenStreetMap-Mitwirkende, Style: © OpenRailwayMap (CC-BY-SA 2.0)',
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

  // Vorhandene Strecken als Linien zeichnen
  useEffect(() => {
    const karte = kartenInstanz.current
    if (!karte) return

    linienRef.current.forEach((linie) => linie.remove())
    linienRef.current.clear()

    strecken.forEach((strecke) => {
      if (!strecke.punkte || strecke.punkte.length < 2) return

      const bekannt =
        !!ausgewaehlterMitarbeiter &&
        kenntnisse.some(
          (k) => k.mitarbeiter_id === ausgewaehlterMitarbeiter && k.strecke_id === strecke.id
        )
      const kenntnisEintrag = kenntnisse.find(
        (k) => k.mitarbeiter_id === ausgewaehlterMitarbeiter && k.strecke_id === strecke.id
      )
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

  // Punkte beim Zeichnen einer neuen Strecke visualisieren
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

  async function befahrungEintragen() {
    if (!ausgewaehlterMitarbeiter || !ausgewaehlteStrecke) return
    const heute = new Date().toISOString().slice(0, 10)

    await supabase
      .from('streckenkenntnis')
      .upsert(
        { mitarbeiter_id: ausgewaehlterMitarbeiter, strecke_id: ausgewaehlteStrecke, zuletzt_befahren: heute },
        { onConflict: 'mitarbeiter_id,strecke_id' }
      )
    await laden()
  }

  const kenntnisseDesMitarbeiters = kenntnisse.filter((k) => k.mitarbeiter_id === ausgewaehlterMitarbeiter)
  const ausgewaehlteStreckeName = strecken.find((s) => s.id === ausgewaehlteStrecke)?.name

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
            <button onClick={befahrungEintragen} style={primaerKnopfStil}>
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

      {ausgewaehlterMitarbeiter && (
        <div style={{ marginTop: 24 }}>
          <h4 style={{ marginBottom: 8 }}>Übersicht Streckenkenntnis</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {strecken
              .filter((s) => kenntnisseDesMitarbeiters.some((k) => k.strecke_id === s.id))
              .map((s) => {
                const eintrag = kenntnisseDesMitarbeiters.find((k) => k.strecke_id === s.id)!
                const tage = tageSeit(eintrag.zuletzt_befahren)
                const verfallen = tage > VERFALL_TAGE
                return (
                  <div
                    key={s.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      padding: '6px 10px',
                      background: verfallen ? '#fef3c7' : '#f0fdf4',
                      borderRadius: 6,
                      fontSize: 13,
                    }}
                  >
                    <span>{s.name}</span>
                    <span style={{ color: verfallen ? 'var(--warning)' : 'var(--success)' }}>
                      {verfallen ? `Verfallen (${tage} Tage)` : `vor ${tage} Tagen`}
                    </span>
                  </div>
                )
              })}
            {kenntnisseDesMitarbeiters.length === 0 && (
              <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                Noch keine Streckenkenntnis erfasst - Strecke auf der Karte anklicken und "Heute als
                befahren eintragen".
              </p>
            )}
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
