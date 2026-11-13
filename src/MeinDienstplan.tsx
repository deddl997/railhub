import { useEffect, useRef, useState } from 'react'
import { supabase } from './lib/supabase'
import { datumZuISO } from './datumUtils'
import { pushAktivieren, pushDeaktivieren, pushStatus } from './pushAbo'
import type { PushStatus } from './pushAbo'
import ZeitkorrekturMitarbeiter from './ZeitkorrekturMitarbeiter'
import { useLiveAktualisierung } from './liveAktualisierung'
import { fahrtenPruefen, infoAusFahrten } from './auftragSchicht'
import type { Fahrtzeile } from './auftragSchicht'

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
  auftrag_id?: string | null
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

interface Wunsch {
  id: string
  datum: string
  notiz: string | null
  status: string
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

function nettoMinuten(beginn: string, ende: string, pause: number): number {
  let d = minuten(ende) - minuten(beginn)
  if (d <= 0) d += 1440
  return Math.max(d - pause, 0)
}

function stundenText(min: number): string {
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`
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
  const [ansicht, setAnsicht] = useState<'plan' | 'wunsch' | 'zeit'>('plan')
  const [gelesen, setGelesen] = useState<string[]>([])
  const [gelesenGeladen, setGelesenGeladen] = useState(false)
  const [kategorie, setKategorie] = useState<string | null>(null)
  const [antritt, setAntritt] = useState<{ status: string; gemeldet_am: string | null; neuer_beginn: string | null } | null>(null)
  const [antrittFehler, setAntrittFehler] = useState<string | null>(null)
  const [jetztMin, setJetztMin] = useState(() => new Date().getHours() * 60 + new Date().getMinutes())
  const [wuensche, setWuensche] = useState<Wunsch[]>([])
  const [pushZustand, setPushZustand] = useState<PushStatus>('aus')
  const [pushMeldung, setPushMeldung] = useState<string | null>(null)
  const [jahresdaten, setJahresdaten] = useState<{ resturlaub: number | null; resturlaub_vorjahr: number | null; rfu_datum: string | null; simulator_datum: string | null } | null>(null)
  const [offeneAntraege, setOffeneAntraege] = useState(0)
  const [wunschDatum, setWunschDatum] = useState('')
  const [wunschNotiz, setWunschNotiz] = useState('')
  const [wunschFehler, setWunschFehler] = useState<string | null>(null)
  const [neuLadenZaehler, setNeuLadenZaehler] = useState(0)
  const stillNeuLaden = useRef(false)
  const [offeneFahrten, setOffeneFahrten] = useState<Fahrtzeile[]>([])
  const [loks, setLoks] = useState<Record<string, string>>({})
  const offenerAuftragId = offenerTag ? (eintraege.find((e) => e.datum === offenerTag)?.auftrag_id ?? null) : null

  // Fahrten (Lokzuführung, Zugfahrt, Rückführung) der geöffneten Schicht laden
  useEffect(() => {
    setOffeneFahrten([])
    if (!offenerAuftragId) return
    let abgebrochen = false
    supabase.rpc('meine_fahrten', { p_auftrag_id: offenerAuftragId }).then(({ data }) => {
      if (!abgebrochen) setOffeneFahrten(fahrtenPruefen(data))
    })
    return () => {
      abgebrochen = true
    }
  }, [offenerAuftragId])

  const heute = new Date()
  heute.setHours(0, 0, 0, 0)
  const heuteIso = datumZuISO(heute)
  const ersteWoche = montagDerWoche(heute)

  // Lok pro Diensttag laden (aus dem Auftrag, der dem Dienst zugeordnet ist). Fehlt die Funktion, bleibt die Anzeige einfach leer.
  useEffect(() => {
    let abgebrochen = false
    const von = datumZuISO(ersteWoche)
    const bis = datumZuISO(addTage(ersteWoche, anzahlWochen * 7 - 1))
    supabase.rpc('meine_loks', { p_von: von, p_bis: bis }).then(({ data, error }) => {
      if (abgebrochen || error) return
      const karte: Record<string, string> = {}
      for (const z of (data ?? []) as { datum: string; lok: string | null }[]) {
        if (z.lok) karte[String(z.datum).slice(0, 10)] = z.lok
      }
      setLoks(karte)
    })
    return () => {
      abgebrochen = true
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datumZuISO(ersteWoche), anzahlWochen, neuLadenZaehler])


  useEffect(() => {
    async function laden() {
      // beim automatischen Neuladen keine Ladeanzeige, damit nichts flackert
      if (!stillNeuLaden.current) setLadeVorgang(true)
      stillNeuLaden.current = false
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
  }, [mitarbeiterId, anzahlWochen, neuLadenZaehler])

  async function extraLaden() {
    const [gel, wun, jd, offen] = await Promise.all([
      supabase.from('dienstplan_gelesen').select('woche_start').eq('mitarbeiter_id', mitarbeiterId),
      supabase.from('wunschfrei').select('id, datum, notiz, status').gte('datum', heuteIso).order('datum'),
      supabase
        .from('mitarbeiter_jahresdaten')
        .select('resturlaub, resturlaub_vorjahr, rfu_datum, simulator_datum')
        .eq('mitarbeiter_id', mitarbeiterId)
        .eq('jahr', heute.getFullYear())
        .maybeSingle(),
      supabase.from('urlaubsantraege').select('id, gruppe_id').eq('mitarbeiter_id', mitarbeiterId).eq('status', 'offen'),
    ])
    setGelesen((gel.data ?? []).map((g) => String(g.woche_start)))
    setGelesenGeladen(true)
    setWuensche((wun.data ?? []) as Wunsch[])
    setJahresdaten(jd.data ?? null)
    setOffeneAntraege(new Set((offen.data ?? []).map((x: { id: string; gruppe_id: string | null }) => x.gruppe_id ?? x.id)).size)
  }

  useEffect(() => {
    extraLaden()
    pushStatus().then(setPushZustand)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mitarbeiterId])

  // Aenderungen vom Planer erscheinen von selbst
  useLiveAktualisierung(
    ['dienstplan_eintraege', 'dienstplan_freigaben', 'schichtvorlagen', 'wunschfrei', 'dienstplan_gelesen', 'urlaubsantraege', 'auftraege', 'dienst_antritt'],
    () => {
      stillNeuLaden.current = true
      setNeuLadenZaehler((z) => z + 1)
      extraLaden()
    }
  )

  // Dienstantritt: Anmeldung von heute und Kategorie laden
  async function antrittLaden() {
    const [a, k] = await Promise.all([
      supabase.from('dienst_antritt').select('status, gemeldet_am, neuer_beginn').eq('mitarbeiter_id', mitarbeiterId).eq('datum', heuteIso).maybeSingle(),
      supabase.from('mitarbeiter').select('kategorie').eq('id', mitarbeiterId).maybeSingle(),
    ])
    if (!a.error) setAntritt((a.data as { status: string; gemeldet_am: string | null; neuer_beginn: string | null } | null) ?? null)
    if (!k.error) setKategorie((k.data as { kategorie: string | null } | null)?.kategorie ?? null)
  }
  useEffect(() => {
    void antrittLaden()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mitarbeiterId, neuLadenZaehler])
  useEffect(() => {
    const t = setInterval(() => setJetztMin(new Date().getHours() * 60 + new Date().getMinutes()), 30000)
    return () => clearInterval(t)
  }, [])

  async function antrittMelden() {
    setAntrittFehler(null)
    const { error } = await supabase.from('dienst_antritt').upsert(
      { mitarbeiter_id: mitarbeiterId, datum: heuteIso, status: 'angemeldet', gemeldet_am: new Date().toISOString(), gemeldet_von: 'mitarbeiter', neuer_beginn: null },
      { onConflict: 'mitarbeiter_id,datum' }
    )
    if (error) {
      setAntrittFehler('Anmeldung fehlgeschlagen: ' + error.message)
      return
    }
    await antrittLaden()
  }

  async function gelesenBestaetigen(wocheIso: string) {
    const { error } = await supabase
      .from('dienstplan_gelesen')
      .upsert({ mitarbeiter_id: mitarbeiterId, woche_start: wocheIso, gelesen_am: new Date().toISOString() })
    if (error) {
      setFehler('Bestätigung fehlgeschlagen: ' + error.message)
      return
    }
    setGelesen((alt) => [...alt, wocheIso])
  }

  async function wunschEintragen() {
    setWunschFehler(null)
    if (!wunschDatum) {
      setWunschFehler('Bitte ein Datum wählen.')
      return
    }
    if (wunschDatum < heuteIso) {
      setWunschFehler('Das Datum liegt in der Vergangenheit.')
      return
    }
    const { error } = await supabase
      .from('wunschfrei')
      .upsert(
        { mitarbeiter_id: mitarbeiterId, datum: wunschDatum, notiz: wunschNotiz.trim() || null },
        { onConflict: 'mitarbeiter_id,datum' }
      )
    if (error) {
      setWunschFehler('Speichern fehlgeschlagen: ' + error.message)
      return
    }
    setWunschDatum('')
    setWunschNotiz('')
    await extraLaden()
  }

  async function wunschLoeschen(id: string) {
    await supabase.from('wunschfrei').delete().eq('id', id)
    await extraLaden()
  }

  async function pushUmschalten() {
    setPushMeldung(null)
    if (pushZustand === 'aktiv') {
      await pushDeaktivieren()
    } else {
      const fehlerText = await pushAktivieren(mitarbeiterId)
      if (fehlerText) setPushMeldung(fehlerText)
    }
    setPushZustand(await pushStatus())
  }

  function tagSchliessen() {
    setOffenerTag(null)
  }

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

  // Eine veröffentlichte, noch nicht vergangene Woche ist gesperrt, bis der Mitarbeiter sie bestätigt hat
  function gesperrt(woche: Date): boolean {
    const iso = datumZuISO(woche)
    return freigegeben.includes(iso) && !gelesen.includes(iso) && datumZuISO(addTage(woche, 6)) >= heuteIso
  }
  const offeneWochen = wochen.filter((w) => gesperrt(w))

  // Dienstantritt (nur Lokführer): heutiger Dienst, falls die Woche veröffentlicht und bestätigt ist
  const heuteWoche = wochen.find((w) => datumZuISO(w) === datumZuISO(ersteWoche))
  const heuteDienst =
    heuteWoche && freigegeben.includes(datumZuISO(heuteWoche)) && !gesperrt(heuteWoche) && !istUrlaub(heuteIso)
      ? dienstFuer(eintraege.find((e) => e.datum === heuteIso))
      : null
  const antrittPflicht = kategorie === 'Lokführer' && heuteDienst !== null
  const antrittBeginnMin = heuteDienst ? minuten(heuteDienst.beginn) : 0
  let antrittEndeMin = heuteDienst ? minuten(heuteDienst.ende) : 0
  if (heuteDienst && antrittEndeMin <= antrittBeginnMin) antrittEndeMin += 1440
  const antrittFruehestens = antrittBeginnMin - 120

  // Naechster Dienst
  let naechster: { tag: Date; dienst: Dienst } | null = null
  for (const woche of wochen) {
    if (!freigegeben.includes(datumZuISO(woche)) || gesperrt(woche)) continue
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
      if (!freigegeben.includes(datumZuISO(woche)) || gesperrt(woche)) continue
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

  const knopfLeise: React.CSSProperties = {
    background: 'none',
    border: '1px solid var(--navy)',
    color: 'var(--navy)',
    borderRadius: 8,
    padding: '8px 14px',
    fontSize: 13,
    cursor: 'pointer',
  }
  const knopfVoll: React.CSSProperties = {
    background: 'var(--navy)',
    color: '#ffffff',
    border: 'none',
    borderRadius: 8,
    padding: '9px 16px',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
  }
  const eingabe: React.CSSProperties = {
    padding: '9px 10px',
    border: '1px solid var(--border)',
    borderRadius: 8,
    fontSize: 14,
    width: '100%',
    boxSizing: 'border-box',
  }

  const datumAusgeschrieben = (iso: string) => {
    const d = new Date(iso + 'T00:00:00')
    return `${WOCHENTAGE[d.getDay()]}, ${datumKurz(d)}${d.getFullYear()}`
  }

  const datumLang = (iso: string) => {
    const d = new Date(iso + 'T00:00:00')
    return `${WOCHENTAGE[d.getDay()].slice(0, 2)}, ${datumKurz(d)}${d.getFullYear()}`
  }

  const tabLeiste = (
    <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', marginBottom: 14 }}>
      {(
        [
          ['plan', 'Dienstplan'],
          ['wunsch', 'Wunschfrei'],
          ['zeit', 'Zeiten'],
        ] as const
      ).map(([id, label]) => (
        <button
          key={id}
          onClick={() => setAnsicht(id)}
          style={{
            flex: 1,
            border: 'none',
            padding: '10px 6px',
            fontSize: 14,
            fontWeight: ansicht === id ? 700 : 500,
            cursor: 'pointer',
            background: ansicht === id ? 'var(--navy)' : '#ffffff',
            color: ansicht === id ? '#ffffff' : 'var(--navy)',
          }}
        >
          {label}
        </button>
      ))}
    </div>
  )

  const pushKarte =
    pushZustand === 'nicht-konfiguriert' ? null : pushZustand === 'nicht-unterstuetzt' ? (
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>
        🔔 Benachrichtigungen funktionieren, wenn du die App über das Symbol auf dem Home-Bildschirm öffnest.
      </div>
    ) : pushZustand === 'blockiert' ? (
      <div style={{ fontSize: 12, color: '#92400e', background: '#fffbeb', borderRadius: 8, padding: '8px 12px', marginBottom: 12 }}>
        🔔 Benachrichtigungen sind blockiert. Du kannst sie in den iPhone-Einstellungen unter Mitteilungen wieder erlauben.
      </div>
    ) : (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          background: pushZustand === 'aktiv' ? '#f0fdf4' : '#eff6ff',
          border: `1px solid ${pushZustand === 'aktiv' ? '#bbf7d0' : '#bfdbfe'}`,
          borderRadius: 10,
          padding: '10px 12px',
          marginBottom: 12,
          fontSize: 13,
        }}
      >
        <span>
          🔔 {pushZustand === 'aktiv' ? 'Benachrichtigungen sind aktiv.' : 'Melde dich bei neuem Dienstplan und Änderungen.'}
        </span>
        <button onClick={pushUmschalten} style={pushZustand === 'aktiv' ? knopfLeise : knopfVoll}>
          {pushZustand === 'aktiv' ? 'Ausschalten' : 'Aktivieren'}
        </button>
      </div>
    )

  const wunschTab = (
    <div>
      <div style={{ border: '1px solid var(--border)', borderRadius: 14, padding: 16, marginBottom: 18, background: '#ffffff', boxShadow: '0 1px 3px rgba(15,23,42,0.06)' }}>
        <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--navy)', marginBottom: 4 }}>Wunschfrei beantragen</div>
        <div style={{ fontSize: 13, color: '#64748b', marginBottom: 14, lineHeight: 1.5 }}>
          Du möchtest an einem Tag frei haben? Wähle das Datum aus. Der Planer entscheidet danach. Das ist kein Urlaubsantrag, und es gibt keinen Urlaubsabzug.
        </div>

        <div style={{ fontSize: 13, fontWeight: 700, color: '#334155', marginBottom: 6 }}>
          <span style={{ background: 'var(--navy)', color: '#fff', borderRadius: 999, padding: '1px 8px', marginRight: 6, fontSize: 12 }}>1</span>
          Für welchen Tag?
        </div>
        <label style={{ position: 'relative', display: 'block', marginBottom: 8, cursor: 'pointer' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '14px 14px',
              borderRadius: 12,
              border: wunschDatum ? '2px solid var(--navy)' : '2px dashed #94a3b8',
              background: wunschDatum ? '#eef4fb' : '#f8fafc',
            }}
          >
            <span style={{ fontSize: 26, lineHeight: 1 }}>📅</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              {wunschDatum ? (
                <>
                  <div style={{ fontSize: 12, color: '#64748b' }}>Dein Wunsch-Tag</div>
                  <div style={{ fontWeight: 800, fontSize: 18, color: 'var(--navy)' }}>{datumAusgeschrieben(wunschDatum)}</div>
                </>
              ) : (
                <>
                  <div style={{ fontWeight: 700, fontSize: 15, color: '#334155' }}>Datum auswählen</div>
                  <div style={{ fontSize: 12, color: '#64748b' }}>Hier antippen – der Kalender öffnet sich</div>
                </>
              )}
            </div>
            <span style={{ color: '#94a3b8', fontSize: 20 }}>›</span>
          </div>
          <input
            type="date"
            min={heuteIso}
            value={wunschDatum}
            onChange={(e) => setWunschDatum(e.target.value)}
            aria-label="Datum für Wunschfrei auswählen"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer', fontSize: 16 }}
          />
        </label>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
          {[
            { text: 'Morgen', n: 1 },
            { text: 'Übermorgen', n: 2 },
            { text: 'Nächster Samstag', n: ((6 - heute.getDay() + 7) % 7) || 7 },
            { text: 'Nächster Sonntag', n: ((7 - heute.getDay()) % 7) || 7 },
          ].map((q) => {
            const iso = datumZuISO(addTage(heute, q.n))
            return (
              <button
                key={q.text}
                onClick={() => setWunschDatum(iso)}
                style={{
                  border: 'none',
                  borderRadius: 999,
                  padding: '6px 12px',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  background: wunschDatum === iso ? 'var(--navy)' : '#f1f5f9',
                  color: wunschDatum === iso ? '#ffffff' : '#334155',
                }}
              >
                {q.text}
              </button>
            )
          })}
        </div>

        <div style={{ fontSize: 13, fontWeight: 700, color: '#334155', marginBottom: 6 }}>
          <span style={{ background: 'var(--navy)', color: '#fff', borderRadius: 999, padding: '1px 8px', marginRight: 6, fontSize: 12 }}>2</span>
          Grund <span style={{ fontWeight: 400, color: '#94a3b8' }}>(freiwillig)</span>
        </div>
        <input
          value={wunschNotiz}
          onChange={(e) => setWunschNotiz(e.target.value)}
          placeholder="z. B. Arzttermin, Familienfeier"
          style={{ ...eingabe, marginBottom: 14 }}
        />

        {wunschFehler && <div style={{ color: '#b91c1c', fontSize: 13, marginBottom: 10 }}>{wunschFehler}</div>}
        <button
          onClick={wunschEintragen}
          disabled={!wunschDatum}
          style={{ ...knopfVoll, width: '100%', padding: '12px 16px', fontSize: 15, opacity: wunschDatum ? 1 : 0.5, cursor: wunschDatum ? 'pointer' : 'not-allowed' }}
        >
          {wunschDatum ? `Wunschfrei für ${datumLang(wunschDatum)} eintragen` : 'Erst ein Datum auswählen'}
        </button>
      </div>

      <div style={{ fontWeight: 700, color: 'var(--navy)', marginBottom: 8 }}>Meine Wünsche</div>
      {wuensche.length === 0 ? (
        <div style={{ color: '#94a3b8', fontSize: 13 }}>Keine Wünsche eingetragen.</div>
      ) : (
        <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', background: '#ffffff' }}>
          {wuensche.map((w, i) => (
            <div
              key={w.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                padding: '10px 12px',
                borderBottom: i < wuensche.length - 1 ? '1px solid #eef2f8' : undefined,
              }}
            >
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{datumLang(w.datum)}</div>
                {w.notiz && <div style={{ fontSize: 12, color: '#64748b' }}>{w.notiz}</div>}
                <div
                  style={{
                    display: 'inline-block',
                    fontSize: 12,
                    fontWeight: 600,
                    marginTop: 4,
                    borderRadius: 999,
                    padding: '2px 10px',
                    background: w.status === 'genehmigt' ? '#dcfce7' : w.status === 'abgelehnt' ? '#fee2e2' : '#fef3c7',
                    color: w.status === 'genehmigt' ? '#15803d' : w.status === 'abgelehnt' ? '#b91c1c' : '#b45309',
                  }}
                >
                  {w.status === 'genehmigt'
                    ? '✓ Genehmigt'
                    : w.status === 'abgelehnt'
                    ? 'Abgelehnt'
                    : 'Wartet auf Entscheidung des Planers'}
                </div>
              </div>
              <button
                onClick={() => wunschLoeschen(w.id)}
                aria-label="Wunsch löschen"
                style={{ background: 'none', border: 'none', color: '#b91c1c', fontSize: 18, cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )

  return (
    <div>
      {fehler && (
        <div style={{ background: '#fee2e2', color: '#991b1b', padding: '8px 12px', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>
          {fehler}
        </div>
      )}

      {tabLeiste}
      {pushKarte}
      {pushMeldung && (
        <div style={{ background: '#fee2e2', color: '#991b1b', padding: '8px 12px', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>
          {pushMeldung}
        </div>
      )}
      {ansicht === 'wunsch' && wunschTab}
      {ansicht === 'zeit' && <ZeitkorrekturMitarbeiter mitarbeiterId={mitarbeiterId} />}
      {ansicht === 'plan' && (
        <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginBottom: 14 }}>
        {[
          {
            titel: `Resturlaub ${heute.getFullYear()}`,
            wert: jahresdaten?.resturlaub != null ? `${jahresdaten.resturlaub} Tage` : '–',
            hinweis: jahresdaten?.resturlaub_vorjahr ? `+ ${jahresdaten.resturlaub_vorjahr} aus Vorjahr` : undefined,
            farbe: 'var(--navy)',
          },
          {
            titel: 'Offene Urlaubsanträge',
            wert: String(offeneAntraege),
            hinweis: offeneAntraege > 0 ? 'warten auf Freigabe' : 'keine offen',
            farbe: offeneAntraege > 0 ? '#b45309' : 'var(--navy)',
          },
          {
            titel: 'Termin RFU',
            wert: jahresdaten?.rfu_datum ? jahresdaten.rfu_datum.split('-').reverse().join('.') : 'noch offen',
            farbe: jahresdaten?.rfu_datum ? 'var(--navy)' : '#94a3b8',
          },
          {
            titel: 'Termin Simulator',
            wert: jahresdaten?.simulator_datum ? jahresdaten.simulator_datum.split('-').reverse().join('.') : 'noch offen',
            farbe: jahresdaten?.simulator_datum ? 'var(--navy)' : '#94a3b8',
          },
        ].map((k) => (
          <div key={k.titel} style={{ background: '#ffffff', border: '1px solid var(--border)', borderRadius: 10, padding: '9px 12px' }}>
            <div style={{ fontSize: 11, color: '#64748b' }}>{k.titel}</div>
            <div style={{ fontSize: 17, fontWeight: 700, color: k.farbe }}>{k.wert}</div>
            {k.hinweis && <div style={{ fontSize: 11, color: '#94a3b8' }}>{k.hinweis}</div>}
          </div>
        ))}
      </div>

      {antrittPflicht && heuteDienst && jetztMin <= antrittEndeMin && (
        <div style={{ background: antritt?.status === 'angemeldet' ? '#f0fdf4' : '#eff6ff', border: `2px solid ${antritt?.status === 'angemeldet' ? '#86efac' : '#93c5fd'}`, borderRadius: 12, padding: 16, marginBottom: 18 }}>
          {antritt?.status === 'angemeldet' ? (
            <div style={{ fontWeight: 700, color: '#166534', fontSize: 16 }}>
              ✓ Dienstantritt gemeldet{antritt.gemeldet_am ? ` um ${new Date(antritt.gemeldet_am).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr` : ''}
              <div style={{ fontWeight: 400, fontSize: 13, color: '#166534', marginTop: 2 }}>
                {heuteDienst.name} · {kurz(heuteDienst.beginn)} – {kurz(heuteDienst.ende)}
              </div>
            </div>
          ) : (
            <>
              <div style={{ fontWeight: 700, color: '#1e3a8a', fontSize: 16, marginBottom: 2 }}>🚉 Dienstantritt heute</div>
              <div style={{ fontSize: 13, color: '#1e3a8a', marginBottom: 10 }}>
                {heuteDienst.name} · {kurz(heuteDienst.beginn)} – {kurz(heuteDienst.ende)}
                {antritt?.status === 'verschoben' && antritt.neuer_beginn ? ` · Dein Dienstbeginn wurde auf ${kurz(antritt.neuer_beginn)} verschoben.` : ''}
                {antritt?.status === 'nicht_erschienen' ? ' · Vom Planer als nicht erschienen vermerkt. Du kannst dich trotzdem noch anmelden.' : ''}
              </div>
              {jetztMin >= antrittFruehestens ? (
                <button onClick={antrittMelden} style={{ ...knopfVoll, padding: '12px 20px', fontSize: 15, width: '100%' }}>
                  Ich bin da: Dienstantritt melden
                </button>
              ) : (
                <div style={{ fontSize: 13, color: '#1e3a8a' }}>
                  Die Anmeldung ist ab {String(Math.floor(((antrittFruehestens % 1440) + 1440) % 1440 / 60)).padStart(2, '0')}:{String((((antrittFruehestens % 1440) + 1440) % 1440) % 60).padStart(2, '0')} Uhr möglich (2 Stunden vor Dienstbeginn).
                </div>
              )}
              {antrittFehler && <div style={{ color: '#b91c1c', fontSize: 13, marginTop: 8 }}>{antrittFehler}</div>}
            </>
          )}
        </div>
      )}

      {offeneWochen.length > 0 && (
        <div style={{ background: '#fffbeb', border: '2px solid #f59e0b', borderRadius: 12, padding: 16, marginBottom: 18 }}>
          <div style={{ fontWeight: 700, color: '#92400e', fontSize: 16, marginBottom: 4 }}>
            📬 Neuer Dienstplan wartet auf deine Bestätigung
          </div>
          <div style={{ fontSize: 13, color: '#92400e', marginBottom: 10 }}>
            Bitte bestätige {offeneWochen.length > 1 ? 'die Wochen' : 'die Woche'} ab {offeneWochen.map((w) => datumKurz(w)).join(', ')}. Erst danach siehst du deine Dienste und deine Lok.
          </div>
          {gelesenGeladen && (
            <button
              onClick={async () => {
                for (const w of offeneWochen) await gelesenBestaetigen(datumZuISO(w))
              }}
              style={{ ...knopfVoll, padding: '10px 18px', fontSize: 14 }}
            >
              Dienstplan ansehen und bestätigen
            </button>
          )}
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
          {loks[datumZuISO(naechster.tag)] && (
            <div style={{ marginTop: 6, fontSize: 16, fontWeight: 700, background: 'rgba(255,255,255,0.18)', borderRadius: 6, padding: '5px 10px', display: 'inline-block' }}>
              🚂 Lok: {loks[datumZuISO(naechster.tag)]}
            </div>
          )}
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
          {offeneWochen.length > 0 ? 'Bestätige zuerst den neuen Dienstplan, dann siehst du hier deinen nächsten Dienst.' : 'Aktuell ist kein kommender Dienst veröffentlicht.'}
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
              <div>
                <div style={{ fontWeight: 700, color: 'var(--navy)' }}>
                  KW {kalenderwoche(woche)} · {datumKurz(woche)} – {datumKurz(addTage(woche, 6))}
                </div>
                {veroeffentlicht && !gesperrt(woche) &&
                  (() => {
                    let summe = 0
                    for (let i = 0; i < 7; i++) {
                      const iso = datumZuISO(addTage(woche, i))
                      if (istUrlaub(iso)) continue
                      const d = dienstFuer(eintraege.find((e) => e.datum === iso))
                      if (d) summe += nettoMinuten(d.beginn, d.ende, d.pause)
                    }
                    return summe > 0 ? <div style={{ fontSize: 12, color: '#64748b' }}>Arbeitszeit netto: {stundenText(summe)} Std.</div> : null
                  })()}
              </div>
              {!veroeffentlicht && (
                <span style={{ fontSize: 11, background: '#fef3c7', color: '#92400e', borderRadius: 999, padding: '2px 10px' }}>
                  Noch nicht veröffentlicht
                </span>
              )}
              {veroeffentlicht &&
                (gelesen.includes(wocheIso) ? (
                  <span style={{ fontSize: 11, background: '#dcfce7', color: '#166534', borderRadius: 999, padding: '2px 10px', fontWeight: 600 }}>
                    ✓ Gelesen
                  </span>
                ) : gesperrt(woche) ? (
                  <span style={{ fontSize: 11, background: '#fef3c7', color: '#92400e', borderRadius: 999, padding: '2px 10px', fontWeight: 600 }}>
                    🔒 bitte bestätigen
                  </span>
                ) : (
                  <button
                    onClick={() => gelesenBestaetigen(wocheIso)}
                    style={{ ...knopfVoll, padding: '5px 12px', fontSize: 12 }}
                  >
                    Gelesen bestätigen
                  </button>
                ))}
            </div>

            {veroeffentlicht && gesperrt(woche) ? (
              <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 10, padding: 18, textAlign: 'center' }}>
                <div style={{ fontSize: 28 }}>🔒</div>
                <div style={{ fontWeight: 700, color: '#92400e', marginBottom: 4 }}>Neuer Dienstplan veröffentlicht</div>
                <div style={{ fontSize: 13, color: '#92400e', marginBottom: 12 }}>
                  Bitte bestätige zuerst, dass du ihn zur Kenntnis nimmst. Danach siehst du deine Dienste und deine Lok.
                </div>
                {gelesenGeladen ? (
                  <button onClick={() => gelesenBestaetigen(wocheIso)} style={{ ...knopfVoll, padding: '10px 18px', fontSize: 14 }}>
                    Dienstplan ansehen und bestätigen
                  </button>
                ) : (
                  <div style={{ fontSize: 12, color: '#92400e' }}>Lädt …</div>
                )}
              </div>
            ) : veroeffentlicht ? (
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
                            {loks[iso] && <div style={{ fontSize: 12, fontWeight: 700, color: '#14325c', marginTop: 2 }}>🚂 Lok: {loks[iso]}</div>}
                            {dienst.info && <div style={{ fontSize: 12, color: '#92400e', marginTop: 2 }}>ℹ {dienst.info}</div>}
                          </div>
                        ) : eintrag?.status === 'ruhe' ? (
                          <span style={{ color: '#0e7490', fontWeight: 600, fontSize: 13 }}>Ruhe</span>
                        ) : eintrag?.status === 'frei' ? (
                          <span style={{ color: '#64748b', fontWeight: 600, fontSize: 13 }}>Frei</span>
                        ) : (
                          <span style={{ color: '#cbd5e1', fontSize: 13 }}>–</span>
                        )}
                        {wuensche.some((w) => w.datum === iso && w.status === 'offen') && (
                          <div style={{ fontSize: 11, color: '#92400e', marginTop: 2 }}>★ Wunschfrei beantragt</div>
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
            onClick={tagSchliessen}
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
                  onClick={tagSchliessen}
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
                  {offenerTag && loks[offenerTag] && (
                    <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', color: '#14325c', borderRadius: 8, padding: '8px 12px', fontSize: 14, fontWeight: 700, marginBottom: 10 }}>
                      🚂 Deine Lok: {loks[offenerTag]}
                    </div>
                  )}
                  {offeneFahrten.length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ fontWeight: 700, fontSize: 13, color: '#0f2447', marginBottom: 6 }}>Deine Fahrten</div>
                      {offeneFahrten.map((f, i) => {
                        const zug = f.art === 'Zugfahrt'
                        return (
                          <div
                            key={i}
                            style={{
                              display: 'flex',
                              gap: 10,
                              alignItems: 'flex-start',
                              border: '1px solid #e2e8f0',
                              borderLeft: `5px solid ${zug ? '#14325c' : '#b45309'}`,
                              borderRadius: 8,
                              padding: '8px 10px',
                              marginBottom: 6,
                              background: '#ffffff',
                            }}
                          >
                            <div style={{ minWidth: 56, fontWeight: 700, fontSize: 15, lineHeight: 1.3 }}>
                              <div>{f.von_zeit || '–'}</div>
                              <div style={{ color: '#64748b', fontWeight: 500 }}>{f.nach_zeit || '–'}</div>
                            </div>
                            <div style={{ fontSize: 14, flex: 1 }}>
                              <div style={{ fontSize: 11, fontWeight: 700, color: zug ? '#14325c' : '#b45309', textTransform: 'uppercase' }}>
                                {f.art}
                                {f.zug ? ` · ${f.zug}` : ''}
                              </div>
                              <div>
                                <b>{f.von || '?'}</b> → <b>{f.nach || '?'}</b>
                              </div>
                              {f.lok && <div style={{ fontSize: 12, color: '#64748b' }}>Lok {f.lok}</div>}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                  {(() => {
                    const erzeugt = offeneFahrten.length > 0 ? infoAusFahrten(offeneFahrten, null) : ''
                    let rest = dienst.info ?? ''
                    if (erzeugt && rest.startsWith(erzeugt)) rest = rest.slice(erzeugt.length).trim()
                    else if (erzeugt) rest = dienst.info ?? ''
                    return rest ? (
                      <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e3a8a', borderRadius: 8, padding: '10px 12px', fontSize: 14 }}>
                        <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 4 }}>{offeneFahrten.length > 0 ? 'Weitere Info vom Planer' : 'Fahrten und Info vom Planer'}</div>
                        <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{rest}</div>
                      </div>
                    ) : offeneFahrten.length > 0 ? null : (
                      <div style={{ fontSize: 13, color: '#94a3b8' }}>Keine zusätzliche Info vom Planer.</div>
                    )
                  })()}

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
              {wuensche.some((w) => w.datum === offenerTag && w.status === 'offen') && (
                <div style={{ marginTop: 10, fontSize: 13, color: '#92400e' }}>★ Für diesen Tag hast du Wunschfrei beantragt.</div>
              )}
            </div>
          </div>
        )
      })()}
        </>
      )}
    </div>
  )
}
