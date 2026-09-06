import jsPDF from 'jspdf'

interface StreckenEintrag {
  streckennummer: string | null
  name: string
  zuletzt_befahren: string
  verfallen: boolean
  teilInfo: string | null
}

function datumFormatieren(iso: string): string {
  const teile = iso.split('-')
  if (teile.length !== 3) return iso
  const [jahr, monat, tag] = teile
  return `${tag}.${monat}.${jahr}`
}

export function erstelleStreckenkenntnisPdf(mitarbeiterName: string, eintraege: StreckenEintrag[]) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const seitenBreite = 210
  const seitenHoehe = 297
  const rand = 15
  let y = 0

  function kopfzeileZeichnen() {
    doc.setFillColor(20, 50, 92)
    doc.rect(0, 0, seitenBreite, 18, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(14)
    doc.text('RAIL BAVARIA LOGISTIK GMBH', rand, 11)
  }

  kopfzeileZeichnen()

  doc.setTextColor(30, 41, 59)
  y = 28
  doc.setFontSize(13)
  doc.text('Streckenkenntnis-Nachweis', rand, y)
  doc.setDrawColor(203, 213, 225)
  doc.line(rand, y + 3, seitenBreite - rand, y + 3)

  y += 12
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(100, 116, 139)
  doc.text('Mitarbeiter', rand, y)
  doc.text('Stand', rand + 100, y)
  y += 5
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(30, 41, 59)
  doc.text(mitarbeiterName, rand, y)
  doc.text(datumFormatieren(new Date().toISOString().slice(0, 10)), rand + 100, y)

  y += 10

  // Tabellenkopf
  function tabellenkopfZeichnen() {
    doc.setFillColor(44, 74, 115)
    doc.rect(rand, y, seitenBreite - 2 * rand, 7, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.text('Nr.', rand + 2, y + 5)
    doc.text('Strecke', rand + 18, y + 5)
    doc.text('Zuletzt befahren', rand + 120, y + 5)
    doc.text('Status', rand + 160, y + 5)
    y += 7
  }

  tabellenkopfZeichnen()

  eintraege.forEach((eintrag, index) => {
    if (y > seitenHoehe - 25) {
      doc.addPage()
      kopfzeileZeichnen()
      y = 28
      tabellenkopfZeichnen()
    }

    const hell = index % 2 === 0
    doc.setFillColor(hell ? 255 : 248, hell ? 255 : 250, hell ? 255 : 252)
    doc.rect(rand, y, seitenBreite - 2 * rand, 7, 'F')

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(30, 41, 59)
    doc.text(eintrag.streckennummer ?? '–', rand + 2, y + 5)

    const streckenName =
      eintrag.name.length > 55 ? eintrag.name.slice(0, 52) + '...' : eintrag.name
    doc.text(streckenName + (eintrag.teilInfo ? ` ${eintrag.teilInfo}` : ''), rand + 18, y + 5)

    doc.text(datumFormatieren(eintrag.zuletzt_befahren), rand + 120, y + 5)

    doc.setFont('helvetica', 'bold')
    if (eintrag.verfallen) {
      doc.setTextColor(217, 119, 6)
      doc.text('Verfallen', rand + 160, y + 5)
    } else {
      doc.setTextColor(22, 163, 74)
      doc.text('Aktuell', rand + 160, y + 5)
    }

    y += 7
  })

  y += 10
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(100, 116, 139)
  doc.text(
    `Insgesamt ${eintraege.length} Strecke(n) erfasst - erstellt am ${datumFormatieren(
      new Date().toISOString().slice(0, 10)
    )} über den RBL Urlaubsplan.`,
    rand,
    y
  )

  const dateiName = `Streckenkenntnis_${mitarbeiterName.replace(/\s+/g, '_')}.pdf`
  doc.save(dateiName)
}
