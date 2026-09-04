import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { supabase } from './lib/supabase'
import { useAktuellerMitarbeiter } from './useAktuellerMitarbeiter'
import { routeUeberMehrereStationen } from './streckenRouting'

const VERFALL_TAGE = 180 // Streckenkenntnis gilt 6 Monate ohne Befahrung als verfallen

interface AnkerStation {
  name: string
  lat: number
  lon: number
}

interface Strecke {
  id: string
  name: string
  streckennummer: string | null
  punkte: [number, number][] | null
  anker_punkte: [number, number][] | null
  anker_stationen: AnkerStation[] | null
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
  bis_index: number | null
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

function naechsterPunktIndex(punkte: [number, number][], klick: L.LatLng): number {
  let besterIndex = 0
  let besteDistanz = Infinity
  punkte.forEach((p, i) => {
    const d = Math.hypot(p[0] - klick.lat, p[1] - klick.lng)
    if (d < besteDistanz) {
      besteDistanz = d
      besterIndex = i
    }
  })
  return besterIndex
}

export default function Streckenkunde() {
  const { mitarbeiter: eigenerMitarbeiter, istAdmin } = useAktuellerMitarbeiter()
  const kartenRef = useRef<HTMLDivElement>(null)
  const kartenInstanz = useRef<L.Map | null>(null)
  const linienRef = useRef<Map<string, L.LayerGroup>>(new Map())

  const [strecken, setStrecken] = useState<Strecke[]>([])
  const [mitarbeiterListe, setMitarbeiterListe] = useState<Mitarbeiter[]>([])
  const [kenntnisse, setKenntnisse] = useState<Kenntnis[]>([])
  const [ausgewaehlterMitarbeiter, setAusgewaehlterMitarbeiter] = useState<string>('')
  const [ausgewaehlteStrecke, setAusgewaehlteStrecke] = useState<string | null>(null)

  const [zeichenModus, setZeichenModus] = useState(false)
  const [streckenSuche, setStreckenSuche] = useState('')
  const [routingLaeuft, setRoutingLaeuft] = useState<string | null>(null)
  const [routingFehler, setRoutingFehler] = useState<string | null>(null)
  const [batchLaeuft, setBatchLaeuft] = useState(false)
  const [batchAbbrechenAngefragt, setBatchAbbrechen] = useState(false)
  const [batchFortschritt, setBatchFortschritt] = useState<{ erledigt: number; gesamt: number } | null>(null)
  const batchAbbrechenRef = useRef(false)
  const [neuePunkte, setNeuePunkte] = useState<[number, number][]>([])
  const [neuerStreckenName, setNeuerStreckenName] = useState('')
  const neuePunkteLinieRef = useRef<L.Polyline | null>(null)
  const neuePunkteMarkerRef = useRef<L.CircleMarker[]>([])

  async function laden() {
    const [{ data: streckenData }, { data: mitarbeiterData }, { data: kenntnisData }] =
      await Promise.all([
        supabase.from('strecken').select('id, name, streckennummer, punkte, anker_punkte, anker_stationen').order('name'),
        supabase.from('mitarbeiter').select('id, name, kategorie').eq('kategorie', 'Lokführer').order('name'),
        supabase.from('streckenkenntnis').select('mitarbeiter_id, strecke_id, zuletzt_befahren, bis_index'),
      ])
    setStrecken(streckenData ?? [])
    setMitarbeiterListe(mitarbeiterData ?? [])
    setKenntnisse(kenntnisData ?? [])
  }

  useEffect(() => {
    laden()
  }, [])

  useEffect(() => {
    if (!eigenerMitarbeiter) return
    setAusgewaehlterMitarbeiter(eigenerMitarbeiter.id)
  }, [eigenerMitarbeiter])

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
      const istAusgewaehlt = ausgewaehlteStrecke === strecke.id

      const farbeBekannt = verfallen ? '#7c3aed' : '#db2777'
      const farbeUnbekannt = '#2563eb'
      const farbeAusgewaehlt = '#facc15'

      // Weisser Rand darunter fuer klare Sichtbarkeit gegen die OpenRailwayMap-Kacheln
      const rand = L.polyline(strecke.punkte, {
        color: '#ffffff',
        weight: istAusgewaehlt ? 12 : 9,
        opacity: 0.9,
      }).addTo(karte)

      function beiKlick(e: L.LeafletMouseEvent) {
        L.DomEvent.stopPropagation(e)
        setAusgewaehlteStrecke(strecke.id)
        setStreckenSuche(strecke.streckennummer ?? strecke.name)
        if (ausgewaehlterMitarbeiter && strecke.punkte) {
          const index = naechsterPunktIndex(strecke.punkte, e.latlng)
          befahrungEintragen(ausgewaehlterMitarbeiter, strecke.id, index)
        }
      }
      rand.on('click', beiKlick)

      const teilweise =
        bekannt &&
        kenntnisEintrag?.bis_index != null &&
        kenntnisEintrag.bis_index < strecke.punkte.length - 1

      const linien: L.Polyline[] = []

      if (istAusgewaehlt) {
        linien.push(
          L.polyline(strecke.punkte, { color: farbeAusgewaehlt, weight: 7, opacity: 1 })
            .bindTooltip(strecke.name, { sticky: true })
            .on('click', beiKlick)
            .addTo(karte)
        )
      } else if (teilweise && kenntnisEintrag) {
        const grenzIndex = kenntnisEintrag.bis_index as number
        const bekannterTeil = strecke.punkte.slice(0, grenzIndex + 1)
        const restTeil = strecke.punkte.slice(grenzIndex)
        linien.push(
          L.polyline(bekannterTeil, { color: farbeBekannt, weight: 5, opacity: 1 })
            .bindTooltip(`${strecke.name} (teilweise bekannt)`, { sticky: true })
            .on('click', beiKlick)
            .addTo(karte)
        )
        linien.push(
          L.polyline(restTeil, { color: farbeUnbekannt, weight: 5, opacity: 1, dashArray: '4 6' })
            .bindTooltip(strecke.name, { sticky: true })
            .on('click', beiKlick)
            .addTo(karte)
        )
      } else {
        const farbe = ausgewaehlterMitarbeiter ? (bekannt ? farbeBekannt : farbeUnbekannt) : farbeUnbekannt
        linien.push(
          L.polyline(strecke.punkte, { color: farbe, weight: 5, opacity: 1 })
            .bindTooltip(strecke.name, { sticky: true })
            .on('click', beiKlick)
            .addTo(karte)
        )
      }

      const marker: L.CircleMarker[] = []
      if (ausgewaehlterMitarbeiter && strecke.anker_stationen && strecke.punkte) {
        for (const station of strecke.anker_stationen) {
          const index = naechsterPunktIndex(strecke.punkte, L.latLng(station.lat, station.lon))
          const bereitsBekanntBis =
            kenntnisEintrag?.bis_index != null ? kenntnisEintrag.bis_index >= index : bekannt

          const punkt = L.circleMarker(strecke.punkte[index], {
            radius: istAusgewaehlt ? 6 : 5,
            color: '#ffffff',
            weight: 2,
            fillColor: bereitsBekanntBis ? farbeBekannt : '#94a3b8',
            fillOpacity: 1,
          })
            .bindTooltip(station.name, { permanent: false, direction: 'top' })
            .on('click', (e) => {
              L.DomEvent.stopPropagation(e)
              setAusgewaehlteStrecke(strecke.id)
              setStreckenSuche(strecke.streckennummer ?? strecke.name)
              befahrungEintragen(ausgewaehlterMitarbeiter, strecke.id, index)
            })
            .addTo(karte)
          marker.push(punkt)
        }
      }

      linienRef.current.set(strecke.id, L.layerGroup([rand, ...linien, ...marker]))
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

  async function befahrungEintragen(mitarbeiterId?: string, streckeId?: string, bisIndex?: number | null) {
    const m = mitarbeiterId ?? ausgewaehlterMitarbeiter
    const s = streckeId ?? ausgewaehlteStrecke
    if (!m || !s) return
    const heute = new Date().toISOString().slice(0, 10)

    const vorhandenerEintrag = kenntnisFuer(m, s)
    const neuerBisIndex = bisIndex !== undefined ? bisIndex : vorhandenerEintrag?.bis_index ?? null

    await supabase
      .from('streckenkenntnis')
      .upsert(
        { mitarbeiter_id: m, strecke_id: s, zuletzt_befahren: heute, bis_index: neuerBisIndex },
        { onConflict: 'mitarbeiter_id,strecke_id' }
      )
    await laden()
  }

  async function wissenEntfernen(mitarbeiterId: string, streckeId: string) {
    await supabase
      .from('streckenkenntnis')
      .delete()
      .eq('mitarbeiter_id', mitarbeiterId)
      .eq('strecke_id', streckeId)
    await laden()
  }

  async function osmRouteLaden(strecke: Strecke) {
    if (!strecke.anker_punkte || strecke.anker_punkte.length < 2) return
    setRoutingLaeuft(strecke.id)
    setRoutingFehler(null)
    try {
      const route = await routeUeberMehrereStationen(strecke.anker_punkte)
      if (!route) {
        setRoutingFehler(`Keine Route gefunden für "${strecke.name}". Manuell einzeichnen nötig.`)
        return
      }
      await supabase.from('strecken').update({ punkte: route }).eq('id', strecke.id)
      await laden()
    } catch (err) {
      setRoutingFehler('Fehler bei der OSM-Abfrage: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setRoutingLaeuft(null)
    }
  }

  function warten(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  async function alleFehlendenLaden() {
    const zuLaden = strecken.filter(
      (s) => !s.punkte && s.anker_punkte && s.anker_punkte.length >= 2
    )
    if (zuLaden.length === 0) return

    setBatchLaeuft(true)
    setBatchAbbrechen(false)
    batchAbbrechenRef.current = false
    setBatchFortschritt({ erledigt: 0, gesamt: zuLaden.length })
    setRoutingFehler(null)

    let erfolgreich = 0
    let fehlgeschlagen = 0

    for (let i = 0; i < zuLaden.length; i++) {
      if (batchAbbrechenRef.current) break

      const strecke = zuLaden[i]
      setRoutingLaeuft(strecke.id)
      try {
        const route = await routeUeberMehrereStationen(strecke.anker_punkte!)
        if (route) {
          await supabase.from('strecken').update({ punkte: route }).eq('id', strecke.id)
          erfolgreich++
        } else {
          fehlgeschlagen++
        }
      } catch {
        fehlgeschlagen++
      }
      setBatchFortschritt({ erledigt: i + 1, gesamt: zuLaden.length })

      // Bewusste Pause zwischen Anfragen, um die kostenlose Overpass-API fair zu nutzen
      if (i < zuLaden.length - 1 && !batchAbbrechenRef.current) {
        await warten(3000)
      }
    }

    setRoutingLaeuft(null)
    setBatchLaeuft(false)
    setRoutingFehler(
      `Batch-Import fertig: ${erfolgreich} erfolgreich, ${fehlgeschlagen} ohne Route gefunden.`
    )
    await laden()
  }

  function batchAbbrechen() {
    batchAbbrechenRef.current = true
    setBatchAbbrechen(true)
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
        {istAdmin ? (
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
        ) : (
          <div style={{ fontWeight: 600, fontSize: 15 }}>
            {eigenerMitarbeiter?.name ?? 'Meine Strecken'}
          </div>
        )}

        {istAdmin && !zeichenModus && (
          <button onClick={zeichnenStarten} style={sekundaerKnopfStil}>
            + Neue Strecke einzeichnen
          </button>
        )}
        {istAdmin && zeichenModus && (
          <span style={{ fontSize: 13, color: 'var(--warning)', fontWeight: 500 }}>
            Zeichenmodus aktiv - klicke Punkte entlang der Strecke auf der Karte
          </span>
        )}
      </div>

      {!zeichenModus && (
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: -4, marginBottom: 10 }}>
          Klick auf eine eingezeichnete Strecke auf der Karte trägt sie sofort als "heute befahren"
          ein - die Liste unten aktualisiert sich automatisch.
        </p>
      )}

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
                  const ausgewaehlteStreckeDaten = strecken.find((s) => s.id === ausgewaehlteStrecke)
                  const teilInfo =
                    eintrag.bis_index != null &&
                    ausgewaehlteStreckeDaten?.punkte &&
                    eintrag.bis_index < ausgewaehlteStreckeDaten.punkte.length - 1
                      ? ` - teilweise bekannt (bis ca. ${Math.round(
                          ((eintrag.bis_index + 1) / ausgewaehlteStreckeDaten.punkte.length) * 100
                        )}%)`
                      : ''
                  return (
                    (tage > VERFALL_TAGE
                      ? `Verfallen (zuletzt vor ${tage} Tagen)`
                      : `Zuletzt vor ${tage} Tagen befahren`) + teilInfo
                  )
                })()}
              </span>
            )}
          </div>
          {ausgewaehlterMitarbeiter && (
            <button onClick={() => befahrungEintragen()} style={primaerKnopfStil}>
              Heute erneut bestätigen
            </button>
          )}
        </div>
      )}

      {ausgewaehlterMitarbeiter && (
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
          Tipp: Auf den Strecken erscheinen kleine Punkte an den bekannten Bahnhöfen (Name beim
          Draufhalten sichtbar). Klick auf einen Bahnhofs-Punkt trägt "kundig bis genau hierher" ein –
          präziser als ein Klick irgendwo auf die Linie.
        </p>
      )}

      <div style={{ display: 'flex', gap: 16, marginTop: 12, fontSize: 12, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
        <span><span style={legendenPunktStil('#db2777')} /> Aktuell bekannt</span>
        <span><span style={legendenPunktStil('#7c3aed')} /> Verfallen (&gt;{VERFALL_TAGE} Tage)</span>
        <span><span style={legendenPunktStil('#2563eb')} /> Nicht befahren</span>
        <span style={{ color: 'var(--text-muted)' }}>· · · Gestrichelt = unbekannter Rest bei Teilstrecken</span>
      </div>

      {ausgewaehlterMitarbeiter && (
        <div style={{ marginTop: 28 }}>
          <style>{`
            .strecken-zeile:hover { background: #eef2f7 !important; }
          `}</style>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              marginBottom: 4,
              flexWrap: 'wrap',
              gap: 8,
            }}
          >
            <h4 style={{ margin: 0 }}>
              {istAdmin ? 'Strecken auswählen' : 'Meine Strecken auswählen'}
            </h4>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {kenntnisseDesMitarbeiters.length} von {strecken.length} Strecken bekannt
            </span>
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 0, marginBottom: 12 }}>
            Haken setzen bei jeder Strecke, die {istAdmin ? 'diese Person' : 'du'} fahren kann/kennt -
            funktioniert auch für Strecken, die noch nicht auf der Karte eingezeichnet sind.
          </p>

          {istAdmin && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                marginBottom: 12,
                flexWrap: 'wrap',
              }}
            >
              {!batchLaeuft ? (
                <button
                  onClick={alleFehlendenLaden}
                  style={{ ...sekundaerKnopfStil, borderColor: 'var(--navy)' }}
                >
                  🛰️ Alle fehlenden Strecken von OSM laden (mit Pause)
                </button>
              ) : (
                <>
                  <span style={{ fontSize: 13, color: 'var(--navy)' }}>
                    Lädt {batchFortschritt?.erledigt} von {batchFortschritt?.gesamt}...
                  </span>
                  <button onClick={batchAbbrechen} disabled={batchAbbrechenAngefragt} style={aktualisierenKnopfStil}>
                    {batchAbbrechenAngefragt ? 'Wird gestoppt...' : 'Abbrechen'}
                  </button>
                </>
              )}
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                (ca. 3 Sek. Pause pro Strecke, um die kostenlose OSM-API fair zu nutzen)
              </span>
            </div>
          )}

          <div style={{ position: 'relative', marginBottom: 12 }}>
            <span
              style={{
                position: 'absolute',
                left: 12,
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--text-muted)',
                fontSize: 14,
                pointerEvents: 'none',
              }}
            >
              🔍
            </span>
            <input
              placeholder="Strecke suchen (Name oder Nummer)..."
              value={streckenSuche}
              onChange={(e) => setStreckenSuche(e.target.value)}
              style={{
                ...eingabeStil,
                width: '100%',
                paddingLeft: 34,
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div
            style={{
              maxHeight: 340,
              overflowY: 'auto',
              border: '1px solid var(--border)',
              borderRadius: 10,
              boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
            }}
          >
            {streckenSortiert
              .filter((s) => {
                const suchtext = streckenSuche.trim().toLowerCase()
                if (!suchtext) return true
                return (
                  s.name.toLowerCase().includes(suchtext) ||
                  (s.streckennummer ?? '').toLowerCase().includes(suchtext)
                )
              })
              .map((s, index, gefiltert) => {
                const eintrag = kenntnisFuer(ausgewaehlterMitarbeiter, s.id)
                const verfallen = eintrag ? tageSeit(eintrag.zuletzt_befahren) > VERFALL_TAGE : false
                const istLetzte = index === gefiltert.length - 1
                return (
                  <div
                    key={s.id}
                    className="strecken-zeile"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 10,
                      padding: '9px 14px',
                      background: eintrag
                        ? verfallen
                          ? '#faf5ff'
                          : '#fdf2f8'
                        : index % 2 === 0
                        ? 'var(--card)'
                        : 'var(--bg)',
                      borderBottom: istLetzte ? 'none' : '1px solid var(--border)',
                      fontSize: 13,
                      transition: 'background 0.1s',
                    }}
                  >
                    <label
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        cursor: 'pointer',
                        flex: 1,
                        minWidth: 0,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={!!eintrag}
                        onChange={(e) =>
                          e.target.checked
                            ? befahrungEintragen(ausgewaehlterMitarbeiter, s.id, null)
                            : wissenEntfernen(ausgewaehlterMitarbeiter, s.id)
                        }
                        style={{ flexShrink: 0, cursor: 'pointer' }}
                      />
                      <span
                        style={{
                          background: '#e2e8f0',
                          color: 'var(--text-muted)',
                          fontSize: 11,
                          fontWeight: 600,
                          padding: '2px 7px',
                          borderRadius: 5,
                          flexShrink: 0,
                          minWidth: 30,
                          textAlign: 'center',
                        }}
                      >
                        {s.streckennummer ?? '–'}
                      </span>
                      <span
                        title={s.name}
                        style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          minWidth: 0,
                        }}
                      >
                        {s.name}
                      </span>
                    </label>

                    {istAdmin && !s.punkte && s.anker_punkte && s.anker_punkte.length >= 2 && (
                      <button
                        onClick={() => osmRouteLaden(s)}
                        disabled={routingLaeuft === s.id || batchLaeuft}
                        style={{ ...aktualisierenKnopfStil, borderColor: 'var(--navy)', color: 'var(--navy)', marginRight: 8 }}
                      >
                        {routingLaeuft === s.id ? 'Lädt...' : '🛰️ OSM-Route laden'}
                      </button>
                    )}

                    {eintrag && (
                      <span
                        style={{
                          fontSize: 12,
                          color: verfallen ? 'var(--warning)' : 'var(--success)',
                          whiteSpace: 'nowrap',
                          marginLeft: 8,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          flexShrink: 0,
                        }}
                      >
                        {verfallen
                          ? `Verfallen (${tageSeit(eintrag.zuletzt_befahren)} Tage)`
                          : `vor ${tageSeit(eintrag.zuletzt_befahren)} Tagen`}
                        {eintrag.bis_index != null && s.punkte && eintrag.bis_index < s.punkte.length - 1 && (
                          <span style={{ color: 'var(--text-muted)' }}>
                            {' '}
                            (bis ca. {Math.round(((eintrag.bis_index + 1) / s.punkte.length) * 100)}%)
                          </span>
                        )}
                        {verfallen && (
                          <button
                            onClick={() => befahrungEintragen(ausgewaehlterMitarbeiter, s.id)}
                            style={{ ...aktualisierenKnopfStil, marginLeft: 6 }}
                          >
                            Heute bestätigen
                          </button>
                        )}
                      </span>
                    )}
                  </div>
                )
              })}
          </div>
          {routingFehler && (
            <p style={{ color: 'var(--danger)', fontSize: 12, marginTop: 8 }}>{routingFehler}</p>
          )}
        </div>
      )}

      {istAdmin && mitarbeiterListe.length > 0 && (
        <div style={{ marginTop: 28 }}>
          <style>{`
            .matrix-zeile:hover td { background: #eef2f7 !important; }
          `}</style>

          <h4 style={{ marginBottom: 4 }}>Streckenkenntnis-Matrix</h4>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 0, marginBottom: 10 }}>
            Klick auf eine Zelle wählt Lokführer + Strecke oben aus. Grün = aktuell bekannt, Orange =
            verfallen, leer = noch nicht befahren.
          </p>

          <div
            style={{
              overflow: 'auto',
              border: '1px solid var(--border)',
              borderRadius: 10,
              boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
              maxHeight: 480,
            }}
          >
            <table style={{ borderCollapse: 'separate', borderSpacing: 0, fontSize: 11, width: '100%' }}>
              <thead>
                <tr>
                  <th
                    style={{
                      position: 'sticky',
                      left: 0,
                      top: 0,
                      background: '#f1f5f9',
                      zIndex: 3,
                      padding: '8px 10px',
                      textAlign: 'left',
                      borderBottom: '1px solid var(--border)',
                      borderRight: '1px solid var(--border)',
                      minWidth: 150,
                      color: 'var(--navy)',
                      fontWeight: 600,
                    }}
                  >
                    Lokführer
                  </th>
                  {streckenSortiert.map((s) => (
                    <th
                      key={s.id}
                      title={s.name}
                      style={{
                        position: 'sticky',
                        top: 0,
                        padding: '4px 2px',
                        background: '#f1f5f9',
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
                  <tr key={mitarbeiter.id} className="matrix-zeile">
                    <td
                      style={{
                        position: 'sticky',
                        left: 0,
                        background: index % 2 === 0 ? 'var(--card)' : 'var(--bg)',
                        zIndex: 1,
                        padding: '5px 10px',
                        borderRight: '1px solid var(--border)',
                        borderBottom: '1px solid var(--border)',
                        whiteSpace: 'nowrap',
                        fontWeight: 500,
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
                            height: 24,
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

const aktualisierenKnopfStil: React.CSSProperties = {
  background: 'none',
  border: '1px solid var(--warning)',
  color: 'var(--warning)',
  borderRadius: 4,
  padding: '2px 6px',
  fontSize: 11,
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
