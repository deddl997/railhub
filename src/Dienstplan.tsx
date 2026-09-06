import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import { datumZuISO } from './datumUtils'

interface Mitarbeiter {
  id: string
  name: string
}

interface Schichtvorlage {
  id: string
  name: string
  beginn_zeit: string
  ende_zeit: string
  pause_minuten: number | null
  pause_von: string | null
  pause_bis: string | null
  dienstort: string | null
  farbe: string
  aktiv: boolean
}

interface DienstplanEintrag {
  id: string
  mitarbeiter_id: string
  datum: string
  schichtvorlage_id: string | null
  ist_spotschicht: boolean
  spot_name: string | null
  spot_beginn_zeit: string | null
  spot_ende_zeit: string | null
  spot_pause_minuten: number | null
  spot_dienstort: string | null
  spot_farbe: string | null
  status: string | null
}

interface UrlaubsBlock {
  mitarbeiter_id: string
  erster_tag: string
  letzter_tag: string
}

const WOCHENTAGE = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag']

function montagDerWoche(datum: Date): Date {
  const tag = datum.getDay()
  const differenz = tag === 0 ? -6 : 1 - tag
  const montag = new Date(datum)
  montag.setDate(datum.getDate() + differenz)
  montag.setHours(0, 0, 0, 0)
  return montag
}

function datumKurz(datum: Date): string {
  const tag = String(datum.getDate()).padStart(2, '0')
  const monat = String(datum.getMonth() + 1).padStart(2, '0')
  const jahr = String(datum.getFullYear()).slice(2)
  return `${tag}.${monat}.${jahr}`
}

function zeitKurz(zeit: string | null): string {
  return zeit ? zeit.slice(0, 5) : ''
}

function schichtDauerMinuten(beginn: string, ende: string, pauseMinuten: number): number {
  const [bh, bm] = beginn.split(':').map(Number)
  const [eh, em] = ende.split(':').map(Number)
  const start = bh * 60 + bm
  let end = eh * 60 + em
  if (end <= start) end += 24 * 60
  return end - start - pauseMinuten
}

function minutenAlsText(minuten: number): string {
  const stunden = Math.floor(minuten / 60)
  const rest = minuten % 60
  return `${stunden}:${String(rest).padStart(2, '0')}`
}

export default function Dienstplan() {
  const [wochenStart, setWochenStart] = useState(() => montagDerWoche(new Date()))
  const [mitarbeiterListe, setMitarbeiterListe] = useState<Mitarbeiter[]>([])
  const [vorlagen, setVorlagen] = useState<Schichtvorlage[]>([])
  const [eintraege, setEintraege] = useState<DienstplanEintrag[]>([])
  const [urlaube, setUrlaube] = useState<UrlaubsBlock[]>([])
  const [ladeVorgang, setLadeVorgang] = useState(true)

  const [ausgewaehlteZelle, setAusgewaehlteZelle] = useState<{ mitarbeiterId: string; datum: string } | null>(null)
  const [gewaehlteVorlage, setGewaehlteVorlage] = useState('')
  const [spotFormularOffen, setSpotFormularOffen] = useState(false)
  const [spotDaten, setSpotDaten] = useState({
    name: '',
    beginn_zeit: '06:00',
    ende_zeit: '18:00',
    pause_minuten: 0,
    dienstort: '',
    farbe: '#8b1a1a',
  })

  const tage = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(wochenStart)
    d.setDate(wochenStart.getDate() + i)
    return d
  })

  async function laden() {
    setLadeVorgang(true)
    const wochenEnde = tage[6]
    const startIso = datumZuISO(wochenStart)
    const endeIso = datumZuISO(wochenEnde)

    const [{ data: mitarbeiterData }, { data: vorlagenData }, { data: eintraegeData }, { data: urlaubeData }] =
      await Promise.all([
        supabase.from('mitarbeiter').select('id, name').order('name'),
        supabase.from('schichtvorlagen').select('*').eq('aktiv', true).order('name'),
        supabase
          .from('dienstplan_eintraege')
          .select('*')
          .gte('datum', startIso)
          .lte('datum', endeIso),
        supabase
          .from('urlaubsantraege')
          .select('mitarbeiter_id, erster_tag, letzter_tag')
          .eq('status', 'genehmigt')
          .lte('erster_tag', endeIso)
          .gte('letzter_tag', startIso),
      ])

    setMitarbeiterListe(mitarbeiterData ?? [])
    setVorlagen(vorlagenData ?? [])
    setEintraege(eintraegeData ?? [])
    setUrlaube((urlaubeData ?? []).filter((u) => u.mitarbeiter_id))
    setLadeVorgang(false)
  }

  useEffect(() => {
    laden()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wochenStart])

  function istUrlaub(mitarbeiterId: string, datumIso: string): boolean {
    return urlaube.some(
      (u) => u.mitarbeiter_id === mitarbeiterId && datumIso >= u.erster_tag && datumIso <= u.letzter_tag
    )
  }

  function eintragFuer(mitarbeiterId: string, datumIso: string): DienstplanEintrag | undefined {
    return eintraege.find((e) => e.mitarbeiter_id === mitarbeiterId && e.datum === datumIso)
  }

  function zelleOeffnen(mitarbeiterId: string, datumIso: string) {
    setAusgewaehlteZelle({ mitarbeiterId, datum: datumIso })
    setGewaehlteVorlage('')
    setSpotFormularOffen(false)
  }

  async function vorlageZuweisen() {
    if (!ausgewaehlteZelle || !gewaehlteVorlage) return
    await supabase.from('dienstplan_eintraege').upsert(
      {
        mitarbeiter_id: ausgewaehlteZelle.mitarbeiterId,
        datum: ausgewaehlteZelle.datum,
        schichtvorlage_id: gewaehlteVorlage,
        ist_spotschicht: false,
        status: null,
      },
      { onConflict: 'mitarbeiter_id,datum' }
    )
    setAusgewaehlteZelle(null)
    await laden()
  }

  async function spotschichtAnlegen() {
    if (!ausgewaehlteZelle || !spotDaten.name.trim()) return
    await supabase.from('dienstplan_eintraege').upsert(
      {
        mitarbeiter_id: ausgewaehlteZelle.mitarbeiterId,
        datum: ausgewaehlteZelle.datum,
        schichtvorlage_id: null,
        ist_spotschicht: true,
        spot_name: spotDaten.name,
        spot_beginn_zeit: spotDaten.beginn_zeit,
        spot_ende_zeit: spotDaten.ende_zeit,
        spot_pause_minuten: spotDaten.pause_minuten,
        spot_dienstort: spotDaten.dienstort,
        spot_farbe: spotDaten.farbe,
        status: null,
      },
      { onConflict: 'mitarbeiter_id,datum' }
    )
    setAusgewaehlteZelle(null)
    setSpotDaten({ name: '', beginn_zeit: '06:00', ende_zeit: '18:00', pause_minuten: 0, dienstort: '', farbe: '#8b1a1a' })
    await laden()
  }

  async function statusSetzen(status: 'ruhe' | 'frei') {
    if (!ausgewaehlteZelle) return
    await supabase.from('dienstplan_eintraege').upsert(
      {
        mitarbeiter_id: ausgewaehlteZelle.mitarbeiterId,
        datum: ausgewaehlteZelle.datum,
        schichtvorlage_id: null,
        ist_spotschicht: false,
        status,
      },
      { onConflict: 'mitarbeiter_id,datum' }
    )
    setAusgewaehlteZelle(null)
    await laden()
  }

  async function eintragLoeschen() {
    if (!ausgewaehlteZelle) return
    await supabase
      .from('dienstplan_eintraege')
      .delete()
      .eq('mitarbeiter_id', ausgewaehlteZelle.mitarbeiterId)
      .eq('datum', ausgewaehlteZelle.datum)
    setAusgewaehlteZelle(null)
    await laden()
  }

  function wochenArbeitszeit(mitarbeiterId: string): string {
    let summe = 0
    for (const tag of tage) {
      const datumIso = datumZuISO(tag)
      const eintrag = eintragFuer(mitarbeiterId, datumIso)
      if (!eintrag || eintrag.status) continue
      if (eintrag.ist_spotschicht && eintrag.spot_beginn_zeit && eintrag.spot_ende_zeit) {
        summe += schichtDauerMinuten(
          eintrag.spot_beginn_zeit,
          eintrag.spot_ende_zeit,
          eintrag.spot_pause_minuten ?? 0
        )
      } else if (eintrag.schichtvorlage_id) {
        const vorlage = vorlagen.find((v) => v.id === eintrag.schichtvorlage_id)
        if (vorlage) {
          summe += schichtDauerMinuten(vorlage.beginn_zeit, vorlage.ende_zeit, vorlage.pause_minuten ?? 0)
        }
      }
    }
    return minutenAlsText(summe)
  }

  if (ladeVorgang) {
    return <p style={{ color: 'var(--text-muted)' }}>Lade Dienstplan...</p>
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <button
          onClick={() => setWochenStart(new Date(wochenStart.getTime() - 7 * 86400000))}
          style={navigationsKnopfStil}
        >
          ← Vorherige Woche
        </button>
        <div style={{ fontWeight: 600 }}>
          {datumKurz(tage[0])} – {datumKurz(tage[6])}
        </div>
        <button
          onClick={() => setWochenStart(new Date(wochenStart.getTime() + 7 * 86400000))}
          style={navigationsKnopfStil}
        >
          Nächste Woche →
        </button>
      </div>

      <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
        <table style={{ borderCollapse: 'separate', borderSpacing: 0, width: '100%', fontSize: 12 }}>
          <thead>
            <tr>
              <th style={{ ...kopfZelleStil, position: 'sticky', left: 0, zIndex: 2, minWidth: 150 }}>
                Mitarbeiter
              </th>
              {tage.map((tag, i) => (
                <th key={i} style={{ ...kopfZelleStil, minWidth: 150 }}>
                  {WOCHENTAGE[i]}
                  <div style={{ fontWeight: 400, fontSize: 11 }}>{datumKurz(tag)}</div>
                </th>
              ))}
              <th style={{ ...kopfZelleStil, minWidth: 70 }}>Arbeitszeit</th>
            </tr>
          </thead>
          <tbody>
            {mitarbeiterListe.map((mitarbeiter) => (
              <tr key={mitarbeiter.id}>
                <td
                  style={{
                    ...zellBasisStil,
                    position: 'sticky',
                    left: 0,
                    background: 'var(--navy)',
                    color: '#ffffff',
                    fontWeight: 600,
                    zIndex: 1,
                  }}
                >
                  {mitarbeiter.name}
                </td>
                {tage.map((tag) => {
                  const datumIso = datumZuISO(tag)
                  const urlaub = istUrlaub(mitarbeiter.id, datumIso)
                  const eintrag = eintragFuer(mitarbeiter.id, datumIso)
                  const ausgewaehlt =
                    ausgewaehlteZelle?.mitarbeiterId === mitarbeiter.id && ausgewaehlteZelle?.datum === datumIso

                  let inhalt: React.ReactNode = null
                  let hintergrund = '#ffffff'

                  if (urlaub) {
                    hintergrund = '#e91ee9'
                    inhalt = <div style={{ fontWeight: 700 }}>Urlaub</div>
                  } else if (eintrag?.status === 'ruhe') {
                    hintergrund = '#7ffcf5'
                    inhalt = <div style={{ fontWeight: 700 }}>Ruhe</div>
                  } else if (eintrag?.status === 'frei') {
                    hintergrund = '#ff5cff'
                    inhalt = <div style={{ fontWeight: 700 }}>Frei</div>
                  } else if (eintrag?.ist_spotschicht) {
                    hintergrund = eintrag.spot_farbe ?? '#8b1a1a'
                    inhalt = (
                      <div>
                        <div style={{ fontWeight: 700 }}>{eintrag.spot_name}</div>
                        <div style={{ fontSize: 10 }}>
                          {zeitKurz(eintrag.spot_beginn_zeit)} – {zeitKurz(eintrag.spot_ende_zeit)}
                        </div>
                        {eintrag.spot_pause_minuten ? (
                          <div style={{ fontSize: 10 }}>Pause {eintrag.spot_pause_minuten} min</div>
                        ) : null}
                      </div>
                    )
                  } else if (eintrag?.schichtvorlage_id) {
                    const vorlage = vorlagen.find((v) => v.id === eintrag.schichtvorlage_id)
                    if (vorlage) {
                      hintergrund = vorlage.farbe
                      inhalt = (
                        <div>
                          <div style={{ fontWeight: 700 }}>{vorlage.name}</div>
                          <div style={{ fontSize: 10 }}>
                            Dienst von {zeitKurz(vorlage.beginn_zeit)} bis {zeitKurz(vorlage.ende_zeit)}
                          </div>
                          {vorlage.pause_minuten ? (
                            <div style={{ fontSize: 10 }}>
                              inkl. Pause {vorlage.pause_minuten} min
                              {vorlage.pause_von ? ` von ${zeitKurz(vorlage.pause_von)}` : ''}
                              {vorlage.pause_bis ? ` bis ${zeitKurz(vorlage.pause_bis)}` : ''}
                            </div>
                          ) : null}
                        </div>
                      )
                    }
                  }

                  return (
                    <td
                      key={datumIso}
                      onClick={() => !urlaub && zelleOeffnen(mitarbeiter.id, datumIso)}
                      style={{
                        ...zellBasisStil,
                        background: hintergrund,
                        cursor: urlaub ? 'default' : 'pointer',
                        outline: ausgewaehlt ? '2px solid var(--navy)' : 'none',
                        outlineOffset: -2,
                        textAlign: 'center',
                        color: '#1e293b',
                      }}
                    >
                      {inhalt}
                    </td>
                  )
                })}
                <td style={{ ...zellBasisStil, background: '#fde047', textAlign: 'center', fontWeight: 600 }}>
                  {wochenArbeitszeit(mitarbeiter.id)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {ausgewaehlteZelle && (
        <div
          style={{
            marginTop: 16,
            padding: 16,
            background: '#f8fafc',
            border: '1px solid var(--border)',
            borderRadius: 8,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <strong>
              {mitarbeiterListe.find((m) => m.id === ausgewaehlteZelle.mitarbeiterId)?.name} –{' '}
              {ausgewaehlteZelle.datum}
            </strong>
            <button onClick={() => setAusgewaehlteZelle(null)} style={sekundaerKnopfStil}>
              Schließen
            </button>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            <select
              value={gewaehlteVorlage}
              onChange={(e) => setGewaehlteVorlage(e.target.value)}
              style={eingabeStil}
            >
              <option value="">Bestandsschicht wählen...</option>
              {vorlagen.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
            <button onClick={vorlageZuweisen} disabled={!gewaehlteVorlage} style={primaerKnopfStil}>
              Zuweisen
            </button>

            <button onClick={() => setSpotFormularOffen(!spotFormularOffen)} style={sekundaerKnopfStil}>
              {spotFormularOffen ? 'Spotschicht abbrechen' : '+ Spotschicht anlegen'}
            </button>

            <button onClick={() => statusSetzen('ruhe')} style={sekundaerKnopfStil}>
              Ruhe
            </button>
            <button onClick={() => statusSetzen('frei')} style={sekundaerKnopfStil}>
              Frei
            </button>
            <button onClick={eintragLoeschen} style={loeschenKnopfStil}>
              Eintrag leeren
            </button>
          </div>

          {spotFormularOffen && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                gap: 10,
                padding: 12,
                background: '#ffffff',
                border: '1px solid var(--border)',
                borderRadius: 6,
              }}
            >
              <label style={beschriftungStil}>
                Name
                <input
                  value={spotDaten.name}
                  onChange={(e) => setSpotDaten({ ...spotDaten, name: e.target.value })}
                  style={eingabeStil}
                  placeholder="z.B. Kessel Dienstantritt NRH"
                />
              </label>
              <label style={beschriftungStil}>
                Beginn
                <input
                  type="time"
                  value={spotDaten.beginn_zeit}
                  onChange={(e) => setSpotDaten({ ...spotDaten, beginn_zeit: e.target.value })}
                  style={eingabeStil}
                />
              </label>
              <label style={beschriftungStil}>
                Ende
                <input
                  type="time"
                  value={spotDaten.ende_zeit}
                  onChange={(e) => setSpotDaten({ ...spotDaten, ende_zeit: e.target.value })}
                  style={eingabeStil}
                />
              </label>
              <label style={beschriftungStil}>
                Pause (Min.)
                <input
                  type="number"
                  value={spotDaten.pause_minuten}
                  onChange={(e) => setSpotDaten({ ...spotDaten, pause_minuten: Number(e.target.value) })}
                  style={eingabeStil}
                />
              </label>
              <label style={beschriftungStil}>
                Dienstort
                <input
                  value={spotDaten.dienstort}
                  onChange={(e) => setSpotDaten({ ...spotDaten, dienstort: e.target.value })}
                  style={eingabeStil}
                />
              </label>
              <label style={beschriftungStil}>
                Farbe
                <input
                  type="color"
                  value={spotDaten.farbe}
                  onChange={(e) => setSpotDaten({ ...spotDaten, farbe: e.target.value })}
                  style={{ ...eingabeStil, padding: 2, height: 36 }}
                />
              </label>
              <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                <button onClick={spotschichtAnlegen} style={primaerKnopfStil}>
                  Anlegen
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const navigationsKnopfStil: React.CSSProperties = {
  background: 'none',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '6px 14px',
  cursor: 'pointer',
  fontSize: 13,
}

const kopfZelleStil: React.CSSProperties = {
  background: 'var(--navy)',
  color: '#ffffff',
  padding: '8px 10px',
  borderBottom: '1px solid var(--border)',
  textAlign: 'center',
  fontWeight: 600,
}

const zellBasisStil: React.CSSProperties = {
  border: '1px solid var(--border)',
  padding: '6px 8px',
  verticalAlign: 'middle',
}

const eingabeStil: React.CSSProperties = {
  padding: '6px 8px',
  border: '1px solid var(--border)',
  borderRadius: 4,
  fontSize: 13,
}

const beschriftungStil: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 500,
  color: 'var(--text-muted)',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
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
  border: '1px solid var(--navy)',
  color: 'var(--navy)',
  borderRadius: 6,
  padding: '8px 14px',
  fontSize: 13,
  cursor: 'pointer',
}

const loeschenKnopfStil: React.CSSProperties = {
  background: 'none',
  border: '1px solid var(--danger)',
  color: 'var(--danger)',
  borderRadius: 6,
  padding: '8px 14px',
  fontSize: 13,
  cursor: 'pointer',
}
