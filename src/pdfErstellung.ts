import jsPDF from 'jspdf'

interface AntragZeile {
  erster_tag: string | null
  letzter_tag: string | null
  brauchbare_tage: number | null
  anzahl_tage: number | null
}

interface AntragDaten {
  name: string | null
  kategorie: string | null
  jahr: number | null
  urlaubsanspruch: number | null
  verplant: number | null
  rest: number | null
  resturlaub_vorjahr: number | null
  ort_antragsteller: string | null
  datum_antragsteller: string | null
  zeilen: AntragZeile[]
}

interface BearbeiterDaten {
  bearbeitetVon: string
  ort: string
  datum: string
}

function datumFormatieren(iso: string | null): string {
  if (!iso) return ''
  const teile = iso.split('-')
  if (teile.length !== 3) return iso
  const [jahr, monat, tag] = teile
  return `${tag}.${monat}.${jahr}`
}

function feld(
  doc: jsPDF,
  label: string,
  wert: string,
  x: number,
  y: number
) {
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(100, 116, 139)
  doc.text(label, x, y)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(30, 41, 59)
  doc.text(wert || '–', x, y + 5)
}

export function erstelleUrlaubsantragPdf(antrag: AntragDaten, bearbeiter: BearbeiterDaten) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const seitenBreite = 210
  const rand = 15
  let y = 0

  // Kopfzeile
  doc.setFillColor(20, 50, 92)
  doc.rect(0, 0, seitenBreite, 18, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.text('RAIL BAVARIA LOGISTIK GMBH', rand, 11)

  doc.setTextColor(30, 41, 59)
  y = 28
  doc.setFontSize(13)
  doc.text('Urlaubsantrag – Betriebsdienst', rand, y)
  doc.setDrawColor(203, 213, 225)
  doc.line(rand, y + 3, seitenBreite - rand, y + 3)

  y = 40
  feld(doc, 'Jahr', antrag.jahr !== null ? String(antrag.jahr) : '', rand, y)
  feld(doc, 'Kategorie', antrag.kategorie ?? '', rand + 55, y)
  feld(doc, 'Name', antrag.name ?? '', rand + 115, y)

  y += 15
  feld(
    doc,
    'Urlaubsanspruch (Tage)',
    antrag.urlaubsanspruch !== null ? String(antrag.urlaubsanspruch) : '',
    rand,
    y
  )
  feld(doc, 'Verplant (Tage)', antrag.verplant !== null ? String(antrag.verplant) : '', rand + 55, y)
  feld(doc, 'Rest (Tage)', antrag.rest !== null ? String(antrag.rest) : '', rand + 100, y)
  feld(
    doc,
    'Resturlaub Vorjahr (Tage)',
    antrag.resturlaub_vorjahr !== null ? String(antrag.resturlaub_vorjahr) : '',
    rand + 140,
    y
  )

  // Zeiträume-Tabelle
  y += 16
  doc.setFillColor(44, 74, 115)
  doc.rect(rand, y, seitenBreite - 2 * rand, 7, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.text('Nr.', rand + 2, y + 5)
  doc.text('Von', rand + 20, y + 5)
  doc.text('Bis', rand + 70, y + 5)
  doc.text('Arbeitstage', rand + 120, y + 5)

  y += 7
  let gesamtTage = 0
  antrag.zeilen.forEach((zeile, index) => {
    const tage = zeile.brauchbare_tage ?? zeile.anzahl_tage ?? 0
    gesamtTage += tage
    const hell = index % 2 === 0
    doc.setFillColor(hell ? 255 : 248, hell ? 255 : 250, hell ? 255 : 252)
    doc.rect(rand, y, seitenBreite - 2 * rand, 7, 'F')
    doc.setTextColor(30, 41, 59)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.text(String(index + 1), rand + 2, y + 5)
    doc.text(datumFormatieren(zeile.erster_tag), rand + 20, y + 5)
    doc.text(datumFormatieren(zeile.letzter_tag), rand + 70, y + 5)
    doc.text(String(tage), rand + 120, y + 5)
    y += 7
  })

  doc.setFont('helvetica', 'bold')
  doc.text('Gesamt:', rand + 70, y + 5)
  doc.text(String(gesamtTage), rand + 120, y + 5)
  y += 16

  // Antragsteller
  doc.setDrawColor(203, 213, 225)
  doc.line(rand, y, seitenBreite - rand, y)
  y += 8
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(20, 50, 92)
  doc.text('Antragsteller', rand, y)
  y += 8
  feld(doc, 'Ort', antrag.ort_antragsteller ?? '', rand, y)
  feld(doc, 'Datum', datumFormatieren(antrag.datum_antragsteller), rand + 55, y)
  feld(doc, 'Unterschrift', antrag.name ?? '', rand + 110, y)

  // Bearbeitung
  y += 20
  doc.line(rand, y, seitenBreite - rand, y)
  y += 8
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(20, 50, 92)
  doc.text('Bearbeitung', rand, y)

  y += 6
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(22, 163, 74)
  doc.text('✔ Urlaub genehmigt', rand, y + 4)

  y += 12
  feld(doc, 'Bearbeitet von', bearbeiter.bearbeitetVon, rand, y)
  feld(doc, 'Ort', bearbeiter.ort, rand + 65, y)
  feld(doc, 'Datum', datumFormatieren(bearbeiter.datum), rand + 120, y)

  const dateiName = `Urlaubsantrag_${(antrag.name ?? 'unbekannt').replace(/\s+/g, '_')}.pdf`
  doc.save(dateiName)
}
