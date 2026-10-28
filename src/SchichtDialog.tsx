import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import {
  FAHRT_ARTEN,
  fahrtenAusAuftrag,
  fahrtenPruefen,
  infoAusFahrten,
  leereFahrt,
  pauseNachArbZG,
  teilstrecken,
  wechselHinweis,
  zeitenAusFahrten,
} from './auftragSchicht'
import type { AuftragKern, Fahrtzeile } from './auftragSchicht'

export interface DialogAuftrag extends AuftragKern {
  id: string
  fahrten: unknown
  anzahl_wagen: number | null
}

const FARBEN = ['#8b1a1a', '#14325c', '#15803d', '#b45309', '#6d28d9', '#0e7490', '#be185d', '#475569']

function bruttoVon(beginn: string, ende: string): number {
  const [bh, bm] = beginn.split(':').map(Number)
  const [eh, em] = ende.split(':').map(Number)
  let d = eh * 60 + em - (bh * 60 + bm)
  if (d <= 0) d += 1440
  return d
}

export default function SchichtDialog({
  auftrag: originalAuftrag,
  spotId,
  bereich = 'Lokführer',
  teilstrecke = null,
  onSchliessen,
  onFertig,
}: {
  auftrag: DialogAuftrag
  spotId: string | null
  bereich?: 'Lokführer' | 'Wagenmeister'
  teilstrecke?: number | null
  onSchliessen: () => void
  onFertig: () => void
}) {
  const wgm = bereich === 'Wagenmeister'
  // Bei Aufträgen mit Personalwechsel gilt der Dialog für eine Teilstrecke
  const alleTeile = teilstrecken(originalAuftrag.fahrten)
  const teilLeg = !wgm && teilstrecke !== null ? alleTeile[teilstrecke] : undefined
  const auftrag: DialogAuftrag = teilLeg
    ? {
        ...originalAuftrag,
        abfahrt_ort: teilLeg.von,
        abfahrt_datum: teilLeg.datum ?? originalAuftrag.abfahrt_datum,
        abfahrt_soll: teilLeg.von_zeit || null,
        ankunft_ort: teilLeg.nach,
        ankunft_datum: null,
        ankunft_soll: teilLeg.nach_zeit || null,
        lok: teilLeg.lok || originalAuftrag.lok,
        mitarbeiter_info: wechselHinweis(teilstrecke ?? 0, alleTeile).trim() || null,
        fahrten: [teilLeg],
      }
    : originalAuftrag
  const gespeicherte = fahrtenPruefen(auftrag.fahrten)
  const [fahrten, setFahrten] = useState<Fahrtzeile[]>(!wgm && gespeicherte.length > 0 ? gespeicherte : fahrtenAusAuftrag(auftrag))
  const [name, setName] = useState(
    wgm ? `Wagenmeister ${auftrag.referenz ?? ''} ${auftrag.abfahrt_ort ?? ''}`.trim() : `${auftrag.referenz ?? 'Fahrt'} ${auftrag.abfahrt_ort ?? ''}–${auftrag.ankunft_ort ?? ''}`
  )
  const [datum, setDatum] = useState(auftrag.abfahrt_datum)
  const [beginn, setBeginn] = useState('')
  const [ende, setEnde] = useState('')
  const [pause, setPause] = useState(0)
  const [dienstort, setDienstort] = useState(auftrag.abfahrt_ort ?? '')
  const [farbe, setFarbe] = useState(wgm ? '#0e7490' : '#8b1a1a')
  const [info, setInfo] = useState('')
  const [zeitenManuell, setZeitenManuell] = useState(false)
  const [pauseManuell, setPauseManuell] = useState(false)
  const [infoManuell, setInfoManuell] = useState(false)
  const [laedt, setLaedt] = useState(spotId !== null)
  const [speichert, setSpeichert] = useState(false)
  const [fehler, setFehler] = useState<string | null>(null)

  // Bestehende offene Schicht laden (Bearbeiten)
  useEffect(() => {
    if (!spotId) return
    supabase
      .from('offene_spotschichten')
      .select('*')
      .eq('id', spotId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setName(data.name)
          setDatum(data.datum)
          setBeginn(String(data.beginn_zeit).slice(0, 5))
          setEnde(String(data.ende_zeit).slice(0, 5))
          setPause(data.pause_minuten ?? 0)
          setDienstort(data.dienstort ?? '')
          setFarbe(data.farbe ?? '#8b1a1a')
          setInfo(data.info ?? '')
          setZeitenManuell(true)
          setPauseManuell(true)
          setInfoManuell(true)
        }
        setLaedt(false)
      })
  }, [spotId])

  // Zeiten, Pause und Info aus den Fahrten berechnen, solange nichts von Hand geaendert wurde
  useEffect(() => {
    if (spotId && laedt) return
    if (!zeitenManuell) {
      const z = zeitenAusFahrten(auftrag.abfahrt_datum, auftrag.abfahrt_soll, fahrten)
      if (z) {
        setDatum(z.datum)
        setBeginn(z.beginn)
        setEnde(z.ende)
      }
    }
    if (!infoManuell) {
      if (wgm) {
        const teile = [
          `Zug ${auftrag.referenz ?? ''}${auftrag.zug_nr ? ` (${auftrag.zug_nr})` : ''}`.trim(),
          auftrag.abfahrt_ort ? `ab ${auftrag.abfahrt_ort}${auftrag.abfahrt_soll ? ' ' + auftrag.abfahrt_soll.slice(0, 5) : ''}` : '',
          auftrag.anzahl_wagen != null ? `${auftrag.anzahl_wagen} Wagen` : '',
        ].filter(Boolean)
        setInfo(teile.join(', '))
      } else setInfo(infoAusFahrten(fahrten, auftrag.mitarbeiter_info))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fahrten, zeitenManuell, infoManuell, laedt])

  useEffect(() => {
    if (!pauseManuell && beginn && ende) setPause(pauseNachArbZG(bruttoVon(beginn, ende)))
  }, [beginn, ende, pauseManuell])

  function fahrtAendern(i: number, teil: Partial<Fahrtzeile>) {
    setFahrten((alt) => alt.map((f, k) => (k === i ? { ...f, ...teil } : f)))
  }

  function verschieben(i: number, richtung: -1 | 1) {
    setFahrten((alt) => {
      const j = i + richtung
      if (j < 0 || j >= alt.length) return alt
      const neu = [...alt]
      ;[neu[i], neu[j]] = [neu[j], neu[i]]
      return neu
    })
  }

  function zufuehrungDavor() {
    setFahrten((alt) => [{ ...leereFahrt('Lokzuführung'), nach: auftrag.abfahrt_ort ?? '', nach_zeit: auftrag.abfahrt_soll?.slice(0, 5) ?? '' }, ...alt])
  }

  function rueckfuehrungDanach() {
    setFahrten((alt) => [...alt, { ...leereFahrt('Lokrückführung'), von: auftrag.ankunft_ort ?? '', von_zeit: auftrag.ankunft_soll?.slice(0, 5) ?? '' }])
  }

  async function speichern() {
    setFehler(null)
    if (!name.trim() || !beginn || !ende || !datum) {
      setFehler('Bitte Name, Datum, Dienstbeginn und Dienstende eintragen.')
      return
    }
    setSpeichert(true)
    const werte = {
      datum,
      bereich,
      name: name.trim(),
      beginn_zeit: beginn,
      ende_zeit: ende,
      pause_minuten: pause,
      dienstort: dienstort.trim() || null,
      farbe,
      info: info.trim() || null,
      auftrag_id: auftrag.id,
    }
    const { error } = spotId
      ? await supabase.from('offene_spotschichten').update(werte).eq('id', spotId)
      : await supabase.from('offene_spotschichten').insert(werte)
    if (error) {
      setSpeichert(false)
      setFehler('Speichern fehlgeschlagen: ' + error.message)
      return
    }
    // Fahrten am Auftrag merken (fuer spaetere Aenderungen)
    if (!wgm && !teilLeg) await supabase.from('auftraege').update({ fahrten }).eq('id', auftrag.id)
    setSpeichert(false)
    onFertig()
  }

  const knopf: React.CSSProperties = { background: 'none', border: '1px solid var(--navy)', color: 'var(--navy)', borderRadius: 8, padding: '8px 14px', fontSize: 13, cursor: 'pointer' }
  const eingabe: React.CSSProperties = { border: '1px solid var(--border)', borderRadius: 6, padding: '7px 9px', fontSize: 14, width: '100%', boxSizing: 'border-box', fontFamily: 'inherit' }
  const klein: React.CSSProperties = { ...eingabe, padding: '5px 6px', fontSize: 13 }
  const brutto = beginn && ende ? bruttoVon(beginn, ende) : 0

  return (
    <div
      onClick={onSchliessen}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: 16 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: '#ffffff', borderRadius: 12, padding: 20, width: 900, maxWidth: '100%', maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 10px 40px rgba(0,0,0,0.3)' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--navy)' }}>{spotId ? `${bereich}-Schicht ändern` : `${bereich}-Schicht anlegen`}{teilLeg ? ` · ${teilLeg.von} → ${teilLeg.nach}` : ''}</div>
          <button onClick={onSchliessen} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)', lineHeight: 1 }}>
            ✕
          </button>
        </div>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>
          Auftrag {auftrag.referenz} · {auftrag.abfahrt_ort} → {auftrag.ankunft_ort}.{' '}
          {wgm
            ? 'Trage Dienstort, Datum und Zeiten für den Wagenmeister ein. Die Vorschläge kommen aus dem Auftrag und lassen sich ändern.'
            : 'Trage unten alle Fahrten der Schicht ein, auch Lokzuführungen. Dienstbeginn, Dienstende und Pause werden daraus berechnet und lassen sich ändern.'}
        </div>

        {laedt ? (
          <div style={{ fontSize: 14, color: '#64748b' }}>Wird geladen …</div>
        ) : (
          <>
            {!wgm && (
              <>
            <div style={{ fontWeight: 700, color: 'var(--navy)', fontSize: 13, marginBottom: 6 }}>Fahrten in dieser Schicht</div>
            <div style={{ overflowX: 'auto', marginBottom: 8 }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 800, fontSize: 12 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: '#64748b' }}>
                    <th style={{ padding: '3px 4px' }}>Art</th>
                    <th style={{ padding: '3px 4px' }}>Zug</th>
                    <th style={{ padding: '3px 4px' }}>Von</th>
                    <th style={{ padding: '3px 4px' }}>ab</th>
                    <th style={{ padding: '3px 4px' }}>Nach</th>
                    <th style={{ padding: '3px 4px' }}>an</th>
                    <th style={{ padding: '3px 4px' }}>Lok</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {fahrten.map((f, i) => (
                    <tr key={i}>
                      <td style={{ padding: '3px 4px' }}>
                        <select value={f.art} onChange={(e) => fahrtAendern(i, { art: e.target.value })} style={{ ...klein, width: 130 }}>
                          {FAHRT_ARTEN.map((a) => (
                            <option key={a}>{a}</option>
                          ))}
                        </select>
                      </td>
                      <td style={{ padding: '3px 4px' }}>
                        <input value={f.zug} onChange={(e) => fahrtAendern(i, { zug: e.target.value })} style={{ ...klein, width: 120 }} />
                      </td>
                      <td style={{ padding: '3px 4px' }}>
                        <input value={f.von} onChange={(e) => fahrtAendern(i, { von: e.target.value })} style={{ ...klein, width: 130 }} />
                      </td>
                      <td style={{ padding: '3px 4px' }}>
                        <input type="time" value={f.von_zeit} onChange={(e) => fahrtAendern(i, { von_zeit: e.target.value })} style={{ ...klein, width: 92 }} />
                      </td>
                      <td style={{ padding: '3px 4px' }}>
                        <input value={f.nach} onChange={(e) => fahrtAendern(i, { nach: e.target.value })} style={{ ...klein, width: 130 }} />
                      </td>
                      <td style={{ padding: '3px 4px' }}>
                        <input type="time" value={f.nach_zeit} onChange={(e) => fahrtAendern(i, { nach_zeit: e.target.value })} style={{ ...klein, width: 92 }} />
                      </td>
                      <td style={{ padding: '3px 4px' }}>
                        <input value={f.lok} onChange={(e) => fahrtAendern(i, { lok: e.target.value })} style={{ ...klein, width: 90 }} />
                      </td>
                      <td style={{ padding: '3px 4px', whiteSpace: 'nowrap' }}>
                        <button onClick={() => verschieben(i, -1)} title="nach oben" style={{ ...knopf, padding: '3px 7px' }}>
                          ↑
                        </button>{' '}
                        <button onClick={() => verschieben(i, 1)} title="nach unten" style={{ ...knopf, padding: '3px 7px' }}>
                          ↓
                        </button>{' '}
                        <button
                          onClick={() => setFahrten((alt) => alt.filter((_, k) => k !== i))}
                          title="Fahrt entfernen"
                          style={{ ...knopf, padding: '3px 7px', borderColor: 'var(--danger)', color: 'var(--danger)' }}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
              <button onClick={zufuehrungDavor} style={knopf}>
                + Lokzuführung davor
              </button>
              <button onClick={() => setFahrten((alt) => [...alt, leereFahrt()])} style={knopf}>
                + Fahrt
              </button>
              <button onClick={rueckfuehrungDanach} style={knopf}>
                + Rückführung danach
              </button>
            </div>

              </>
            )}

            <div style={{ fontWeight: 700, color: 'var(--navy)', fontSize: 13, marginBottom: 6 }}>Schicht</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
              <label style={{ fontSize: 12, color: '#475569', gridColumn: '1 / -1' }}>
                Name der Schicht
                <input value={name} onChange={(e) => setName(e.target.value)} style={eingabe} />
              </label>
              <label style={{ fontSize: 12, color: '#475569' }}>
                Datum Dienstbeginn
                <input
                  type="date"
                  value={datum}
                  onChange={(e) => {
                    setDatum(e.target.value)
                    setZeitenManuell(true)
                  }}
                  style={eingabe}
                />
              </label>
              <label style={{ fontSize: 12, color: '#475569' }}>
                Dienstbeginn
                <input
                  type="time"
                  value={beginn}
                  onChange={(e) => {
                    setBeginn(e.target.value)
                    setZeitenManuell(true)
                  }}
                  style={eingabe}
                />
              </label>
              <label style={{ fontSize: 12, color: '#475569' }}>
                Dienstende
                <input
                  type="time"
                  value={ende}
                  onChange={(e) => {
                    setEnde(e.target.value)
                    setZeitenManuell(true)
                  }}
                  style={eingabe}
                />
              </label>
              <label style={{ fontSize: 12, color: '#475569' }}>
                Pause (Min.)
                <input
                  type="number"
                  min={0}
                  max={240}
                  value={pause}
                  onChange={(e) => {
                    setPause(Math.max(0, Number(e.target.value) || 0))
                    setPauseManuell(true)
                  }}
                  style={eingabe}
                />
              </label>
              <label style={{ fontSize: 12, color: '#475569' }}>
                {wgm ? 'Ort (Dienstort)' : 'Dienstort'}
                <input value={dienstort} onChange={(e) => setDienstort(e.target.value)} style={eingabe} />
              </label>
              <div style={{ fontSize: 12, color: '#475569' }}>
                Farbe
                <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap', marginTop: 4 }}>
                  {FARBEN.map((f) => (
                    <button
                      key={f}
                      onClick={() => setFarbe(f)}
                      style={{ width: 22, height: 22, borderRadius: 6, background: f, border: farbe === f ? '3px solid #0f172a' : '2px solid #ffffff', outline: '1px solid #cbd5e1', cursor: 'pointer', padding: 0 }}
                    />
                  ))}
                  <input type="color" value={farbe} onChange={(e) => setFarbe(e.target.value)} style={{ width: 30, height: 26, padding: 0, border: 'none', background: 'none' }} />
                </div>
              </div>
            </div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 6, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              {brutto > 0 && (
                <span>
                  Dauer {Math.floor(brutto / 60)}:{String(brutto % 60).padStart(2, '0')} Std. (Pause enthalten), Arbeitszeit {Math.floor((brutto - pause) / 60)}:
                  {String((brutto - pause) % 60).padStart(2, '0')} Std.
                </span>
              )}
              {(zeitenManuell || pauseManuell) && (
                <button
                  onClick={() => {
                    setZeitenManuell(false)
                    setPauseManuell(false)
                  }}
                  style={{ ...knopf, padding: '3px 8px', fontSize: 11 }}
                >
                  Zeiten und Pause neu berechnen
                </button>
              )}
            </div>

            <label style={{ fontSize: 12, color: '#475569', display: 'block', marginTop: 12 }}>
              {wgm ? 'Info an den Wagenmeister' : 'Info an den Lokführer'}
              <textarea
                value={info}
                rows={5}
                onChange={(e) => {
                  setInfo(e.target.value)
                  setInfoManuell(true)
                }}
                style={{ ...eingabe, resize: 'vertical' }}
              />
            </label>
            {infoManuell && (
              <button onClick={() => setInfoManuell(false)} style={{ ...knopf, padding: '3px 8px', fontSize: 11, marginTop: 4 }}>
                Info neu erzeugen
              </button>
            )}

            {fehler && <div style={{ background: '#fee2e2', color: '#991b1b', padding: '8px 12px', borderRadius: 8, marginTop: 12, fontSize: 13 }}>{fehler}</div>}

            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button onClick={speichern} disabled={speichert} style={{ ...knopf, background: 'var(--navy)', color: '#ffffff' }}>
                {speichert ? 'Speichert …' : spotId ? 'Änderungen speichern' : 'Schicht anlegen'}
              </button>
              <button onClick={onSchliessen} style={knopf}>
                Abbrechen
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
