import { Fragment, useEffect, useRef, useState } from 'react'
import { supabase } from './lib/supabase'
import { datumZuISO } from './datumUtils'
import { useLiveAktualisierung } from './liveAktualisierung'
import { schichtenAusAuftrag, teilstrecken } from './auftragSchicht'
import BestellungImport from './BestellungImport'
import SchichtDialog from './SchichtDialog'
import { fahrtenPruefen } from './auftragSchicht'
import { Ablauf, AuftragKarte, LokTeile, tagUeberschrift } from './AuftragKarten'
import StatusMailDialog from './StatusMailDialog'

interface Auftrag {
  id: string
  kunde: string | null
  referenz: string | null
  zug_nr: string | null
  evu: string | null
  status: string
  abfahrt_ort: string | null
  abfahrt_datum: string
  abfahrt_soll: string | null
  abfahrt_ist: string | null
  ankunft_ort: string | null
  ankunft_datum: string | null
  ankunft_soll: string | null
  ankunft_ist: string | null
  anzahl_wagen: number | null
  ggk: string | null
  lok: string | null
  wgm_info: string | null
  infos: string | null
  mitarbeiter_info: string | null
  abrechnung_status: string
  kuerzel_abrechnung: string | null
  kuerzel_planung: string | null
  kontrolle: string | null
  preis: number | null
  rechnungsnr: string | null
  info_abrechnung: string | null
  fahrten: unknown
  storno_datum: string | null
  storno_zeit: string | null
  storno_grund: string | null
}

interface Formular {
  kunde: string
  referenz: string
  zug_nr: string
  evu: string
  status: string
  abfahrt_ort: string
  abfahrt_datum: string
  abfahrt_soll: string
  abfahrt_ist: string
  ankunft_ort: string
  ankunft_datum: string
  ankunft_soll: string
  ankunft_ist: string
  anzahl_wagen: string
  ggk: string
  lok: string
  wgm_info: string
  infos: string
  mitarbeiter_info: string
  abrechnung_status: string
  kuerzel_abrechnung: string
  kuerzel_planung: string
  kontrolle: string
  preis: string
  rechnungsnr: string
  info_abrechnung: string
  storno_datum: string
  storno_zeit: string
  storno_grund: string
}

interface Historie {
  id: string
  zeitpunkt: string
  benutzer: string | null
  aktion: string
  aenderungen: Record<string, { alt: unknown; neu: unknown }>
}

interface WgmBesetzung {
  namen: string[]
  offen: boolean
  spotId: string | null
}

interface Besetzung {
  namen: string[]
  offen: boolean
  spotId: string | null
  wgm: WgmBesetzung
  lok: { name: string; person: string | null; spotId: string | null }[]
}

const LEERE_WGM: WgmBesetzung = { namen: [], offen: false, spotId: null }

const STATUS: Record<string, { text: string; farbe: string; hell: string }> = {
  geplant: { text: 'Geplant', farbe: '#475569', hell: '#e2e8f0' },
  bestaetigt: { text: 'Bestätigt', farbe: '#1d4ed8', hell: '#dbeafe' },
  gefahren: { text: 'Gefahren', farbe: '#15803d', hell: '#dcfce7' },
  storniert: { text: 'Storniert', farbe: '#b91c1c', hell: '#fee2e2' },
}

const ABRECHNUNG: Record<string, { text: string; farbe: string; hell: string }> = {
  offen: { text: 'Offen', farbe: '#b45309', hell: '#fef3c7' },
  geprueft: { text: 'Geprüft', farbe: '#1d4ed8', hell: '#dbeafe' },
  abgerechnet: { text: 'Abgerechnet', farbe: '#15803d', hell: '#dcfce7' },
}

const FELDNAMEN: Record<string, string> = {
  kunde: 'Kunde',
  referenz: 'Referenz',
  zug_nr: 'Zugnummer',
  evu: 'EVU',
  status: 'Status',
  abfahrt_ort: 'Abfahrt Ort',
  abfahrt_datum: 'Abfahrt Datum',
  abfahrt_soll: 'Abfahrt Soll',
  abfahrt_ist: 'Abfahrt Ist',
  ankunft_ort: 'Ankunft Ort',
  ankunft_datum: 'Ankunft Datum',
  ankunft_soll: 'Ankunft Soll',
  ankunft_ist: 'Ankunft Ist',
  anzahl_wagen: 'Anzahl Wagen',
  ggk: 'Last/Leer, Zuschläge',
  lok: 'Lok',
  wgm_info: 'Wagenmeister',
  infos: 'Infos',
  mitarbeiter_info: 'Mitarbeiter-Info',
  abrechnung_status: 'Abrechnung',
  kuerzel_abrechnung: 'Kürzel Abrechnung',
  kuerzel_planung: 'Kürzel Planung',
  kontrolle: 'Kontrolle',
  preis: 'Preis',
  rechnungsnr: 'Rechnungsnummer',
  info_abrechnung: 'Info an Abrechnung',
  storno_datum: 'Storno Datum',
  storno_zeit: 'Storno Uhrzeit',
  storno_grund: 'Storno Grund',
}

const WOCHENTAGE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']

function addTage(d: Date, n: number): Date {
  const neu = new Date(d)
  neu.setDate(neu.getDate() + n)
  return neu
}

function montagDerWoche(d: Date): Date {
  const tag = d.getDay()
  const m = new Date(d)
  m.setDate(d.getDate() + (tag === 0 ? -6 : 1 - tag))
  m.setHours(0, 0, 0, 0)
  return m
}

function kalenderwoche(d: Date): number {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const tag = x.getUTCDay() || 7
  x.setUTCDate(x.getUTCDate() + 4 - tag)
  const start = new Date(Date.UTC(x.getUTCFullYear(), 0, 1))
  return Math.ceil(((x.getTime() - start.getTime()) / 86400000 + 1) / 7)
}

function datumDeutsch(iso: string): string {
  return iso.split('-').reverse().join('.')
}

function zeit(z: string | null): string {
  return z ? z.slice(0, 5) : ''
}

function zeitMin(z: string): number {
  const [h, m] = z.split(':').map(Number)
  return h * 60 + m
}

// Abweichung der Ist-Zeit von der Soll-Zeit in Minuten (nur wenige Stunden Unterschied erwartet)
function verspaetung(soll: string | null, ist: string | null): number | null {
  if (!soll || !ist) return null
  let d = zeitMin(ist.slice(0, 5)) - zeitMin(soll.slice(0, 5))
  if (d > 720) d -= 1440
  if (d < -720) d += 1440
  return d
}

function leeresFormular(datum: string): Formular {
  return {
    kunde: '',
    referenz: '',
    zug_nr: '',
    evu: 'RBL',
    status: 'geplant',
    abfahrt_ort: '',
    abfahrt_datum: datum,
    abfahrt_soll: '',
    abfahrt_ist: '',
    ankunft_ort: '',
    ankunft_datum: datum,
    ankunft_soll: '',
    ankunft_ist: '',
    anzahl_wagen: '',
    ggk: '',
    lok: '',
    wgm_info: '',
    infos: '',
    mitarbeiter_info: '',
    abrechnung_status: 'offen',
    kuerzel_abrechnung: '',
    kuerzel_planung: '',
    kontrolle: '',
    preis: '',
    rechnungsnr: '',
    info_abrechnung: '',
    storno_datum: '',
    storno_zeit: '',
    storno_grund: '',
  }
}

function auftragZuFormular(a: Auftrag): Formular {
  return {
    kunde: a.kunde ?? '',
    referenz: a.referenz ?? '',
    zug_nr: a.zug_nr ?? '',
    evu: a.evu ?? '',
    status: a.status,
    abfahrt_ort: a.abfahrt_ort ?? '',
    abfahrt_datum: a.abfahrt_datum,
    abfahrt_soll: zeit(a.abfahrt_soll),
    abfahrt_ist: zeit(a.abfahrt_ist),
    ankunft_ort: a.ankunft_ort ?? '',
    ankunft_datum: a.ankunft_datum ?? a.abfahrt_datum,
    ankunft_soll: zeit(a.ankunft_soll),
    ankunft_ist: zeit(a.ankunft_ist),
    anzahl_wagen: a.anzahl_wagen == null ? '' : String(a.anzahl_wagen),
    ggk: a.ggk ?? '',
    lok: a.lok ?? '',
    wgm_info: a.wgm_info ?? '',
    infos: a.infos ?? '',
    mitarbeiter_info: a.mitarbeiter_info ?? '',
    abrechnung_status: a.abrechnung_status,
    kuerzel_abrechnung: a.kuerzel_abrechnung ?? '',
    kuerzel_planung: a.kuerzel_planung ?? '',
    kontrolle: a.kontrolle ?? '',
    preis: a.preis == null ? '' : String(a.preis),
    rechnungsnr: a.rechnungsnr ?? '',
    info_abrechnung: a.info_abrechnung ?? '',
    storno_datum: a.storno_datum ?? '',
    storno_zeit: zeit(a.storno_zeit),
    storno_grund: a.storno_grund ?? '',
  }
}

const leerNull = (s: string): string | null => (s.trim() === '' ? null : s.trim())

function formularZuDaten(f: Formular) {
  return {
    kunde: leerNull(f.kunde),
    referenz: leerNull(f.referenz),
    zug_nr: leerNull(f.zug_nr),
    evu: leerNull(f.evu),
    status: f.status,
    abfahrt_ort: leerNull(f.abfahrt_ort),
    abfahrt_datum: f.abfahrt_datum,
    abfahrt_soll: leerNull(f.abfahrt_soll),
    abfahrt_ist: leerNull(f.abfahrt_ist),
    ankunft_ort: leerNull(f.ankunft_ort),
    ankunft_datum: leerNull(f.ankunft_datum),
    ankunft_soll: leerNull(f.ankunft_soll),
    ankunft_ist: leerNull(f.ankunft_ist),
    anzahl_wagen: f.anzahl_wagen.trim() === '' ? null : Math.round(Number(f.anzahl_wagen)),
    ggk: leerNull(f.ggk),
    lok: leerNull(f.lok),
    wgm_info: leerNull(f.wgm_info),
    infos: leerNull(f.infos),
    mitarbeiter_info: leerNull(f.mitarbeiter_info),
    abrechnung_status: f.abrechnung_status,
    kuerzel_abrechnung: leerNull(f.kuerzel_abrechnung),
    kuerzel_planung: leerNull(f.kuerzel_planung),
    kontrolle: leerNull(f.kontrolle),
    preis: f.preis.trim() === '' ? null : Number(f.preis.replace(',', '.')),
    rechnungsnr: leerNull(f.rechnungsnr),
    info_abrechnung: leerNull(f.info_abrechnung),
    storno_datum: f.status === 'storniert' ? leerNull(f.storno_datum) : null,
    storno_zeit: f.status === 'storniert' ? leerNull(f.storno_zeit) : null,
    storno_grund: f.status === 'storniert' ? leerNull(f.storno_grund) : null,
  }
}

function csvSpeichern(name: string, kopf: string[], zeilen: string[][]) {
  const text = [kopf, ...zeilen].map((z) => z.map((w) => `"${String(w).replace(/"/g, '""')}"`).join(';')).join('\r\n')
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

export default function Auftraege({ darfDisponieren, darfAbrechnen }: { darfDisponieren: boolean; darfAbrechnen: boolean }) {
  const [wocheStart, setWocheStart] = useState(() => montagDerWoche(new Date()))
  const [auftraege, setAuftraege] = useState<Auftrag[]>([])
  const [besetzung, setBesetzung] = useState<Record<string, Besetzung>>({})
  const [kundenListe, setKundenListe] = useState<string[]>([])
  const [laedt, setLaedt] = useState(true)
  const [fehler, setFehler] = useState<string | null>(null)
  const [suche, setSuche] = useState('')
  const [statusFilter, setStatusFilter] = useState('alle')
  const [nurOhneLokfuehrer, setNurOhneLokfuehrer] = useState(false)
  const [bearbeiteId, setBearbeiteId] = useState<string | 'neu' | null>(null)
  const [form, setForm] = useState<Formular>(leeresFormular(datumZuISO(new Date())))
  const [historie, setHistorie] = useState<Historie[]>([])
  const [speichert, setSpeichert] = useState(false)
  const [meldung, setMeldung] = useState<string | null>(null)
  const [importOffen, setImportOffen] = useState(false)
  const [mailOffen, setMailOffen] = useState(false)
  const [ansicht, setAnsichtZustand] = useState<'karten' | 'liste'>(() => {
    try {
      return localStorage.getItem('auftraege_ansicht') === 'liste' ? 'liste' : 'karten'
    } catch {
      return 'karten'
    }
  })
  function ansichtWaehlen(neu: 'karten' | 'liste') {
    setAnsichtZustand(neu)
    try {
      localStorage.setItem('auftraege_ansicht', neu)
    } catch {
      /* egal */
    }
  }
  const [schichtDialog, setSchichtDialog] = useState<{ auftrag: Auftrag; spotId: string | null; bereich: 'Lokführer' | 'Wagenmeister'; teil: number | null } | null>(null)
  const still = useRef(false)
  const [zaehler, setZaehler] = useState(0)

  useLiveAktualisierung(['auftraege', 'dienstplan_eintraege', 'offene_spotschichten'], () => {
    still.current = true
    setZaehler((z) => z + 1)
  })

  const wocheEndeIso = datumZuISO(addTage(wocheStart, 6))
  const wocheStartIso = datumZuISO(wocheStart)

  useEffect(() => {
    async function laden() {
      if (!still.current) setLaedt(true)
      still.current = false
      setFehler(null)
      const antwort = await supabase
        .from('auftraege')
        .select('*')
        .gte('abfahrt_datum', wocheStartIso)
        .lte('abfahrt_datum', wocheEndeIso)
        .order('abfahrt_datum')
        .order('abfahrt_soll')
      if (antwort.error) {
        setFehler(antwort.error.message)
        setLaedt(false)
        return
      }
      const liste = (antwort.data ?? []) as Auftrag[]
      const ids = liste.map((a) => a.id)
      const neueBesetzung: Record<string, Besetzung> = {}
      for (const id of ids) neueBesetzung[id] = { namen: [], offen: false, spotId: null, wgm: { namen: [], offen: false, spotId: null }, lok: [] }
      if (ids.length > 0) {
        const [eintraege, offene, personen] = await Promise.all([
          supabase.from('dienstplan_eintraege').select('mitarbeiter_id, auftrag_id, spot_name').eq('ist_spotschicht', true).in('auftrag_id', ids),
          supabase.from('offene_spotschichten').select('id, auftrag_id, bereich, name').in('auftrag_id', ids),
          supabase.from('mitarbeiter').select('id, name, kategorie'),
        ])
        const personenListe = (personen.data ?? []) as { id: string; name: string; kategorie: string | null }[]
        const namen = new Map<string, string>(personenListe.map((p) => [p.id, p.name]))
        const istWgm = new Map<string, boolean>(personenListe.map((p) => [p.id, (p.kategorie ?? '').toLowerCase().includes('wagen')]))
        for (const e of (eintraege.data ?? []) as { mitarbeiter_id: string; auftrag_id: string; spot_name: string | null }[]) {
          const ziel = istWgm.get(e.mitarbeiter_id) ? neueBesetzung[e.auftrag_id]?.wgm : neueBesetzung[e.auftrag_id]
          ziel?.namen.push(namen.get(e.mitarbeiter_id) ?? 'Unbekannt')
          if (!istWgm.get(e.mitarbeiter_id)) neueBesetzung[e.auftrag_id]?.lok.push({ name: e.spot_name ?? '', person: namen.get(e.mitarbeiter_id) ?? 'Unbekannt', spotId: null })
        }
        for (const o of (offene.data ?? []) as { id: string; auftrag_id: string; bereich: string; name: string }[]) {
          const b = neueBesetzung[o.auftrag_id]
          if (!b) continue
          if (o.bereich !== 'Wagenmeister') b.lok.push({ name: o.name ?? '', person: null, spotId: o.id })
          const ziel = o.bereich === 'Wagenmeister' ? b.wgm : b
          ziel.offen = true
          ziel.spotId = ziel.spotId ?? o.id
        }
      }
      // Zugewiesenen Wagenmeister automatisch in den Auftrag uebernehmen
      if (darfDisponieren) {
        for (const a of liste) {
          const n = neueBesetzung[a.id]?.wgm.namen.join(', ') ?? ''
          if (n && n !== (a.wgm_info ?? '')) {
            const { error } = await supabase.from('auftraege').update({ wgm_info: n }).eq('id', a.id)
            if (!error) a.wgm_info = n
          }
        }
      }
      const kunden = await supabase.from('auftraege').select('kunde').not('kunde', 'is', null).limit(500)
      setKundenListe(Array.from(new Set((kunden.data ?? []).map((k: { kunde: string | null }) => k.kunde ?? '').filter(Boolean))).sort())
      setAuftraege(liste)
      setBesetzung(neueBesetzung)
      setLaedt(false)
    }
    laden()
  }, [wocheStartIso, wocheEndeIso, zaehler])

  const sichtbar = auftraege.filter((a) => {
    if (statusFilter !== 'alle' && a.status !== statusFilter) return false
    if (nurOhneLokfuehrer && (besetzung[a.id]?.namen.length ?? 0) > 0) return false
    const s = suche.trim().toLowerCase()
    if (!s) return true
    return [a.kunde, a.referenz, a.zug_nr, a.evu, a.abfahrt_ort, a.ankunft_ort, a.lok, a.infos]
      .filter(Boolean)
      .some((x) => String(x).toLowerCase().includes(s))
  })

  const ohneSchicht = auftraege.filter(
    (a) => a.status !== 'storniert' && a.abfahrt_soll && (besetzung[a.id]?.namen.length ?? 0) === 0 && !besetzung[a.id]?.offen
  )

  function neuOeffnen() {
    setForm(leeresFormular(datumZuISO(wocheStart)))
    setHistorie([])
    setMeldung(null)
    setBearbeiteId('neu')
  }

  async function bearbeitenOeffnen(a: Auftrag) {
    const wgmNamen = besetzung[a.id]?.wgm.namen ?? []
    setForm({ ...auftragZuFormular(a), wgm_info: wgmNamen.length > 0 ? wgmNamen.join(', ') : (a.wgm_info ?? '') })
    setHistorie([])
    setMeldung(null)
    setBearbeiteId(a.id)
    const h = await supabase.from('auftrag_historie').select('*').eq('auftrag_id', a.id).order('zeitpunkt', { ascending: false }).limit(30)
    setHistorie((h.data ?? []) as Historie[])
  }

  async function speichern() {
    if (!form.abfahrt_datum) {
      setMeldung('Bitte das Abfahrtsdatum eintragen.')
      return
    }
    if (form.status === 'storniert' && (!form.storno_datum || !form.storno_zeit || !form.storno_grund.trim())) {
      setMeldung('Bei einer Stornierung bitte Datum, Uhrzeit und Grund der Stornierung eintragen.')
      return
    }
    setSpeichert(true)
    setMeldung(null)
    const daten = formularZuDaten(form)
    // Ankunft Ist neu eingetragen: der Zug gilt als gefahren
    const ankunftNeu = bearbeiteId === 'neu' || zeit(auftraege.find((x) => x.id === bearbeiteId)?.ankunft_ist ?? null) !== form.ankunft_ist
    if (daten.ankunft_ist && ankunftNeu && (daten.status === 'geplant' || daten.status === 'bestaetigt')) daten.status = 'gefahren'
    let fehlerText: string | null = null
    if (bearbeiteId === 'neu') {
      const { error } = await supabase.from('auftraege').insert(daten)
      fehlerText = error?.message ?? null
    } else if (bearbeiteId) {
      // Abrechnung darf nur die Abrechnungsfelder aendern, Disposition nur die uebrigen
      const abrechnungsFelder = ['abrechnung_status', 'kuerzel_abrechnung', 'kuerzel_planung', 'kontrolle', 'preis', 'rechnungsnr', 'info_abrechnung']
      const werte: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(daten)) {
        const istAbrechnung = abrechnungsFelder.includes(k)
        if ((istAbrechnung && darfAbrechnen) || (!istAbrechnung && darfDisponieren)) werte[k] = v
      }
      const { error } = await supabase.from('auftraege').update(werte).eq('id', bearbeiteId)
      fehlerText = error?.message ?? null
    }
    setSpeichert(false)
    if (fehlerText) {
      setMeldung('Speichern fehlgeschlagen: ' + fehlerText)
      return
    }
    setBearbeiteId(null)
    still.current = true
    setZaehler((z) => z + 1)
  }

  async function loeschen() {
    if (!bearbeiteId || bearbeiteId === 'neu') return
    if (!window.confirm('Diesen Auftrag wirklich löschen? Schichten im Dienstplan bleiben bestehen, verlieren aber die Verknüpfung.')) return
    const { error } = await supabase.from('auftraege').delete().eq('id', bearbeiteId)
    if (error) {
      setMeldung('Löschen fehlgeschlagen: ' + error.message)
      return
    }
    setBearbeiteId(null)
    still.current = true
    setZaehler((z) => z + 1)
  }

  async function schichtAnlegen(a: Auftrag): Promise<string | null> {
    // Bei Personalwechsel gibt es pro Teilstrecke eine Schicht
    const schichten = schichtenAusAuftrag(a)
    if (schichten.length === 0) return 'Für ' + (a.referenz ?? 'den Auftrag') + ' fehlt die Abfahrtszeit.'
    const { error } = await supabase.from('offene_spotschichten').insert(
      schichten.map((s) => ({
        datum: s.datum,
        bereich: 'Lokführer',
        name: s.name,
        beginn_zeit: s.beginn_zeit,
        ende_zeit: s.ende_zeit,
        pause_minuten: s.pause_minuten,
        dienstort: s.dienstort,
        farbe: '#8b1a1a',
        info: s.info,
        auftrag_id: a.id,
      }))
    )
    return error ? error.message : null
  }

  function schichtDialogOeffnen(a: Auftrag, spotId: string | null = null, bereich: 'Lokführer' | 'Wagenmeister' = 'Lokführer', teil: number | null = null) {
    setFehler(null)
    setSchichtDialog({ auftrag: a, spotId, bereich, teil })
  }

  async function alleSchichtenAnlegen() {
    if (!window.confirm(`Für ${ohneSchicht.length} Aufträge offene Schichten im Dienstplan anlegen?`)) return
    setFehler(null)
    for (const a of ohneSchicht) {
      const f = await schichtAnlegen(a)
      if (f) {
        setFehler('Schicht konnte nicht angelegt werden: ' + f)
        break
      }
    }
    still.current = true
    setZaehler((z) => z + 1)
  }

  function exportieren() {
    csvSpeichern(
      `Auftraege_KW${kalenderwoche(wocheStart)}_${wocheStart.getFullYear()}.csv`,
      ['KW', 'Kunde', 'Referenz', 'Zugnummer', 'EVU', 'Status', 'Abfahrt Ort', 'Abfahrt Datum', 'Abfahrt Soll', 'Abfahrt Ist', 'Ankunft Ort', 'Ankunft Datum', 'Ankunft Soll', 'Ankunft Ist', 'Wagen', 'Last/Leer', 'Lok', 'Lokführer', 'Abrechnung', 'Kürzel Abrechnung', 'Kürzel Planung', 'Kontrolle', 'Preis', 'Info an Abrechnung'],
      sichtbar.map((a) => [
        String(kalenderwoche(new Date(a.abfahrt_datum + 'T00:00:00'))),
        a.kunde ?? '',
        a.referenz ?? '',
        a.zug_nr ?? '',
        a.evu ?? '',
        STATUS[a.status]?.text ?? a.status,
        a.abfahrt_ort ?? '',
        datumDeutsch(a.abfahrt_datum),
        zeit(a.abfahrt_soll),
        zeit(a.abfahrt_ist),
        a.ankunft_ort ?? '',
        a.ankunft_datum ? datumDeutsch(a.ankunft_datum) : '',
        zeit(a.ankunft_soll),
        zeit(a.ankunft_ist),
        a.anzahl_wagen == null ? '' : String(a.anzahl_wagen),
        a.ggk ?? '',
        a.lok ?? '',
        (besetzung[a.id]?.namen ?? []).join(', '),
        ABRECHNUNG[a.abrechnung_status]?.text ?? a.abrechnung_status,
        a.kuerzel_abrechnung ?? '',
        a.kuerzel_planung ?? '',
        a.kontrolle ?? '',
        a.preis == null ? '' : String(a.preis).replace('.', ','),
        a.info_abrechnung ?? '',
      ])
    )
  }

  const knopf: React.CSSProperties = { background: 'none', border: '1px solid var(--navy)', color: 'var(--navy)', borderRadius: 8, padding: '8px 14px', fontSize: 13, cursor: 'pointer' }
  const knopfVoll: React.CSSProperties = { ...knopf, background: 'var(--navy)', color: '#ffffff', border: '1px solid var(--navy)' }
  const eingabe: React.CSSProperties = { border: '1px solid var(--border)', borderRadius: 6, padding: '7px 9px', fontSize: 14, width: '100%', boxSizing: 'border-box', fontFamily: 'inherit' }
  const th: React.CSSProperties = { textAlign: 'left', padding: '8px 8px', fontSize: 12, color: '#475569', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', background: '#f8fafc' }
  const td: React.CSSProperties = { padding: '8px 8px', fontSize: 13, borderBottom: '1px solid #eef2f8', verticalAlign: 'top' }

  const badge = (t: { text: string; farbe: string; hell: string }) => (
    <span style={{ fontSize: 11, fontWeight: 700, color: t.farbe, background: t.hell, borderRadius: 6, padding: '2px 7px', whiteSpace: 'nowrap' }}>{t.text}</span>
  )

  const feld = (label: string, schluessel: keyof Formular, optionen?: { typ?: string; sperre?: boolean; liste?: string; breit?: boolean }) => (
    <label style={{ fontSize: 12, color: '#475569', gridColumn: optionen?.breit ? '1 / -1' : undefined }}>
      {label}
      <input
        type={optionen?.typ ?? 'text'}
        value={form[schluessel]}
        list={optionen?.liste}
        disabled={optionen?.sperre}
        onChange={(e) => setForm({ ...form, [schluessel]: e.target.value })}
        style={{ ...eingabe, background: optionen?.sperre ? '#f1f5f9' : '#ffffff' }}
      />
    </label>
  )

  const auswahl = (label: string, schluessel: keyof Formular, optionen: Record<string, { text: string }>, sperre: boolean) => (
    <label style={{ fontSize: 12, color: '#475569' }}>
      {label}
      <select
        value={form[schluessel]}
        disabled={sperre}
        onChange={(e) => {
          const wert = e.target.value
          if (schluessel === 'status' && wert === 'storniert' && !form.storno_zeit) {
            // Zeitpunkt der Stornierung mit "jetzt" vorbelegen
            const jetzt = new Date()
            setForm({ ...form, status: wert, storno_datum: datumZuISO(jetzt), storno_zeit: `${String(jetzt.getHours()).padStart(2, '0')}:${String(jetzt.getMinutes()).padStart(2, '0')}` })
          } else setForm({ ...form, [schluessel]: wert })
        }}
        style={{ ...eingabe, background: sperre ? '#f1f5f9' : '#ffffff' }}
      >
        {Object.entries(optionen).map(([k, v]) => (
          <option key={k} value={k}>
            {v.text}
          </option>
        ))}
      </select>
    </label>
  )

  const text = (label: string, schluessel: keyof Formular, sperre: boolean) => (
    <label style={{ fontSize: 12, color: '#475569', gridColumn: '1 / -1' }}>
      {label}
      <textarea
        value={form[schluessel]}
        rows={2}
        disabled={sperre}
        onChange={(e) => setForm({ ...form, [schluessel]: e.target.value })}
        style={{ ...eingabe, resize: 'vertical', background: sperre ? '#f1f5f9' : '#ffffff' }}
      />
    </label>
  )

  const abschnitt = (titel: string) => (
    <div style={{ gridColumn: '1 / -1', fontWeight: 700, color: 'var(--navy)', fontSize: 13, borderBottom: '1px solid var(--border)', paddingBottom: 4, marginTop: 6 }}>{titel}</div>
  )

  const aktuellerAuftrag = bearbeiteId && bearbeiteId !== 'neu' ? auftraege.find((a) => a.id === bearbeiteId) : undefined
  const sperreDispo = !darfDisponieren
  const wgmZugewiesen = !!aktuellerAuftrag && (besetzung[aktuellerAuftrag.id]?.wgm.namen.length ?? 0) > 0
  const sperreAbrechnung = !darfAbrechnen

  return (
    <div>
      <datalist id="kunden-liste">
        {kundenListe.map((k) => (
          <option key={k} value={k} />
        ))}
      </datalist>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <button onClick={() => setWocheStart(addTage(wocheStart, -7))} style={knopf}>
          ‹
        </button>
        <div style={{ fontWeight: 700, color: 'var(--navy)', minWidth: 190, textAlign: 'center' }}>
          KW {kalenderwoche(wocheStart)} · {datumDeutsch(wocheStartIso).slice(0, 5)} – {datumDeutsch(wocheEndeIso)}
        </div>
        <button onClick={() => setWocheStart(addTage(wocheStart, 7))} style={knopf}>
          ›
        </button>
        <button onClick={() => setWocheStart(montagDerWoche(new Date()))} style={knopf}>
          Heute
        </button>
        <div style={{ flex: 1 }} />
        <div style={{ display: 'flex', border: '1px solid var(--navy)', borderRadius: 8, overflow: 'hidden' }}>
          {(['karten', 'liste'] as const).map((v) => (
            <button
              key={v}
              onClick={() => ansichtWaehlen(v)}
              style={{ background: ansicht === v ? 'var(--navy)' : 'transparent', color: ansicht === v ? '#ffffff' : 'var(--navy)', border: 'none', padding: '8px 12px', fontSize: 13, cursor: 'pointer' }}
            >
              {v === 'karten' ? 'Karten' : 'Liste'}
            </button>
          ))}
        </div>
        <input placeholder="Suchen (Zug, Kunde, Ort, Lok …)" value={suche} onChange={(e) => setSuche(e.target.value)} style={{ ...eingabe, width: 230 }} />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ ...eingabe, width: 140 }}>
          <option value="alle">Alle Status</option>
          {Object.entries(STATUS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.text}
            </option>
          ))}
        </select>
        <label style={{ fontSize: 13, color: '#475569', display: 'flex', gap: 5, alignItems: 'center' }}>
          <input type="checkbox" checked={nurOhneLokfuehrer} onChange={(e) => setNurOhneLokfuehrer(e.target.checked)} />
          ohne Lokführer
        </label>
        <button onClick={exportieren} style={knopf} title="Als Excel-Datei (CSV) speichern">
          Export
        </button>
        {darfDisponieren && (
          <button onClick={() => setImportOffen(true)} style={knopf}>
            Bestellung einlesen
          </button>
        )}
        {darfDisponieren && (
          <button onClick={neuOeffnen} style={knopfVoll}>
            + Neuer Auftrag
          </button>
        )}
      </div>

      {darfDisponieren && ohneSchicht.length > 0 && (
        <div style={{ background: '#fef3c7', border: '1px solid #fcd34d', color: '#92400e', borderRadius: 8, padding: '8px 12px', fontSize: 13, marginBottom: 12, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span>
            <b>{ohneSchicht.length}</b> Aufträge dieser Woche haben noch keine Schicht im Dienstplan.
          </span>
          <button onClick={alleSchichtenAnlegen} style={{ ...knopf, borderColor: '#b45309', color: '#92400e', padding: '5px 10px' }}>
            Schichten anlegen
          </button>
        </div>
      )}

      {fehler && <div style={{ background: '#fee2e2', color: '#991b1b', padding: '8px 12px', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>{fehler}</div>}
      {laedt && <div style={{ fontSize: 14, color: '#64748b' }}>Wird geladen …</div>}

      {!laedt && sichtbar.length === 0 && <div style={{ fontSize: 14, color: '#94a3b8', padding: '20px 0' }}>Keine Aufträge in dieser Woche.</div>}

      {!laedt && sichtbar.length > 0 && ansicht === 'karten' && (
        <div>
          {Array.from(new Set(sichtbar.map((x) => x.abfahrt_datum))).map((tagIso) => (
            <div key={tagIso} style={{ marginBottom: 18 }}>
              <div style={{ fontWeight: 700, color: 'var(--navy)', fontSize: 14, margin: '4px 2px 8px' }}>{tagUeberschrift(tagIso)}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 400px), 1fr))', gap: 12 }}>
                {sichtbar
                  .filter((x) => x.abfahrt_datum === tagIso)
                  .map((a) => (
                    <AuftragKarte
                      key={a.id}
                      a={a}
                      b={besetzung[a.id] ?? { namen: [], offen: false, spotId: null, wgm: LEERE_WGM, lok: [] }}
                      darfDisponieren={darfDisponieren}
                      zeigePreis={darfAbrechnen}
                      statusBadge={badge(STATUS[a.status] ?? STATUS.geplant)}
                      abrechnungBadge={badge(ABRECHNUNG[a.abrechnung_status] ?? ABRECHNUNG.offen)}
                      onOeffnen={() => bearbeitenOeffnen(a)}
                      onSchicht={(bereich, spotId, teil) => schichtDialogOeffnen(a, spotId, bereich, teil ?? null)}
                    />
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {!laedt && sichtbar.length > 0 && ansicht === 'liste' && (
        <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 10, background: '#ffffff' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1080 }}>
            <thead>
              <tr>
                <th style={th}>Datum</th>
                <th style={th}>Zug</th>
                <th style={th}>Kunde / EVU</th>
                <th style={th}>Abfahrt</th>
                <th style={th}>Ankunft</th>
                <th style={th}>Wagen / Lok</th>
                <th style={th}>Lokführer</th>
                <th style={th}>Wagenmeister</th>
                <th style={th}>Status</th>
                <th style={th}>Abrechnung</th>
              </tr>
            </thead>
            <tbody>
              {sichtbar.map((a) => {
                const b = besetzung[a.id] ?? { namen: [], offen: false, spotId: null, wgm: LEERE_WGM, lok: [] }
                const tag = new Date(a.abfahrt_datum + 'T00:00:00')
                const spaet = verspaetung(a.ankunft_soll, a.ankunft_ist)
                const spaetAb = verspaetung(a.abfahrt_soll, a.abfahrt_ist)
                return (
                  <Fragment key={a.id}>
                    <tr onClick={() => bearbeitenOeffnen(a)} style={{ cursor: 'pointer', opacity: a.status === 'storniert' ? 0.55 : 1 }}>
                      <td style={td}>
                        <div style={{ fontWeight: 700 }}>
                          {WOCHENTAGE[tag.getDay()]} {datumDeutsch(a.abfahrt_datum).slice(0, 5)}
                        </div>
                      </td>
                      <td style={td}>
                        <div style={{ fontWeight: 700, color: 'var(--navy)' }}>{a.referenz ?? '–'}</div>
                        {a.zug_nr && <div style={{ fontSize: 11, color: '#64748b' }}>{a.zug_nr}</div>}
                        {a.status === 'storniert' && (
                          <div style={{ fontSize: 11, color: '#b91c1c', fontWeight: 600, maxWidth: 180 }}>
                            Storno {a.storno_datum ? datumDeutsch(a.storno_datum).slice(0, 5) : ''} {zeit(a.storno_zeit)}
                            {a.storno_grund ? `: ${a.storno_grund}` : ''}
                          </div>
                        )}
                      </td>
                      <td style={td}>
                        <div>{a.kunde ?? '–'}</div>
                        <div style={{ fontSize: 11, color: '#64748b' }}>{a.evu}</div>
                      </td>
                      <td style={td}>
                        <div>{a.abfahrt_ort}</div>
                        <div style={{ fontSize: 12 }}>
                          {zeit(a.abfahrt_soll)}
                          {a.abfahrt_ist && (
                            <span style={{ color: spaetAb && spaetAb > 0 ? '#b91c1c' : '#15803d', fontWeight: 600 }}> · Ist {zeit(a.abfahrt_ist)}</span>
                          )}
                        </div>
                      </td>
                      <td style={td}>
                        <div>{a.ankunft_ort}</div>
                        <div style={{ fontSize: 12 }}>
                          {a.ankunft_datum && a.ankunft_datum !== a.abfahrt_datum ? datumDeutsch(a.ankunft_datum).slice(0, 5) + ' ' : ''}
                          {zeit(a.ankunft_soll)}
                          {a.ankunft_ist && (
                            <span style={{ color: spaet && spaet > 0 ? '#b91c1c' : '#15803d', fontWeight: 600 }}>
                              {' '}
                              · Ist {zeit(a.ankunft_ist)}
                              {spaet ? ` (${spaet > 0 ? '+' : ''}${spaet} Min.)` : ''}
                            </span>
                          )}
                        </div>
                      </td>
                      <td style={td}>
                        <div>{a.anzahl_wagen != null ? `${a.anzahl_wagen} Wagen` : ''}</div>
                        <div style={{ fontSize: 11, color: '#64748b' }}>{a.lok}</div>
                      </td>
                      <td style={td} onClick={(e) => e.stopPropagation()}>
                        {teilstrecken(a.fahrten).length >= 2 ? (
                          <LokTeile a={a} b={b} darfDisponieren={darfDisponieren} onSchicht={(bereich, spotId, teil) => schichtDialogOeffnen(a, spotId, bereich, teil ?? null)} />
                        ) : b.namen.length > 0 ? (
                          <span style={{ fontWeight: 600, color: '#15803d' }}>{b.namen.join(', ')}</span>
                        ) : b.offen ? (
                          <span>
                            <span style={{ fontWeight: 600, color: '#b45309' }}>Schicht offen</span>
                            {darfDisponieren && (
                              <button onClick={() => schichtDialogOeffnen(a, b.spotId)} style={{ ...knopf, padding: '2px 7px', fontSize: 11, marginLeft: 6 }}>
                                ändern
                              </button>
                            )}
                          </span>
                        ) : a.status !== 'storniert' && darfDisponieren ? (
                          <button onClick={() => schichtDialogOeffnen(a)} style={{ ...knopf, padding: '4px 8px', fontSize: 12 }}>
                            Schicht anlegen
                          </button>
                        ) : (
                          <span style={{ color: '#94a3b8' }}>–</span>
                        )}
                      </td>
                      <td style={td} onClick={(e) => e.stopPropagation()}>
                        {b.wgm.namen.length > 0 ? (
                          <span style={{ fontWeight: 600, color: '#15803d' }}>{b.wgm.namen.join(', ')}</span>
                        ) : b.wgm.offen ? (
                          <span>
                            <span style={{ fontWeight: 600, color: '#b45309' }}>Schicht offen</span>
                            {darfDisponieren && (
                              <button onClick={() => schichtDialogOeffnen(a, b.wgm.spotId, 'Wagenmeister')} style={{ ...knopf, padding: '2px 7px', fontSize: 11, marginLeft: 6 }}>
                                ändern
                              </button>
                            )}
                          </span>
                        ) : a.status !== 'storniert' && darfDisponieren ? (
                          <button onClick={() => schichtDialogOeffnen(a, null, 'Wagenmeister')} style={{ ...knopf, padding: '4px 8px', fontSize: 12 }}>
                            Schicht anlegen
                          </button>
                        ) : (
                          <span style={{ color: '#94a3b8' }}>–</span>
                        )}
                      </td>
                      <td style={td}>{badge(STATUS[a.status] ?? STATUS.geplant)}</td>
                      <td style={td}>
                        {badge(ABRECHNUNG[a.abrechnung_status] ?? ABRECHNUNG.offen)}
                        {a.preis != null && <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{a.preis.toFixed(2).replace('.', ',')} €</div>}
                      </td>
                    </tr>
                    {(() => {
                      const zusatz = fahrtenPruefen(a.fahrten).filter((f) => f.art !== 'Zugfahrt' && (f.von || f.nach))
                      if (zusatz.length === 0) return null
                      return (
                        <tr onClick={() => bearbeitenOeffnen(a)} style={{ cursor: 'pointer', opacity: a.status === 'storniert' ? 0.55 : 1 }}>
                          <td colSpan={10} style={{ ...td, paddingTop: 0, fontSize: 12, color: '#92400e' }}>
                            {zusatz.map((f, i) => (
                              <span key={i} style={{ display: 'inline-block', marginRight: 16 }}>
                                ↳ <b>{f.art}</b>
                                {f.zug ? ` ${f.zug}` : ''}: {f.von} {f.von_zeit} → {f.nach} {f.nach_zeit}
                                {f.lok ? ` (Lok ${f.lok})` : ''}
                              </span>
                            ))}
                          </td>
                        </tr>
                      )
                    })()}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {schichtDialog && (
        <SchichtDialog
          auftrag={schichtDialog.auftrag}
          spotId={schichtDialog.spotId}
          bereich={schichtDialog.bereich}
          teilstrecke={schichtDialog.teil}
          onSchliessen={() => setSchichtDialog(null)}
          onFertig={() => {
            setSchichtDialog(null)
            still.current = true
            setZaehler((z) => z + 1)
          }}
        />
      )}

      {mailOffen && aktuellerAuftrag && (
        <StatusMailDialog
          auftrag={{ ...aktuellerAuftrag, ...formularZuDaten(form), abfahrt_datum: form.abfahrt_datum }}
          darfSpeichern={darfDisponieren}
          onSchliessen={() => setMailOffen(false)}
        />
      )}

      {importOffen && (
        <BestellungImport
          onSchliessen={() => setImportOffen(false)}
          onFertig={(ersterTag) => {
            setImportOffen(false)
            if (ersterTag) setWocheStart(montagDerWoche(new Date(ersterTag + 'T00:00:00')))
            still.current = true
            setZaehler((z) => z + 1)
          }}
        />
      )}

      {bearbeiteId && (
        <div
          onClick={() => setBearbeiteId(null)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: '#ffffff', borderRadius: 12, padding: 20, width: 760, maxWidth: '100%', maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 10px 40px rgba(0,0,0,0.25)' }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--navy)' }}>{bearbeiteId === 'neu' ? 'Neuer Auftrag' : `Auftrag ${form.referenz || ''}`}</div>
              <button onClick={() => setBearbeiteId(null)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)', lineHeight: 1 }}>
                ✕
              </button>
            </div>

            {aktuellerAuftrag && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontWeight: 700, color: 'var(--navy)', fontSize: 13, marginBottom: 6 }}>Ablauf</div>
                <Ablauf a={aktuellerAuftrag} />
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
              {abschnitt('Auftrag')}
              {feld('Kunde', 'kunde', { liste: 'kunden-liste', sperre: sperreDispo })}
              {feld('Referenz', 'referenz', { sperre: sperreDispo })}
              {feld('Zugnummer (ZN/LZ)', 'zug_nr', { sperre: sperreDispo })}
              {feld('EVU', 'evu', { sperre: sperreDispo })}
              {auswahl('Status', 'status', STATUS, sperreDispo)}

              {form.status === 'storniert' && (
                <>
                  {abschnitt('Stornierung')}
                  {feld('Storniert am', 'storno_datum', { typ: 'date', sperre: sperreDispo })}
                  {feld('Uhrzeit der Stornierung', 'storno_zeit', { typ: 'time', sperre: sperreDispo })}
                  {text('Grund der Stornierung (Pflicht)', 'storno_grund', sperreDispo)}
                </>
              )}

              {abschnitt('Fahrt')}
              {feld('Abfahrt Ort', 'abfahrt_ort', { sperre: sperreDispo })}
              {feld('Abfahrt Datum', 'abfahrt_datum', { typ: 'date', sperre: sperreDispo })}
              {feld('Abfahrt Soll', 'abfahrt_soll', { typ: 'time', sperre: sperreDispo })}
              {feld('Abfahrt Ist', 'abfahrt_ist', { typ: 'time', sperre: sperreDispo })}
              {feld('Ankunft Ort', 'ankunft_ort', { sperre: sperreDispo })}
              {feld('Ankunft Datum', 'ankunft_datum', { typ: 'date', sperre: sperreDispo })}
              {feld('Ankunft Soll', 'ankunft_soll', { typ: 'time', sperre: sperreDispo })}
              {feld('Ankunft Ist', 'ankunft_ist', { typ: 'time', sperre: sperreDispo })}

              {abschnitt('Einsatz')}
              {feld('Anzahl Wagen', 'anzahl_wagen', { typ: 'number', sperre: sperreDispo })}
              {feld('Last / Leer, Zuschläge', 'ggk', { sperre: sperreDispo })}
              {feld('Lok', 'lok', { sperre: sperreDispo })}
              {aktuellerAuftrag && (besetzung[aktuellerAuftrag.id]?.namen.length ?? 0) > 0 && (
                <label style={{ fontSize: 12, color: '#475569' }}>
                  Lokführer (aus dem Dienstplan)
                  <input value={besetzung[aktuellerAuftrag.id].namen.join(', ')} disabled style={{ ...eingabe, background: '#f1f5f9' }} />
                </label>
              )}
              {feld(wgmZugewiesen ? 'Wagenmeister (aus dem Dienstplan)' : 'Wagenmeister', 'wgm_info', { sperre: sperreDispo || wgmZugewiesen })}
              {text('Infos, Ablöser, Ereignisse', 'infos', sperreDispo)}
              {text('Mitarbeiter-Info (geht als Info an den Lokführer in die Schicht)', 'mitarbeiter_info', sperreDispo)}

              {abschnitt('Abrechnung')}
              {auswahl('Abrechnung', 'abrechnung_status', ABRECHNUNG, sperreAbrechnung)}
              {feld('Kürzel Abrechnung', 'kuerzel_abrechnung', { sperre: sperreAbrechnung })}
              {feld('Kürzel Planung / Dispo', 'kuerzel_planung', { sperre: sperreAbrechnung })}
              {feld('Kontrolle (z. B. 100 %)', 'kontrolle', { sperre: sperreAbrechnung })}
              {feld('Preis (€)', 'preis', { typ: 'number', sperre: sperreAbrechnung })}
              {feld('Rechnungsnummer', 'rechnungsnr', { sperre: sperreAbrechnung })}
              {text('Info an Abrechnung', 'info_abrechnung', sperreAbrechnung)}
            </div>

            {meldung && <div style={{ background: '#fee2e2', color: '#991b1b', padding: '8px 12px', borderRadius: 8, marginTop: 12, fontSize: 13 }}>{meldung}</div>}

            <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
              <button onClick={speichern} disabled={speichert} style={knopfVoll}>
                {speichert ? 'Speichert …' : 'Speichern'}
              </button>
              <button onClick={() => setBearbeiteId(null)} style={knopf}>
                Abbrechen
              </button>
              {aktuellerAuftrag && darfDisponieren && teilstrecken(aktuellerAuftrag.fahrten).length >= 2 && (besetzung[aktuellerAuftrag.id]?.lok.length ?? 0) === 0 && (
                <button
                  onClick={async () => {
                    const f = await schichtAnlegen(aktuellerAuftrag)
                    if (f) setMeldung('Schichten konnten nicht angelegt werden: ' + f)
                    else {
                      setBearbeiteId(null)
                      still.current = true
                      setZaehler((z) => z + 1)
                    }
                  }}
                  style={knopf}
                >
                  Lokführer-Schichten anlegen ({teilstrecken(aktuellerAuftrag.fahrten).length} Teilstrecken)
                </button>
              )}
              {aktuellerAuftrag && darfDisponieren && teilstrecken(aktuellerAuftrag.fahrten).length < 2 && (
                <button
                  onClick={() => {
                    setBearbeiteId(null)
                    schichtDialogOeffnen(aktuellerAuftrag)
                  }}
                  style={knopf}
                >
                  {besetzung[aktuellerAuftrag.id]?.namen.length || besetzung[aktuellerAuftrag.id]?.offen ? 'Weitere Lokführer-Schicht (z. B. Ablöser)' : 'Lokführer-Schicht anlegen'}
                </button>
              )}
              {aktuellerAuftrag && darfDisponieren && (
                <button
                  onClick={() => {
                    setBearbeiteId(null)
                    schichtDialogOeffnen(aktuellerAuftrag, null, 'Wagenmeister')
                  }}
                  style={knopf}
                >
                  {besetzung[aktuellerAuftrag.id]?.wgm.namen.length || besetzung[aktuellerAuftrag.id]?.wgm.offen ? 'Weitere Wagenmeister-Schicht' : 'Wagenmeister-Schicht anlegen'}
                </button>
              )}
              {aktuellerAuftrag && form.abfahrt_soll && (
                <button onClick={() => setMailOffen(true)} style={knopf}>
                  Status-Mail an Kunden
                </button>
              )}
              <div style={{ flex: 1 }} />
              {bearbeiteId !== 'neu' && darfDisponieren && (
                <button onClick={loeschen} style={{ ...knopf, borderColor: 'var(--danger)', color: 'var(--danger)' }}>
                  Löschen
                </button>
              )}
            </div>

            {bearbeiteId !== 'neu' && (
              <div style={{ marginTop: 18 }}>
                <div style={{ fontWeight: 700, color: 'var(--navy)', fontSize: 13, marginBottom: 6 }}>Änderungsprotokoll</div>
                {historie.length === 0 && <div style={{ fontSize: 12, color: '#94a3b8' }}>Noch keine Einträge.</div>}
                {historie.map((h) => (
                  <div key={h.id} style={{ fontSize: 12, color: '#475569', padding: '4px 0', borderBottom: '1px solid #f1f5f9' }}>
                    <b>{new Date(h.zeitpunkt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}</b> · {h.benutzer ?? 'Unbekannt'} · {h.aktion}
                    {Object.entries(h.aenderungen ?? {}).map(([k, v]) => (
                      <div key={k} style={{ marginLeft: 12 }}>
                        {FELDNAMEN[k] ?? k}: {String(v.alt ?? '–')} → {String(v.neu ?? '–')}
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
