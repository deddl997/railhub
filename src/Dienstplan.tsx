import { Fragment, useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import { datumZuISO } from './datumUtils'
import { KATEGORIEN } from './qualifikationen'

interface Mitarbeiter {
  id: string
  name: string
  kategorie: string | null
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
  benoetigte_wochentage: number[] | null
  bereich?: string | null
}

interface OffeneSpot {
  id: string
  datum: string
  bereich: string
  name: string
  beginn_zeit: string
  ende_zeit: string
  pause_minuten: number | null
  dienstort: string | null
  farbe: string | null
  info?: string | null
}

interface Warnung {
  art: 'ueberschneidung' | 'ruhezeit' | 'urlaub'
  kurz: string
  lang: string
}

interface OffenesElement {
  art: 'vorlage' | 'spot'
  id: string
  tagDatum: string
  bereich: string
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
  spot_info?: string | null
  abw_beginn_zeit?: string | null
  abw_ende_zeit?: string | null
  abw_pause_minuten?: number | null
  abw_dienstort?: string | null
  abw_info?: string | null
  status: string | null
}

interface UrlaubsBlock {
  mitarbeiter_id: string
  erster_tag: string
  letzter_tag: string
}

interface SchichtInfo {
  titel: string
  farbe: string
  beginn: number // Minuten ab 00:00
  ende: number // Minuten ab Beginn-Tag, kann > 1440 sein (Nachtschicht)
  pause: number
  pauseVon: number | null
  pauseBis: number | null
  ort: string | null
  info: string | null
  abweichung: boolean
}

interface Balken {
  info: SchichtInfo
  von: number // Minuten im angezeigten Tag (0-1440)
  bis: number
  vortag: boolean // Nachtschicht vom Vortag
  weiter: boolean // laeuft in den Folgetag
}

const SPOT_STANDARD = {
  name: '',
  beginn_zeit: '06:00',
  ende_zeit: '18:00',
  pause_minuten: 0,
  dienstort: '',
  farbe: '#8b1a1a',
  info: '',
}

const ABW_LEER = {
  abw_beginn_zeit: null,
  abw_ende_zeit: null,
  abw_pause_minuten: null,
  abw_dienstort: null,
  abw_info: null,
}

const MONATE = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
]

type Ansicht = 'tag' | 'woche' | 'monat'

function kalenderwoche(datum: Date): number {
  const d = new Date(Date.UTC(datum.getFullYear(), datum.getMonth(), datum.getDate()))
  const tag = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - tag)
  const jahrStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  return Math.ceil(((d.getTime() - jahrStart.getTime()) / 86400000 + 1) / 7)
}

function textFarbeFuer(hex: string): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return '#ffffff'
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const helligkeit = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return helligkeit > 0.65 ? '#0f2447' : '#ffffff'
}

const BEREICHE = ['Lokführer', 'Wagenmeister'] as const

function bereichVonKategorie(kategorie: string | null): string {
  return (kategorie ?? '').toLowerCase().includes('wagen') ? 'Wagenmeister' : 'Lokführer'
}

const WOCHENTAGE_KURZ = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
const WOCHENTAGE_LANG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']
const STUNDEN = Array.from({ length: 24 }, (_, i) => i)

function stundeKurz(minuten: number): string {
  const m = ((minuten % 1440) + 1440) % 1440
  if (m % 60 === 0) return String(m / 60).padStart(2, '0')
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

function addTage(datum: Date, anzahl: number): Date {
  const neu = new Date(datum)
  neu.setDate(neu.getDate() + anzahl)
  return neu
}

function montagDerWoche(datum: Date): Date {
  const tag = datum.getDay()
  const differenz = tag === 0 ? -6 : 1 - tag
  const montag = new Date(datum)
  montag.setDate(datum.getDate() + differenz)
  montag.setHours(0, 0, 0, 0)
  return montag
}

function heuteOhneUhrzeit(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function datumKurz(datum: Date): string {
  const tag = String(datum.getDate()).padStart(2, '0')
  const monat = String(datum.getMonth() + 1).padStart(2, '0')
  return `${tag}.${monat}.`
}

function istHeute(datum: Date): boolean {
  const heute = new Date()
  return (
    datum.getFullYear() === heute.getFullYear() &&
    datum.getMonth() === heute.getMonth() &&
    datum.getDate() === heute.getDate()
  )
}

function istWochenende(datum: Date): boolean {
  const tag = datum.getDay()
  return tag === 0 || tag === 6
}

function zeitKurz(zeit: string | null): string {
  return zeit ? zeit.slice(0, 5) : ''
}

function zeitInMinuten(zeit: string): number {
  const [h, m] = zeit.split(':').map(Number)
  return h * 60 + m
}

function minutenAlsUhrzeit(minuten: number): string {
  const m = ((minuten % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

function minutenAlsText(minuten: number): string {
  const stunden = Math.floor(minuten / 60)
  const rest = minuten % 60
  return `${stunden}:${String(rest).padStart(2, '0')}`
}

function initialen(name: string): string {
  const teile = name.trim().split(/\s+/)
  if (teile.length === 1) return teile[0].slice(0, 2).toUpperCase()
  return (teile[0][0] + teile[teile.length - 1][0]).toUpperCase()
}

function farbeFuerAvatar(name: string): string {
  const palette = ['#14325c', '#2c4a73', '#0e7490', '#7c3aed', '#be185d', '#a16207', '#15803d']
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return palette[Math.abs(hash) % palette.length]
}

export default function Dienstplan() {
  const [ansicht, setAnsicht] = useState<Ansicht>('tag')
  const [ausgewaehlterBalken, setAusgewaehlterBalken] = useState<{ mitarbeiterId: string; datum: string } | null>(null)
  const [tauschenOffen, setTauschenOffen] = useState(false)
  const [freigegebeneWochen, setFreigegebeneWochen] = useState<string[]>([])
  const [tauschZiel, setTauschZiel] = useState('')
  const [mindestbesetzung, setMindestbesetzung] = useState(() => {
    try {
      const gespeichert = window.localStorage.getItem('dienstplan_mindestbesetzung')
      return gespeichert ? Number(gespeichert) || 2 : 2
    } catch {
      return 2
    }
  })
  const [bezugsdatum, setBezugsdatum] = useState(() => heuteOhneUhrzeit())
  const [mitarbeiterListe, setMitarbeiterListe] = useState<Mitarbeiter[]>([])
  const [vorlagen, setVorlagen] = useState<Schichtvorlage[]>([])
  const [eintraege, setEintraege] = useState<DienstplanEintrag[]>([])
  const [urlaube, setUrlaube] = useState<UrlaubsBlock[]>([])
  const [ladeVorgang, setLadeVorgang] = useState(true)
  const [erstesLaden, setErstesLaden] = useState(true)

  const [ausgewaehlteZelle, setAusgewaehlteZelle] = useState<{ mitarbeiterId: string; datum: string } | null>(null)
  const [offeneSpots, setOffeneSpots] = useState<OffeneSpot[]>([])
  const [gezogeneVorlage, setGezogeneVorlage] = useState<OffenesElement | null>(null)
  const [offenSpotDialogOffen, setOffenSpotDialogOffen] = useState(false)
  const [offenSpotDaten, setOffenSpotDaten] = useState({
    datum: '',
    bereich: 'Lokführer',
    name: '',
    beginn_zeit: '06:00',
    ende_zeit: '18:00',
    pause_minuten: 0,
    dienstort: '',
    farbe: '#8b1a1a',
    info: '',
  })
  const [offenSpotBearbeitenId, setOffenSpotBearbeitenId] = useState<string | null>(null)
  const [gezogenerEintrag, setGezogenerEintrag] = useState<{ mitarbeiterId: string; datum: string } | null>(null)
  const [hoverZiel, setHoverZiel] = useState<string | null>(null)
  const [gewaehlteVorlage, setGewaehlteVorlage] = useState('')
  const [spotFormularOffen, setSpotFormularOffen] = useState(false)
  const [abwFormularOffen, setAbwFormularOffen] = useState(false)
  const [abwDaten, setAbwDaten] = useState({
    beginn_zeit: '06:00',
    ende_zeit: '18:00',
    pause_minuten: 0,
    dienstort: '',
    info: '',
  })
  const [spotDaten, setSpotDaten] = useState(SPOT_STANDARD)

  const wochenStart = montagDerWoche(bezugsdatum)
  const tage = Array.from({ length: 7 }, (_, i) => addTage(wochenStart, i))
  const tagIso = datumZuISO(bezugsdatum)
  const wochenStartIso = datumZuISO(wochenStart)
  const monatsErster = new Date(bezugsdatum.getFullYear(), bezugsdatum.getMonth(), 1)
  const monatsTage = Array.from(
    { length: new Date(bezugsdatum.getFullYear(), bezugsdatum.getMonth() + 1, 0).getDate() },
    (_, i) => new Date(bezugsdatum.getFullYear(), bezugsdatum.getMonth(), i + 1)
  )
  const ladeSchluessel = ansicht === 'monat' ? `m-${datumZuISO(monatsErster)}` : `w-${wochenStartIso}`

  async function laden() {
    setLadeVorgang(true)
    // ein Tag davor wird mitgeladen, damit Nachtschichten vom Vortag sichtbar sind
    const bereichStart = ansicht === 'monat' ? monatsErster : wochenStart
    const bereichEnde = ansicht === 'monat' ? monatsTage[monatsTage.length - 1] : tage[6]
    const startIso = datumZuISO(addTage(bereichStart, -1))
    const endeIso = datumZuISO(bereichEnde)
    const urlaubStartIso = datumZuISO(bereichStart)

    const [
      { data: mitarbeiterData },
      { data: vorlagenData },
      { data: eintraegeData },
      { data: urlaubeData },
      { data: spotsData },
      { data: freigabenData },
    ] = await Promise.all([
        supabase.from('mitarbeiter').select('id, name, kategorie').order('name'),
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
          .gte('letzter_tag', urlaubStartIso),
        supabase
          .from('offene_spotschichten')
          .select('*')
          .gte('datum', urlaubStartIso)
          .lte('datum', endeIso),
        supabase.from('dienstplan_freigaben').select('woche_start'),
    ])

    const sortierteMitarbeiter = [...(mitarbeiterData ?? [])].sort((a, b) => {
      const rangA = a.kategorie ? KATEGORIEN.indexOf(a.kategorie) : 999
      const rangB = b.kategorie ? KATEGORIEN.indexOf(b.kategorie) : 999
      const bereinigtA = rangA === -1 ? 998 : rangA
      const bereinigtB = rangB === -1 ? 998 : rangB
      if (bereinigtA !== bereinigtB) return bereinigtA - bereinigtB
      return a.name.localeCompare(b.name)
    })
    setMitarbeiterListe(sortierteMitarbeiter)
    setVorlagen(vorlagenData ?? [])
    setEintraege(eintraegeData ?? [])
    setUrlaube((urlaubeData ?? []).filter((u) => u.mitarbeiter_id))
    setOffeneSpots((spotsData ?? []) as OffeneSpot[])
    setFreigegebeneWochen((freigabenData ?? []).map((f) => String(f.woche_start)))
    setLadeVorgang(false)
    setErstesLaden(false)
  }

  useEffect(() => {
    laden()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ladeSchluessel])

  function istUrlaub(mitarbeiterId: string, datumIso: string): boolean {
    return urlaube.some(
      (u) => u.mitarbeiter_id === mitarbeiterId && datumIso >= u.erster_tag && datumIso <= u.letzter_tag
    )
  }

  function eintragFuer(mitarbeiterId: string, datumIso: string): DienstplanEintrag | undefined {
    return eintraege.find((e) => e.mitarbeiter_id === mitarbeiterId && e.datum === datumIso)
  }

  // Zeiten, Farbe und Name einer Schicht (Spotschicht oder Vorlage). Ruhe/Frei haben keine Schicht.
  function schichtInfoVon(eintrag: DienstplanEintrag | undefined): SchichtInfo | null {
    if (!eintrag || eintrag.status) return null
    if (eintrag.ist_spotschicht && eintrag.spot_beginn_zeit && eintrag.spot_ende_zeit) {
      const beginn = zeitInMinuten(eintrag.spot_beginn_zeit)
      let ende = zeitInMinuten(eintrag.spot_ende_zeit)
      if (ende <= beginn) ende += 1440
      return {
        titel: eintrag.spot_name ?? 'Spotschicht',
        farbe: eintrag.spot_farbe ?? '#8b1a1a',
        beginn,
        ende,
        pause: eintrag.spot_pause_minuten ?? 0,
        pauseVon: null,
        pauseBis: null,
        ort: eintrag.spot_dienstort,
        info: eintrag.spot_info ?? null,
        abweichung: false,
      }
    }
    if (eintrag.schichtvorlage_id) {
      const v = vorlagen.find((x) => x.id === eintrag.schichtvorlage_id)
      if (!v) return null
      const basis = infoAusVorlage(v)
      // Dienstzeitabweichung fuer genau diesen Eintrag
      const hatZeitAbw = !!(eintrag.abw_beginn_zeit || eintrag.abw_ende_zeit)
      const beginn = eintrag.abw_beginn_zeit ? zeitInMinuten(eintrag.abw_beginn_zeit) : basis.beginn
      let ende = eintrag.abw_ende_zeit ? zeitInMinuten(eintrag.abw_ende_zeit) : basis.ende
      if (ende <= beginn) ende += 1440
      return {
        ...basis,
        beginn,
        ende,
        pause: eintrag.abw_pause_minuten ?? basis.pause,
        pauseVon: hatZeitAbw ? null : basis.pauseVon,
        pauseBis: hatZeitAbw ? null : basis.pauseBis,
        ort: eintrag.abw_dienstort ?? basis.ort,
        info: eintrag.abw_info ?? null,
        abweichung: hatZeitAbw || eintrag.abw_pause_minuten != null || eintrag.abw_dienstort != null,
      }
    }
    return null
  }

  function infoAusVorlage(v: Schichtvorlage): SchichtInfo {
    const beginn = zeitInMinuten(v.beginn_zeit)
    let ende = zeitInMinuten(v.ende_zeit)
    if (ende <= beginn) ende += 1440
    return {
      titel: v.name,
      farbe: v.farbe,
      beginn,
      ende,
      pause: v.pause_minuten ?? 0,
      pauseVon: v.pause_von ? zeitInMinuten(v.pause_von) : null,
      pauseBis: v.pause_bis ? zeitInMinuten(v.pause_bis) : null,
      ort: v.dienstort,
      info: null,
      abweichung: false,
    }
  }

  // Alle Balken einer Person fuer einen Tag (inkl. Nachtschicht vom Vortag)
  function balkenFuer(mitarbeiterId: string, datum: Date): Balken[] {
    const ergebnis: Balken[] = []
    const vortagInfo = schichtInfoVon(eintragFuer(mitarbeiterId, datumZuISO(addTage(datum, -1))))
    if (vortagInfo && vortagInfo.ende > 1440) {
      ergebnis.push({ info: vortagInfo, von: 0, bis: vortagInfo.ende - 1440, vortag: true, weiter: false })
    }
    const heuteInfo = schichtInfoVon(eintragFuer(mitarbeiterId, datumZuISO(datum)))
    if (heuteInfo) {
      ergebnis.push({
        info: heuteInfo,
        von: heuteInfo.beginn,
        bis: Math.min(heuteInfo.ende, 1440),
        vortag: false,
        weiter: heuteInfo.ende > 1440,
      })
    }
    return ergebnis
  }

  function zelleOeffnen(mitarbeiterId: string, datumIso: string) {
    setAusgewaehlteZelle({ mitarbeiterId, datum: datumIso })
    setGewaehlteVorlage('')
    setAbwFormularOffen(false)
    const eintrag = eintragFuer(mitarbeiterId, datumIso)
    const aktuelleInfo = eintrag && !eintrag.ist_spotschicht ? schichtInfoVon(eintrag) : null
    if (aktuelleInfo) {
      setAbwDaten({
        beginn_zeit: minutenAlsUhrzeit(aktuelleInfo.beginn),
        ende_zeit: minutenAlsUhrzeit(aktuelleInfo.ende),
        pause_minuten: aktuelleInfo.pause,
        dienstort: aktuelleInfo.ort ?? '',
        info: eintrag?.abw_info ?? '',
      })
    }
    if (eintrag?.ist_spotschicht) {
      // bestehende Spotschicht: direkt im Bearbeiten-Formular oeffnen
      setSpotDaten({
        name: eintrag.spot_name ?? '',
        beginn_zeit: zeitKurz(eintrag.spot_beginn_zeit) || '06:00',
        ende_zeit: zeitKurz(eintrag.spot_ende_zeit) || '18:00',
        pause_minuten: eintrag.spot_pause_minuten ?? 0,
        dienstort: eintrag.spot_dienstort ?? '',
        farbe: eintrag.spot_farbe ?? '#8b1a1a',
        info: eintrag.spot_info ?? '',
      })
      setSpotFormularOffen(true)
    } else {
      setSpotDaten(SPOT_STANDARD)
      setSpotFormularOffen(false)
    }
  }

  async function schichtDirektZuweisen(vorlageId: string, mitarbeiterId: string, datumIso: string) {
    const bestehend = eintragFuer(mitarbeiterId, datumIso)
    if (bestehend) {
      const bestaetigt = window.confirm(
        'Für diesen Tag ist bereits ein Eintrag vorhanden. Überschreiben?'
      )
      if (!bestaetigt) return
    }
    await supabase.from('dienstplan_eintraege').upsert(
      {
        ...ABW_LEER,
        mitarbeiter_id: mitarbeiterId,
        datum: datumIso,
        schichtvorlage_id: vorlageId,
        ist_spotschicht: false,
        status: null,
      },
      { onConflict: 'mitarbeiter_id,datum' }
    )
    await laden()
  }

  async function eintragVerschieben(
    quelle: { mitarbeiterId: string; datum: string },
    zielMitarbeiterId: string,
    zielDatumIso: string
  ) {
    if (quelle.mitarbeiterId === zielMitarbeiterId && quelle.datum === zielDatumIso) return
    const quellEintrag = eintragFuer(quelle.mitarbeiterId, quelle.datum)
    if (!quellEintrag) return

    const zielBestehend = eintragFuer(zielMitarbeiterId, zielDatumIso)
    if (zielBestehend) {
      const bestaetigt = window.confirm('Der Zieltag hat bereits einen Eintrag. Überschreiben?')
      if (!bestaetigt) return
    }

    await supabase
      .from('dienstplan_eintraege')
      .delete()
      .eq('mitarbeiter_id', quelle.mitarbeiterId)
      .eq('datum', quelle.datum)

    await supabase.from('dienstplan_eintraege').upsert(
      {
        ...ABW_LEER,
        mitarbeiter_id: zielMitarbeiterId,
        datum: zielDatumIso,
        schichtvorlage_id: quellEintrag.schichtvorlage_id,
        ist_spotschicht: quellEintrag.ist_spotschicht,
        spot_name: quellEintrag.spot_name,
        spot_beginn_zeit: quellEintrag.spot_beginn_zeit,
        spot_ende_zeit: quellEintrag.spot_ende_zeit,
        spot_pause_minuten: quellEintrag.spot_pause_minuten,
        spot_dienstort: quellEintrag.spot_dienstort,
        spot_farbe: quellEintrag.spot_farbe,
        spot_info: quellEintrag.spot_info ?? null,
        status: quellEintrag.status,
        abw_beginn_zeit: quellEintrag.abw_beginn_zeit ?? null,
        abw_ende_zeit: quellEintrag.abw_ende_zeit ?? null,
        abw_pause_minuten: quellEintrag.abw_pause_minuten ?? null,
        abw_dienstort: quellEintrag.abw_dienstort ?? null,
        abw_info: quellEintrag.abw_info ?? null,
      },
      { onConflict: 'mitarbeiter_id,datum' }
    )
    await laden()
  }

  async function vorlageZuweisen() {
    if (!ausgewaehlteZelle || !gewaehlteVorlage) return
    await supabase.from('dienstplan_eintraege').upsert(
      {
        ...ABW_LEER,
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
        ...ABW_LEER,
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
        spot_info: spotDaten.info.trim() || null,
        status: null,
      },
      { onConflict: 'mitarbeiter_id,datum' }
    )
    setAusgewaehlteZelle(null)
    setSpotDaten(SPOT_STANDARD)
    await laden()
  }

  async function abweichungSpeichern() {
    if (!ausgewaehlteZelle) return
    const eintrag = eintragFuer(ausgewaehlteZelle.mitarbeiterId, ausgewaehlteZelle.datum)
    const vorlage = vorlagen.find((v) => v.id === eintrag?.schichtvorlage_id)
    if (!eintrag || !vorlage) return
    await supabase
      .from('dienstplan_eintraege')
      .update({
        abw_beginn_zeit: abwDaten.beginn_zeit !== zeitKurz(vorlage.beginn_zeit) ? abwDaten.beginn_zeit : null,
        abw_ende_zeit: abwDaten.ende_zeit !== zeitKurz(vorlage.ende_zeit) ? abwDaten.ende_zeit : null,
        abw_pause_minuten: abwDaten.pause_minuten !== (vorlage.pause_minuten ?? 0) ? abwDaten.pause_minuten : null,
        abw_dienstort: abwDaten.dienstort !== (vorlage.dienstort ?? '') ? abwDaten.dienstort : null,
        abw_info: abwDaten.info.trim() || null,
      })
      .eq('mitarbeiter_id', ausgewaehlteZelle.mitarbeiterId)
      .eq('datum', ausgewaehlteZelle.datum)
    setAusgewaehlteZelle(null)
    await laden()
  }

  async function abweichungZuruecksetzen() {
    if (!ausgewaehlteZelle) return
    await supabase
      .from('dienstplan_eintraege')
      .update(ABW_LEER)
      .eq('mitarbeiter_id', ausgewaehlteZelle.mitarbeiterId)
      .eq('datum', ausgewaehlteZelle.datum)
    setAusgewaehlteZelle(null)
    await laden()
  }

  async function statusSetzen(status: 'ruhe' | 'frei') {
    if (!ausgewaehlteZelle) return
    await supabase.from('dienstplan_eintraege').upsert(
      {
        ...ABW_LEER,
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

  // Zuweisung zurueck in den "Offen"-Pool: normale Schichten werden einfach geleert,
  // Spotschichten werden wieder zu offenen Spotschichten.
  async function eintragLoeschenExtern(ziel: { mitarbeiterId: string; datum: string }) {
    const eintrag = eintragFuer(ziel.mitarbeiterId, ziel.datum)
    if (eintrag?.ist_spotschicht && eintrag.spot_beginn_zeit && eintrag.spot_ende_zeit) {
      const person = mitarbeiterListe.find((m) => m.id === ziel.mitarbeiterId)
      await supabase.from('offene_spotschichten').insert({
        datum: ziel.datum,
        bereich: bereichVonKategorie(person?.kategorie ?? null),
        name: eintrag.spot_name ?? 'Spotschicht',
        beginn_zeit: eintrag.spot_beginn_zeit,
        ende_zeit: eintrag.spot_ende_zeit,
        pause_minuten: eintrag.spot_pause_minuten ?? 0,
        dienstort: eintrag.spot_dienstort,
        farbe: eintrag.spot_farbe,
        info: eintrag.spot_info ?? null,
      })
    }
    await supabase
      .from('dienstplan_eintraege')
      .delete()
      .eq('mitarbeiter_id', ziel.mitarbeiterId)
      .eq('datum', ziel.datum)
    await laden()
  }

  async function spotZuweisen(spotId: string, mitarbeiterId: string, datumIso: string) {
    const spot = offeneSpots.find((x) => x.id === spotId)
    if (!spot) return
    if (eintragFuer(mitarbeiterId, datumIso)) {
      const bestaetigt = window.confirm('Für diesen Tag ist bereits ein Eintrag vorhanden. Überschreiben?')
      if (!bestaetigt) return
    }
    await supabase.from('dienstplan_eintraege').upsert(
      {
        ...ABW_LEER,
        mitarbeiter_id: mitarbeiterId,
        datum: datumIso,
        schichtvorlage_id: null,
        ist_spotschicht: true,
        spot_name: spot.name,
        spot_beginn_zeit: spot.beginn_zeit,
        spot_ende_zeit: spot.ende_zeit,
        spot_pause_minuten: spot.pause_minuten ?? 0,
        spot_dienstort: spot.dienstort,
        spot_farbe: spot.farbe,
        spot_info: spot.info ?? null,
        status: null,
      },
      { onConflict: 'mitarbeiter_id,datum' }
    )
    await supabase.from('offene_spotschichten').delete().eq('id', spotId)
    await laden()
  }

  // Zentrale Zuweisung per Drag & Drop (Vorlage oder offene Spotschicht)
  async function offenesZuweisen(quelle: OffenesElement, mitarbeiterId: string, datumIso: string) {
    const person = mitarbeiterListe.find((m) => m.id === mitarbeiterId)
    const personBereich = bereichVonKategorie(person?.kategorie ?? null)
    if (quelle.bereich !== personBereich) {
      const ok = window.confirm(
        `Diese Schicht gehört zum Bereich ${quelle.bereich}, ${person?.name ?? 'die Person'} ist ${personBereich}. Trotzdem zuweisen?`
      )
      if (!ok) return
    }
    if (quelle.art === 'vorlage') {
      await schichtDirektZuweisen(quelle.id, mitarbeiterId, datumIso)
    } else {
      await spotZuweisen(quelle.id, mitarbeiterId, datumIso)
    }
  }

  function offenSpotDialogOeffnen() {
    setOffenSpotBearbeitenId(null)
    setOffenSpotDaten({ ...SPOT_STANDARD, datum: tagIso, bereich: 'Lokführer' })
    setOffenSpotDialogOffen(true)
  }

  function offenSpotBearbeiten(x: OffeneSpot) {
    setOffenSpotBearbeitenId(x.id)
    setOffenSpotDaten({
      datum: x.datum,
      bereich: x.bereich,
      name: x.name,
      beginn_zeit: zeitKurz(x.beginn_zeit),
      ende_zeit: zeitKurz(x.ende_zeit),
      pause_minuten: x.pause_minuten ?? 0,
      dienstort: x.dienstort ?? '',
      farbe: x.farbe ?? '#8b1a1a',
      info: x.info ?? '',
    })
    setOffenSpotDialogOffen(true)
  }

  async function offeneSpotschichtAnlegen() {
    if (!offenSpotDaten.name.trim() || !offenSpotDaten.datum) return
    const werte = {
      datum: offenSpotDaten.datum,
      bereich: offenSpotDaten.bereich,
      name: offenSpotDaten.name.trim(),
      beginn_zeit: offenSpotDaten.beginn_zeit,
      ende_zeit: offenSpotDaten.ende_zeit,
      pause_minuten: offenSpotDaten.pause_minuten,
      dienstort: offenSpotDaten.dienstort || null,
      farbe: offenSpotDaten.farbe,
      info: offenSpotDaten.info.trim() || null,
    }
    if (offenSpotBearbeitenId) {
      await supabase.from('offene_spotschichten').update(werte).eq('id', offenSpotBearbeitenId)
    } else {
      await supabase.from('offene_spotschichten').insert(werte)
    }
    setOffenSpotDialogOffen(false)
    setOffenSpotBearbeitenId(null)
    setOffenSpotDaten({ ...SPOT_STANDARD, datum: tagIso, bereich: 'Lokführer' })
    await laden()
  }

  async function offeneSpotschichtLoeschen(spot: OffeneSpot) {
    if (!window.confirm(`Offene Spotschicht "${spot.name}" wirklich löschen?`)) return
    await supabase.from('offene_spotschichten').delete().eq('id', spot.id)
    await laden()
  }

  function wochenMinuten(mitarbeiterId: string): number {
    let summe = 0
    for (const tag of tage) {
      if (istUrlaub(mitarbeiterId, datumZuISO(tag))) continue
      const info = schichtInfoVon(eintragFuer(mitarbeiterId, datumZuISO(tag)))
      if (info) summe += info.ende - info.beginn
    }
    return summe
  }

  function wochenArbeitszeit(mitarbeiterId: string): string {
    return minutenAlsText(wochenMinuten(mitarbeiterId))
  }

  // Warnungen fuer eine Person an einem Tag (Ueberschneidung / zu kurze Ruhezeit)
  function warnungenFuer(mitarbeiterId: string, datum: Date): Warnung[] {
    if (istUrlaub(mitarbeiterId, datumZuISO(datum))) {
      // Urlaub genehmigt, aber noch eine Schicht eingetragen
      if (schichtInfoVon(eintragFuer(mitarbeiterId, datumZuISO(datum)))) {
        return [
          {
            art: 'urlaub',
            kurz: 'Urlaub, aber Schicht eingetragen',
            lang: 'Urlaub ist genehmigt, es ist aber noch eine Schicht eingetragen. Zelle anklicken und "Eintrag leeren" wählen, dann ist die Schicht wieder offen.',
          },
        ]
      }
      return []
    }
    const vortag = schichtInfoVon(eintragFuer(mitarbeiterId, datumZuISO(addTage(datum, -1))))
    const heute = schichtInfoVon(eintragFuer(mitarbeiterId, datumZuISO(datum)))
    if (!vortag || !heute) return []
    const ruhe = 1440 + heute.beginn - vortag.ende
    if (ruhe < 0) {
      return [
        {
          art: 'ueberschneidung',
          kurz: 'Überschneidung',
          lang: `Überschneidung: Die Schicht vom Vortag endet erst um ${minutenAlsUhrzeit(vortag.ende)}, die heutige beginnt schon um ${minutenAlsUhrzeit(heute.beginn)}.`,
        },
      ]
    }
    if (ruhe < 660) {
      return [
        {
          art: 'ruhezeit',
          kurz: `Ruhezeit nur ${minutenAlsText(ruhe)} Std.`,
          lang: `Ruhezeit nur ${minutenAlsText(ruhe)} Std. (mind. 11 Std.): Vortag Ende ${minutenAlsUhrzeit(vortag.ende)}, heute Beginn ${minutenAlsUhrzeit(heute.beginn)}.`,
        },
      ]
    }
    return []
  }

  function offeneVorlagenFuerTag(datumIso: string, wochentag: number, bereich: string): Schichtvorlage[] {
    return vorlagen.filter((v) => {
      if ((v.bereich ?? 'Lokführer') !== bereich) return false
      const benoetigt = (v.benoetigte_wochentage ?? [0, 1, 2, 3, 4, 5, 6]).includes(wochentag)
      if (!benoetigt) return false
      // Wer im Urlaub ist, belegt die Schicht nicht: sie bleibt offen
      const bereitsVergeben = eintraege.some(
        (e) => e.schichtvorlage_id === v.id && e.datum === datumIso && !istUrlaub(e.mitarbeiter_id, datumIso)
      )
      return !bereitsVergeben
    })
  }

  function offeneSpotsFuerTag(datumIso: string, bereich: string): OffeneSpot[] {
    return offeneSpots.filter((x) => x.datum === datumIso && x.bereich === bereich)
  }

  function infoAusSpot(x: OffeneSpot): SchichtInfo {
    const beginn = zeitInMinuten(x.beginn_zeit)
    let ende = zeitInMinuten(x.ende_zeit)
    if (ende <= beginn) ende += 1440
    return {
      titel: x.name,
      farbe: x.farbe ?? '#8b1a1a',
      beginn,
      ende,
      pause: x.pause_minuten ?? 0,
      pauseVon: null,
      pauseBis: null,
      ort: x.dienstort,
      info: x.info ?? null,
      abweichung: false,
    }
  }

  function eintragPayload(e: DienstplanEintrag, mitarbeiterId: string, datumIso: string) {
    return {
      mitarbeiter_id: mitarbeiterId,
      datum: datumIso,
      schichtvorlage_id: e.schichtvorlage_id,
      ist_spotschicht: e.ist_spotschicht,
      spot_name: e.spot_name,
      spot_beginn_zeit: e.spot_beginn_zeit,
      spot_ende_zeit: e.spot_ende_zeit,
      spot_pause_minuten: e.spot_pause_minuten,
      spot_dienstort: e.spot_dienstort,
      spot_farbe: e.spot_farbe,
      spot_info: e.spot_info ?? null,
      abw_beginn_zeit: e.abw_beginn_zeit ?? null,
      abw_ende_zeit: e.abw_ende_zeit ?? null,
      abw_pause_minuten: e.abw_pause_minuten ?? null,
      abw_dienstort: e.abw_dienstort ?? null,
      abw_info: e.abw_info ?? null,
      status: e.status,
    }
  }

  // Zwei Personen tauschen ihre Schichten am selben Tag
  async function eintragTauschen(quelle: { mitarbeiterId: string; datum: string }, zielId: string) {
    const eA = eintragFuer(quelle.mitarbeiterId, quelle.datum)
    if (!eA || !zielId) return
    const eB = eintragFuer(zielId, quelle.datum)
    await supabase
      .from('dienstplan_eintraege')
      .delete()
      .eq('datum', quelle.datum)
      .in('mitarbeiter_id', [quelle.mitarbeiterId, zielId])
    await supabase
      .from('dienstplan_eintraege')
      .upsert(eintragPayload(eA, zielId, quelle.datum), { onConflict: 'mitarbeiter_id,datum' })
    if (eB) {
      await supabase
        .from('dienstplan_eintraege')
        .upsert(eintragPayload(eB, quelle.mitarbeiterId, quelle.datum), { onConflict: 'mitarbeiter_id,datum' })
    }
    setTauschenOffen(false)
    setTauschZiel('')
    setAusgewaehlterBalken({ mitarbeiterId: zielId, datum: quelle.datum })
    await laden()
  }

  function uebersichtFuerTage(tageListe: Date[]): { dienste: number; offen: number } {
    let dienste = 0
    let offen = 0
    for (const tag of tageListe) {
      const iso = datumZuISO(tag)
      for (const m of mitarbeiterListe) {
        if (!istUrlaub(m.id, iso) && schichtInfoVon(eintragFuer(m.id, iso))) dienste++
      }
      for (const b of BEREICHE) {
        offen += offeneVorlagenFuerTag(iso, tag.getDay(), b).length + offeneSpotsFuerTag(iso, b).length
      }
    }
    return { dienste, offen }
  }

  async function wocheVeroeffentlichen() {
    const bestaetigt = window.confirm(
      `Woche ${datumKurz(tage[0])} – ${datumKurz(tage[6])} für alle Mitarbeiter veröffentlichen? Jeder sieht dann seinen eigenen Dienstplan dieser Woche. Spätere Änderungen sind sofort sichtbar.`
    )
    if (!bestaetigt) return
    const { error } = await supabase.from('dienstplan_freigaben').upsert({ woche_start: wochenStartIso })
    if (error) window.alert('Veröffentlichen fehlgeschlagen: ' + error.message)
    await laden()
  }

  async function wocheZurueckziehen() {
    const bestaetigt = window.confirm(
      'Veröffentlichung zurückziehen? Die Mitarbeiter sehen diese Woche dann nicht mehr.'
    )
    if (!bestaetigt) return
    const { error } = await supabase.from('dienstplan_freigaben').delete().eq('woche_start', wochenStartIso)
    if (error) window.alert('Zurückziehen fehlgeschlagen: ' + error.message)
    await laden()
  }

  function auswahlZuruecksetzen() {
    setAusgewaehlterBalken(null)
    setTauschenOffen(false)
    setTauschZiel('')
  }

  function navigieren(richtung: -1 | 1) {
    auswahlZuruecksetzen()
    if (ansicht === 'monat') {
      setBezugsdatum(new Date(bezugsdatum.getFullYear(), bezugsdatum.getMonth() + richtung, 1))
    } else {
      setBezugsdatum(addTage(bezugsdatum, (ansicht === 'tag' ? 1 : 7) * richtung))
    }
  }

  function zuTagSpringen(tag: Date, mitarbeiterId?: string) {
    setBezugsdatum(tag)
    setAnsicht('tag')
    setTauschenOffen(false)
    setTauschZiel('')
    setAusgewaehlterBalken(mitarbeiterId ? { mitarbeiterId, datum: datumZuISO(tag) } : null)
  }

  if (erstesLaden && ladeVorgang) {
    return <p style={{ color: 'var(--text-muted)' }}>Lade Dienstplan...</p>
  }

  const anzeigeTage = ansicht === 'tag' ? [bezugsdatum] : ansicht === 'woche' ? tage : monatsTage
  const uebersicht = uebersichtFuerTage(anzeigeTage)
  const toolbarTitel =
    ansicht === 'tag'
      ? `${WOCHENTAGE_LANG[bezugsdatum.getDay()]}, ${datumKurz(bezugsdatum)}${bezugsdatum.getFullYear()}`
      : ansicht === 'woche'
      ? `${datumKurz(tage[0])} – ${datumKurz(tage[6])} ${tage[0].getFullYear()}`
      : `${MONATE[bezugsdatum.getMonth()]} ${bezugsdatum.getFullYear()}`
  const toolbarUntertitel =
    (ansicht === 'monat' ? '' : `KW ${kalenderwoche(bezugsdatum)} · `) +
    `${uebersicht.dienste} Dienste · ${uebersicht.offen} offen`

  return (
    <div style={{ opacity: ladeVorgang ? 0.7 : 1, transition: 'opacity 0.15s' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: 14,
        }}
      >
        <button onClick={() => navigieren(-1)} style={pfeilKnopfStil} aria-label="Zurück">
          ‹
        </button>
        <div style={{ minWidth: 190, textAlign: 'center' }}>
          <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--navy)' }}>{toolbarTitel}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{toolbarUntertitel}</div>
        </div>
        <button onClick={() => navigieren(1)} style={pfeilKnopfStil} aria-label="Weiter">
          ›
        </button>

        <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          {(
            [
              ['woche', 'Woche'],
              ['tag', 'Tag'],
              ['monat', 'Monat'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => {
                auswahlZuruecksetzen()
                setAnsicht(id)
              }}
              style={{
                border: 'none',
                padding: '8px 16px',
                fontSize: 13,
                fontWeight: ansicht === id ? 600 : 500,
                cursor: 'pointer',
                background: ansicht === id ? 'var(--navy)' : '#ffffff',
                color: ansicht === id ? '#ffffff' : 'var(--navy)',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <button
          onClick={() => {
            auswahlZuruecksetzen()
            setBezugsdatum(heuteOhneUhrzeit())
          }}
          style={navigationsKnopfStil}
        >
          Heute
        </button>

        <div style={{ flexGrow: 1 }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 12, color: '#475569' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{ width: 16, height: 12, borderRadius: 3, background: '#f6d3cc', border: '1px solid #e5a99c' }}
            />
            Nachtdienst Vortag
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 16, height: 12, borderRadius: 3, border: '1.5px dashed #c2410c' }} />
            Offen
          </span>
        </div>

        {ansicht !== 'monat' &&
          (freigegebeneWochen.includes(wochenStartIso) ? (
            <button
              onClick={wocheZurueckziehen}
              title="Diese Woche ist für die Mitarbeiter sichtbar. Klicken zum Zurückziehen."
              style={{
                background: '#dcfce7',
                color: '#166534',
                border: '1px solid #86efac',
                borderRadius: 6,
                padding: '8px 14px',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              ✓ Woche veröffentlicht
            </button>
          ) : (
            <button
              onClick={wocheVeroeffentlichen}
              title="Diese Woche ist für die Mitarbeiter noch nicht sichtbar."
              style={{
                background: '#ffffff',
                color: '#166534',
                border: '1px solid #16a34a',
                borderRadius: 6,
                padding: '8px 14px',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Woche veröffentlichen
            </button>
          ))}

        <button onClick={offenSpotDialogOeffnen} style={primaerKnopfStil}>
          + Offene Spotschicht
        </button>
      </div>

      {ansicht === 'tag' ? renderTagesansicht() : ansicht === 'woche' ? renderWochenansicht() : renderMonatsansicht()}

      <style>{`
        .dienstplan-leerzelle:hover { border-color: var(--navy) !important; color: var(--navy) !important; }
        .dp-leer-tag { opacity: 0; transition: opacity 0.12s; }
        .dp-zeile:hover .dp-leer-tag { opacity: 1; }
        .dp-zeile:hover { background: #f8fafc; }
      `}</style>

      {offenSpotDialogOffen && (
        <div
          onClick={() => setOffenSpotDialogOffen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#ffffff',
              borderRadius: 12,
              padding: 20,
              width: 520,
              maxWidth: '100%',
              maxHeight: '85vh',
              overflowY: 'auto',
              boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
              <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--navy)' }}>{offenSpotBearbeitenId ? 'Offene Spotschicht bearbeiten' : 'Offene Spotschicht anlegen'}</div>
              <button
                onClick={() => setOffenSpotDialogOffen(false)}
                style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)', lineHeight: 1 }}
              >
                ✕
              </button>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>
              Die Schicht erscheint oben bei den offenen Schichten und kann per Drag &amp; Drop einer Person zugewiesen werden.
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                gap: 10,
              }}
            >
              <label style={beschriftungStil}>
                Datum
                <input
                  type="date"
                  value={offenSpotDaten.datum}
                  onChange={(e) => setOffenSpotDaten({ ...offenSpotDaten, datum: e.target.value })}
                  style={eingabeStil}
                />
              </label>
              <label style={beschriftungStil}>
                Bereich
                <select
                  value={offenSpotDaten.bereich}
                  onChange={(e) => setOffenSpotDaten({ ...offenSpotDaten, bereich: e.target.value })}
                  style={eingabeStil}
                >
                  {BEREICHE.map((b) => (
                    <option key={b} value={b}>
                      {b}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ ...beschriftungStil, gridColumn: '1 / -1' }}>
                Name
                <input
                  value={offenSpotDaten.name}
                  onChange={(e) => setOffenSpotDaten({ ...offenSpotDaten, name: e.target.value })}
                  style={eingabeStil}
                  placeholder="z.B. Kessel Dienstantritt NRH"
                />
              </label>
              <label style={beschriftungStil}>
                Beginn
                <input
                  type="time"
                  value={offenSpotDaten.beginn_zeit}
                  onChange={(e) => setOffenSpotDaten({ ...offenSpotDaten, beginn_zeit: e.target.value })}
                  style={eingabeStil}
                />
              </label>
              <label style={beschriftungStil}>
                Ende
                <input
                  type="time"
                  value={offenSpotDaten.ende_zeit}
                  onChange={(e) => setOffenSpotDaten({ ...offenSpotDaten, ende_zeit: e.target.value })}
                  style={eingabeStil}
                />
              </label>
              <label style={beschriftungStil}>
                Pause (Min.)
                <input
                  type="number"
                  value={offenSpotDaten.pause_minuten}
                  onChange={(e) => setOffenSpotDaten({ ...offenSpotDaten, pause_minuten: Number(e.target.value) })}
                  style={eingabeStil}
                />
              </label>
              <label style={beschriftungStil}>
                Dienstort
                <input
                  value={offenSpotDaten.dienstort}
                  onChange={(e) => setOffenSpotDaten({ ...offenSpotDaten, dienstort: e.target.value })}
                  style={eingabeStil}
                />
              </label>
              <label style={beschriftungStil}>
                Farbe
                <input
                  type="color"
                  value={offenSpotDaten.farbe}
                  onChange={(e) => setOffenSpotDaten({ ...offenSpotDaten, farbe: e.target.value })}
                  style={{ ...eingabeStil, padding: 2, height: 36 }}
                />
              </label>
              <label style={{ ...beschriftungStil, gridColumn: '1 / -1' }}>
                Info / Bemerkung
                <textarea
                  value={offenSpotDaten.info}
                  onChange={(e) => setOffenSpotDaten({ ...offenSpotDaten, info: e.target.value })}
                  rows={3}
                  style={{ ...eingabeStil, resize: 'vertical', fontFamily: 'inherit' }}
                  placeholder="z.B. Treffpunkt, Auftrag, Ansprechpartner ..."
                />
              </label>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button onClick={() => setOffenSpotDialogOffen(false)} style={sekundaerKnopfStil}>
                Abbrechen
              </button>
              <button
                onClick={offeneSpotschichtAnlegen}
                disabled={!offenSpotDaten.name.trim() || !offenSpotDaten.datum}
                style={primaerKnopfStil}
              >
                {offenSpotBearbeitenId ? 'Speichern' : 'Anlegen'}
              </button>
            </div>
          </div>
        </div>
      )}

      {ausgewaehlteZelle && (
        <div
          onClick={() => setAusgewaehlteZelle(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#ffffff',
              borderRadius: 12,
              padding: 20,
              width: 480,
              maxWidth: '100%',
              maxHeight: '85vh',
              overflowY: 'auto',
              boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--navy)' }}>
                  {mitarbeiterListe.find((m) => m.id === ausgewaehlteZelle.mitarbeiterId)?.name}
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{ausgewaehlteZelle.datum}</div>
              </div>
              <button
                onClick={() => setAusgewaehlteZelle(null)}
                style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)', lineHeight: 1 }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
              <select
                value={gewaehlteVorlage}
                onChange={(e) => setGewaehlteVorlage(e.target.value)}
                style={{ ...eingabeStil, width: '100%' }}
              >
                <option value="">Bestandsschicht wählen...</option>
                {(() => {
                  const wochentagDerZelle = new Date(ausgewaehlteZelle.datum).getDay()
                  const person = mitarbeiterListe.find((m) => m.id === ausgewaehlteZelle.mitarbeiterId)
                  const personBereich = bereichVonKategorie(person?.kategorie ?? null)
                  // Schichten, die an diesem Tag schon an jemand anderen vergeben sind, nicht mehr anbieten
                  const bereitsVergeben = new Set(
                    eintraege
                      .filter(
                        (e) =>
                          e.datum === ausgewaehlteZelle.datum &&
                          e.schichtvorlage_id &&
                          e.mitarbeiter_id !== ausgewaehlteZelle.mitarbeiterId &&
                          !istUrlaub(e.mitarbeiter_id, e.datum)
                      )
                      .map((e) => e.schichtvorlage_id)
                  )
                  const freieVorlagen = vorlagen.filter((v) => !bereitsVergeben.has(v.id))
                  const imBereich = freieVorlagen.filter((v) => (v.bereich ?? 'Lokführer') === personBereich)
                  const andererBereich = freieVorlagen.filter((v) => (v.bereich ?? 'Lokführer') !== personBereich)
                  const passt = (v: Schichtvorlage) =>
                    (v.benoetigte_wochentage ?? [0, 1, 2, 3, 4, 5, 6]).includes(wochentagDerZelle)
                  const passend = imBereich.filter(passt)
                  const unpassend = imBereich.filter((v) => !passt(v))
                  return (
                    <>
                      {passend.length > 0 && (
                        <optgroup label={`Für diesen Wochentag vorgesehen (${personBereich})`}>
                          {passend.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.name}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {unpassend.length > 0 && (
                        <optgroup label="⚠ Normalerweise nicht an diesem Tag">
                          {unpassend.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.name}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {andererBereich.length > 0 && (
                        <optgroup label="⚠ Anderer Bereich">
                          {andererBereich.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.name}
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </>
                  )
                })()}
              </select>
              <button onClick={vorlageZuweisen} disabled={!gewaehlteVorlage} style={{ ...primaerKnopfStil, width: '100%' }}>
                Zuweisen
              </button>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              <button onClick={() => {
                  setSpotFormularOffen(!spotFormularOffen)
                  setAbwFormularOffen(false)
                }} style={sekundaerKnopfStil}>
                {spotFormularOffen
                  ? 'Spotschicht schließen'
                  : eintragFuer(ausgewaehlteZelle.mitarbeiterId, ausgewaehlteZelle.datum)?.ist_spotschicht
                  ? 'Spotschicht bearbeiten'
                  : '+ Spotschicht anlegen'}
              </button>
              {(() => {
                const e = eintragFuer(ausgewaehlteZelle.mitarbeiterId, ausgewaehlteZelle.datum)
                if (!e?.schichtvorlage_id || e.ist_spotschicht) return null
                return (
                  <button
                    onClick={() => {
                      setAbwFormularOffen(!abwFormularOffen)
                      setSpotFormularOffen(false)
                    }}
                    style={sekundaerKnopfStil}
                  >
                    {abwFormularOffen ? 'Dienstzeit schließen' : 'Dienstzeit anpassen'}
                  </button>
                )
              })()}
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

            {abwFormularOffen && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                  gap: 10,
                  padding: 12,
                  background: '#fffbeb',
                  border: '1px solid #fde68a',
                  borderRadius: 6,
                }}
              >
                <div style={{ gridColumn: '1 / -1', fontSize: 12, color: '#92400e' }}>
                  Dienstzeitabweichung nur für diesen Tag und diese Person. Die Schichtvorlage selbst bleibt unverändert.
                </div>
                <label style={beschriftungStil}>
                  Beginn
                  <input
                    type="time"
                    value={abwDaten.beginn_zeit}
                    onChange={(e) => setAbwDaten({ ...abwDaten, beginn_zeit: e.target.value })}
                    style={eingabeStil}
                  />
                </label>
                <label style={beschriftungStil}>
                  Ende
                  <input
                    type="time"
                    value={abwDaten.ende_zeit}
                    onChange={(e) => setAbwDaten({ ...abwDaten, ende_zeit: e.target.value })}
                    style={eingabeStil}
                  />
                </label>
                <label style={beschriftungStil}>
                  Pause (Min.)
                  <input
                    type="number"
                    value={abwDaten.pause_minuten}
                    onChange={(e) => setAbwDaten({ ...abwDaten, pause_minuten: Number(e.target.value) })}
                    style={eingabeStil}
                  />
                </label>
                <label style={beschriftungStil}>
                  Dienstort
                  <input
                    value={abwDaten.dienstort}
                    onChange={(e) => setAbwDaten({ ...abwDaten, dienstort: e.target.value })}
                    style={eingabeStil}
                  />
                </label>
                <label style={{ ...beschriftungStil, gridColumn: '1 / -1' }}>
                  Grund / Info
                  <textarea
                    value={abwDaten.info}
                    onChange={(e) => setAbwDaten({ ...abwDaten, info: e.target.value })}
                    rows={2}
                    style={{ ...eingabeStil, resize: 'vertical', fontFamily: 'inherit' }}
                    placeholder="z.B. Zugverspätung, Dienstbeginn verschoben ..."
                  />
                </label>
                <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8 }}>
                  <button onClick={abweichungSpeichern} style={primaerKnopfStil}>
                    Speichern
                  </button>
                  <button onClick={abweichungZuruecksetzen} style={sekundaerKnopfStil}>
                    Auf Vorlage zurücksetzen
                  </button>
                </div>
              </div>
            )}

            {spotFormularOffen && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                  gap: 10,
                  padding: 12,
                  background: '#f8fafc',
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
                <label style={{ ...beschriftungStil, gridColumn: '1 / -1' }}>
                  Info / Bemerkung
                  <textarea
                    value={spotDaten.info}
                    onChange={(e) => setSpotDaten({ ...spotDaten, info: e.target.value })}
                    rows={3}
                    style={{ ...eingabeStil, resize: 'vertical', fontFamily: 'inherit' }}
                    placeholder="z.B. Treffpunkt, Auftrag, Ansprechpartner ..."
                  />
                </label>
                <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                  <button onClick={spotschichtAnlegen} style={primaerKnopfStil}>
                    {eintragFuer(ausgewaehlteZelle.mitarbeiterId, ausgewaehlteZelle.datum)?.ist_spotschicht
                      ? 'Speichern'
                      : 'Anlegen'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )

  // ---------------------------------------------------------------------------
  // TAGESANSICHT (Zeitstrahl)
  // ---------------------------------------------------------------------------
  function renderTagesansicht() {
    const datumIso = tagIso
    const offeneVorlagenTag = BEREICHE.flatMap((b) => offeneVorlagenFuerTag(datumIso, bezugsdatum.getDay(), b))
    const offeneSpotsTag = offeneSpots.filter((x) => x.datum === datumIso)
    const offeneNamen = [...offeneVorlagenTag.map((v) => v.name), ...offeneSpotsTag.map((x) => x.name)]
    const jetzt = new Date()
    const jetztMinuten = jetzt.getHours() * 60 + jetzt.getMinutes()
    const zeigeJetzt = istHeute(bezugsdatum)
    const raster: React.CSSProperties = {
      backgroundImage: 'linear-gradient(to right, #e8edf4 1px, transparent 1px)',
      backgroundSize: `${100 / 24}% 100%`,
    }

    // Besetzung pro Stunde
    const alleBalken = mitarbeiterListe
      .filter((m) => !istUrlaub(m.id, datumIso))
      .flatMap((m) => balkenFuer(m.id, bezugsdatum))
    const besetzung = STUNDEN.map(
      (h) => alleBalken.filter((b) => b.von < (h + 1) * 60 && b.bis > h * 60).length
    )
    const maxBesetzung = Math.max(1, ...besetzung)

    // Pruefung: Ueberschneidungen und Ruhezeiten (< 11 Std.) aller Personen
    const hinweise: string[] = mitarbeiterListe.flatMap((m) =>
      warnungenFuer(m.id, bezugsdatum).map((w) => `${m.name}: ${w.lang}`)
    )
    const dienste = mitarbeiterListe.filter(
      (m) => !istUrlaub(m.id, datumIso) && schichtInfoVon(eintragFuer(m.id, datumIso))
    ).length

    // Ausgewaehlte Schicht (rechtes Detailfeld)
    const sel = ausgewaehlterBalken
    const selEintrag = sel ? eintragFuer(sel.mitarbeiterId, sel.datum) : undefined
    const selInfo = schichtInfoVon(selEintrag)
    const selPerson = sel ? mitarbeiterListe.find((m) => m.id === sel.mitarbeiterId) : undefined
    const selVortag = sel
      ? schichtInfoVon(eintragFuer(sel.mitarbeiterId, datumZuISO(addTage(new Date(sel.datum + 'T00:00:00'), -1))))
      : null
    const selRuhe = selInfo && selVortag ? 1440 + selInfo.beginn - selVortag.ende : null
    const selUrlaub = sel ? istUrlaub(sel.mitarbeiterId, sel.datum) : false
    const selWoche = sel ? wochenMinuten(sel.mitarbeiterId) : 0
    const pruefpunkte: { ok: boolean; text: string }[] = []
    if (sel && selInfo) {
      if (selRuhe === null) pruefpunkte.push({ ok: true, text: 'Kein Dienst am Vortag' })
      else if (selRuhe < 0) pruefpunkte.push({ ok: false, text: 'Überschneidung mit der Schicht vom Vortag' })
      else if (selRuhe < 660)
        pruefpunkte.push({ ok: false, text: `Ruhezeit zum Vortag nur ${minutenAlsText(selRuhe)} Std. (mind. 11 Std.)` })
      else pruefpunkte.push({ ok: true, text: `Ruhezeit zum Vortag: ${minutenAlsText(selRuhe)} Std.` })
      pruefpunkte.push(
        selUrlaub
          ? { ok: false, text: 'Urlaub in diesem Zeitraum' }
          : { ok: true, text: 'Kein Urlaub in diesem Zeitraum' }
      )
      pruefpunkte.push(
        selWoche > 48 * 60
          ? { ok: false, text: `Wochenstunden: ${minutenAlsText(selWoche)} Std. (über 48)` }
          : { ok: true, text: `Wochenstunden: ${minutenAlsText(selWoche)} Std.` }
      )
    }

    const linkeSpalte: React.CSSProperties = { width: 210, flexShrink: 0, padding: '0 14px' }
    const kachelStil: React.CSSProperties = {
      background: '#f1f5f9',
      borderRadius: 8,
      padding: '8px 12px',
    }

    return (
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div
          style={{
            flex: '999 1 640px',
            minWidth: 0,
            border: '1px solid var(--border)',
            borderRadius: 12,
            overflow: 'hidden',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
            background: '#ffffff',
          }}
        >
          <div style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: 1100 }}>
              {/* Kopfzeile mit Uhrzeiten */}
              <div style={{ display: 'flex', background: '#14325c', color: '#ffffff' }}>
                <div style={{ ...linkeSpalte, padding: '11px 14px', fontWeight: 600, fontSize: 13 }}>Mitarbeiter</div>
                <div style={{ flex: 1, display: 'flex' }}>
                  {STUNDEN.map((h) => (
                    <div
                      key={h}
                      style={{
                        flex: 1,
                        padding: '11px 0 11px 5px',
                        fontSize: 11,
                        color: '#c9d6ea',
                        borderLeft: '1px solid rgba(255,255,255,0.14)',
                      }}
                    >
                      {String(h).padStart(2, '0')}
                    </div>
                  ))}
                </div>
              </div>

              {/* Offene Schichten, getrennt nach Bereich */}
              {BEREICHE.map((bereich) => {
                const offeneV = offeneVorlagenFuerTag(datumIso, bezugsdatum.getDay(), bereich)
                const offeneS = offeneSpotsFuerTag(datumIso, bereich)
                const poolSchluessel = `offen-${bereich}`
                return (
                  <div
                    key={bereich}
                    style={{ display: 'flex', background: '#fff7ed', borderBottom: '1px solid var(--border)' }}
                    onDragOver={(e) => {
                      e.preventDefault()
                      setHoverZiel(poolSchluessel)
                    }}
                    onDragLeave={() => setHoverZiel((z) => (z === poolSchluessel ? null : z))}
                    onDrop={(e) => {
                      e.preventDefault()
                      setHoverZiel(null)
                      if (gezogenerEintrag) {
                        eintragLoeschenExtern(gezogenerEintrag)
                        setGezogenerEintrag(null)
                      }
                    }}
                  >
                    <div
                      style={{
                        ...linkeSpalte,
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'center',
                        gap: 1,
                      }}
                    >
                      <div style={{ fontWeight: 700, fontSize: 11, color: '#9a3412' }}>Offene Schichten</div>
                      <div style={{ fontWeight: 600, fontSize: 11, color: 'var(--navy)' }}>{bereich}</div>
                    </div>
                    <div
                      style={{
                        flex: 1,
                        position: 'relative',
                        minHeight: 40,
                        padding: '5px 0',
                        background: hoverZiel === poolSchluessel ? '#ffedd5' : undefined,
                        ...raster,
                      }}
                    >
                      {offeneV.length === 0 && offeneS.length === 0 ? (
                        <div style={{ padding: '10px 8px', fontSize: 11, color: 'var(--success)' }}>
                          ✓ Alle Schichten besetzt
                        </div>
                      ) : (
                        <>
                          {offeneV.map((v) => {
                            const info = infoAusVorlage(v)
                            const bis = Math.min(info.ende, 1440)
                            return (
                              <div key={v.id} style={{ position: 'relative', height: 30, marginBottom: 4 }}>
                                <div
                                  draggable
                                  onDragStart={() =>
                                    setGezogeneVorlage({ art: 'vorlage', id: v.id, tagDatum: datumIso, bereich })
                                  }
                                  onDragEnd={() => setGezogeneVorlage(null)}
                                  title="Auf eine Person ziehen, um die Schicht zuzuweisen"
                                  style={{
                                    position: 'absolute',
                                    left: `${(info.beginn / 1440) * 100}%`,
                                    width: `${((bis - info.beginn) / 1440) * 100}%`,
                                    top: 0,
                                    height: 30,
                                    boxSizing: 'border-box',
                                    border: `2px dashed ${v.farbe}`,
                                    background: '#ffffff',
                                    color: v.farbe,
                                    borderRadius: 6,
                                    padding: '0 8px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 6,
                                    fontSize: 11,
                                    fontWeight: 700,
                                    cursor: 'grab',
                                    overflow: 'hidden',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {v.name}
                                  <span style={{ fontWeight: 400, opacity: 0.85 }}>
                                    {minutenAlsUhrzeit(info.beginn)}–{minutenAlsUhrzeit(info.ende)}
                                  </span>
                                </div>
                              </div>
                            )
                          })}
                          {offeneS.map((x) => {
                            const info = infoAusSpot(x)
                            const bis = Math.min(info.ende, 1440)
                            return (
                              <div key={x.id} style={{ position: 'relative', height: 30, marginBottom: 4 }}>
                                <div
                                  draggable
                                  onDragStart={() =>
                                    setGezogeneVorlage({ art: 'spot', id: x.id, tagDatum: datumIso, bereich })
                                  }
                                  onDragEnd={() => setGezogeneVorlage(null)}
                                  onClick={() => offenSpotBearbeiten(x)}
                                  title="Offene Spotschicht: Klick zum Bearbeiten, auf eine Person ziehen zum Zuweisen"
                                  style={{
                                    position: 'absolute',
                                    left: `${(info.beginn / 1440) * 100}%`,
                                    width: `${((bis - info.beginn) / 1440) * 100}%`,
                                    top: 0,
                                    height: 30,
                                    boxSizing: 'border-box',
                                    background: info.farbe,
                                    color: '#ffffff',
                                    borderRadius: 6,
                                    padding: '0 8px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 6,
                                    fontSize: 11,
                                    fontWeight: 700,
                                    cursor: 'grab',
                                    overflow: 'hidden',
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  <span style={{ background: 'rgba(255,255,255,0.25)', borderRadius: 4, padding: '1px 5px', fontSize: 9 }}>
                                    SPOT
                                  </span>
                                  {x.name}
                                  <span style={{ fontWeight: 400, opacity: 0.9 }}>
                                    {minutenAlsUhrzeit(info.beginn)}–{minutenAlsUhrzeit(info.ende)}
                                  </span>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      offeneSpotschichtLoeschen(x)
                                    }}
                                    title="Offene Spotschicht löschen"
                                    style={{
                                      marginLeft: 'auto',
                                      background: 'none',
                                      border: 'none',
                                      color: '#ffffff',
                                      cursor: 'pointer',
                                      fontSize: 12,
                                      lineHeight: 1,
                                    }}
                                  >
                                    ✕
                                  </button>
                                </div>
                              </div>
                            )
                          })}
                        </>
                      )}
                    </div>
                  </div>
                )
              })}

              {/* Mitarbeiterzeilen */}
              {mitarbeiterListe.map((mitarbeiter) => {
                const urlaub = istUrlaub(mitarbeiter.id, datumIso)
                const eintrag = eintragFuer(mitarbeiter.id, datumIso)
                const balken = urlaub ? [] : balkenFuer(mitarbeiter.id, bezugsdatum)
                const warnungen = warnungenFuer(mitarbeiter.id, bezugsdatum)
                const ueberlappt = warnungen.some((w) => w.art === 'ueberschneidung')
                const zielSchluessel = `${mitarbeiter.id}-${datumIso}`
                const ausgewaehlt =
                  ausgewaehlteZelle?.mitarbeiterId === mitarbeiter.id && ausgewaehlteZelle?.datum === datumIso
                const vortagIso = datumZuISO(addTage(bezugsdatum, -1))

                return (
                  <div
                    key={mitarbeiter.id}
                    className="dp-zeile"
                    style={{ display: 'flex', borderBottom: '1px solid #eef2f8', alignItems: 'stretch' }}
                  >
                    <div style={{ ...linkeSpalte, display: 'flex', alignItems: 'center', gap: 10, padding: '7px 14px' }}>
                      <div
                        style={{
                          width: 30,
                          height: 30,
                          borderRadius: '50%',
                          background: farbeFuerAvatar(mitarbeiter.name),
                          color: '#ffffff',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: 11,
                          fontWeight: 700,
                          flexShrink: 0,
                        }}
                      >
                        {initialen(mitarbeiter.name)}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 13, color: '#1e293b', lineHeight: 1.25 }}>
                          {mitarbeiter.name}
                        </div>
                        <div style={{ fontSize: 11, color: '#64748b' }}>{mitarbeiter.kategorie ?? 'Ohne Qualifikation'}</div>
                        {warnungen.map((w, wi) => (
                          <div
                            key={wi}
                            title={w.lang}
                            style={{
                              fontSize: 10,
                              fontWeight: 700,
                              color: w.art === 'ueberschneidung' ? '#dc2626' : '#b45309',
                            }}
                          >
                            ⚠ {w.kurz}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div
                      onClick={() => (!urlaub || !!eintrag) && zelleOeffnen(mitarbeiter.id, datumIso)}
                      onDragOver={(e) => {
                        if (urlaub) return
                        e.preventDefault()
                        setHoverZiel(zielSchluessel)
                      }}
                      onDragLeave={() => setHoverZiel((z) => (z === zielSchluessel ? null : z))}
                      onDrop={(e) => {
                        e.preventDefault()
                        setHoverZiel(null)
                        if (urlaub) return
                        if (gezogeneVorlage) {
                          offenesZuweisen(gezogeneVorlage, mitarbeiter.id, datumIso)
                          setGezogeneVorlage(null)
                        } else if (gezogenerEintrag) {
                          eintragVerschieben(gezogenerEintrag, mitarbeiter.id, datumIso)
                          setGezogenerEintrag(null)
                        }
                      }}
                      style={{
                        flex: 1,
                        position: 'relative',
                        minHeight: 52,
                        cursor: urlaub && !eintrag ? 'default' : 'pointer',
                        background: hoverZiel === zielSchluessel ? '#e0f2fe' : undefined,
                        boxShadow: ausgewaehlt ? 'inset 0 0 0 2px var(--navy)' : undefined,
                        ...raster,
                      }}
                    >
                      {zeigeJetzt && (
                        <div
                          style={{
                            position: 'absolute',
                            left: `${(jetztMinuten / 1440) * 100}%`,
                            top: 0,
                            bottom: 0,
                            width: 2,
                            background: '#dc2626',
                            opacity: 0.6,
                            pointerEvents: 'none',
                            zIndex: 2,
                          }}
                        />
                      )}

                      {urlaub && (
                        <div
                          style={{
                            position: 'absolute',
                            left: 0,
                            right: 0,
                            top: 'calc(50% - 16px)',
                            height: 32,
                            borderRadius: 6,
                            background: '#c026d3',
                            color: '#ffffff',
                            fontWeight: 700,
                            fontSize: 12,
                            display: 'flex',
                            alignItems: 'center',
                            padding: '0 10px',
                          }}
                        >
                          Urlaub ganztägig
                        </div>
                      )}

                      {!urlaub && eintrag?.status && (
                        <div
                          style={{
                            position: 'absolute',
                            left: 0,
                            right: 0,
                            top: 'calc(50% - 16px)',
                            height: 32,
                            borderRadius: 6,
                            border: `1.5px solid ${eintrag.status === 'ruhe' ? '#0e7490' : '#64748b'}`,
                            background: eintrag.status === 'ruhe' ? '#0e749015' : '#64748b15',
                            color: eintrag.status === 'ruhe' ? '#0e7490' : '#64748b',
                            fontWeight: 700,
                            fontSize: 12,
                            display: 'flex',
                            alignItems: 'center',
                            padding: '0 10px',
                            boxSizing: 'border-box',
                          }}
                        >
                          {eintrag.status === 'ruhe' ? 'Ruhe' : 'Frei'}
                        </div>
                      )}

                      {!urlaub && !eintrag && balken.length === 0 && (
                        <div
                          className="dienstplan-leerzelle dp-leer-tag"
                          style={{
                            position: 'absolute',
                            inset: '8px 4px',
                            borderRadius: 8,
                            border: '1.5px dashed #cbd5e1',
                            color: '#94a3b8',
                            fontSize: 12,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          + Schicht
                        </div>
                      )}

                      {balken.map((b, i) => {
                        const breite = ((b.bis - b.von) / 1440) * 100
                        const balkenDatum = b.vortag ? vortagIso : datumIso
                        const istAuswahl = sel?.mitarbeiterId === mitarbeiter.id && sel?.datum === balkenDatum
                        // Pausenabschnitt (nur bei Vorlagen mit Pause von/bis, nur am Starttag)
                        const pauseSichtbar =
                          !b.vortag && b.info.pauseVon !== null && b.info.pauseBis !== null && b.info.pauseBis > b.info.pauseVon
                        const zeitText = b.vortag
                          ? `bis ${stundeKurz(b.info.ende)}`
                          : `${stundeKurz(b.info.beginn)}–${stundeKurz(b.info.ende)}`
                        return (
                          <div
                            key={i}
                            draggable={!b.vortag}
                            onClick={(e) => {
                              e.stopPropagation()
                              setTauschenOffen(false)
                              setAusgewaehlterBalken({ mitarbeiterId: mitarbeiter.id, datum: balkenDatum })
                            }}
                            onDragStart={(e) => {
                              e.stopPropagation()
                              setGezogenerEintrag({ mitarbeiterId: mitarbeiter.id, datum: datumIso })
                            }}
                            onDragEnd={() => setGezogenerEintrag(null)}
                            title={`${b.info.titel} ${minutenAlsUhrzeit(b.info.beginn)}–${minutenAlsUhrzeit(b.info.ende)}${b.info.ort ? ' · ' + b.info.ort : ''}${b.vortag ? ' (Nachtschicht vom Vortag)' : ''}${b.info.info ? '\nInfo: ' + b.info.info : ''}`}
                            style={{
                              position: 'absolute',
                              left: `${(b.von / 1440) * 100}%`,
                              width: `${breite}%`,
                              top: ueberlappt ? (b.vortag ? 'calc(50% - 24px)' : 'calc(50% + 2px)') : 'calc(50% - 16px)',
                              height: ueberlappt ? 22 : 32,
                              boxSizing: 'border-box',
                              boxShadow: istAuswahl
                                ? '0 0 0 2px var(--navy)'
                                : ueberlappt
                                ? '0 0 0 2px #dc2626'
                                : undefined,
                              background: b.vortag ? '#f6d3cc' : b.info.farbe,
                              color: b.vortag ? '#7a1d0f' : textFarbeFuer(b.info.farbe),
                              borderRadius: `${b.vortag ? 0 : 6}px ${b.weiter ? 0 : 6}px ${b.weiter ? 0 : 6}px ${b.vortag ? 0 : 6}px`,
                              padding: '0 9px',
                              overflow: 'hidden',
                              cursor: 'pointer',
                              zIndex: istAuswahl ? 3 : 1,
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                              whiteSpace: 'nowrap',
                              fontSize: 12,
                            }}
                          >
                            <span style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {b.info.titel}
                              {b.vortag ? ' (Vortag)' : ''}
                              {b.info.abweichung ? ' ✎' : ''}
                              {b.info.info ? ' ℹ' : ''}
                            </span>
                            <span style={{ fontWeight: 400, opacity: 0.9, flexShrink: 0 }}>
                              {zeitText}
                              {b.weiter ? ' →' : ''}
                            </span>
                            {pauseSichtbar && (
                              <div
                                style={{
                                  position: 'absolute',
                                  left: `${(((b.info.pauseVon as number) - b.von) / (b.bis - b.von)) * 100}%`,
                                  width: `${(((b.info.pauseBis as number) - (b.info.pauseVon as number)) / (b.bis - b.von)) * 100}%`,
                                  top: 0,
                                  bottom: 0,
                                  background: 'rgba(255,255,255,0.35)',
                                  pointerEvents: 'none',
                                }}
                              />
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}

              {/* Besetzung pro Stunde */}
              <div style={{ display: 'flex', background: '#f8fafc', borderTop: '2px solid #14325c' }}>
                <div style={{ ...linkeSpalte, padding: '10px 14px', fontSize: 12, color: '#334155' }}>
                  <div style={{ fontWeight: 700, color: 'var(--navy)', fontSize: 13 }}>Besetzung je Stunde</div>
                  <div style={{ marginTop: 2 }}>
                    Mindestbesetzung:{' '}
                    <input
                      type="number"
                      min={0}
                      value={mindestbesetzung}
                      onChange={(e) => {
                        const wert = Math.max(0, Number(e.target.value) || 0)
                        setMindestbesetzung(wert)
                        try {
                          window.localStorage.setItem('dienstplan_mindestbesetzung', String(wert))
                        } catch {
                          // Speichern im Browser nicht moeglich: egal
                        }
                      }}
                      style={{ width: 42, padding: '2px 4px', border: '1px solid var(--border)', borderRadius: 4, fontSize: 12 }}
                    />{' '}
                    Personen
                  </div>
                </div>
                <div style={{ flex: 1, display: 'flex', height: 74 }}>
                  {besetzung.map((n, h) => {
                    const farbe = n < mindestbesetzung ? '#b91c1c' : n === mindestbesetzung ? '#c2570c' : '#15803d'
                    return (
                      <div
                        key={h}
                        style={{
                          flex: 1,
                          borderLeft: '1px solid #e2e8f0',
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'flex-end',
                          alignItems: 'center',
                          padding: '4px 2px',
                          boxSizing: 'border-box',
                        }}
                      >
                        <div style={{ fontSize: 10, fontWeight: 700, color: farbe }}>{n}</div>
                        <div
                          style={{
                            width: '72%',
                            height: Math.max(3, (n / maxBesetzung) * 40),
                            background: farbe,
                            borderRadius: '3px 3px 0 0',
                          }}
                        />
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Detailfeld rechts */}
        <div
          style={{
            flex: '1 1 280px',
            maxWidth: 360,
            minWidth: 260,
            border: '1px solid var(--border)',
            borderRadius: 12,
            background: '#ffffff',
            padding: 16,
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
          }}
        >
          {sel && selInfo && selEintrag ? (
            <div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 14 }}>
                <div style={{ width: 8, alignSelf: 'stretch', borderRadius: 4, background: selInfo.farbe, minHeight: 34 }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--navy)' }}>
                    {selInfo.titel}
                    {selInfo.abweichung ? ' ✎' : ''}
                  </div>
                  <div style={{ fontSize: 12, color: '#64748b' }}>
                    {selPerson?.name} · {sel.datum.split('-').reverse().join('.')}
                  </div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
                <div style={kachelStil}>
                  <div style={{ fontSize: 11, color: '#64748b' }}>Beginn</div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{minutenAlsUhrzeit(selInfo.beginn)}</div>
                </div>
                <div style={kachelStil}>
                  <div style={{ fontSize: 11, color: '#64748b' }}>Ende</div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{minutenAlsUhrzeit(selInfo.ende)}</div>
                </div>
                <div style={kachelStil}>
                  <div style={{ fontSize: 11, color: '#64748b' }}>Pause</div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>
                    {selInfo.pause} min
                    {selInfo.pauseVon !== null ? ` · ${minutenAlsUhrzeit(selInfo.pauseVon)}` : ''}
                  </div>
                </div>
                <div style={kachelStil}>
                  <div style={{ fontSize: 11, color: '#64748b' }}>Arbeitszeit</div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{minutenAlsText(selInfo.ende - selInfo.beginn)} Std.</div>
                </div>
              </div>

              {selInfo.ort && (
                <div style={{ fontSize: 12, color: '#475569', marginBottom: 8 }}>
                  Dienstort: <b>{selInfo.ort}</b>
                </div>
              )}
              {selInfo.info && (
                <div
                  style={{
                    fontSize: 12,
                    color: '#78350f',
                    background: '#fffbeb',
                    border: '1px solid #fde68a',
                    borderRadius: 8,
                    padding: '6px 10px',
                    marginBottom: 8,
                  }}
                >
                  ℹ {selInfo.info}
                </div>
              )}

              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 4 }}>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Prüfung</div>
                {pruefpunkte.map((pp, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, fontSize: 13, marginBottom: 6, color: pp.ok ? '#334155' : '#b91c1c' }}>
                    <span style={{ color: pp.ok ? '#15803d' : '#dc2626', fontWeight: 700 }}>{pp.ok ? '✓' : '⚠'}</span>
                    {pp.text}
                  </div>
                ))}
              </div>

              {tauschenOffen && (
                <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <select value={tauschZiel} onChange={(e) => setTauschZiel(e.target.value)} style={{ ...eingabeStil, width: '100%' }}>
                    <option value="">Mit wem tauschen?</option>
                    {mitarbeiterListe
                      .filter((m) => m.id !== sel.mitarbeiterId && !istUrlaub(m.id, sel.datum))
                      .map((m) => {
                        const ziel = schichtInfoVon(eintragFuer(m.id, sel.datum))
                        return (
                          <option key={m.id} value={m.id}>
                            {m.name} ({ziel ? ziel.titel : 'kein Dienst'})
                          </option>
                        )
                      })}
                  </select>
                  <button
                    onClick={() => eintragTauschen(sel, tauschZiel)}
                    disabled={!tauschZiel}
                    style={{ ...primaerKnopfStil, width: '100%' }}
                  >
                    Jetzt tauschen
                  </button>
                </div>
              )}

              <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                <button
                  onClick={() => setTauschenOffen(!tauschenOffen)}
                  style={{ ...sekundaerKnopfStil, flex: 1, borderColor: 'var(--border)', fontWeight: 600 }}
                >
                  Tauschen
                </button>
                <button
                  onClick={async () => {
                    await eintragLoeschenExtern({ mitarbeiterId: sel.mitarbeiterId, datum: sel.datum })
                    auswahlZuruecksetzen()
                  }}
                  style={{
                    flex: 1,
                    background: '#b91c1c',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: 6,
                    padding: '8px 14px',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Entfernen
                </button>
              </div>
              <button
                onClick={() => zelleOeffnen(sel.mitarbeiterId, sel.datum)}
                style={{ ...sekundaerKnopfStil, width: '100%', marginTop: 8 }}
              >
                Bearbeiten / Dienstzeit anpassen
              </button>
            </div>
          ) : (
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--navy)', marginBottom: 4 }}>Tagesübersicht</div>
              <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>
                {dienste} Dienste · {offeneNamen.length} offen
              </div>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Prüfung für diesen Tag</div>
              {hinweise.length === 0 && offeneNamen.length === 0 && (
                <div style={{ color: '#15803d', fontSize: 13 }}>✓ Alles in Ordnung: keine offenen Schichten, Ruhezeiten eingehalten.</div>
              )}
              {offeneNamen.length > 0 && (
                <div style={{ color: '#b45309', fontSize: 13, marginBottom: 6 }}>
                  ⚠ {offeneNamen.length} offene Schicht{offeneNamen.length === 1 ? '' : 'en'}: {offeneNamen.join(', ')}
                </div>
              )}
              {hinweise.map((h, i) => (
                <div key={i} style={{ color: '#b91c1c', fontSize: 13, marginBottom: 6 }}>
                  ⚠ {h}
                </div>
              ))}
              {hinweise.length === 0 && offeneNamen.length > 0 && (
                <div style={{ color: '#15803d', fontSize: 13 }}>✓ Ruhezeiten (mind. 11 Std.) eingehalten.</div>
              )}
              <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 14 }}>
                Klicke auf eine Schicht, um Details, Prüfung, Tauschen und Entfernen zu sehen. Ein Klick auf eine leere
                Stelle in der Zeile weist eine Schicht zu.
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // MONATSANSICHT (Matrix + Hinweise)
  // ---------------------------------------------------------------------------
  function renderMonatsansicht() {
    const n = monatsTage.length
    const spalten = `190px repeat(${n}, minmax(28px, 1fr))`
    let urlaubstage = 0
    let verstoesse = 0
    let sollGesamt = 0
    let offenVorlagenGesamt = 0
    let offenGesamt = 0
    const hinweisListe: { farbe: string; titel: string; text: string; tag: Date; mitarbeiterId?: string }[] = []

    const proTag = monatsTage.map((tag) => {
      const iso = datumZuISO(tag)
      let anwesend = 0
      for (const m of mitarbeiterListe) {
        if (istUrlaub(m.id, iso)) urlaubstage++
        else if (schichtInfoVon(eintragFuer(m.id, iso))) anwesend++
      }
      const offeneV = BEREICHE.flatMap((b) => offeneVorlagenFuerTag(iso, tag.getDay(), b))
      const offeneS = offeneSpots.filter((x) => x.datum === iso)
      const soll = vorlagen.filter((v) => (v.benoetigte_wochentage ?? [0, 1, 2, 3, 4, 5, 6]).includes(tag.getDay())).length
      sollGesamt += soll
      offenVorlagenGesamt += Math.min(offeneV.length, soll)
      offenGesamt += offeneV.length + offeneS.length
      if (offeneV.length + offeneS.length > 0) {
        hinweisListe.push({
          farbe: '#d97706',
          titel: `Offene Schichten am ${datumKurz(tag)}`,
          text: [...offeneV.map((v) => v.name), ...offeneS.map((x) => x.name)].join(', '),
          tag,
        })
      }
      return { anwesend, offen: offeneV.length + offeneS.length }
    })

    const zeilen = mitarbeiterListe.map((m) => {
      const zellen = monatsTage.map((tag) => {
        const iso = datumZuISO(tag)
        const urlaub = istUrlaub(m.id, iso)
        const eintrag = eintragFuer(m.id, iso)
        const info = urlaub ? null : schichtInfoVon(eintrag)
        const warnungen = warnungenFuer(m.id, tag)
        for (const w of warnungen) {
          if (w.art !== 'urlaub') verstoesse++
          hinweisListe.push({
            farbe: w.art === 'ueberschneidung' ? '#dc2626' : '#d97706',
            titel: w.art === 'ueberschneidung' ? 'Überschneidung' : w.art === 'ruhezeit' ? 'Ruhezeit unter 11 Stunden' : 'Urlaub und Schicht',
            text: `${m.name}, ${datumKurz(tag)}: ${w.lang}`,
            tag,
            mitarbeiterId: m.id,
          })
        }
        let bg = '#f3f6fa'
        let fg = '#64748b'
        let txt = ''
        let tip = `${m.name} · ${datumKurz(tag)}`
        if (urlaub) {
          bg = '#c026d3'
          fg = '#ffffff'
          txt = 'U'
          tip += ' · Urlaub'
        } else if (eintrag?.status === 'ruhe') {
          bg = '#d8eef2'
          fg = '#0e7490'
          txt = 'R'
          tip += ' · Ruhe'
        } else if (eintrag?.status === 'frei') {
          bg = '#e2e8f0'
          fg = '#475569'
          txt = 'F'
          tip += ' · Frei'
        } else if (info) {
          bg = info.farbe
          fg = textFarbeFuer(info.farbe)
          txt = stundeKurz(info.beginn)
          tip += ` · ${info.titel} ${minutenAlsUhrzeit(info.beginn)}–${minutenAlsUhrzeit(info.ende)}`
        }
        const zeigeRing = warnungen.some((w) => w.art !== 'urlaub')
        return { tag, iso, bg, fg, txt, tip, ring: zeigeRing ? '#dc2626' : 'transparent' }
      })
      return { m, zellen }
    })

    const besetzungsgrad = sollGesamt > 0 ? Math.round(((sollGesamt - offenVorlagenGesamt) / sollGesamt) * 100) : 100
    const kpis = [
      { label: 'Besetzungsgrad', wert: `${besetzungsgrad} %`, farbe: besetzungsgrad >= 95 ? '#15803d' : besetzungsgrad >= 80 ? '#b45309' : '#b91c1c' },
      { label: 'Offene Schichten', wert: String(offenGesamt), farbe: offenGesamt === 0 ? '#15803d' : '#b45309' },
      { label: 'Urlaubstage im Monat', wert: String(urlaubstage), farbe: '#a21caf' },
      { label: 'Regelverstöße', wert: String(verstoesse), farbe: verstoesse === 0 ? '#15803d' : '#b91c1c' },
    ]

    const legende: { name: string; farbe: string }[] = []
    for (const v of vorlagen) {
      if (!legende.some((l) => l.name === v.name && l.farbe === v.farbe)) legende.push({ name: v.name, farbe: v.farbe })
    }

    return (
      <div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 14 }}>
          {kpis.map((k) => (
            <div key={k.label} style={{ background: '#ffffff', border: '1px solid var(--border)', borderRadius: 12, padding: '10px 16px' }}>
              <div style={{ fontSize: 12, color: '#64748b' }}>{k.label}</div>
              <div style={{ fontWeight: 700, fontSize: 24, color: k.farbe }}>{k.wert}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div
            style={{
              flex: '999 1 640px',
              minWidth: 0,
              border: '1px solid var(--border)',
              borderRadius: 12,
              overflow: 'hidden',
              background: '#ffffff',
              boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
            }}
          >
            <div style={{ overflowX: 'auto' }}>
              <div style={{ minWidth: 1000 }}>
                <div style={{ display: 'grid', gridTemplateColumns: spalten, background: '#14325c', color: '#ffffff' }}>
                  <div style={{ padding: '8px 14px', fontWeight: 600, alignSelf: 'end' }}>Mitarbeiter</div>
                  {monatsTage.map((tag) => {
                    const we = istWochenende(tag)
                    return (
                      <div
                        key={datumZuISO(tag)}
                        style={{
                          padding: '6px 0',
                          textAlign: 'center',
                          borderLeft: '1px solid rgba(255,255,255,0.14)',
                          background: istHeute(tag) ? '#2f5d9e' : we ? 'rgba(255,255,255,0.10)' : 'transparent',
                        }}
                      >
                        <div style={{ fontSize: 10, color: '#c9d6ea' }}>{WOCHENTAGE_LANG[tag.getDay()].slice(0, 2)}</div>
                        <div style={{ fontWeight: 700, fontSize: 12 }}>{tag.getDate()}</div>
                      </div>
                    )
                  })}
                </div>

                {zeilen.map(({ m, zellen }) => (
                  <div
                    key={m.id}
                    style={{ display: 'grid', gridTemplateColumns: spalten, borderBottom: '1px solid #e8edf5', alignItems: 'stretch' }}
                  >
                    <div style={{ padding: '6px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div
                        style={{
                          width: 26,
                          height: 26,
                          borderRadius: '50%',
                          background: farbeFuerAvatar(m.name),
                          color: '#ffffff',
                          fontWeight: 700,
                          fontSize: 10,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexShrink: 0,
                        }}
                      >
                        {initialen(m.name)}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {m.name}
                        </div>
                        <div style={{ fontSize: 10, color: '#64748b' }}>{m.kategorie ?? ''}</div>
                      </div>
                    </div>
                    {zellen.map((c) => (
                      <div
                        key={c.iso}
                        onClick={() => zuTagSpringen(c.tag, m.id)}
                        title={c.tip}
                        style={{
                          padding: '3px 1px',
                          borderLeft: '1px solid #eef2f8',
                          background: istWochenende(c.tag) ? '#f7f9fc' : 'transparent',
                          cursor: 'pointer',
                        }}
                      >
                        <div
                          style={{
                            height: 30,
                            borderRadius: 4,
                            background: c.bg,
                            color: c.fg,
                            boxShadow: `inset 0 0 0 2px ${c.ring}`,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 600,
                            fontSize: 10,
                          }}
                        >
                          {c.txt}
                        </div>
                      </div>
                    ))}
                  </div>
                ))}

                <div style={{ display: 'grid', gridTemplateColumns: spalten, background: '#f7f9fc', borderTop: '2px solid #14325c' }}>
                  <div style={{ padding: '10px 14px', fontWeight: 700 }}>Besetzung</div>
                  {proTag.map((t, i) => (
                    <div
                      key={i}
                      title={t.offen > 0 ? `${t.offen} offene Schicht(en)` : 'Alle Schichten besetzt'}
                      style={{
                        textAlign: 'center',
                        padding: '10px 0',
                        fontWeight: 700,
                        fontSize: 12,
                        color: t.offen === 0 ? '#15803d' : t.offen <= 2 ? '#b45309' : '#b91c1c',
                        borderLeft: '1px solid #eef2f8',
                      }}
                    >
                      {t.anwesend}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div
              style={{
                display: 'flex',
                gap: 12,
                flexWrap: 'wrap',
                padding: '10px 14px',
                borderTop: '1px solid #e8edf5',
                fontSize: 12,
                color: '#3d4c63',
              }}
            >
              <span style={{ color: '#94a3b8' }}>Zahl = Dienstbeginn (Stunde)</span>
              {legende.map((l) => (
                <span key={l.name + l.farbe} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ width: 14, height: 14, borderRadius: 3, background: l.farbe }} />
                  {l.name}
                </span>
              ))}
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 14, height: 14, borderRadius: 3, background: '#c026d3' }} />U = Urlaub
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 14, height: 14, borderRadius: 3, boxShadow: 'inset 0 0 0 2px #dc2626' }} />
                Regelverstoß
              </span>
            </div>
          </div>

          <div
            style={{
              flex: '1 1 280px',
              maxWidth: 360,
              minWidth: 260,
              border: '1px solid var(--border)',
              borderRadius: 12,
              background: '#ffffff',
              boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
            }}
          >
            <div
              style={{
                padding: '14px 16px',
                borderBottom: '1px solid #e8edf5',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ fontWeight: 700, fontSize: 15 }}>Hinweise</div>
              <div
                style={{
                  background: hinweisListe.length === 0 ? '#dcfce7' : '#fee2e2',
                  color: hinweisListe.length === 0 ? '#166534' : '#991b1b',
                  fontWeight: 700,
                  fontSize: 12,
                  borderRadius: 999,
                  padding: '2px 10px',
                }}
              >
                {hinweisListe.length}
              </div>
            </div>
            <div style={{ maxHeight: 560, overflowY: 'auto' }}>
              {hinweisListe.length === 0 && (
                <div style={{ padding: '14px 16px', color: '#15803d', fontSize: 13 }}>
                  ✓ Keine Hinweise: Alle Schichten besetzt, keine Regelverstöße.
                </div>
              )}
              {hinweisListe.map((h, i) => (
                <div
                  key={i}
                  onClick={() => zuTagSpringen(h.tag, h.mitarbeiterId)}
                  style={{ padding: '10px 16px', borderBottom: '1px solid #eef2f8', display: 'flex', gap: 10, cursor: 'pointer' }}
                >
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: h.farbe, marginTop: 6, flexShrink: 0 }} />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{h.titel}</div>
                    <div style={{ color: '#3d4c63', fontSize: 12, marginTop: 2 }}>{h.text}</div>
                    <div style={{ color: 'var(--navy)', fontWeight: 600, fontSize: 11, marginTop: 4 }}>Zum Tag springen →</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ---------------------------------------------------------------------------
  // WOCHENANSICHT (wie bisher)
  // ---------------------------------------------------------------------------
  function renderWochenansicht() {
    return (
      <div
        style={{
          border: '1px solid var(--border)',
          borderRadius: 12,
          overflow: 'hidden',
          boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        }}
      >
        <table style={{ borderCollapse: 'collapse', width: '100%', tableLayout: 'fixed', fontSize: 12 }}>
          <colgroup>
            <col style={{ width: 170 }} />
            {tage.map((_, i) => (
              <col key={i} />
            ))}
            <col style={{ width: 64 }} />
          </colgroup>
          <thead>
            <tr>
              <th style={{ ...kopfZelleStil, textAlign: 'left', paddingLeft: 16 }}>Mitarbeiter</th>
              {tage.map((tag, i) => (
                <th
                  key={i}
                  onClick={() => {
                    setBezugsdatum(tag)
                    setAnsicht('tag')
                  }}
                  title="Tagesansicht öffnen"
                  style={{
                    ...kopfZelleStil,
                    cursor: 'pointer',
                    background: istHeute(tag) ? '#dbe6f5' : istWochenende(tag) ? '#eef1f5' : '#f8fafc',
                    color: istHeute(tag) ? 'var(--navy)' : '#475569',
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 700 }}>{WOCHENTAGE_KURZ[i]}</div>
                  <div style={{ fontSize: 10, fontWeight: 400 }}>{datumKurz(tag)}</div>
                </th>
              ))}
              <th style={{ ...kopfZelleStil, background: '#f8fafc', color: '#475569' }}>Std.</th>
            </tr>
          </thead>
          <tbody>
            {BEREICHE.map((bereich) => (
              <tr key={`offen-${bereich}`}>
                <td
                  style={{
                    ...zellBasisStil,
                    padding: '6px 16px',
                    background: '#fff7ed',
                    borderBottom: '1px solid #fed7aa',
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: 11, color: '#9a3412' }}>Offene Schichten</div>
                  <div style={{ fontWeight: 600, fontSize: 11, color: 'var(--navy)' }}>{bereich}</div>
                </td>
                {tage.map((tag) => {
                  const datumIso = datumZuISO(tag)
                  const offeneV = offeneVorlagenFuerTag(datumIso, tag.getDay(), bereich)
                  const offeneS = offeneSpotsFuerTag(datumIso, bereich)
                  const zielSchluessel = `offen-${bereich}-${datumIso}`
                  return (
                    <td
                      key={datumIso}
                      onDragOver={(e) => {
                        e.preventDefault()
                        setHoverZiel(zielSchluessel)
                      }}
                      onDragLeave={() => setHoverZiel((z) => (z === zielSchluessel ? null : z))}
                      onDrop={(e) => {
                        e.preventDefault()
                        setHoverZiel(null)
                        // Zurueck in den Offen-Pool: bereits zugewiesene Schicht wieder freigeben
                        if (gezogenerEintrag) {
                          eintragLoeschenExtern(gezogenerEintrag)
                          setGezogenerEintrag(null)
                        }
                      }}
                      style={{
                        ...zellBasisStil,
                        background: hoverZiel === zielSchluessel ? '#ffedd5' : '#fff7ed',
                        borderBottom: '1px solid #fed7aa',
                        padding: 5,
                        verticalAlign: 'top',
                      }}
                    >
                      {offeneV.length === 0 && offeneS.length === 0 ? (
                        <div style={{ textAlign: 'center', fontSize: 10, color: 'var(--success)' }}>
                          ✓ besetzt
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {offeneV.map((vorlage) => (
                            <div
                              key={vorlage.id}
                              draggable
                              onDragStart={() =>
                                setGezogeneVorlage({ art: 'vorlage', id: vorlage.id, tagDatum: datumIso, bereich })
                              }
                              onDragEnd={() => setGezogeneVorlage(null)}
                              title="Nach unten auf die Person ziehen"
                              style={{
                                background: vorlage.farbe,
                                color: '#ffffff',
                                borderRadius: 6,
                                padding: '4px 6px',
                                cursor: 'grab',
                                fontSize: 10,
                                fontWeight: 600,
                              }}
                            >
                              <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {vorlage.name}
                              </div>
                              <div style={{ fontSize: 9, opacity: 0.85, fontWeight: 400 }}>
                                {zeitKurz(vorlage.beginn_zeit)}–{zeitKurz(vorlage.ende_zeit)}
                              </div>
                            </div>
                          ))}
                          {offeneS.map((x) => (
                            <div
                              key={x.id}
                              draggable
                              onDragStart={() =>
                                setGezogeneVorlage({ art: 'spot', id: x.id, tagDatum: datumIso, bereich })
                              }
                              onDragEnd={() => setGezogeneVorlage(null)}
                              onClick={() => offenSpotBearbeiten(x)}
                              title="Offene Spotschicht: Klick zum Bearbeiten, nach unten auf die Person ziehen zum Zuweisen"
                              style={{
                                background: x.farbe ?? '#8b1a1a',
                                color: '#ffffff',
                                borderRadius: 6,
                                padding: '4px 6px',
                                cursor: 'grab',
                                fontSize: 10,
                                fontWeight: 600,
                                position: 'relative',
                              }}
                            >
                              <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 14 }}>
                                <span style={{ background: 'rgba(255,255,255,0.25)', borderRadius: 3, padding: '0 4px', fontSize: 8, marginRight: 4 }}>
                                  SPOT
                                </span>
                                {x.name}
                              </div>
                              <div style={{ fontSize: 9, opacity: 0.9, fontWeight: 400 }}>
                                {zeitKurz(x.beginn_zeit)}–{zeitKurz(x.ende_zeit)}
                              </div>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  offeneSpotschichtLoeschen(x)
                                }}
                                title="Offene Spotschicht löschen"
                                style={{
                                  position: 'absolute',
                                  top: 2,
                                  right: 4,
                                  background: 'none',
                                  border: 'none',
                                  color: '#ffffff',
                                  cursor: 'pointer',
                                  fontSize: 11,
                                  lineHeight: 1,
                                }}
                              >
                                ✕
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                  )
                })}
                <td style={{ ...zellBasisStil, background: '#fff7ed', borderBottom: '1px solid #fed7aa' }} />
              </tr>
            ))}
            {mitarbeiterListe.map((mitarbeiter, zeilenIndex) => {
              const vorherigeKategorie = zeilenIndex > 0 ? mitarbeiterListe[zeilenIndex - 1].kategorie : null
              const neueGruppe = mitarbeiter.kategorie !== vorherigeKategorie
              return (
                <Fragment key={mitarbeiter.id}>
                  {neueGruppe && (
                    <tr key={`gruppe-${mitarbeiter.kategorie ?? 'ohne'}`}>
                      <td
                        colSpan={9}
                        style={{
                          background: '#eef2f7',
                          color: 'var(--navy)',
                          fontWeight: 700,
                          fontSize: 11,
                          padding: '6px 16px',
                          textTransform: 'uppercase',
                          letterSpacing: 0.4,
                          borderBottom: '1px solid var(--border)',
                          borderTop: zeilenIndex > 0 ? '1px solid var(--border)' : undefined,
                        }}
                      >
                        {mitarbeiter.kategorie ?? 'Ohne Qualifikation'}
                      </td>
                    </tr>
                  )}
                  <tr key={mitarbeiter.id} style={{ background: zeilenIndex % 2 === 0 ? '#ffffff' : '#fafbfc' }}>
                    <td style={{ ...zellBasisStil, padding: '8px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div
                          style={{
                            width: 26,
                            height: 26,
                            borderRadius: '50%',
                            background: farbeFuerAvatar(mitarbeiter.name),
                            color: '#ffffff',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 10,
                            fontWeight: 700,
                            flexShrink: 0,
                          }}
                        >
                          {initialen(mitarbeiter.name)}
                        </div>
                        <span
                          style={{
                            fontWeight: 500,
                            color: '#1e293b',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {mitarbeiter.name}
                        </span>
                      </div>
                    </td>
                    {tage.map((tag) => {
                      const datumIso = datumZuISO(tag)
                      const urlaub = istUrlaub(mitarbeiter.id, datumIso)
                      const eintrag = eintragFuer(mitarbeiter.id, datumIso)
                      const ausgewaehlt =
                        ausgewaehlteZelle?.mitarbeiterId === mitarbeiter.id && ausgewaehlteZelle?.datum === datumIso
                      const spalteBetont = istHeute(tag) || istWochenende(tag)

                      let karte: React.ReactNode = null

                      if (urlaub) {
                        karte = <SchichtKarte farbe="#db2777" titel="Urlaub" umrandet />
                      } else if (eintrag?.status === 'ruhe') {
                        karte = <SchichtKarte farbe="#0e7490" titel="Ruhe" umrandet />
                      } else if (eintrag?.status === 'frei') {
                        karte = <SchichtKarte farbe="#64748b" titel="Frei" umrandet />
                      } else if (eintrag?.ist_spotschicht) {
                        karte = (
                          <SchichtKarte
                            farbe={eintrag.spot_farbe ?? '#8b1a1a'}
                            titel={eintrag.spot_name ?? ''}
                            zeile2={`${zeitKurz(eintrag.spot_beginn_zeit)}–${zeitKurz(eintrag.spot_ende_zeit)}`}
                            zeile3={eintrag.spot_dienstort ?? undefined}
                            info={eintrag.spot_info ?? undefined}
                          />
                        )
                      } else if (eintrag?.schichtvorlage_id) {
                        const vorlage = vorlagen.find((v) => v.id === eintrag.schichtvorlage_id)
                        if (vorlage) {
                          const si = schichtInfoVon(eintrag)
                          karte = (
                            <SchichtKarte
                              farbe={vorlage.farbe}
                              titel={vorlage.name + (si?.abweichung ? ' ✎' : '')}
                              zeile2={
                                si
                                  ? `${minutenAlsUhrzeit(si.beginn)}–${minutenAlsUhrzeit(si.ende)}`
                                  : `${zeitKurz(vorlage.beginn_zeit)}–${zeitKurz(vorlage.ende_zeit)}`
                              }
                              zeile3={si?.ort ?? vorlage.dienstort ?? undefined}
                              info={eintrag.abw_info ?? undefined}
                            />
                          )
                        }
                      }

                      const zielSchluessel = `${mitarbeiter.id}-${datumIso}`
                      const falscherTagBeimZiehen = !!gezogeneVorlage && gezogeneVorlage.tagDatum !== datumIso
                      const warnungenTag = warnungenFuer(mitarbeiter.id, tag)

                      return (
                        <td
                          key={datumIso}
                          onClick={() => (!urlaub || !!eintrag) && zelleOeffnen(mitarbeiter.id, datumIso)}
                          onDragOver={(e) => {
                            if (urlaub || falscherTagBeimZiehen) return
                            e.preventDefault()
                            setHoverZiel(zielSchluessel)
                          }}
                          onDragLeave={() => setHoverZiel((z) => (z === zielSchluessel ? null : z))}
                          onDrop={(e) => {
                            e.preventDefault()
                            setHoverZiel(null)
                            if (urlaub) return
                            if (gezogeneVorlage && gezogeneVorlage.tagDatum === datumIso) {
                              offenesZuweisen(gezogeneVorlage, mitarbeiter.id, datumIso)
                              setGezogeneVorlage(null)
                            } else if (gezogenerEintrag) {
                              eintragVerschieben(gezogenerEintrag, mitarbeiter.id, datumIso)
                              setGezogenerEintrag(null)
                            }
                          }}
                          style={{
                            ...zellBasisStil,
                            opacity: falscherTagBeimZiehen ? 0.5 : 1,
                            background:
                              hoverZiel === zielSchluessel
                                ? '#e0f2fe'
                                : spalteBetont
                                ? istHeute(tag)
                                  ? '#f3f7fd'
                                  : '#fafbfc'
                                : undefined,
                            position: 'relative',
                            cursor: urlaub && !eintrag ? 'default' : 'pointer',
                            boxShadow: ausgewaehlt ? 'inset 0 0 0 2px var(--navy)' : undefined,
                            padding: 5,
                          }}
                        >
                          {warnungenTag.length > 0 && (
                            <div
                              title={warnungenTag.map((w) => w.lang).join('\n')}
                              style={{
                                position: 'absolute',
                                top: 1,
                                right: 3,
                                zIndex: 2,
                                fontSize: 12,
                                lineHeight: 1,
                                color: warnungenTag.some((w) => w.art === 'ueberschneidung') ? '#dc2626' : '#d97706',
                                background: '#ffffff',
                                borderRadius: 4,
                                padding: '1px 2px',
                                boxShadow: '0 0 0 1px #fecaca',
                              }}
                            >
                              ⚠
                            </div>
                          )}
                          {karte && eintrag && !urlaub && !eintrag.status ? (
                            <div
                              draggable
                              onDragStart={(e) => {
                                e.stopPropagation()
                                setGezogenerEintrag({ mitarbeiterId: mitarbeiter.id, datum: datumIso })
                              }}
                              onDragEnd={() => setGezogenerEintrag(null)}
                              style={{ cursor: 'grab' }}
                            >
                              {karte}
                            </div>
                          ) : (
                            karte
                          )}
                          {!karte && (
                            <div
                              className="dienstplan-leerzelle"
                              style={{
                                height: 44,
                                borderRadius: 8,
                                border: '1.5px dashed #e2e8f0',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: '#cbd5e1',
                                fontSize: 16,
                              }}
                            >
                              +
                            </div>
                          )}
                        </td>
                      )
                    })}
                    <td style={{ ...zellBasisStil, textAlign: 'center' }}>
                      <div
                        title={wochenMinuten(mitarbeiter.id) > 48 * 60 ? 'Über 48 Wochenstunden' : undefined}
                        style={{
                          fontWeight: 700,
                          color: wochenMinuten(mitarbeiter.id) > 48 * 60 ? '#dc2626' : 'var(--navy)',
                          fontSize: 13,
                        }}
                      >
                        {wochenMinuten(mitarbeiter.id) > 48 * 60 ? '⚠ ' : ''}
                        {wochenArbeitszeit(mitarbeiter.id)}
                      </div>
                    </td>
                  </tr>
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }
}

function SchichtKarte({
  farbe,
  titel,
  zeile2,
  zeile3,
  info,
  umrandet,
}: {
  farbe: string
  titel: string
  zeile2?: string
  zeile3?: string
  info?: string
  umrandet?: boolean
}) {
  if (umrandet) {
    return (
      <div
        style={{
          height: 44,
          borderRadius: 8,
          border: `1.5px solid ${farbe}`,
          background: `${farbe}15`,
          color: farbe,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 700,
          fontSize: 12,
        }}
      >
        {titel}
      </div>
    )
  }

  return (
    <div
      style={{
        minHeight: 44,
        borderRadius: 8,
        background: farbe,
        color: '#ffffff',
        padding: '5px 7px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 1,
      }}
    >
      <div
        style={{
          fontWeight: 700,
          fontSize: 11,
          lineHeight: 1.25,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
        title={titel}
      >
        {titel}
      </div>
      {zeile2 && <div style={{ fontSize: 10, opacity: 0.9 }}>{zeile2}</div>}
      {zeile3 && (
        <div style={{ fontSize: 9, opacity: 0.8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {zeile3}
        </div>
      )}
      {info && (
        <div
          title={info}
          style={{ fontSize: 9, opacity: 0.95, fontStyle: 'italic', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
        >
          ℹ {info}
        </div>
      )}
    </div>
  )
}

const pfeilKnopfStil: React.CSSProperties = {
  width: 34,
  height: 34,
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: '#ffffff',
  color: 'var(--navy)',
  cursor: 'pointer',
  fontSize: 20,
  lineHeight: 1,
  padding: 0,
}

const navigationsKnopfStil: React.CSSProperties = {
  background: 'none',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '6px 14px',
  cursor: 'pointer',
  fontSize: 13,
  color: 'var(--navy)',
  fontWeight: 500,
}

const kopfZelleStil: React.CSSProperties = {
  padding: '10px 6px',
  borderBottom: '1px solid var(--border)',
  textAlign: 'center',
  fontWeight: 600,
}

const zellBasisStil: React.CSSProperties = {
  borderBottom: '1px solid #f1f5f9',
  padding: 5,
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
