import jsPDF from 'jspdf'

interface AntragZeile {
  erster_tag: string | null
  letzter_tag: string | null
  brauchbare_tage: number | null
  anzahl_tage: number | null
}

interface AntragDaten {
  name: string | null
  vorgesetzter: string | null
  funktion_bereich: string | null
  urlaubsart: string | null
  urlaubsart_begruendung: string | null
  jahr: number | null
  urlaubsanspruch: number | null
  verplant: number | null
  rest: number | null
  resturlaub_vorjahr: number | null
  datum_antragsteller: string | null
  zeilen: AntragZeile[]
}

interface BearbeiterDaten {
  genehmigt: boolean
  bearbeitetVon: string
  datum: string
  ablehnungBegruendung: string
}

const URLAUBSARTEN = ['Erholungsurlaub', 'Sonderurlaub', 'Bildungsurlaub', 'Unbezahlter Urlaub', 'Sonstiges']

const RAND = 15
const BREITE = 210

const NAVY: [number, number, number] = [20, 50, 92]
const TEXT: [number, number, number] = [30, 41, 59]
const LILA: [number, number, number] = [237, 233, 254]
const WEISS: [number, number, number] = [255, 255, 255]
const LINIE: [number, number, number] = [203, 213, 225]

function datumFormatieren(iso: string | null): string {
  if (!iso) return ''
  const teile = iso.split('-')
  if (teile.length !== 3) return iso
  const [jahr, monat, tag] = teile
  return `${tag}.${monat}.${jahr}`
}

function kopfzeile(doc: jsPDF) {
  const oben = 10
  const hoehe = 26
  const logoBreite = 38
  const rechtsBreite = 24
  const mitteX = RAND + logoBreite
  const mitteBreite = BREITE - 2 * RAND - logoBreite - rechtsBreite
  const rechtsX = mitteX + mitteBreite

  doc.setDrawColor(0, 0, 0)
  doc.setLineWidth(0.3)
  doc.rect(RAND, oben, BREITE - 2 * RAND, hoehe)

  doc.setFillColor(...NAVY)
  doc.rect(RAND, oben, logoBreite, hoehe, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(15)
  doc.text('RBL', RAND + logoBreite / 2, oben + 13, { align: 'center' })
  doc.setFontSize(6)
  doc.text('RAIL BAVARIA', RAND + logoBreite / 2, oben + 18, { align: 'center' })
  doc.text('LOGISTIK GMBH', RAND + logoBreite / 2, oben + 22, { align: 'center' })

  doc.setDrawColor(0, 0, 0)
  doc.line(mitteX, oben, mitteX, oben + hoehe)
  doc.line(mitteX, oben + hoehe / 2, mitteX + mitteBreite, oben + hoehe / 2)
  doc.setTextColor(...TEXT)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.text('Personalwesen', mitteX + mitteBreite / 2, oben + hoehe / 2 - 3.5, { align: 'center' })
  doc.text('Urlaubsantrag', mitteX + mitteBreite / 2, oben + hoehe - 3.5, { align: 'center' })

  doc.line(rechtsX, oben, rechtsX, oben + hoehe)
  doc.line(rechtsX, oben + hoehe / 2, rechtsX + rechtsBreite, oben + hoehe / 2)
  doc.setFontSize(10)
  doc.text('FB', rechtsX + rechtsBreite / 2, oben + hoehe / 2 - 3.5, { align: 'center' })
  doc.setFontSize(8)
  doc.text('Version 01', rechtsX + rechtsBreite / 2, oben + hoehe - 3.5, { align: 'center' })

  return oben + hoehe
}

function fusszeile(doc: jsPDF, seite: number) {
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(148, 163, 184)
  doc.text(`Seite ${seite} von 2`, BREITE / 2, 287, { align: 'center' })
}

function abschnitt(doc: jsPDF, nummer: number, text: string, y: number) {
  doc.setTextColor(...NAVY)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.text(`${nummer}. ${text}`, RAND, y)
  return y + 7
}

function doppelFeldZeile(
  doc: jsPDF,
  y: number,
  a: { label: string; wert: string },
  b: { label: string; wert: string },
  hoehe = 9
) {
  const innenBreite = BREITE - 2 * RAND
  const labelBreite = innenBreite * 0.22
  const wertBreite = innenBreite * 0.28
  const xA = RAND
  const xAW = xA + labelBreite
  const xB = xAW + wertBreite
  const xBW = xB + labelBreite

  const zellen = [
    { x: xA, breite: labelBreite, text: a.label, lila: true, bold: true },
    { x: xAW, breite: wertBreite, text: a.wert, lila: false, bold: false },
    { x: xB, breite: labelBreite, text: b.label, lila: true, bold: true },
    { x: xBW, breite: wertBreite, text: b.wert, lila: false, bold: false },
  ]

  zellen.forEach((zelle) => {
    doc.setFillColor(...(zelle.lila ? LILA : WEISS))
    doc.rect(zelle.x, y, zelle.breite, hoehe, 'F')
    doc.setDrawColor(...LINIE)
    doc.rect(zelle.x, y, zelle.breite, hoehe)
    doc.setTextColor(...TEXT)
    doc.setFont('helvetica', zelle.bold ? 'bold' : 'normal')
    doc.setFontSize(9)
    doc.text(zelle.text || (zelle.lila ? '' : '–'), zelle.x + 2.5, y + hoehe / 2 + 1.2)
  })

  return y + hoehe
}

function einzelFeldZeile(doc: jsPDF, y: number, label: string, wert: string, hoehe = 8) {
  const innenBreite = BREITE - 2 * RAND
  const labelBreite = innenBreite * 0.45

  doc.setFillColor(...LILA)
  doc.rect(RAND, y, labelBreite, hoehe, 'F')
  doc.setDrawColor(...LINIE)
  doc.rect(RAND, y, labelBreite, hoehe)
  doc.setTextColor(...TEXT)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text(label, RAND + 2.5, y + hoehe / 2 + 1.2)

  doc.setFillColor(...WEISS)
  doc.rect(RAND + labelBreite, y, innenBreite - labelBreite, hoehe, 'F')
  doc.rect(RAND + labelBreite, y, innenBreite - labelBreite, hoehe)
  doc.setFont('helvetica', 'normal')
  doc.text(wert || '–', RAND + labelBreite + 3, y + hoehe / 2 + 1.2)

  return y + hoehe
}

function checkboxZeile(doc: jsPDF, x: number, y: number, text: string, angekreuzt: boolean) {
  const groesse = 3.6
  doc.setDrawColor(...TEXT)
  doc.setLineWidth(0.3)
  doc.rect(x, y - groesse, groesse, groesse)
  if (angekreuzt) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.text('X', x + 0.5, y - 0.5)
  }
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(...TEXT)
  doc.text(text, x + groesse + 2.5, y)
}

export function erstelleUrlaubsantragPdf(antrag: AntragDaten, bearbeiter: BearbeiterDaten) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })

  // ---------- Seite 1 ----------
  let y = kopfzeile(doc)

  y += 14
  doc.setTextColor(...NAVY)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(22)
  doc.text('Urlaubsantrag', BREITE / 2, y, { align: 'center' })

  y += 14
  y = abschnitt(doc, 1, 'Angaben zum Mitarbeiter', y)
  y += 3
  const [vorname, ...restName] = (antrag.name ?? '').split(' ')
  const nachname = restName.join(' ')
  y = doppelFeldZeile(
    doc,
    y,
    { label: 'Vorname', wert: vorname ?? '' },
    { label: 'Nachname', wert: nachname }
  )
  y = doppelFeldZeile(
    doc,
    y,
    { label: 'Vorgesetzter', wert: antrag.vorgesetzter ?? '' },
    { label: 'Funktion / Bereich', wert: antrag.funktion_bereich ?? '' }
  )

  y += 12
  y = abschnitt(doc, 2, 'Urlaubszeitraum', y)
  y += 2
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(...TEXT)
  doc.text('Hiermit beantrage ich Urlaub für folgenden Zeitraum:', RAND, y)
  y += 7

  URLAUBSARTEN.forEach((art) => {
    checkboxZeile(doc, RAND, y, art === 'Sonstiges' ? 'Sonstiges:' : art, antrag.urlaubsart === art)
    if (
      (art === 'Sonstiges' || art === 'Sonderurlaub') &&
      antrag.urlaubsart === art &&
      antrag.urlaubsart_begruendung
    ) {
      doc.setFont('helvetica', 'italic')
      doc.setFontSize(8)
      doc.setTextColor(100, 116, 139)
      doc.text(`(${antrag.urlaubsart_begruendung})`, RAND + 55, y)
      doc.setTextColor(...TEXT)
    }
    y += 6
  })

  y += 4
  for (let i = 0; i < 4; i++) {
    const zeile = antrag.zeilen[i]
    y = doppelFeldZeile(
      doc,
      y,
      { label: 'Von (DD.MM.JJJJ)', wert: zeile ? datumFormatieren(zeile.erster_tag) : '' },
      { label: 'Bis (DD.MM.JJJJ)', wert: zeile ? datumFormatieren(zeile.letzter_tag) : '' }
    )
  }

  y += 4
  const gesamtTage = antrag.zeilen.reduce(
    (summe, z) => summe + (z.brauchbare_tage ?? z.anzahl_tage ?? 0),
    0
  )
  y = einzelFeldZeile(doc, y, 'Gesamtanzahl beantragter Arbeitstage', String(gesamtTage))

  y += 12
  y = abschnitt(doc, 3, 'Aktueller Urlaubsanspruch', y)
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(8)
  doc.setTextColor(100, 116, 139)
  doc.text('(wird durch die Verwaltung geprüft und ergänzt)', RAND, y)
  y += 5

  y = einzelFeldZeile(
    doc,
    y,
    'Resturlaub Vorjahr',
    antrag.resturlaub_vorjahr !== null ? String(antrag.resturlaub_vorjahr) : ''
  )
  y = einzelFeldZeile(
    doc,
    y,
    'Urlaubsanspruch laufendes Jahr',
    antrag.urlaubsanspruch !== null ? String(antrag.urlaubsanspruch) : ''
  )
  y = einzelFeldZeile(
    doc,
    y,
    'Davon bereits genommen',
    antrag.verplant !== null ? String(antrag.verplant) : ''
  )
  y = einzelFeldZeile(doc, y, 'Neu beantragter Urlaub', String(gesamtTage))
  y = einzelFeldZeile(
    doc,
    y,
    'Verbleibender Resturlaub',
    antrag.rest !== null ? String(antrag.rest) : ''
  )

  fusszeile(doc, 1)

  // ---------- Seite 2 ----------
  doc.addPage()
  y = kopfzeile(doc)
  y += 14

  y = abschnitt(doc, 4, 'Entscheidung Vorgesetzte/r', y)
  y += 3
  checkboxZeile(doc, RAND, y, 'Urlaub genehmigt', bearbeiter.genehmigt)
  y += 7
  checkboxZeile(doc, RAND, y, 'Urlaub abgelehnt', !bearbeiter.genehmigt)
  y += 10

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(...TEXT)
  doc.text('Begründung bei Ablehnung (falls zutreffend):', RAND, y)
  y += 8

  const begruendungZeilen = bearbeiter.genehmigt
    ? []
    : doc.splitTextToSize(bearbeiter.ablehnungBegruendung || '', BREITE - 2 * RAND)
  for (let i = 0; i < 4; i++) {
    doc.setDrawColor(...LINIE)
    doc.line(RAND, y, BREITE - RAND, y)
    if (begruendungZeilen[i]) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9)
      doc.setTextColor(...TEXT)
      doc.text(begruendungZeilen[i], RAND + 1, y - 1.5)
    }
    y += 10
  }

  y += 14
  y = abschnitt(doc, 5, 'Bestätigung und Kenntnisnahme', y)
  y += 16

  doc.setDrawColor(...TEXT)
  doc.line(RAND, y, RAND + 80, y)
  doc.line(RAND + 95, y, RAND + 175, y)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(100, 116, 139)
  doc.text('Datum, Unterschrift Mitarbeiter', RAND, y + 5)
  doc.text('Datum, Unterschrift Vorgesetzter', RAND + 95, y + 5)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(...TEXT)
  doc.text(datumFormatieren(antrag.datum_antragsteller), RAND, y - 2)
  doc.text(datumFormatieren(bearbeiter.datum), RAND + 95, y - 2)

  y += 20
  doc.setDrawColor(...TEXT)
  doc.line(RAND, y, RAND + 80, y)
  doc.line(RAND + 95, y, RAND + 175, y)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(100, 116, 139)
  doc.text('Name in Blockbuchstaben', RAND, y + 5)
  doc.text('Name in Blockbuchstaben', RAND + 95, y + 5)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(...TEXT)
  doc.text((antrag.name ?? '').toUpperCase(), RAND, y - 2)
  doc.text(bearbeiter.bearbeitetVon.toUpperCase(), RAND + 95, y - 2)

  fusszeile(doc, 2)

  const dateiName = `Urlaubsantrag_${(antrag.name ?? 'unbekannt').replace(/\s+/g, '_')}.pdf`
  doc.save(dateiName)
}