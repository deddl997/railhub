import { Fragment, useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import { datumZuISO } from './datumUtils'
import { feiertageBayern } from './feiertage'
import { KATEGORIEN } from './qualifikationen'
import { arbeitsMinuten, datumDeutsch, stundenText, zeitKurz } from './zeitkorrekturUtils'

interface Person {
  id: string
  name: string
  kategorie: string | null
}

interface Vorlage {
  id: string
  name: string
  beginn_zeit: string
  ende_zeit: string
  pause_minuten: number | null
}

interface Eintrag {
  mitarbeiter_id: string
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

interface Antrag {
  id: string
  mitarbeiter_id: string | null
  erster_tag: string
  letzter_tag: string
  anzahl_tage: number | null
  brauchbare_tage: number | null
  status: string
  gruppe_id: string | null
}

interface Jahresdaten {
  mitarbeiter_id: string
  urlaubsanspruch: number | null
  resturlaub: number | null
  resturlaub_vorjahr: number | null
}

interface Korrektur {
  mitarbeiter_id: string
  datum: string
  status: string
  geplant_beginn: string | null
  geplant_ende: string | null
  geplant_pause: number
  ist_beginn: string
  ist_ende: string
  ist_pause: number
}

interface Tag {
  datum: string
  art: 'dienst' | 'urlaub' | 'frei' | 'ruhe'
  text: string
  netto: number
  nacht: boolean
  wochenende: boolean
  feiertag: string | null
  mehr: number
}

const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
const WOCHENTAGE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']

function monatsEnde(jahr: number, monat: number): string {
  return datumZuISO(new Date(jahr, monat + 1, 0))
}

// Minuten der Schicht, die in der Nachtzeit 23:00 bis 06:00 liegen
function nachtMinuten(beginn: string, ende: string): number {
  const b = Number(beginn.slice(0, 2)) * 60 + Number(beginn.slice(3, 5))
  let dauer = Number(ende.slice(0, 2)) * 60 + Number(ende.slice(3, 5)) - b
  if (dauer <= 0) dauer += 1440
  let summe = 0
  for (let i = 0; i < dauer; i++) {
    const m = (b + i) % 1440
    if (m >= 23 * 60 || m < 6 * 60) summe++
  }
  return summe
}

function csvLaden(dateiname: string, kopf: string[], zeilen: string[][]) {
  const text = [kopf, ...zeilen].map((z) => z.map((w) => `"${String(w).replace(/"/g, '""')}"`).join(';')).join('\r\n')
  const blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = dateiname
  a.click()
  URL.revokeObjectURL(url)
}

const zahl = (v: number | null | undefined) => (v == null ? 0 : v)

export default function Uebersichten({ eigeneId }: { eigeneId: string | null }) {
  const nurEigene = eigeneId !== null
  const heute = new Date()
  const [ansicht, setAnsicht] = useState<'monat' | 'urlaub'>('monat')
  const [jahr, setJahr] = useState(heute.getFullYear())
  const [monat, setMonat] = useState(heute.getMonth())
  const [kategorie, setKategorie] = useState('alle')
  const [laedt, setLaedt] = useState(true)
  const [fehler, setFehler] = useState<string | null>(null)
  const [personen, setPersonen] = useState<Person[]>([])
  const [tageProPerson, setTageProPerson] = useState<Record<string, Tag[]>>({})
  const [offeneKorrekturen, setOffeneKorrekturen] = useState<Record<string, number>>({})
  const [antraege, setAntraege] = useState<Antrag[]>([])
  const [jahresdaten, setJahresdaten] = useState<Jahresdaten[]>([])
  const [aufgeklappt, setAufgeklappt] = useState<string | null>(null)

  useEffect(() => {
    async function laden() {
      setLaedt(true)
      setFehler(null)
      const von = datumZuISO(new Date(jahr, monat, 1))
      const bis = monatsEnde(jahr, monat)

      let personenAbfrage = supabase.from('mitarbeiter').select('id, name, kategorie').order('name')
      if (nurEigene) personenAbfrage = personenAbfrage.eq('id', eigeneId)
      let eintraegeAbfrage = supabase.from('dienstplan_eintraege').select('*').gte('datum', von).lte('datum', bis)
      let korrekturAbfrage = supabase.from('zeitkorrekturen').select('*').gte('datum', von).lte('datum', bis)
      let urlaubAbfrage = supabase
        .from('urlaubsantraege')
        .select('id, mitarbeiter_id, erster_tag, letzter_tag, anzahl_tage, brauchbare_tage, status, gruppe_id')
        .lte('erster_tag', `${jahr}-12-31`)
        .gte('letzter_tag', `${jahr}-01-01`)
      let jahresAbfrage = supabase
        .from('mitarbeiter_jahresdaten')
        .select('mitarbeiter_id, urlaubsanspruch, resturlaub, resturlaub_vorjahr')
        .eq('jahr', jahr)
      if (nurEigene) {
        eintraegeAbfrage = eintraegeAbfrage.eq('mitarbeiter_id', eigeneId)
        korrekturAbfrage = korrekturAbfrage.eq('mitarbeiter_id', eigeneId)
        urlaubAbfrage = urlaubAbfrage.eq('mitarbeiter_id', eigeneId)
        jahresAbfrage = jahresAbfrage.eq('mitarbeiter_id', eigeneId)
      }

      const [p, v, e, k, u, j] = await Promise.all([
        personenAbfrage,
        supabase.from('schichtvorlagen').select('id, name, beginn_zeit, ende_zeit, pause_minuten'),
        eintraegeAbfrage,
        korrekturAbfrage,
        urlaubAbfrage,
        jahresAbfrage,
      ])
      const err = p.error ?? v.error ?? e.error ?? k.error ?? u.error ?? j.error
      if (err) {
        setFehler(err.message)
        setLaedt(false)
        return
      }

      const vorlagen = (v.data ?? []) as Vorlage[]
      const feiertage = new Map(feiertageBayern(jahr).map((f) => [f.datum, f.name]))
      const korrekturen = (k.data ?? []) as Korrektur[]
      const urlaube = ((u.data ?? []) as Antrag[]).filter((a) => a.status === 'genehmigt')
      const neueTage: Record<string, Tag[]> = {}
      const offene: Record<string, number> = {}

      for (const kk of korrekturen) if (kk.status === 'offen') offene[kk.mitarbeiter_id] = (offene[kk.mitarbeiter_id] ?? 0) + 1

      const eintraege = (e.data ?? []) as Eintrag[]
      for (const ein of eintraege) {
        const tag = new Date(ein.datum + 'T00:00:00')
        const basis = {
          datum: ein.datum,
          wochenende: tag.getDay() === 0 || tag.getDay() === 6,
          feiertag: feiertage.get(ein.datum) ?? null,
          mehr: 0,
        }
        const liste = (neueTage[ein.mitarbeiter_id] ??= [])
        if (ein.status === 'frei' || ein.status === 'ruhe') {
          liste.push({ ...basis, art: ein.status, text: ein.status === 'frei' ? 'Frei' : 'Ruhe', netto: 0, nacht: false })
          continue
        }
        if (ein.status) continue
        let name = ''
        let beginn = ''
        let ende = ''
        let pause = 0
        if (ein.ist_spotschicht && ein.spot_beginn_zeit && ein.spot_ende_zeit) {
          name = ein.spot_name ?? 'Spotschicht'
          beginn = ein.spot_beginn_zeit
          ende = ein.spot_ende_zeit
          pause = ein.spot_pause_minuten ?? 0
        } else {
          const vl = vorlagen.find((x) => x.id === ein.schichtvorlage_id)
          if (!vl) continue
          name = vl.name
          beginn = ein.abw_beginn_zeit ?? vl.beginn_zeit
          ende = ein.abw_ende_zeit ?? vl.ende_zeit
          pause = ein.abw_pause_minuten ?? vl.pause_minuten ?? 0
        }
        const kor = korrekturen.find((x) => x.mitarbeiter_id === ein.mitarbeiter_id && x.datum === ein.datum && x.status === 'genehmigt')
        const geplantNetto = arbeitsMinuten(beginn, ende, pause)
        const mehr = kor ? arbeitsMinuten(kor.ist_beginn, kor.ist_ende, kor.ist_pause) - geplantNetto : 0
        liste.push({
          ...basis,
          art: 'dienst',
          text: `${name} ${zeitKurz(beginn)}–${zeitKurz(ende)}`,
          netto: geplantNetto,
          nacht: nachtMinuten(beginn, ende) > 120,
          mehr,
        })
      }

      // Urlaubstage (Mo bis Fr ohne Feiertag) an Tagen ohne Dienst
      const letzterTag = new Date(jahr, monat + 1, 0).getDate()
      for (const a of urlaube) {
        if (!a.mitarbeiter_id) continue
        for (let t = 1; t <= letzterTag; t++) {
          const d = new Date(jahr, monat, t)
          const iso = datumZuISO(d)
          if (iso < a.erster_tag || iso > a.letzter_tag) continue
          if (d.getDay() === 0 || d.getDay() === 6 || feiertage.has(iso)) continue
          const liste = (neueTage[a.mitarbeiter_id] ??= [])
          if (liste.some((x) => x.datum === iso && x.art === 'dienst')) continue
          if (liste.some((x) => x.datum === iso && x.art === 'urlaub')) continue
          liste.push({ datum: iso, art: 'urlaub', text: 'Urlaub', netto: 0, nacht: false, wochenende: false, feiertag: null, mehr: 0 })
        }
      }
      for (const id of Object.keys(neueTage)) neueTage[id].sort((a, b) => a.datum.localeCompare(b.datum))

      setPersonen((p.data ?? []) as Person[])
      setTageProPerson(neueTage)
      setOffeneKorrekturen(offene)
      setAntraege((u.data ?? []) as Antrag[])
      setJahresdaten((j.data ?? []) as Jahresdaten[])
      setLaedt(false)
    }
    laden()
  }, [jahr, monat, nurEigene, eigeneId])

  const sichtbar = personen
    .filter((p) => kategorie === 'alle' || p.kategorie === kategorie)
    .sort((a, b) => {
      const ra = a.kategorie ? KATEGORIEN.indexOf(a.kategorie) : 999
      const rb = b.kategorie ? KATEGORIEN.indexOf(b.kategorie) : 999
      return (ra === -1 ? 998 : ra) - (rb === -1 ? 998 : rb) || a.name.localeCompare(b.name)
    })

  function monatsWerte(id: string) {
    const tage = tageProPerson[id] ?? []
    const dienste = tage.filter((t) => t.art === 'dienst')
    const geplant = dienste.reduce((s, t) => s + t.netto, 0)
    const mehr = dienste.reduce((s, t) => s + t.mehr, 0)
    return {
      dienste: dienste.length,
      geplant,
      mehr,
      gesamt: geplant + mehr,
      nacht: dienste.filter((t) => t.nacht).length,
      wochenende: dienste.filter((t) => t.wochenende).length,
      feiertag: dienste.filter((t) => t.feiertag).length,
      urlaub: tage.filter((t) => t.art === 'urlaub').length,
      frei: tage.filter((t) => t.art === 'frei' || t.art === 'ruhe').length,
    }
  }

  function urlaubsWerte(id: string) {
    const jd = jahresdaten.find((x) => x.mitarbeiter_id === id)
    const eigene = antraege.filter((a) => a.mitarbeiter_id === id)
    const tage = (a: Antrag) => zahl(a.brauchbare_tage ?? a.anzahl_tage)
    const genehmigt = eigene.filter((a) => a.status === 'genehmigt')
    const heuteIso = datumZuISO(new Date())
    const genehmigtSumme = genehmigt.reduce((s, a) => s + tage(a), 0)
    const genommen = genehmigt.filter((a) => a.letzter_tag < heuteIso).reduce((s, a) => s + tage(a), 0)
    const offen = eigene.filter((a) => a.status === 'offen').reduce((s, a) => s + tage(a), 0)
    const rest = jd ? zahl(jd.resturlaub) : 30 - genehmigtSumme
    return {
      standard: !jd,
      anspruch: jd ? zahl(jd.urlaubsanspruch) : 30,
      vorjahr: jd ? zahl(jd.resturlaub_vorjahr) : 0,
      genehmigt: genehmigtSumme,
      genommen,
      geplant: genehmigtSumme - genommen,
      offen,
      rest,
      restNachOffen: rest - offen,
      antraege: eigene.sort((a, b) => a.erster_tag.localeCompare(b.erster_tag)),
    }
  }

  function exportieren() {
    if (ansicht === 'monat') {
      csvLaden(
        `Monatsuebersicht_${jahr}-${String(monat + 1).padStart(2, '0')}.csv`,
        ['Name', 'Kategorie', 'Dienste', 'Geplante Std', 'Mehrzeit genehmigt Std', 'Gesamt Std', 'Nachtdienste', 'Wochenenddienste', 'Feiertagsdienste', 'Urlaubstage', 'Frei/Ruhe'],
        sichtbar.map((p) => {
          const w = monatsWerte(p.id)
          return [p.name, p.kategorie ?? '', String(w.dienste), (w.geplant / 60).toFixed(2).replace('.', ','), (w.mehr / 60).toFixed(2).replace('.', ','), (w.gesamt / 60).toFixed(2).replace('.', ','), String(w.nacht), String(w.wochenende), String(w.feiertag), String(w.urlaub), String(w.frei)]
        })
      )
    } else {
      csvLaden(
        `Urlaubsuebersicht_${jahr}.csv`,
        ['Name', 'Kategorie', 'Anspruch', 'Rest Vorjahr', 'Genehmigt', 'Davon genommen', 'Noch geplant', 'Offen beantragt', 'Resturlaub', 'Rest nach offenen'],
        sichtbar.map((p) => {
          const w = urlaubsWerte(p.id)
          return [p.name, p.kategorie ?? '', String(w.anspruch), String(w.vorjahr), String(w.genehmigt), String(w.genommen), String(w.geplant), String(w.offen), String(w.rest), String(w.restNachOffen)]
        })
      )
    }
  }

  const knopf = (aktiv: boolean): React.CSSProperties => ({
    border: '1px solid var(--navy)',
    background: aktiv ? 'var(--navy)' : '#ffffff',
    color: aktiv ? '#ffffff' : 'var(--navy)',
    borderRadius: 8,
    padding: '8px 14px',
    fontSize: 14,
    fontWeight: aktiv ? 600 : 500,
    cursor: 'pointer',
  })
  const eingabe: React.CSSProperties = { border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', fontSize: 14 }
  const th: React.CSSProperties = { textAlign: 'right', padding: '8px 10px', fontSize: 12, color: '#475569', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', background: '#f8fafc' }
  const td: React.CSSProperties = { textAlign: 'right', padding: '8px 10px', fontSize: 13, borderBottom: '1px solid #eef2f8', whiteSpace: 'nowrap' }
  const tdName: React.CSSProperties = { ...td, textAlign: 'left', fontWeight: 600, color: 'var(--navy)' }

  const monatsDetail = (id: string) => {
    const tage = tageProPerson[id] ?? []
    if (tage.length === 0) return <div style={{ fontSize: 13, color: '#94a3b8', padding: 8 }}>Keine Einträge in diesem Monat.</div>
    return (
      <div style={{ padding: '4px 4px 8px' }}>
        {tage.map((t) => {
          const d = new Date(t.datum + 'T00:00:00')
          return (
            <div key={t.datum + t.art} style={{ display: 'flex', gap: 10, fontSize: 13, padding: '3px 0', flexWrap: 'wrap' }}>
              <span style={{ width: 82, color: t.wochenende || t.feiertag ? '#b45309' : '#475569', fontWeight: 600 }}>
                {WOCHENTAGE[d.getDay()]}, {datumDeutsch(t.datum).slice(0, 5)}
              </span>
              <span style={{ flex: 1, minWidth: 140 }}>
                {t.text}
                {t.feiertag ? ` · ${t.feiertag}` : ''}
                {t.nacht ? ' · Nacht' : ''}
              </span>
              {t.art === 'dienst' && (
                <span style={{ color: '#475569' }}>
                  {stundenText(t.netto)}
                  {t.mehr !== 0 ? ` (${t.mehr > 0 ? '+' : '-'}${stundenText(Math.abs(t.mehr))} Korrektur)` : ''}
                </span>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  const urlaubsDetail = (id: string) => {
    const w = urlaubsWerte(id)
    if (w.antraege.length === 0) return <div style={{ fontSize: 13, color: '#94a3b8', padding: 8 }}>Keine Anträge in diesem Jahr.</div>
    return (
      <div style={{ padding: '4px 4px 8px' }}>
        {w.antraege.map((a) => (
          <div key={a.id} style={{ display: 'flex', gap: 10, fontSize: 13, padding: '3px 0', flexWrap: 'wrap' }}>
            <span style={{ minWidth: 190, fontWeight: 600 }}>
              {datumDeutsch(a.erster_tag)} – {datumDeutsch(a.letzter_tag)}
            </span>
            <span>{zahl(a.brauchbare_tage ?? a.anzahl_tage)} Arbeitstage</span>
            <span style={{ color: a.status === 'genehmigt' ? '#15803d' : a.status === 'abgelehnt' ? '#b91c1c' : '#b45309', fontWeight: 600 }}>
              {a.status === 'offen' ? 'Noch nicht bearbeitet' : a.status === 'genehmigt' ? 'Genehmigt' : 'Abgelehnt'}
            </span>
          </div>
        ))}
      </div>
    )
  }

  const restFarbe = (rest: number) => (rest < 0 ? '#b91c1c' : rest <= 5 ? '#b45309' : '#15803d')

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        <button onClick={() => setAnsicht('monat')} style={knopf(ansicht === 'monat')}>
          Monatsübersicht
        </button>
        <button onClick={() => setAnsicht('urlaub')} style={knopf(ansicht === 'urlaub')}>
          Urlaubsübersicht
        </button>
        <div style={{ flex: 1 }} />
        {ansicht === 'monat' && (
          <>
            <select value={monat} onChange={(e) => setMonat(Number(e.target.value))} style={eingabe}>
              {MONATE.map((m, i) => (
                <option key={m} value={i}>
                  {m}
                </option>
              ))}
            </select>
          </>
        )}
        <select value={jahr} onChange={(e) => setJahr(Number(e.target.value))} style={eingabe}>
          {[heute.getFullYear() - 2, heute.getFullYear() - 1, heute.getFullYear(), heute.getFullYear() + 1].map((j) => (
            <option key={j} value={j}>
              {j}
            </option>
          ))}
        </select>
        {!nurEigene && (
          <>
            <select value={kategorie} onChange={(e) => setKategorie(e.target.value)} style={eingabe}>
              <option value="alle">Alle Bereiche</option>
              {KATEGORIEN.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <button onClick={exportieren} style={{ ...knopf(false), fontSize: 13 }} title="Als Excel-Datei (CSV) speichern">
              Export (Excel)
            </button>
          </>
        )}
      </div>

      {fehler && (
        <div style={{ background: '#fee2e2', color: '#991b1b', padding: '8px 12px', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>{fehler}</div>
      )}
      {laedt && <div style={{ fontSize: 14, color: '#64748b' }}>Wird geladen …</div>}

      {!laedt && sichtbar.length === 0 && <div style={{ fontSize: 14, color: '#94a3b8' }}>Keine Mitarbeiter gefunden.</div>}

      {!laedt && ansicht === 'monat' && sichtbar.length > 0 && (
        <>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>
            Geplante Stunden sind die Arbeitszeit der Schichten ohne Pause. Mehrzeit sind genehmigte Zeitkorrekturen. Nachtdienste haben mehr als 2 Stunden
            zwischen 23 und 6 Uhr. Urlaubstage zählen Montag bis Freitag ohne Feiertag.
          </div>
          <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 10, background: '#ffffff' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
              <thead>
                <tr>
                  <th style={{ ...th, textAlign: 'left' }}>Name</th>
                  <th style={th}>Dienste</th>
                  <th style={th}>Geplant</th>
                  <th style={th}>Mehrzeit</th>
                  <th style={th}>Gesamt</th>
                  <th style={th}>Nacht</th>
                  <th style={th}>Wochenende</th>
                  <th style={th}>Feiertag</th>
                  <th style={th}>Urlaub</th>
                  <th style={th}>Frei/Ruhe</th>
                </tr>
              </thead>
              <tbody>
                {sichtbar.map((p) => {
                  const w = monatsWerte(p.id)
                  const offen = nurEigene || aufgeklappt === p.id
                  return (
                    <Fragment key={p.id}>
                      <tr onClick={() => !nurEigene && setAufgeklappt(aufgeklappt === p.id ? null : p.id)} style={{ cursor: nurEigene ? 'default' : 'pointer' }}>
                        <td style={tdName}>
                          {p.name}
                          {offeneKorrekturen[p.id] ? <span style={{ marginLeft: 6, fontSize: 11, color: '#b45309' }}>({offeneKorrekturen[p.id]} Korrektur offen)</span> : null}
                        </td>
                        <td style={td}>{w.dienste}</td>
                        <td style={td}>{stundenText(w.geplant)}</td>
                        <td style={{ ...td, color: w.mehr > 0 ? '#b45309' : undefined }}>{w.mehr === 0 ? '–' : `${w.mehr > 0 ? '+' : '-'}${stundenText(Math.abs(w.mehr))}`}</td>
                        <td style={{ ...td, fontWeight: 700 }}>{stundenText(w.gesamt)}</td>
                        <td style={td}>{w.nacht}</td>
                        <td style={td}>{w.wochenende}</td>
                        <td style={td}>{w.feiertag}</td>
                        <td style={td}>{w.urlaub}</td>
                        <td style={td}>{w.frei}</td>
                      </tr>
                      {offen && (
                        <tr>
                          <td colSpan={10} style={{ background: '#f8fafc', padding: '6px 14px', borderBottom: '1px solid #eef2f8' }}>
                            {monatsDetail(p.id)}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
          {!nurEigene && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 8 }}>Klicke auf einen Namen, um die einzelnen Tage zu sehen.</div>}
        </>
      )}

      {!laedt && ansicht === 'urlaub' && sichtbar.length > 0 && (
        <>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>
            Resturlaub ist der Wert aus der Mitarbeiterübersicht (wird bei Genehmigung automatisch abgezogen). „Rest nach offenen“ zieht noch nicht bearbeitete
            Anträge ab.
          </div>
          <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 10, background: '#ffffff' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 780 }}>
              <thead>
                <tr>
                  <th style={{ ...th, textAlign: 'left' }}>Name</th>
                  <th style={th}>Anspruch</th>
                  <th style={th}>Rest Vorjahr</th>
                  <th style={th}>Genehmigt</th>
                  <th style={th}>Genommen</th>
                  <th style={th}>Noch geplant</th>
                  <th style={th}>Offen beantragt</th>
                  <th style={th}>Resturlaub</th>
                  <th style={th}>Rest nach offenen</th>
                </tr>
              </thead>
              <tbody>
                {sichtbar.map((p) => {
                  const w = urlaubsWerte(p.id)
                  const offen = nurEigene || aufgeklappt === p.id
                  return (
                    <Fragment key={p.id}>
                      <tr onClick={() => !nurEigene && setAufgeklappt(aufgeklappt === p.id ? null : p.id)} style={{ cursor: nurEigene ? 'default' : 'pointer' }}>
                        <td style={tdName}>
                          {p.name}
                          {w.standard && <span style={{ marginLeft: 6, fontSize: 11, color: '#94a3b8' }}>(Standard 30 Tage)</span>}
                        </td>
                        <td style={td}>{w.anspruch}</td>
                        <td style={td}>{w.vorjahr}</td>
                        <td style={td}>{w.genehmigt}</td>
                        <td style={td}>{w.genommen}</td>
                        <td style={td}>{w.geplant}</td>
                        <td style={{ ...td, color: w.offen > 0 ? '#b45309' : undefined }}>{w.offen}</td>
                        <td style={{ ...td, fontWeight: 700, color: restFarbe(w.rest) }}>{w.rest}</td>
                        <td style={{ ...td, fontWeight: 700, color: restFarbe(w.restNachOffen) }}>{w.restNachOffen}</td>
                      </tr>
                      {offen && (
                        <tr>
                          <td colSpan={9} style={{ background: '#f8fafc', padding: '6px 14px', borderBottom: '1px solid #eef2f8' }}>
                            {urlaubsDetail(p.id)}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
          {!nurEigene && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 8 }}>Klicke auf einen Namen, um die Anträge zu sehen. Alle Werte in Arbeitstagen.</div>}
        </>
      )}
    </div>
  )
}
