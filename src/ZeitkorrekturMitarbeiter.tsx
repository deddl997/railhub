import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import { datumZuISO } from './datumUtils'
import { useLiveAktualisierung } from './liveAktualisierung'
import {
  arbeitsMinuten,
  datumDeutsch,
  differenzText,
  mehrzeitMinuten,
  stundenText,
  zeitKurz,
} from './zeitkorrekturUtils'
import type { Zeitkorrektur } from './zeitkorrekturUtils'

interface Vorlage {
  id: string
  name: string
  beginn_zeit: string
  ende_zeit: string
  pause_minuten: number | null
}

interface Eintrag {
  datum: string
  schichtvorlage_id: string | null
  ist_spotschicht: boolean
  spot_name: string | null
  spot_beginn_zeit: string | null
  spot_ende_zeit: string | null
  spot_pause_minuten: number | null
  abw_beginn_zeit: string | null
  abw_ende_zeit: string | null
  abw_pause_minuten: number | null
  status: string | null
}

interface Geplant {
  datum: string
  name: string
  beginn: string
  ende: string
  pause: number
}

const WOCHENTAGE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']

const STATUS_STIL: Record<string, { text: string; farbe: string; hell: string }> = {
  offen: { text: 'Wartet auf den Planer', farbe: '#b45309', hell: '#fef3c7' },
  genehmigt: { text: 'Genehmigt', farbe: '#15803d', hell: '#dcfce7' },
  abgelehnt: { text: 'Abgelehnt', farbe: '#b91c1c', hell: '#fee2e2' },
}

const eingabeStil: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: '10px 12px',
  fontSize: 15,
  fontFamily: 'inherit',
}

export default function ZeitkorrekturMitarbeiter({ mitarbeiterId }: { mitarbeiterId: string }) {
  const [laedt, setLaedt] = useState(true)
  const [fehler, setFehler] = useState<string | null>(null)
  const [dienste, setDienste] = useState<Geplant[]>([])
  const [korrekturen, setKorrekturen] = useState<Zeitkorrektur[]>([])
  const [offen, setOffen] = useState<string | null>(null)
  const [beginn, setBeginn] = useState('')
  const [ende, setEnde] = useState('')
  const [pause, setPause] = useState('0')
  const [grund, setGrund] = useState('')
  const [formFehler, setFormFehler] = useState<string | null>(null)
  const [speichert, setSpeichert] = useState(false)

  async function laden() {
    setFehler(null)
    const heute = new Date()
    const von = new Date(heute)
    von.setDate(von.getDate() - 28)
    const vonIso = datumZuISO(von)
    const bisIso = datumZuISO(heute)

    const [vorlagenAntwort, eintraegeAntwort, korrekturAntwort] = await Promise.all([
      supabase.from('schichtvorlagen').select('id, name, beginn_zeit, ende_zeit, pause_minuten'),
      supabase
        .from('dienstplan_eintraege')
        .select(
          'datum, schichtvorlage_id, ist_spotschicht, spot_name, spot_beginn_zeit, spot_ende_zeit, spot_pause_minuten, abw_beginn_zeit, abw_ende_zeit, abw_pause_minuten, status'
        )
        .eq('mitarbeiter_id', mitarbeiterId)
        .gte('datum', vonIso)
        .lte('datum', bisIso)
        .order('datum', { ascending: false }),
      supabase
        .from('zeitkorrekturen')
        .select('*')
        .eq('mitarbeiter_id', mitarbeiterId)
        .gte('datum', vonIso)
        .order('datum', { ascending: false }),
    ])

    if (vorlagenAntwort.error || eintraegeAntwort.error || korrekturAntwort.error) {
      setFehler(
        (vorlagenAntwort.error ?? eintraegeAntwort.error ?? korrekturAntwort.error)?.message ?? 'Laden fehlgeschlagen'
      )
      setLaedt(false)
      return
    }

    const vorlagen = (vorlagenAntwort.data ?? []) as Vorlage[]
    const liste: Geplant[] = []
    for (const e of (eintraegeAntwort.data ?? []) as Eintrag[]) {
      if (e.status) continue
      if (e.ist_spotschicht && e.spot_beginn_zeit && e.spot_ende_zeit) {
        liste.push({
          datum: e.datum,
          name: e.spot_name ?? 'Spotschicht',
          beginn: e.spot_beginn_zeit,
          ende: e.spot_ende_zeit,
          pause: e.spot_pause_minuten ?? 0,
        })
        continue
      }
      const v = vorlagen.find((x) => x.id === e.schichtvorlage_id)
      if (!v) continue
      liste.push({
        datum: e.datum,
        name: v.name,
        beginn: e.abw_beginn_zeit ?? v.beginn_zeit,
        ende: e.abw_ende_zeit ?? v.ende_zeit,
        pause: e.abw_pause_minuten ?? v.pause_minuten ?? 0,
      })
    }
    setDienste(liste)
    setKorrekturen((korrekturAntwort.data ?? []) as Zeitkorrektur[])
    setLaedt(false)
  }

  useEffect(() => {
    laden()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mitarbeiterId])

  useLiveAktualisierung(['zeitkorrekturen', 'dienstplan_eintraege'], () => {
    // nicht neu laden, waehrend der Mitarbeiter gerade das Formular ausfuellt
    if (offen === null) laden()
  })

  function korrekturFuer(datum: string): Zeitkorrektur | undefined {
    return korrekturen.find((k) => k.datum === datum)
  }

  function formOeffnen(d: Geplant) {
    const k = korrekturFuer(d.datum)
    setOffen(d.datum)
    setBeginn((k?.ist_beginn ?? d.beginn).slice(0, 5))
    setEnde((k?.ist_ende ?? d.ende).slice(0, 5))
    setPause(String(k?.ist_pause ?? d.pause))
    setGrund(k?.grund ?? '')
    setFormFehler(null)
  }

  async function absenden(d: Geplant) {
    setFormFehler(null)
    if (!beginn || !ende) {
      setFormFehler('Bitte Beginn und Ende eintragen.')
      return
    }
    if (grund.trim().length < 5) {
      setFormFehler('Bitte einen Grund angeben (mindestens 5 Zeichen), warum es so war.')
      return
    }
    const pauseZahl = Number(pause)
    if (!Number.isFinite(pauseZahl) || pauseZahl < 0 || pauseZahl > 600) {
      setFormFehler('Die Pause muss in Minuten angegeben werden (0 bis 600).')
      return
    }
    setSpeichert(true)
    const { error } = await supabase.from('zeitkorrekturen').upsert(
      {
        mitarbeiter_id: mitarbeiterId,
        datum: d.datum,
        schicht_name: d.name,
        geplant_beginn: d.beginn,
        geplant_ende: d.ende,
        geplant_pause: d.pause,
        ist_beginn: beginn,
        ist_ende: ende,
        ist_pause: Math.round(pauseZahl),
        grund: grund.trim(),
        status: 'offen',
        planer_notiz: null,
        entschieden_am: null,
      },
      { onConflict: 'mitarbeiter_id,datum' }
    )
    setSpeichert(false)
    if (error) {
      setFormFehler(error.message)
      return
    }
    setOffen(null)
    await laden()
  }

  async function zurueckziehen(k: Zeitkorrektur) {
    if (!window.confirm(`Deine Zeitkorrektur vom ${datumDeutsch(k.datum)} zurückziehen?`)) return
    const { error } = await supabase.from('zeitkorrekturen').delete().eq('id', k.id)
    if (error) {
      setFehler(error.message)
      return
    }
    await laden()
  }

  if (laedt) return <div style={{ fontSize: 14, color: '#64748b' }}>Wird geladen …</div>

  return (
    <div>
      <div style={{ fontSize: 13, color: '#475569', marginBottom: 12 }}>
        Wenn dein Dienst länger oder anders gedauert hat, trage hier deine tatsächlichen Zeiten ein und nenne den Grund. Der
        Planer genehmigt die Korrektur oder lehnt sie ab. Angezeigt werden deine Dienste der letzten 4 Wochen.
      </div>
      {fehler && (
        <div style={{ background: '#fee2e2', color: '#991b1b', padding: '8px 12px', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>
          {fehler}
        </div>
      )}
      {dienste.length === 0 && <div style={{ fontSize: 14, color: '#94a3b8' }}>Keine Dienste in den letzten 4 Wochen.</div>}
      {dienste.map((d) => {
        const k = korrekturFuer(d.datum)
        const tag = new Date(d.datum + 'T00:00:00')
        const stil = k ? STATUS_STIL[k.status] : null
        const geplantMin = arbeitsMinuten(d.beginn, d.ende, d.pause)
        const vorschauMin = beginn && ende ? arbeitsMinuten(beginn, ende, Number(pause) || 0) - geplantMin : 0
        return (
          <div key={d.datum} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, marginBottom: 10, background: '#ffffff' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--navy)' }}>
                {WOCHENTAGE[tag.getDay()]}, {datumDeutsch(d.datum)}
              </div>
              {stil && (
                <span style={{ fontSize: 12, fontWeight: 700, color: stil.farbe, background: stil.hell, borderRadius: 6, padding: '2px 8px' }}>
                  {stil.text}
                </span>
              )}
            </div>
            <div style={{ fontSize: 13, color: '#475569', marginTop: 4 }}>
              {d.name} · geplant {zeitKurz(d.beginn)}–{zeitKurz(d.ende)}
              {d.pause > 0 ? `, Pause ${d.pause} Min.` : ''} ({stundenText(geplantMin)})
            </div>

            {k && offen !== d.datum && (
              <div style={{ marginTop: 8, fontSize: 13 }}>
                <div style={{ fontWeight: 600 }}>
                  Tatsächlich {zeitKurz(k.ist_beginn)}–{zeitKurz(k.ist_ende)}
                  {k.ist_pause > 0 ? `, Pause ${k.ist_pause} Min.` : ''} ({differenzText(mehrzeitMinuten(k))})
                </div>
                <div style={{ color: '#475569', background: '#f1f5f9', borderRadius: 6, padding: '6px 10px', marginTop: 4 }}>
                  Grund: {k.grund}
                </div>
                {k.planer_notiz && (
                  <div style={{ color: '#475569', marginTop: 4 }}>Antwort vom Planer: {k.planer_notiz}</div>
                )}
              </div>
            )}

            {offen === d.datum ? (
              <div style={{ marginTop: 10 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                  <label style={{ fontSize: 12, color: '#475569' }}>
                    Beginn
                    <input type="time" value={beginn} onChange={(e) => setBeginn(e.target.value)} style={eingabeStil} />
                  </label>
                  <label style={{ fontSize: 12, color: '#475569' }}>
                    Ende
                    <input type="time" value={ende} onChange={(e) => setEnde(e.target.value)} style={eingabeStil} />
                  </label>
                  <label style={{ fontSize: 12, color: '#475569' }}>
                    Pause (Min.)
                    <input type="number" min={0} max={600} value={pause} onChange={(e) => setPause(e.target.value)} style={eingabeStil} />
                  </label>
                </div>
                <label style={{ fontSize: 12, color: '#475569', display: 'block', marginTop: 8 }}>
                  Grund (Pflicht): Warum war es so?
                  <textarea
                    value={grund}
                    onChange={(e) => setGrund(e.target.value)}
                    rows={3}
                    placeholder="z. B. Zug 40 Minuten verspätet, Übergabe verzögert …"
                    style={{ ...eingabeStil, resize: 'vertical' }}
                  />
                </label>
                {beginn && ende && (
                  <div style={{ fontSize: 13, marginTop: 6, color: vorschauMin > 0 ? '#b45309' : '#475569' }}>
                    Das ergibt {stundenText(arbeitsMinuten(beginn, ende, Number(pause) || 0))} ({differenzText(vorschauMin)} gegenüber dem Plan).
                  </div>
                )}
                {formFehler && (
                  <div style={{ background: '#fee2e2', color: '#991b1b', padding: '8px 12px', borderRadius: 8, marginTop: 8, fontSize: 13 }}>
                    {formFehler}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button
                    onClick={() => absenden(d)}
                    disabled={speichert}
                    style={{ background: 'var(--navy)', color: '#ffffff', border: 'none', borderRadius: 8, padding: '10px 16px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
                  >
                    {speichert ? 'Wird gesendet …' : 'An Planer senden'}
                  </button>
                  <button
                    onClick={() => setOffen(null)}
                    style={{ background: 'none', border: '1px solid var(--navy)', color: 'var(--navy)', borderRadius: 8, padding: '10px 16px', fontSize: 14, cursor: 'pointer' }}
                  >
                    Abbrechen
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                {(!k || k.status !== 'genehmigt') && (
                  <button
                    onClick={() => formOeffnen(d)}
                    style={{ background: 'none', border: '1px solid var(--navy)', color: 'var(--navy)', borderRadius: 8, padding: '8px 14px', fontSize: 13, cursor: 'pointer' }}
                  >
                    {k ? (k.status === 'abgelehnt' ? 'Erneut einreichen' : 'Ändern') : 'Zeit korrigieren'}
                  </button>
                )}
                {k && k.status === 'offen' && (
                  <button
                    onClick={() => zurueckziehen(k)}
                    style={{ background: 'none', border: '1px solid #b91c1c', color: '#b91c1c', borderRadius: 8, padding: '8px 14px', fontSize: 13, cursor: 'pointer' }}
                  >
                    Zurückziehen
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
