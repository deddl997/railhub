import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import { datumZuISO } from './datumUtils'

interface Vorlage {
  id: string
  name: string
  beginn_zeit: string
  ende_zeit: string
  pause_minuten: number | null
  pause_von: string | null
  pause_bis: string | null
  dienstort: string | null
  farbe: string
}

interface Eintrag {
  datum: string
  schichtvorlage_id: string | null
  ist_spotschicht: boolean
  spot_name: string | null
  spot_beginn_zeit: string | null
  spot_ende_zeit: string | null
  spot_pause_minuten: number | null
  spot_dienstort: string | null
  spot_farbe: string | null
  spot_info: string | null
  abw_beginn_zeit: string | null
  abw_ende_zeit: string | null
  abw_pause_minuten: number | null
  abw_dienstort: string | null
  abw_info: string | null
  status: string | null
}

interface Dienst {
  name: string
  beginn: string
  ende: string
  pause: number
  ort: string | null
  farbe: string
  info: string | null
  abweichung: boolean
  pauseVon: string | null
  pauseBis: string | null
  standard: string | null
}

const WOCHENTAGE = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']

function addTage(datum: Date, anzahl: number): Date {
  const neu = new Date(datum)
  neu.setDate(neu.getDate() + anzahl)
  return neu
}

function montagDerWoche(datum: Date): Date {
  const tag = datum.getDay()
  const montag = new Date(datum)
  montag.setDate(datum.getDate() + (tag === 0 ? -6 : 1 - tag))
  montag.setHours(0, 0, 0, 0)
  return montag
}

function kalenderwoche(datum: Date): number {
  const d = new Date(Date.UTC(datum.getFullYear(), datum.getMonth(), datum.getDate()))
  const tag = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - tag)
  const jahrStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil(((d.getTime() - jahrStart.getTime()) / 86400000 + 1) / 7)
}

function datumKurz(datum: Date): string {
  return `${String(datum.getDate()).padStart(2, '0')}.${String(datum.getMonth() + 1).padStart(2, '0')}.`
}

function kurz(zeit: string): string {
  return zeit.slice(0, 5)
}

function minuten(zeit: string): number {
  const [h, m] = zeit.split(':').map(Number)
  return h * 60 + m
}

function dauerText(beginn: string, ende: string): string {
  let d = minuten(ende) - minuten(beginn)
  if (d <= 0) d += 1440
  return `${Math.floor(d / 60)}:${String(d % 60).padStart(2, '0')} Std.`
}

function textFarbeFuer(hex: string): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return '#ffffff'
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.65 ? '#0f2447' : '#ffffff'
}

export default function MeinDienstplan({ mitarbeiterId }: { mitarbeiterId: string }) {
  const [anzahlWochen, setAnzahlWochen] = useState(4)
  const [ladeVorgang, setLadeVorgang] = useState(true)
  const [fehler, setFehler] = useState<string | null>(null)
  const [vorlagen, setVorlagen] = useState<Vorlage[]>([])
  const [eintraege, setEintraege] = useState<Eintrag[]>([])
  const [freigegeben, setFreigegeben] = useState<string[]>([])
  const [offenerTag, setOffenerTag] = useState<string | null>(null)
  const [urlaube, setUrlaube] = useState<{ erster_tag: string; letzter_tag: string }[]>([])

  const heute = new Date()
  heute.setHours(0, 0, 0, 0)
  const heuteIso = datumZuISO(heute)
  const ersteWoche = montagDerWoche(heute)

  useEffect(() => {
    async function laden() {
      setLadeVorgang(true)
      setFehler(null)
      const vonIso = datumZuISO(ersteWoche)
      const bisIso = datumZuISO(addTage(ersteWoche, anzahlWochen * 7 - 1))
      const [vor, ein, fre, urlaub] = await Promise.all([
        supabase.from('schichtvorlagen').select('*'),
        supabase
          .from('dienstplan_eintraege')
          .select('*')
          .eq('mitarbeiter_id', mitarbeiterId)
          .gte('datum', vonIso)
          .lte('datum', bisIso),
        supabase.from('dienstplan_freigaben').select('woche_start').gte('woche_start', vonIso).lte('woche_start', bisIso),
        supabase
          .from('urlaubsantraege')
          .select('erster_tag, letzter_tag')
          .eq('mitarbeiter_id', mitarbeiterId)
          .eq('status', 'genehmigt')
          .lte('erster_tag', bisIso)
          .gte('letzter_tag', vonIso),
      ])
      if (vor.error || ein.error || fre.error) {
        setFehler('Der Dienstplan konnte nicht geladen werden. Bitte später erneut versuchen.')
      }
      setVorlagen((vor.data ?? []) as Vorlage[])
      setEintraege((ein.data ?? []) as Eintrag[])
      setFreigegeben((fre.data ?? []).map((f) => String(f.woche_start)))
      setUrlaube((urlaub.data ?? []) as { erster_tag: string; letzter_tag: string }[])
      setLadeVorgang(false)
    }
    laden()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mitarbeiterId, anzahlWochen])

  function dienstFuer(eintrag: Eintrag | undefined): Dienst | null {
    if (!eintrag || eintrag.status) return null
    if (eintrag.ist_spotschicht && eintrag.spot_beginn_zeit && eintrag.spot_ende_zeit) {
      return {
        name: eintrag.spot_name ?? 'Spotschicht',
        beginn: eintrag.spot_beginn_zeit,
        ende: eintrag.spot_ende_zeit,
        pause: eintrag.spot_pause_minuten ?? 0,
        ort: eintrag.spot_dienstort,
        farbe: eintrag.spot_farbe ?? '#8b1a1a',
        info: eintrag.spot_info,
        abweichung: false,
        pauseVon: null,
        pauseBis: null,
        standard: null,
      }
    }
    const v = vorlagen.find((x) => x.id === eintrag.schichtvorlage_id)
    if (!v) return null
    const zeitAbw = !!(eintrag.abw_beginn_zeit || eintrag.abw_ende_zeit)
    return {
      name: v.name,
      beginn: eintrag.abw_beginn_zeit ?? v.beginn_zeit,
      ende: eintrag.abw_ende_zeit ?? v.ende_zeit,
      pause: eintrag.abw_pause_minuten ?? v.pause_minuten ?? 0,
      ort: eintrag.abw_dienstort ?? v.dienstort,
      farbe: v.farbe,
      info: eintrag.abw_info,
      abweichung: !!(eintrag.abw_beginn_zeit || eintrag.abw_ende_zeit || eintrag.abw_pause_minuten != null || eintrag.abw_dienstort),
      pauseVon: zeitAbw ? null : v.pause_von,
      pauseBis: zeitAbw ? null : v.pause_bis,
      standard: zeitAbw ? `${kurz(v.beginn_zeit)} – ${kurz(v.ende_zeit)}` : null,
    }
  }

  function istUrlaub(iso: string): boolean {
    return urlaube.some((u) => iso >= u.erster_tag && iso <= u.letzter_tag)
  }

  const wochen = Array.from({ length: anzahlWochen }, (_, i) => addTage(ersteWoche, i * 7))

  // Naechster Dienst
  let naechster: { tag: Date; dienst: Dienst } | null = null
  for (const woche of wochen) {
    if (!freigegeben.includes(datumZuISO(woche))) continue
    for (let i = 0; i < 7; i++) {
      const tag = addTage(woche, i)
      const iso = datumZuISO(tag)
      if (iso < heuteIso || istUrlaub(iso)) continue
      const dienst = dienstFuer(eintraege.find((e) => e.datum === iso))
      if (!dienst) continue
      if (iso === heuteIso && minuten(dienst.ende) > minuten(dienst.beginn)) {
        const jetzt = new Date()
        if (jetzt.getHours() * 60 + jetzt.getMinutes() > minuten(dienst.ende)) continue
      }
      naechster = { tag, dienst }
      break
    }
    if (naechster) break
  }

  function relativ(tag: Date): string {
    const diff = Math.round((tag.getTime() - heute.getTime()) / 86400000)
    if (diff === 0) return 'Heute'
    if (diff === 1) return 'Morgen'
    return `In ${diff} Tagen`
  }

  function kalenderDatei() {
    const zeilen: string[] = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Rail Bavaria Logistik//Dienstplan//DE', 'CALSCALE:GREGORIAN']
    const stempel = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
    for (const woche of wochen) {
      if (!freigegeben.includes(datumZuISO(woche))) continue
      for (let i = 0; i < 7; i++) {
        const tag = addTage(woche, i)
        const iso = datumZuISO(tag)
        if (istUrlaub(iso)) continue
        const dienst = dienstFuer(eintraege.find((e) => e.datum === iso))
        if (!dienst) continue
        const ende = minuten(dienst.ende) <= minuten(dienst.beginn) ? addTage(tag, 1) : tag
        const f = (d: Date, z: string) =>
          `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}T${kurz(z).replace(':', '')}00`
        zeilen.push(
          'BEGIN:VEVENT',
          `UID:dienst-${mitarbeiterId}-${iso}@rbl`,
          `DTSTAMP:${stempel}`,
          `DTSTART:${f(tag, dienst.beginn)}`,
          `DTEND:${f(ende, dienst.ende)}`,
          `SUMMARY:${dienst.name}`,
          ...(dienst.ort ? [`LOCATION:${dienst.ort}`] : []),
          ...(dienst.info ? [`DESCRIPTION:${dienst.info.replace(/\n/g, ' ')}`] : []),
          'END:VEVENT'
        )
      }
    }
    zeilen.push('END:VCALENDAR')
    const blob = new Blob([zeilen.join('\r\n')], { type: 'text/calendar;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'dienstplan.ics'
    a.click()
    URL.revokeObjectURL(url)
  }

  if (ladeVorgang) {
    return <p style={{ color: 'var(--text-muted)' }}>Lade Dienstplan...</p>
  }

  return (
    <div>
      {fehler && (
        <div style={{ background: '#fee2e2', color: '#991b1b', padding: '8px 12px', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>
          {fehler}
        </div>
      )}

      {naechster ? (
        <div
          onClick={() => setOffenerTag(datumZuISO(naechster!.tag))}
          style={{
            background: '#14325c',
            color: '#ffffff',
            borderRadius: 12,
            padding: 18,
            marginBottom: 18,
            cursor: 'pointer',
          }}
        >
          <div style={{ fontSize: 12, color: '#c9d6ea', marginBottom: 4 }}>
            Dein nächster Dienst · {relativ(naechster.tag)}
          </div>
          <div style={{ fontSize: 13, color: '#c9d6ea' }}>
            {WOCHENTAGE[naechster.tag.getDay()]}, {datumKurz(naechster.tag)}
            {naechster.tag.getFullYear()}
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, margin: '6px 0' }}>{naechster.dienst.name}</div>
          <div style={{ fontSize: 28, fontWeight: 700 }}>
            {kurz(naechster.dienst.beginn)} – {kurz(naechster.dienst.ende)}
          </div>
          <div style={{ fontSize: 13, color: '#c9d6ea', marginTop: 6 }}>
            {dauerText(naechster.dienst.beginn, naechster.dienst.ende)} · Pause {naechster.dienst.pause} Min. inklusive
            {naechster.dienst.ort ? ` · ${naechster.dienst.ort}` : ''}
          </div>
          {naechster.dienst.abweichung && (
            <div style={{ marginTop: 8, fontSize: 12, background: 'rgba(253,230,138,0.2)', borderRadius: 6, padding: '4px 8px' }}>
              ✎ Abweichend von der Standard-Schicht
            </div>
          )}
          {naechster.dienst.info && (
            <div style={{ marginTop: 8, fontSize: 13, background: 'rgba(255,255,255,0.12)', borderRadius: 6, padding: '6px 10px' }}>
              ℹ {naechster.dienst.info}
            </div>
          )}
        </div>
      ) : (
        <div style={{ background: '#f1f5f9', borderRadius: 12, padding: 16, marginBottom: 18, color: '#475569', fontSize: 14 }}>
          Aktuell ist kein kommender Dienst veröffentlicht.
        </div>
      )}

      <button
        onClick={kalenderDatei}
        disabled={eintraege.length === 0}
        style={{
          background: 'none',
          border: '1px solid var(--navy)',
          color: 'var(--navy)',
          borderRadius: 8,
          padding: '8px 14px',
          fontSize: 13,
          cursor: 'pointer',
          marginBottom: 18,
        }}
      >
        Dienste in meinen Kalender übernehmen (.ics)
      </button>

      {wochen.map((woche) => {
        const wocheIso = datumZuISO(woche)
        const veroeffentlicht = freigegeben.includes(wocheIso)
        return (
          <div key={wocheIso} style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ fontWeight: 700, color: 'var(--navy)' }}>
                KW {kalenderwoche(woche)} · {datumKurz(woche)} – {datumKurz(addTage(woche, 6))}
              </div>
              {!veroeffentlicht && (
                <span style={{ fontSize: 11, background: '#fef3c7', color: '#92400e', borderRadius: 999, padding: '2px 10px' }}>
                  Noch nicht veröffentlicht
                </span>
              )}
            </div>

            {veroeffentlicht ? (
              <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                {Array.from({ length: 7 }, (_, i) => {
                  const tag = addTage(woche, i)
                  const iso = datumZuISO(tag)
                  const eintrag = eintraege.find((e) => e.datum === iso)
                  const urlaub = istUrlaub(iso)
                  const dienst = urlaub ? null : dienstFuer(eintrag)
                  return (
                    <div
                      key={iso}
                      onClick={() => setOffenerTag(iso)}
                      style={{
                        display: 'flex',
                        gap: 12,
                        alignItems: 'center',
                        cursor: 'pointer',
                        padding: '10px 12px',
                        borderBottom: i < 6 ? '1px solid #eef2f8' : undefined,
                        background: iso === heuteIso ? '#f3f7fd' : '#ffffff',
                      }}
                    >
                      <div style={{ width: 64, flexShrink: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 13 }}>{WOCHENTAGE[tag.getDay()].slice(0, 2)}</div>
                        <div style={{ fontSize: 11, color: '#64748b' }}>{datumKurz(tag)}</div>
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {urlaub ? (
                          <span style={{ background: '#c026d3', color: '#ffffff', borderRadius: 6, padding: '4px 10px', fontSize: 13, fontWeight: 600 }}>
                            Urlaub
                          </span>
                        ) : dienst ? (
                          <div>
                            <span
                              style={{
                                background: dienst.farbe,
                                color: textFarbeFuer(dienst.farbe),
                                borderRadius: 6,
                                padding: '4px 10px',
                                fontSize: 13,
                                fontWeight: 600,
                                display: 'inline-block',
                              }}
                            >
                              {dienst.name}
                              {dienst.abweichung ? ' ✎' : ''}
                            </span>
                            <div style={{ fontSize: 13, marginTop: 4 }}>
                              {kurz(dienst.beginn)} – {kurz(dienst.ende)}
                              <span style={{ color: '#64748b' }}>
                                {' '}
                                · {dauerText(dienst.beginn, dienst.ende)}
                                {dienst.ort ? ` · ${dienst.ort}` : ''}
                              </span>
                            </div>
                            {dienst.info && <div style={{ fontSize: 12, color: '#92400e', marginTop: 2 }}>ℹ {dienst.info}</div>}
                          </div>
                        ) : eintrag?.status === 'ruhe' ? (
                          <span style={{ color: '#0e7490', fontWeight: 600, fontSize: 13 }}>Ruhe</span>
                        ) : eintrag?.status === 'frei' ? (
                          <span style={{ color: '#64748b', fontWeight: 600, fontSize: 13 }}>Frei</span>
                        ) : (
                          <span style={{ color: '#cbd5e1', fontSize: 13 }}>–</span>
                        )}
                      </div>
                      <div style={{ color: '#94a3b8', fontSize: 18 }}>›</div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div style={{ background: '#f8fafc', borderRadius: 10, padding: 14, color: '#94a3b8', fontSize: 13 }}>
                Diese Woche hat der Planer noch nicht freigegeben.
              </div>
            )}
          </div>
        )
      })}

      <button
        onClick={() => setAnzahlWochen(anzahlWochen + 4)}
        style={{ background: 'none', border: 'none', color: 'var(--navy)', cursor: 'pointer', fontSize: 13, textDecoration: 'underline' }}
      >
        Weitere Wochen anzeigen
      </button>
      {offenerTag && (() => {
        const tag = new Date(offenerTag + 'T00:00:00')
        const eintrag = eintraege.find((e) => e.datum === offenerTag)
        const urlaub = istUrlaub(offenerTag)
        const dienst = urlaub ? null : dienstFuer(eintrag)
        const kachel: React.CSSProperties = { background: '#f1f5f9', borderRadius: 8, padding: '8px 12px' }
        return (
          <div
            onClick={() => setOffenerTag(null)}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(15, 23, 42, 0.5)',
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'center',
              zIndex: 1000,
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                background: '#ffffff',
                borderRadius: '16px 16px 0 0',
                padding: 20,
                width: 520,
                maxWidth: '100%',
                maxHeight: '88vh',
                overflowY: 'auto',
                boxShadow: '0 -10px 40px rgba(0,0,0,0.2)',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize: 12, color: '#64748b' }}>
                    {WOCHENTAGE[tag.getDay()]}, {datumKurz(tag)}
                    {tag.getFullYear()}
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 20, color: 'var(--navy)' }}>
                    {urlaub ? 'Urlaub' : dienst ? dienst.name : eintrag?.status === 'ruhe' ? 'Ruhe' : eintrag?.status === 'frei' ? 'Frei' : 'Kein Dienst'}
                  </div>
                </div>
                <button
                  onClick={() => setOffenerTag(null)}
                  style={{ background: 'none', border: 'none', fontSize: 24, cursor: 'pointer', color: '#64748b', lineHeight: 1 }}
                  aria-label="Schließen"
                >
                  ✕
                </button>
              </div>

              {dienst ? (
                <div>
                  <div style={{ height: 6, borderRadius: 3, background: dienst.farbe, marginBottom: 14 }} />
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
                    <div style={kachel}>
                      <div style={{ fontSize: 11, color: '#64748b' }}>Beginn</div>
                      <div style={{ fontWeight: 700, fontSize: 18 }}>{kurz(dienst.beginn)}</div>
                    </div>
                    <div style={kachel}>
                      <div style={{ fontSize: 11, color: '#64748b' }}>Ende</div>
                      <div style={{ fontWeight: 700, fontSize: 18 }}>{kurz(dienst.ende)}</div>
                    </div>
                    <div style={kachel}>
                      <div style={{ fontSize: 11, color: '#64748b' }}>Dauer</div>
                      <div style={{ fontWeight: 700, fontSize: 16 }}>{dauerText(dienst.beginn, dienst.ende)}</div>
                    </div>
                    <div style={kachel}>
                      <div style={{ fontSize: 11, color: '#64748b' }}>Pause (inklusive)</div>
                      <div style={{ fontWeight: 700, fontSize: 16 }}>
                        {dienst.pause} Min.
                        {dienst.pauseVon && dienst.pauseBis ? ` · ${kurz(dienst.pauseVon)}–${kurz(dienst.pauseBis)}` : ''}
                      </div>
                    </div>
                  </div>
                  {dienst.ort && (
                    <div style={{ fontSize: 14, marginBottom: 10 }}>
                      Dienstort: <b>{dienst.ort}</b>
                    </div>
                  )}
                  {dienst.abweichung && (
                    <div style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', borderRadius: 8, padding: '8px 12px', fontSize: 13, marginBottom: 10 }}>
                      ✎ Diese Schicht weicht von der Standard-Schicht ab
                      {dienst.standard ? ` (Standard: ${dienst.standard})` : ''}.
                    </div>
                  )}
                  {dienst.info ? (
                    <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e3a8a', borderRadius: 8, padding: '10px 12px', fontSize: 14 }}>
                      <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 4 }}>Info vom Planer</div>
                      <div style={{ whiteSpace: 'pre-wrap' }}>{dienst.info}</div>
                    </div>
                  ) : (
                    <div style={{ fontSize: 13, color: '#94a3b8' }}>Keine zusätzliche Info vom Planer.</div>
                  )}
                </div>
              ) : urlaub ? (
                <div style={{ fontSize: 14, color: '#475569' }}>Dein Urlaub ist genehmigt.</div>
              ) : eintrag?.status === 'ruhe' ? (
                <div style={{ fontSize: 14, color: '#475569' }}>Du hast an diesem Tag Ruhe.</div>
              ) : eintrag?.status === 'frei' ? (
                <div style={{ fontSize: 14, color: '#475569' }}>Du hast an diesem Tag frei.</div>
              ) : (
                <div style={{ fontSize: 14, color: '#475569' }}>An diesem Tag ist kein Dienst eingetragen.</div>
              )}
            </div>
          </div>
        )
      })()}
    </div>
  )
}
