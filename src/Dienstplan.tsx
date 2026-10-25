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
}

interface Balken {
  info: SchichtInfo
  von: number // Minuten im angezeigten Tag (0-1440)
  bis: number
  vortag: boolean // Nachtschicht vom Vortag
  weiter: boolean // laeuft in den Folgetag
}

const BEREICHE = ['Lokführer', 'Wagenmeister'] as const

function bereichVonKategorie(kategorie: string | null): string {
  return (kategorie ?? '').toLowerCase().includes('wagen') ? 'Wagenmeister' : 'Lokführer'
}

const WOCHENTAGE_KURZ = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
const WOCHENTAGE_LANG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']
const STUNDEN = Array.from({ length: 24 }, (_, i) => i)

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
  const [ansicht, setAnsicht] = useState<'tag' | 'woche'>('tag')
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
  })
  const [gezogenerEintrag, setGezogenerEintrag] = useState<{ mitarbeiterId: string; datum: string } | null>(null)
  const [hoverZiel, setHoverZiel] = useState<string | null>(null)
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

  const wochenStart = montagDerWoche(bezugsdatum)
  const tage = Array.from({ length: 7 }, (_, i) => addTage(wochenStart, i))
  const tagIso = datumZuISO(bezugsdatum)
  const wochenStartIso = datumZuISO(wochenStart)

  async function laden() {
    setLadeVorgang(true)
    // ein Tag davor wird mitgeladen, damit Nachtschichten vom Vortag sichtbar sind
    const startIso = datumZuISO(addTage(wochenStart, -1))
    const endeIso = datumZuISO(tage[6])
    const urlaubStartIso = datumZuISO(wochenStart)

    const [
      { data: mitarbeiterData },
      { data: vorlagenData },
      { data: eintraegeData },
      { data: urlaubeData },
      { data: spotsData },
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
    setLadeVorgang(false)
    setErstesLaden(false)
  }

  useEffect(() => {
    laden()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wochenStartIso])

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
      }
    }
    if (eintrag.schichtvorlage_id) {
      const v = vorlagen.find((x) => x.id === eintrag.schichtvorlage_id)
      if (!v) return null
      return infoAusVorlage(v)
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
    setSpotFormularOffen(false)
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
        status: quellEintrag.status,
      },
      { onConflict: 'mitarbeiter_id,datum' }
    )
    await laden()
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
    setOffenSpotDaten((alt) => ({ ...alt, datum: tagIso }))
    setOffenSpotDialogOffen(true)
  }

  async function offeneSpotschichtAnlegen() {
    if (!offenSpotDaten.name.trim() || !offenSpotDaten.datum) return
    await supabase.from('offene_spotschichten').insert({
      datum: offenSpotDaten.datum,
      bereich: offenSpotDaten.bereich,
      name: offenSpotDaten.name.trim(),
      beginn_zeit: offenSpotDaten.beginn_zeit,
      ende_zeit: offenSpotDaten.ende_zeit,
      pause_minuten: offenSpotDaten.pause_minuten,
      dienstort: offenSpotDaten.dienstort || null,
      farbe: offenSpotDaten.farbe,
    })
    setOffenSpotDialogOffen(false)
    setOffenSpotDaten((alt) => ({ ...alt, name: '', dienstort: '' }))
    await laden()
  }

  async function offeneSpotschichtLoeschen(spot: OffeneSpot) {
    if (!window.confirm(`Offene Spotschicht "${spot.name}" wirklich löschen?`)) return
    await supabase.from('offene_spotschichten').delete().eq('id', spot.id)
    await laden()
  }

  function wochenArbeitszeit(mitarbeiterId: string): string {
    let summe = 0
    for (const tag of tage) {
      const info = schichtInfoVon(eintragFuer(mitarbeiterId, datumZuISO(tag)))
      if (info) summe += info.ende - info.beginn
    }
    return minutenAlsText(summe)
  }

  function tagesArbeitszeit(mitarbeiterId: string, datum: Date): string {
    const info = schichtInfoVon(eintragFuer(mitarbeiterId, datumZuISO(datum)))
    if (!info) return ''
    return minutenAlsText(info.ende - info.beginn)
  }

  function offeneVorlagenFuerTag(datumIso: string, wochentag: number, bereich: string): Schichtvorlage[] {
    return vorlagen.filter((v) => {
      if ((v.bereich ?? 'Lokführer') !== bereich) return false
      const benoetigt = (v.benoetigte_wochentage ?? [0, 1, 2, 3, 4, 5, 6]).includes(wochentag)
      if (!benoetigt) return false
      const bereitsVergeben = eintraege.some((e) => e.schichtvorlage_id === v.id && e.datum === datumIso)
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
    }
  }

  function navigieren(richtung: -1 | 1) {
    setBezugsdatum(addTage(bezugsdatum, (ansicht === 'tag' ? 1 : 7) * richtung))
  }

  if (erstesLaden && ladeVorgang) {
    return <p style={{ color: 'var(--text-muted)' }}>Lade Dienstplan...</p>
  }

  const navigationsText =
    ansicht === 'tag'
      ? `${WOCHENTAGE_LANG[bezugsdatum.getDay()]}, ${datumKurz(bezugsdatum)}${bezugsdatum.getFullYear()}`
      : `${datumKurz(tage[0])} – ${datumKurz(tage[6])} ${tage[0].getFullYear()}`

  return (
    <div style={{ opacity: ladeVorgang ? 0.7 : 1, transition: 'opacity 0.15s' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={() => navigieren(-1)} style={navigationsKnopfStil}>
            ← {ansicht === 'tag' ? 'Vortag' : 'Vorherige Woche'}
          </button>
          <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--navy)', minWidth: 190, textAlign: 'center' }}>
            {navigationsText}
          </div>
          <button onClick={() => navigieren(1)} style={navigationsKnopfStil}>
            {ansicht === 'tag' ? 'Folgetag' : 'Nächste Woche'} →
          </button>
          <button onClick={() => setBezugsdatum(heuteOhneUhrzeit())} style={navigationsKnopfStil}>
            Heute
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button onClick={offenSpotDialogOeffnen} style={primaerKnopfStil}>
          + Offene Spotschicht
        </button>
        <div style={{ display: 'flex', border: '1px solid var(--navy)', borderRadius: 6, overflow: 'hidden' }}>
          {(['tag', 'woche'] as const).map((a) => (
            <button
              key={a}
              onClick={() => setAnsicht(a)}
              style={{
                border: 'none',
                padding: '7px 18px',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
                background: ansicht === a ? 'var(--navy)' : '#ffffff',
                color: ansicht === a ? '#ffffff' : 'var(--navy)',
              }}
            >
              {a === 'tag' ? 'Tag' : 'Woche'}
            </button>
          ))}
        </div>
        </div>
      </div>

      {ansicht === 'tag' && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
          {tage.map((tag, i) => {
            const aktiv = datumZuISO(tag) === tagIso
            return (
              <button
                key={i}
                onClick={() => setBezugsdatum(tag)}
                style={{
                  border: `1px solid ${aktiv ? 'var(--navy)' : 'var(--border)'}`,
                  background: aktiv ? 'var(--navy)' : istHeute(tag) ? '#dbe6f5' : '#ffffff',
                  color: aktiv ? '#ffffff' : 'var(--navy)',
                  borderRadius: 6,
                  padding: '5px 12px',
                  fontSize: 12,
                  cursor: 'pointer',
                  fontWeight: aktiv ? 700 : 500,
                }}
              >
                {WOCHENTAGE_KURZ[i]} {datumKurz(tag)}
              </button>
            )
          })}
        </div>
      )}

      {ansicht === 'tag' ? renderTagesansicht() : renderWochenansicht()}

      <style>{`.dienstplan-leerzelle:hover { border-color: var(--navy) !important; color: var(--navy) !important; }`}</style>

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
              <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--navy)' }}>Offene Spotschicht anlegen</div>
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
                Anlegen
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
                          e.mitarbeiter_id !== ausgewaehlteZelle.mitarbeiterId
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
                <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                  <button onClick={spotschichtAnlegen} style={primaerKnopfStil}>
                    Anlegen
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

    // Pruefung Ruhezeit (< 11 Std. zwischen Schichten)
    const hinweise: string[] = []
    for (const m of mitarbeiterListe) {
      if (istUrlaub(m.id, datumIso)) continue
      const vortag = schichtInfoVon(eintragFuer(m.id, datumZuISO(addTage(bezugsdatum, -1))))
      const heute = schichtInfoVon(eintragFuer(m.id, datumIso))
      if (!vortag || !heute) continue
      const ruhe = 1440 + heute.beginn - vortag.ende
      if (ruhe < 660) {
        hinweise.push(
          `${m.name}: nur ${minutenAlsText(Math.max(ruhe, 0))} Std. Ruhezeit (Vortag Ende ${minutenAlsUhrzeit(vortag.ende)}, heute Beginn ${minutenAlsUhrzeit(heute.beginn)})`
        )
      }
    }

    const linkeSpalte: React.CSSProperties = { width: 190, flexShrink: 0, padding: '0 14px' }
    const rechteSpalte: React.CSSProperties = { width: 56, flexShrink: 0, textAlign: 'center' }

    return (
      <div>
        <div
          style={{
            border: '1px solid var(--border)',
            borderRadius: 12,
            overflow: 'hidden',
            boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
            background: '#ffffff',
          }}
        >
          <div style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: 1000 }}>
              {/* Kopfzeile mit Uhrzeiten */}
              <div style={{ display: 'flex', background: '#f8fafc', borderBottom: '1px solid var(--border)' }}>
                <div style={{ ...linkeSpalte, padding: '10px 14px', fontWeight: 600, fontSize: 12, color: '#475569' }}>
                  Mitarbeiter
                </div>
                <div style={{ flex: 1, display: 'flex' }}>
                  {STUNDEN.map((h) => (
                    <div
                      key={h}
                      style={{
                        flex: 1,
                        padding: '10px 0 10px 4px',
                        fontSize: 10,
                        color: '#64748b',
                        borderLeft: '1px solid #e2e8f0',
                      }}
                    >
                      {String(h).padStart(2, '0')}
                    </div>
                  ))}
                </div>
                <div style={{ ...rechteSpalte, padding: '10px 0', fontWeight: 600, fontSize: 12, color: '#475569' }}>
                  Std.
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
                                  title="Offene Spotschicht: auf eine Person ziehen"
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
                    <div style={rechteSpalte} />
                  </div>
                )
              })}

              {/* Mitarbeiterzeilen */}
              {mitarbeiterListe.map((mitarbeiter, zeilenIndex) => {
                const vorherigeKategorie = zeilenIndex > 0 ? mitarbeiterListe[zeilenIndex - 1].kategorie : null
                const neueGruppe = mitarbeiter.kategorie !== vorherigeKategorie
                const urlaub = istUrlaub(mitarbeiter.id, datumIso)
                const eintrag = eintragFuer(mitarbeiter.id, datumIso)
                const balken = urlaub ? [] : balkenFuer(mitarbeiter.id, bezugsdatum)
                const zielSchluessel = `${mitarbeiter.id}-${datumIso}`
                const ausgewaehlt =
                  ausgewaehlteZelle?.mitarbeiterId === mitarbeiter.id && ausgewaehlteZelle?.datum === datumIso

                return (
                  <Fragment key={mitarbeiter.id}>
                    {neueGruppe && (
                      <div
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
                      </div>
                    )}
                    <div style={{ display: 'flex', borderBottom: '1px solid #f1f5f9', alignItems: 'stretch' }}>
                      <div style={{ ...linkeSpalte, display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px' }}>
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
                            fontSize: 12,
                            color: '#1e293b',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {mitarbeiter.name}
                        </span>
                      </div>

                      <div
                        onClick={() => !urlaub && zelleOeffnen(mitarbeiter.id, datumIso)}
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
                          height: 52,
                          cursor: urlaub ? 'default' : 'pointer',
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
                              inset: '8px 4px',
                              borderRadius: 8,
                              border: '1.5px solid #db2777',
                              background: '#db277715',
                              color: '#db2777',
                              fontWeight: 700,
                              fontSize: 12,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            Urlaub
                          </div>
                        )}

                        {!urlaub && eintrag?.status && (
                          <div
                            style={{
                              position: 'absolute',
                              inset: '8px 4px',
                              borderRadius: 8,
                              border: `1.5px solid ${eintrag.status === 'ruhe' ? '#0e7490' : '#64748b'}`,
                              background: eintrag.status === 'ruhe' ? '#0e749015' : '#64748b15',
                              color: eintrag.status === 'ruhe' ? '#0e7490' : '#64748b',
                              fontWeight: 700,
                              fontSize: 12,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            {eintrag.status === 'ruhe' ? 'Ruhe' : 'Frei'}
                          </div>
                        )}

                        {!urlaub && !eintrag && balken.length === 0 && (
                          <div
                            className="dienstplan-leerzelle"
                            style={{
                              position: 'absolute',
                              inset: '8px 4px',
                              borderRadius: 8,
                              border: '1.5px dashed #e2e8f0',
                              color: '#cbd5e1',
                              fontSize: 14,
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
                          // Pausenabschnitt (nur bei Vorlagen mit Pause von/bis, nur am Starttag)
                          const pauseSichtbar =
                            !b.vortag && b.info.pauseVon !== null && b.info.pauseBis !== null && b.info.pauseBis > b.info.pauseVon
                          return (
                            <div
                              key={i}
                              draggable={!b.vortag}
                              onDragStart={(e) => {
                                e.stopPropagation()
                                setGezogenerEintrag({ mitarbeiterId: mitarbeiter.id, datum: datumIso })
                              }}
                              onDragEnd={() => setGezogenerEintrag(null)}
                              title={`${b.info.titel} ${minutenAlsUhrzeit(b.info.beginn)}–${minutenAlsUhrzeit(b.info.ende)}${b.info.ort ? ' · ' + b.info.ort : ''}${b.vortag ? ' (Nachtschicht vom Vortag)' : ''}`}
                              style={{
                                position: 'absolute',
                                left: `${(b.von / 1440) * 100}%`,
                                width: `${breite}%`,
                                top: 8,
                                height: 36,
                                boxSizing: 'border-box',
                                background: b.info.farbe,
                                color: '#ffffff',
                                opacity: b.vortag ? 0.75 : 1,
                                borderRadius: `${b.vortag ? 0 : 8}px ${b.weiter ? 0 : 8}px ${b.weiter ? 0 : 8}px ${b.vortag ? 0 : 8}px`,
                                padding: '3px 8px',
                                overflow: 'hidden',
                                cursor: b.vortag ? 'pointer' : 'grab',
                                zIndex: 1,
                                display: 'flex',
                                flexDirection: 'column',
                                justifyContent: 'center',
                              }}
                            >
                              <div
                                style={{
                                  fontWeight: 700,
                                  fontSize: 11,
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                }}
                              >
                                {b.vortag ? '← ' : ''}
                                {b.info.titel}
                                {b.weiter ? ' →' : ''}
                              </div>
                              <div style={{ fontSize: 10, opacity: 0.9, whiteSpace: 'nowrap', overflow: 'hidden' }}>
                                {b.vortag
                                  ? `Nacht vom Vortag bis ${minutenAlsUhrzeit(b.info.ende)}`
                                  : `${minutenAlsUhrzeit(b.info.beginn)}–${minutenAlsUhrzeit(b.info.ende)}${b.info.ort ? ' · ' + b.info.ort : ''}`}
                              </div>
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

                      <div
                        style={{
                          ...rechteSpalte,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: 700,
                          fontSize: 12,
                          color: 'var(--navy)',
                        }}
                      >
                        {urlaub ? '' : tagesArbeitszeit(mitarbeiter.id, bezugsdatum)}
                      </div>
                    </div>
                  </Fragment>
                )
              })}

              {/* Besetzung pro Stunde */}
              <div style={{ display: 'flex', background: '#f8fafc', borderTop: '2px solid var(--navy)' }}>
                <div style={{ ...linkeSpalte, display: 'flex', alignItems: 'center', fontWeight: 700, fontSize: 12, color: 'var(--navy)' }}>
                  Besetzung
                </div>
                <div style={{ flex: 1, display: 'flex', height: 58 }}>
                  {besetzung.map((n, h) => (
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
                      <div style={{ fontSize: 10, fontWeight: 700, color: n === 0 ? '#b91c1c' : '#334155' }}>{n}</div>
                      <div
                        style={{
                          width: '70%',
                          height: Math.max(2, (n / maxBesetzung) * 28),
                          background: n === 0 ? '#fca5a5' : '#7ea6e8',
                          borderRadius: 2,
                        }}
                      />
                    </div>
                  ))}
                </div>
                <div style={rechteSpalte} />
              </div>
            </div>
          </div>
        </div>

        {/* Pruefung */}
        <div
          style={{
            marginTop: 12,
            border: '1px solid var(--border)',
            borderRadius: 12,
            padding: '12px 16px',
            background: '#ffffff',
            fontSize: 13,
          }}
        >
          <div style={{ fontWeight: 700, color: 'var(--navy)', marginBottom: 6 }}>Prüfung für diesen Tag</div>
          {hinweise.length === 0 && offeneNamen.length === 0 && (
            <div style={{ color: 'var(--success)' }}>✓ Alles in Ordnung: keine offenen Schichten, Ruhezeiten eingehalten.</div>
          )}
          {offeneNamen.length > 0 && (
            <div style={{ color: '#b45309', marginBottom: 4 }}>
              ⚠ {offeneNamen.length} offene Schicht{offeneNamen.length === 1 ? '' : 'en'}: {offeneNamen.join(', ')}
            </div>
          )}
          {hinweise.map((h, i) => (
            <div key={i} style={{ color: '#b91c1c', marginBottom: 4 }}>
              ⚠ {h}
            </div>
          ))}
          {hinweise.length === 0 && offeneNamen.length > 0 && (
            <div style={{ color: 'var(--success)' }}>✓ Ruhezeiten (mind. 11 Std.) eingehalten.</div>
          )}
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
                              title="Offene Spotschicht: nach unten auf die Person ziehen"
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
                          />
                        )
                      } else if (eintrag?.schichtvorlage_id) {
                        const vorlage = vorlagen.find((v) => v.id === eintrag.schichtvorlage_id)
                        if (vorlage) {
                          karte = (
                            <SchichtKarte
                              farbe={vorlage.farbe}
                              titel={vorlage.name}
                              zeile2={`${zeitKurz(vorlage.beginn_zeit)}–${zeitKurz(vorlage.ende_zeit)}`}
                              zeile3={vorlage.dienstort ?? undefined}
                            />
                          )
                        }
                      }

                      const zielSchluessel = `${mitarbeiter.id}-${datumIso}`
                      const falscherTagBeimZiehen = !!gezogeneVorlage && gezogeneVorlage.tagDatum !== datumIso

                      return (
                        <td
                          key={datumIso}
                          onClick={() => !urlaub && zelleOeffnen(mitarbeiter.id, datumIso)}
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
                            cursor: urlaub ? 'default' : 'pointer',
                            boxShadow: ausgewaehlt ? 'inset 0 0 0 2px var(--navy)' : undefined,
                            padding: 5,
                          }}
                        >
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
                      <div style={{ fontWeight: 700, color: 'var(--navy)', fontSize: 13 }}>
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
  umrandet,
}: {
  farbe: string
  titel: string
  zeile2?: string
  zeile3?: string
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
