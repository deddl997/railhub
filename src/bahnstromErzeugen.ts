import * as XLSX from 'xlsx'
import JSZip from 'jszip'

// ============================================================
// Anlage 8 (Meldeformular Fahrplandaten Triebfahrzeuge, DB Energie)
//   -> Vorlage "Traktionsleistungen" fuer die Meldung
// Die Vorlage wird nicht neu gebaut: Nur die Datenzeilen ab Zeile 9 werden ersetzt.
// Aussehen, Spaltenbreiten, Logo, Kommentare, Auswahllisten bleiben unveraendert.
// ============================================================

export interface TraktionsZeile {
  tfz: number
  abfahrt: number // Excel-Seriennummer inkl. Uhrzeit
  ankunft: number
  abOrt: string
  anOrt: string
  strecke: number
  last: number
  zug: number | string
  bestellkriterium: string
  verwendung: string
  vmax: number
  verkehrstag: number // Excel-Seriennummer (nur Datum)
}

export interface Anlage8 {
  monat: string | null
  zaehlpunkt: string | null
  marktpartner: string | null
  zeilen: TraktionsZeile[]
  warnungen: string[]
}

const VERWENDUNGSARTEN = ['OR', 'LLA', 'LLN', 'SE', 'LH', 'SG']
const SPARTEN: Record<string, string> = { C: 'Güterverkehr', F: 'Fernverkehr', N: 'Regioverkehr', R: 'Regioverkehr', S: 'S-Bahn' }

const norm = (t: unknown) => String(t ?? '').replace(/\s+/g, ' ').trim().toLowerCase()

export function serialZuDatum(serial: number): Date {
  return new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000)
}

export function serialZuText(serial: number): string {
  const d = serialZuDatum(serial)
  return `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${d.getUTCFullYear()}`
}

export function serialZuZeit(serial: number): string {
  const minuten = Math.round((serial - Math.floor(serial)) * 1440) % 1440
  return `${String(Math.floor(minuten / 60)).padStart(2, '0')}:${String(minuten % 60).padStart(2, '0')}`
}

function zahl(v: unknown): number | null {
  if (typeof v === 'number' && isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && isFinite(Number(v.replace(',', '.')))) return Number(v.replace(',', '.'))
  return null
}

function textZuSerial(t: unknown): number | null {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(String(t ?? '').trim())
  if (!m) return null
  return Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])) / 86400000 + 25569
}

export async function anlage8Lesen(daten: ArrayBuffer): Promise<Anlage8> {
  const mappe = XLSX.read(daten, { type: 'array' })
  const blatt = mappe.Sheets[mappe.SheetNames[0]]
  if (!blatt) throw new Error('Die Datei enthält kein Tabellenblatt.')
  const zeilenRoh = XLSX.utils.sheet_to_json<unknown[]>(blatt, { header: 1, raw: true, defval: null })

  const kopfIndex = zeilenRoh.findIndex((z) => norm(z[0]) === 'traktionsleistungs-id')
  if (kopfIndex < 0) throw new Error('Das ist keine Anlage 8: Die Überschriftenzeile „Traktionsleistungs-ID“ wurde nicht gefunden.')
  const kopf = zeilenRoh[kopfIndex].map(norm)
  const spalte = (name: string): number => {
    const i = kopf.indexOf(norm(name))
    if (i < 0) throw new Error(`In der Datei fehlt die Spalte „${name}“.`)
    return i
  }
  const c = {
    tfz: spalte('Triebfahrzeugnummer'),
    abDatum: spalte('Datum Abfahrt'),
    abZeit: spalte('Zeit Abfahrt'),
    anDatum: spalte('Datum Ankunft'),
    anZeit: spalte('Zeit Ankunft'),
    abOrt: spalte('Ril100-Kürzel Abfahrtsort'),
    anOrt: spalte('Ril100-Kürzel Ankunftsort'),
    strecke: spalte('Strecke'),
    last: spalte('Anhängelast'),
    zug: spalte('Zugnummer'),
    sparte: spalte('Sparte'),
    verw: spalte('Tfz-Verwendungsart'),
    vmax: spalte('Höchstgeschwindigkeit'),
  }
  const planTag = kopf.indexOf(norm('Datum Planabfahrtstag'))
  const fehlerSpalte = kopf.findIndex((k) => k.startsWith('fehlermeldung'))

  const wertNebenLabel = (label: string): string | null => {
    for (const z of zeilenRoh.slice(0, kopfIndex)) {
      if (norm(z[0]) === norm(label) && z[1] !== null && z[1] !== undefined) return String(z[1])
    }
    return null
  }

  const warnungen: string[] = []
  const zeilen: TraktionsZeile[] = []
  const unbekannteSparten = new Set<string>()
  const unbekannteVerw = new Set<string>()
  let mitHinweis = 0
  let ankunftVorAbfahrt = 0

  for (const z of zeilenRoh.slice(kopfIndex + 1)) {
    const tfz = zahl(z[c.tfz])
    const abDatum = zahl(z[c.abDatum])
    const abZeit = zahl(z[c.abZeit])
    const anDatum = zahl(z[c.anDatum])
    const anZeit = zahl(z[c.anZeit])
    if (tfz === null || abDatum === null || abZeit === null || anDatum === null || anZeit === null) continue

    const abfahrt = Math.floor(abDatum) + Math.round(abZeit * 1440) / 1440
    const ankunft = Math.floor(anDatum) + Math.round(anZeit * 1440) / 1440
    if (ankunft < abfahrt) ankunftVorAbfahrt++

    const sparteCode = String(z[c.sparte] ?? '').trim().toUpperCase()
    let bestellkriterium = SPARTEN[sparteCode]
    if (!bestellkriterium) {
      unbekannteSparten.add(sparteCode || '(leer)')
      bestellkriterium = 'Güterverkehr'
    } else if (sparteCode !== 'C') unbekannteSparten.add(sparteCode + ' → ' + bestellkriterium)

    const verwendung = String(z[c.verw] ?? '').trim()
    if (!VERWENDUNGSARTEN.includes(verwendung)) unbekannteVerw.add(verwendung || '(leer)')

    if (fehlerSpalte >= 0 && String(z[fehlerSpalte] ?? '').trim() !== '') mitHinweis++

    const zug = zahl(z[c.zug])
    zeilen.push({
      tfz,
      abfahrt,
      ankunft,
      abOrt: String(z[c.abOrt] ?? '').replace(/\s+$/, ''),
      anOrt: String(z[c.anOrt] ?? '').replace(/\s+$/, ''),
      strecke: zahl(z[c.strecke]) ?? 0,
      last: zahl(z[c.last]) ?? 0,
      zug: zug ?? String(z[c.zug] ?? ''),
      bestellkriterium,
      verwendung,
      vmax: zahl(z[c.vmax]) ?? 0,
      verkehrstag: (planTag >= 0 ? textZuSerial(z[planTag]) : null) ?? Math.floor(abDatum),
    })
  }

  if (zeilen.length === 0) throw new Error('In der Datei wurden keine Traktionsleistungen gefunden.')
  if (unbekannteSparten.size > 0) warnungen.push('Sparte umgesetzt bzw. unbekannt, bitte prüfen: ' + Array.from(unbekannteSparten).join(', '))
  if (unbekannteVerw.size > 0) warnungen.push('Verwendungsart nicht in der Auswahlliste der Vorlage: ' + Array.from(unbekannteVerw).join(', '))
  if (mitHinweis > 0) warnungen.push(`${mitHinweis} Zeilen haben in der Anlage 8 einen Eintrag unter „Fehlermeldung/ Hinweis“.`)
  if (ankunftVorAbfahrt > 0) warnungen.push(`${ankunftVorAbfahrt} Zeilen haben eine Ankunft vor der Abfahrt.`)

  return {
    monat: wertNebenLabel('Jahr und Monat'),
    zaehlpunkt: wertNebenLabel('Zählpunkt der virtuellen Entnahmestelle'),
    marktpartner: wertNebenLabel('Marktpartner-ID'),
    zeilen,
    warnungen,
  }
}

// ------------------------------------------------------------
// Vorlage befuellen
// ------------------------------------------------------------

const xmlText = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const xmlEntfernen = (t: string) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')

// Stilnummern der Datenzeilen in der Vorlage (Zeile 9)
const STIL = { A: 17, B: 9, C: 8, D: 9, E: 8, F: 7, G: 11, H: 8, I: 8, J: 8, K: 18, L: 10 }

export function dateiNameFuer(zeilen: TraktionsZeile[]): string {
  const tage = zeilen.map((z) => z.verkehrstag)
  const kurz = (s: number) => serialZuText(s).slice(0, 6)
  return `KoDiBahnstrom_Vorlage_ANu-vEns_Traktionsleistungen_${kurz(Math.min(...tage))}_-_${kurz(Math.max(...tage))}.xlsx`
}

export async function vorlageBefuellen(vorlage: ArrayBuffer, zeilen: TraktionsZeile[]): Promise<Uint8Array> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(vorlage)
  } catch {
    throw new Error('Die Vorlage konnte nicht gelesen werden. Liegt sie unter public/vorlagen/bahnstrom_vorlage.xlsx?')
  }

  // Blatt "Traktionsleistungen" finden
  const arbeitsmappe = await zip.file('xl/workbook.xml')?.async('string')
  const beziehungen = await zip.file('xl/_rels/workbook.xml.rels')?.async('string')
  if (!arbeitsmappe || !beziehungen) throw new Error('Die Vorlage ist beschädigt.')
  const blattTag = /<sheet [^>]*name="Traktionsleistungen"[^>]*r:id="([^"]+)"/.exec(arbeitsmappe)
  if (!blattTag) throw new Error('In der Vorlage fehlt das Blatt „Traktionsleistungen“.')
  const ziel = new RegExp(`<Relationship [^>]*Id="${blattTag[1]}"[^>]*Target="([^"]+)"|<Relationship [^>]*Target="([^"]+)"[^>]*Id="${blattTag[1]}"`).exec(beziehungen)
  const blattPfad = 'xl/' + (ziel?.[1] ?? ziel?.[2] ?? '').replace(/^\/?(xl\/)?/, '')
  const blattDatei = zip.file(blattPfad)
  const sstDatei = zip.file('xl/sharedStrings.xml')
  if (!blattDatei || !sstDatei) throw new Error('Die Vorlage ist beschädigt (Blatt oder Textliste fehlt).')
  let blatt = await blattDatei.async('string')
  let sst = await sstDatei.async('string')

  // Textliste einlesen
  const texte: string[] = []
  const index = new Map<string, number>()
  for (const m of sst.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    const t = Array.from(m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g))
      .map((x) => xmlEntfernen(x[1]))
      .join('')
    if (!index.has(t)) index.set(t, texte.length)
    texte.push(t)
  }
  const neu: string[] = []
  const textNr = (t: string): number => {
    const vorhanden = index.get(t)
    if (vorhanden !== undefined) return vorhanden
    const nr = texte.length + neu.length
    neu.push(`<si><t${/^\s|\s$/.test(t) ? ' xml:space="preserve"' : ''}>${xmlText(t)}</t></si>`)
    index.set(t, nr)
    return nr
  }

  // Datenzeilen bauen (ab Zeile 9, Stil wie in der Vorlage)
  const erste = 9
  const zahlZelle = (ref: string, stil: number, wert: number) => `<c r="${ref}" s="${stil}"><v>${wert}</v></c>`
  const textZelle = (ref: string, stil: number, wert: string) => `<c r="${ref}" s="${stil}" t="s"><v>${textNr(wert)}</v></c>`
  const zeilenXml = zeilen
    .map((z, i) => {
      const r = erste + i
      return (
        `<row r="${r}" spans="1:12">` +
        zahlZelle(`A${r}`, STIL.A, z.tfz) +
        zahlZelle(`B${r}`, STIL.B, z.abfahrt) +
        textZelle(`C${r}`, STIL.C, z.abOrt) +
        zahlZelle(`D${r}`, STIL.D, z.ankunft) +
        textZelle(`E${r}`, STIL.E, z.anOrt) +
        zahlZelle(`F${r}`, STIL.F, z.strecke) +
        zahlZelle(`G${r}`, STIL.G, z.last) +
        (typeof z.zug === 'number' ? zahlZelle(`H${r}`, STIL.H, z.zug) : textZelle(`H${r}`, STIL.H, z.zug)) +
        textZelle(`I${r}`, STIL.I, z.bestellkriterium) +
        textZelle(`J${r}`, STIL.J, z.verwendung) +
        zahlZelle(`K${r}`, STIL.K, z.vmax) +
        zahlZelle(`L${r}`, STIL.L, z.verkehrstag) +
        `</row>`
      )
    })
    .join('')

  const start = blatt.indexOf(`<row r="${erste}"`)
  const ende = blatt.indexOf('</sheetData>')
  if (start < 0 || ende < 0 || start > ende) throw new Error('Die Vorlage hat nicht den erwarteten Aufbau (Datenzeilen ab Zeile 9).')
  blatt = blatt.slice(0, start) + zeilenXml + blatt.slice(ende)

  const letzte = erste + zeilen.length - 1
  blatt = blatt.replace(/<dimension ref="A1:([A-Z]+)\d+"\/>/, `<dimension ref="A1:$1${letzte}"/>`)
  blatt = blatt.replace(/<xm:sqref>I9:I\d+<\/xm:sqref>/, `<xm:sqref>I9:I${letzte}</xm:sqref>`)
  blatt = blatt.replace(/<xm:sqref>J9:J\d+<\/xm:sqref>/, `<xm:sqref>J9:J${letzte}</xm:sqref>`)

  // Textliste ergaenzen und Zaehler aktualisieren
  if (neu.length > 0) sst = sst.replace('</sst>', neu.join('') + '</sst>')
  const gesamt = texte.length + neu.length
  sst = sst.replace(/uniqueCount="\d+"/, `uniqueCount="${gesamt}"`)
  const quellenBlatt = await zip.file('xl/worksheets/sheet2.xml')?.async('string')
  const zaehlerQuellen = (quellenBlatt?.match(/ t="s"/g) ?? []).length
  sst = sst.replace(/ count="\d+"/, ` count="${(blatt.match(/ t="s"/g) ?? []).length + zaehlerQuellen}"`)

  zip.file(blattPfad, blatt)
  zip.file('xl/sharedStrings.xml', sst)
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } })
}
