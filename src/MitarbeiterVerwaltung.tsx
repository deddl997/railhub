import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import { namensSignatur } from './namensAbgleich'
import { KATEGORIEN, LOK_TYPEN } from './qualifikationen'
import { useAktuellerMitarbeiter } from './useAktuellerMitarbeiter'
import { bestaetigen, useToast } from './ui'
import * as XLSX from 'xlsx'

interface Jahresdaten {
  id: string
  mitarbeiter_id: string
  urlaubsanspruch: number | null
  resturlaub: number | null
  resturlaub_vorjahr: number | null
  rfu_datum: string | null
  simulator_datum: string | null
}

interface Zeile {
  mitarbeiterId: string
  name: string
  kategorie: string | null
  lokTypen: string[]
  rolle: string
  jahresdatenId: string | null
  urlaubsanspruch: number | null
  resturlaub: number | null
  resturlaub_vorjahr: number | null
  tageGenommen: number
  email: string
  rfuDatum: string | null
  simulatorDatum: string | null
}

function wortTeile(n: string): string[] {
  return n
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .split(/[\s\-,]+/)
    .filter((w) => w.length > 1)
}

function editDistanz(x: string, y: string): number {
  const d: number[][] = Array.from({ length: x.length + 1 }, (_, i) => [i, ...Array(y.length).fill(0)])
  for (let j = 1; j <= y.length; j++) d[0][j] = j
  for (let i = 1; i <= x.length; i++)
    for (let j = 1; j <= y.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1))
  return d[x.length][y.length]
}

function namensAehnlichkeit(a: string, b: string): number {
  const wa = wortTeile(a)
  const wb = wortTeile(b)
  if (wa.length === 0 || wb.length === 0) return 0
  let punkte = 0
  for (const x of wa) {
    let best = 0
    for (const y of wb) {
      if (x === y) best = Math.max(best, 1)
      else if (x.length >= 4 && y.length >= 4 && Math.abs(x.length - y.length) <= 2 && editDistanz(x, y) <= 2) best = Math.max(best, 0.7)
    }
    punkte += best
  }
  return punkte / Math.max(wa.length, wb.length)
}

export default function MitarbeiterVerwaltung({ neuLadenAuslöser }: { neuLadenAuslöser: number }) {
  const { mitarbeiter: eigenerMitarbeiter } = useAktuellerMitarbeiter()
  const toast = useToast()
  const [jahr, setJahr] = useState(() => new Date().getFullYear())
  const [verfuegbareJahre, setVerfuegbareJahre] = useState<number[]>([])
  const [zeilen, setZeilen] = useState<Zeile[]>([])
  const [ladeVorgang, setLadeVorgang] = useState(true)
  const [gespeichertId, setGespeichertId] = useState<string | null>(null)
  const [neuerName, setNeuerName] = useState('')
  const [wirdHinzugefuegt, setWirdHinzugefuegt] = useState(false)
  const [offenesLokMenue, setOffenesLokMenue] = useState<string | null>(null)
  const [namenOriginal, setNamenOriginal] = useState<Map<string, string>>(new Map())
  const [qualiFilter, setQualiFilter] = useState<string>('alle')
  const [suche, setSuche] = useState('')

  async function laden() {
    // Beim Neuladen (z. B. durch Live-Aktualisierung) bleibt die Liste stehen: kein Flackern, kein Sprung nach oben

    const [{ data: mitarbeiterListe }, { data: alleJahresdaten }, { data: genehmigteAntraege }] =
      await Promise.all([
        supabase.from('mitarbeiter').select('id, name, kategorie, lok_typen, rolle, email').order('name'),
        supabase.from('mitarbeiter_jahresdaten').select('jahr'),
        supabase
          .from('urlaubsantraege')
          .select('name, brauchbare_tage, erster_tag')
          .eq('status', 'genehmigt')
          .gte('erster_tag', `${jahr}-01-01`)
          .lte('erster_tag', `${jahr}-12-31`),
      ])

    const { data: jahresdatenDiesesJahr } = await supabase
      .from('mitarbeiter_jahresdaten')
      .select('id, mitarbeiter_id, urlaubsanspruch, resturlaub, resturlaub_vorjahr, rfu_datum, simulator_datum')
      .eq('jahr', jahr)

    const jahresdatenMap = new Map<string, Jahresdaten>()
    for (const eintrag of jahresdatenDiesesJahr ?? []) {
      jahresdatenMap.set(eintrag.mitarbeiter_id, eintrag)
    }

    const genommenMap = new Map<string, number>()
    for (const antrag of genehmigteAntraege ?? []) {
      if (!antrag.name) continue
      const schluessel = namensSignatur(antrag.name)
      genommenMap.set(schluessel, (genommenMap.get(schluessel) ?? 0) + (antrag.brauchbare_tage ?? 0))
    }

    const neueZeilen: Zeile[] = (mitarbeiterListe ?? []).map((m) => {
      const jd = jahresdatenMap.get(m.id)
      return {
        mitarbeiterId: m.id,
        name: m.name,
        kategorie: m.kategorie,
        lokTypen: m.lok_typen ?? [],
        rolle: m.rolle ?? 'mitarbeiter',
        jahresdatenId: jd?.id ?? null,
        urlaubsanspruch: jd ? jd.urlaubsanspruch : 30,
        resturlaub: jd ? jd.resturlaub : 30,
        resturlaub_vorjahr: jd ? jd.resturlaub_vorjahr : 0,
        tageGenommen: genommenMap.get(namensSignatur(m.name)) ?? 0,
        email: m.email ?? '',
        rfuDatum: jd?.rfu_datum ?? null,
        simulatorDatum: jd?.simulator_datum ?? null,
      }
    })
    setZeilen(neueZeilen)
    setNamenOriginal(new Map(neueZeilen.map((z) => [z.mitarbeiterId, z.name])))

    const jahresSet = new Set<number>([jahr, new Date().getFullYear()])
    for (const eintrag of alleJahresdaten ?? []) {
      jahresSet.add(eintrag.jahr)
    }
    setVerfuegbareJahre(Array.from(jahresSet).sort((a, b) => a - b))

    setLadeVorgang(false)
  }

  useEffect(() => {
    // Waehrend du gerade in ein Feld tippst oder ein Datum waehlst, wird nicht zwischendurch neu geladen
    const aktiv = document.activeElement
    if (!ladeVorgang && (aktiv instanceof HTMLInputElement || aktiv instanceof HTMLSelectElement) && aktiv.closest('table')) return
    laden()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [neuLadenAuslöser, jahr])

  function feldAendern(
    mitarbeiterId: string,
    feld: 'urlaubsanspruch' | 'resturlaub' | 'resturlaub_vorjahr',
    wert: string
  ) {
    setZeilen((vorher) =>
      vorher.map((z) =>
        z.mitarbeiterId === mitarbeiterId ? { ...z, [feld]: wert === '' ? null : Number(wert) } : z
      )
    )
  }

  async function speichern(zeile: Zeile) {
    if (zeile.jahresdatenId) {
      await supabase
        .from('mitarbeiter_jahresdaten')
        .update({
          urlaubsanspruch: zeile.urlaubsanspruch,
          resturlaub: zeile.resturlaub,
          resturlaub_vorjahr: zeile.resturlaub_vorjahr,
          rfu_datum: zeile.rfuDatum,
          simulator_datum: zeile.simulatorDatum,
        })
        .eq('id', zeile.jahresdatenId)
    } else {
      const { data } = await supabase
        .from('mitarbeiter_jahresdaten')
        .insert({
          mitarbeiter_id: zeile.mitarbeiterId,
          jahr,
          urlaubsanspruch: zeile.urlaubsanspruch,
          resturlaub: zeile.resturlaub,
          resturlaub_vorjahr: zeile.resturlaub_vorjahr,
          rfu_datum: zeile.rfuDatum,
          simulator_datum: zeile.simulatorDatum,
        })
        .select('id')
        .single()

      if (data) {
        setZeilen((vorher) =>
          vorher.map((z) =>
            z.mitarbeiterId === zeile.mitarbeiterId ? { ...z, jahresdatenId: data.id } : z
          )
        )
      }
    }

    setGespeichertId(zeile.mitarbeiterId)
    setTimeout(() => setGespeichertId(null), 1200)
  }

  async function datumAendern(zeile: Zeile, feld: 'rfuDatum' | 'simulatorDatum', wert: string) {
    const neueZeile = { ...zeile, [feld]: wert === '' ? null : wert }
    setZeilen((vorher) => vorher.map((z) => (z.mitarbeiterId === zeile.mitarbeiterId ? neueZeile : z)))
    await speichern(neueZeile)
  }

  function emailAendern(mitarbeiterId: string, wert: string) {
    setZeilen((vorher) => vorher.map((z) => (z.mitarbeiterId === mitarbeiterId ? { ...z, email: wert } : z)))
  }

  async function emailSpeichern(zeile: Zeile) {
    const sauber = zeile.email.trim()
    const { error } = await supabase.from('mitarbeiter').update({ email: sauber === '' ? null : sauber }).eq('id', zeile.mitarbeiterId)
    if (error) toast.fehler('E-Mail konnte nicht gespeichert werden: ' + error.message)
    else {
      setGespeichertId(zeile.mitarbeiterId)
      setTimeout(() => setGespeichertId(null), 1200)
    }
  }

  async function kategorieAendern(zeile: Zeile, neueKategorie: string) {
    const wert = neueKategorie === '' ? null : neueKategorie
    setZeilen((vorher) =>
      vorher.map((z) =>
        z.mitarbeiterId === zeile.mitarbeiterId
          ? { ...z, kategorie: wert, lokTypen: wert === 'Lokführer' ? z.lokTypen : [] }
          : z
      )
    )
    await supabase
      .from('mitarbeiter')
      .update({ kategorie: wert, ...(wert !== 'Lokführer' ? { lok_typen: [] } : {}) })
      .eq('id', zeile.mitarbeiterId)
  }

  async function lokTypAendern(zeile: Zeile, lokTyp: string, ausgewaehlt: boolean) {
    const neueTypen = ausgewaehlt
      ? [...zeile.lokTypen, lokTyp]
      : zeile.lokTypen.filter((t) => t !== lokTyp)

    setZeilen((vorher) =>
      vorher.map((z) => (z.mitarbeiterId === zeile.mitarbeiterId ? { ...z, lokTypen: neueTypen } : z))
    )
    await supabase.from('mitarbeiter').update({ lok_typen: neueTypen }).eq('id', zeile.mitarbeiterId)
  }

  async function rolleAendern(zeile: Zeile, neueRolle: string) {
    const istEigenerAccount = zeile.mitarbeiterId === eigenerMitarbeiter?.id
    if (istEigenerAccount && neueRolle !== 'admin') {
      const bestaetigt = await bestaetigen(
        'Du entziehst dir selbst die Admin-Rechte. Danach siehst du nur noch den eingeschränkten Mitarbeiter-Bereich und kannst diese Einstellung nicht mehr selbst rückgängig machen. Fortfahren?',
        { titel: 'Admin-Rechte entziehen', jaText: 'Ja, entziehen', gefahr: true }
      )
      if (!bestaetigt) return
    }

    setZeilen((vorher) =>
      vorher.map((z) => (z.mitarbeiterId === zeile.mitarbeiterId ? { ...z, rolle: neueRolle } : z))
    )
    await supabase.from('mitarbeiter').update({ rolle: neueRolle }).eq('id', zeile.mitarbeiterId)
  }

  async function mitarbeiterHinzufuegen() {
    const name = neuerName.trim()
    if (!name) return
    const aehnliche = zeilen
      .map((z) => ({ z, w: namensSignatur(z.name) === namensSignatur(name) ? 1 : namensAehnlichkeit(name, z.name) }))
      .filter((x) => x.w >= 0.55)
      .sort((a, b) => b.w - a.w)
      .slice(0, 3)
    if (aehnliche.length > 0) {
      const weiter = await bestaetigen(
        `Es gibt schon einen ähnlichen Mitarbeiter: ${aehnliche.map((x) => `„${x.z.name}“`).join(', ')}.\n\nIst „${name}“ wirklich eine andere Person? Falls es dieselbe ist, benenne den vorhandenen Eintrag lieber um, statt einen Doppelten anzulegen.`,
        { titel: 'Mögliche Doppelanlage', jaText: 'Ja, neu anlegen', gefahr: true }
      )
      if (!weiter) return
    }
    setWirdHinzugefuegt(true)
    await supabase.from('mitarbeiter').insert({ name })
    setNeuerName('')
    setWirdHinzugefuegt(false)
    await laden()
  }

  async function inZwischenablage(text: string) {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const feldEl = document.createElement('textarea')
      feldEl.value = text
      document.body.appendChild(feldEl)
      feldEl.select()
      document.execCommand('copy')
      document.body.removeChild(feldEl)
    }
  }

  async function termineKopieren(art: 'rfu' | 'simulator', ausgewaehlt: Zeile[]) {
    const feld = art === 'rfu' ? 'rfuDatum' : 'simulatorDatum'
    const titel = art === 'rfu' ? 'RFU' : 'Simulator'
    const mitTermin = ausgewaehlt
      .filter((z) => z[feld])
      .sort((a, b) => (a[feld] as string).localeCompare(b[feld] as string) || a.name.localeCompare(b.name, 'de'))
    if (mitTermin.length === 0) {
      toast.info(`Keine ${titel}-Termine für ${jahr} in dieser Auswahl eingetragen.`)
      return
    }
    const wochentage = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']
    const zeilenText = mitTermin.map((z) => {
      const [j, m, t] = (z[feld] as string).split('-').map(Number)
      const wt = wochentage[new Date(j, m - 1, t).getDay()]
      return `${z.name}: ${wt}, ${String(t).padStart(2, '0')}.${String(m).padStart(2, '0')}.${j}`
    })
    await inZwischenablage(`${titel}-Termine ${jahr}\n\n${zeilenText.join('\n')}`)
    toast.erfolg(`${mitTermin.length} ${titel}-Termine kopiert – jetzt in die Mail einfügen (Strg+V).`)
  }

  function emailVorschlag(name: string): string {
    const bereinigen = (t: string) =>
      t
        .toLowerCase()
        .replace(/ä/g, 'ae')
        .replace(/ö/g, 'oe')
        .replace(/ü/g, 'ue')
        .replace(/ß/g, 'ss')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9-]/g, '')
    let vorname: string
    let nachname: string
    if (name.includes(',')) {
      const [n, v] = name.split(',')
      nachname = n
      vorname = v
    } else {
      const teile = name.trim().split(/\s+/)
      vorname = teile[0]
      nachname = teile.slice(1).join('-')
    }
    const v = bereinigen(vorname.trim().split(/\s+/)[0] ?? '')
    const n = bereinigen(nachname.trim().replace(/\s+/g, '-'))
    return v && n ? `${v}.${n}@railbavaria.de` : ''
  }

  async function emailsAutomatischEintragen(ausgewaehlt: Zeile[]) {
    const kandidaten = ausgewaehlt
      .filter((z) => z.email.trim() === '')
      .map((z) => ({ zeile: z, adresse: emailVorschlag(z.name) }))
      .filter((k) => k.adresse !== '')
    if (kandidaten.length === 0) {
      toast.info('Keine leeren E-Mail-Felder in dieser Auswahl.')
      return
    }
    const liste = kandidaten.map((k) => `${k.zeile.name}  →  ${k.adresse}`).join('  ·  ')
    const ok = await bestaetigen(
      `Für ${kandidaten.length} Mitarbeiter wird die Adresse nach dem Schema vorname.nachname@railbavaria.de eingetragen (nur leere Felder, bereits eingetragene bleiben unberührt). Bitte kurz prüfen, ob Vor- und Nachname richtig herum stehen: ${liste}`,
      { titel: 'E-Mail-Adressen automatisch eintragen', jaText: 'Eintragen' }
    )
    if (!ok) return
    const fehler: string[] = []
    for (const k of kandidaten) {
      const { error } = await supabase.from('mitarbeiter').update({ email: k.adresse }).eq('id', k.zeile.mitarbeiterId)
      if (error) fehler.push(k.zeile.name)
    }
    const adressenNachId = new Map(kandidaten.map((k) => [k.zeile.mitarbeiterId, k.adresse]))
    setZeilen((vorher) => vorher.map((z) => (adressenNachId.has(z.mitarbeiterId) && !fehler.includes(z.name) ? { ...z, email: adressenNachId.get(z.mitarbeiterId) as string } : z)))
    if (fehler.length > 0) toast.fehler('Nicht gespeichert: ' + fehler.join(', '))
    else toast.erfolg(`${kandidaten.length} E-Mail-Adressen eingetragen.`)
  }

  function nameAendern(mitarbeiterId: string, wert: string) {
    setZeilen((vorher) => vorher.map((z) => (z.mitarbeiterId === mitarbeiterId ? { ...z, name: wert } : z)))
  }

  async function nameSpeichern(zeile: Zeile) {
    const neu = zeile.name.trim().replace(/\s+/g, ' ')
    if (neu === '') {
      toast.fehler('Der Name darf nicht leer sein.')
      laden()
      return
    }
    const alt = namenOriginal.get(zeile.mitarbeiterId)
    if (alt === undefined || alt === neu) {
      nameAendern(zeile.mitarbeiterId, neu)
      return
    }
    const { error } = await supabase.from('mitarbeiter').update({ name: neu }).eq('id', zeile.mitarbeiterId)
    if (error) {
      toast.fehler('Name konnte nicht gespeichert werden: ' + error.message)
      nameAendern(zeile.mitarbeiterId, alt)
      return
    }
    // Bestehende Urlaubsanträge dieser Person mit umbenennen, damit die Zuordnung (genommene Urlaubstage) erhalten bleibt
    await supabase.from('urlaubsantraege').update({ name: neu }).eq('mitarbeiter_id', zeile.mitarbeiterId)
    await supabase.from('urlaubsantraege').update({ name: neu }).eq('name', alt)
    setNamenOriginal((vorher) => new Map(vorher).set(zeile.mitarbeiterId, neu))
    nameAendern(zeile.mitarbeiterId, neu)
    setGespeichertId(zeile.mitarbeiterId)
    setTimeout(() => setGespeichertId(null), 1200)
    toast.erfolg(`Name geändert: ${alt} → ${neu}`)
  }

  async function mitarbeiterLoeschen(zeile: Zeile) {
    if (zeile.mitarbeiterId === eigenerMitarbeiter?.id) {
      toast.fehler('Du kannst dich nicht selbst löschen.')
      return
    }
    const ok = await bestaetigen(
      `„${zeile.name}“ wird endgültig gelöscht – inklusive aller Urlaubsanträge, Jahresdaten und Dienstplan-Einträge dieser Person. Das kann nicht rückgängig gemacht werden. Wirklich löschen?`,
      { titel: 'Mitarbeiter löschen', jaText: 'Ja, endgültig löschen', gefahr: true }
    )
    if (!ok) return
    const { error } = await supabase.rpc('mitarbeiter_loeschen', { p_id: zeile.mitarbeiterId })
    if (error) {
      toast.fehler('Löschen fehlgeschlagen: ' + error.message)
      return
    }
    setZeilen((vorher) => vorher.filter((z) => z.mitarbeiterId !== zeile.mitarbeiterId))
    toast.erfolg(`${zeile.name} wurde gelöscht.`)
  }

  async function emailsKopieren(ausgewaehlt: Zeile[]) {
    const adressen = ausgewaehlt.map((z) => z.email.trim()).filter(Boolean)
    if (adressen.length === 0) {
      toast.info('In dieser Auswahl ist noch keine E-Mail-Adresse eingetragen.')
      return
    }
    const fehlen = ausgewaehlt.length - adressen.length
    await inZwischenablage(adressen.join('; '))
    toast.erfolg(`${adressen.length} E-Mail-Adressen kopiert${fehlen > 0 ? ` (bei ${fehlen} fehlt noch eine)` : ''} – in das „An“-Feld der Mail einfügen.`)
  }

  function alsDatum(iso: string | null): Date | string {
    if (!iso) return ''
    const [j, m, t] = iso.split('-').map(Number)
    return new Date(Date.UTC(j, m - 1, t))
  }

  function excelExportieren(ausgewaehlt: Zeile[]) {
    if (ausgewaehlt.length === 0) {
      toast.info('Keine Mitarbeiter in dieser Auswahl.')
      return
    }
    const kopf = ['Name', 'Qualifikation', 'E-Mail', `Datum RFU ${jahr}`, `Datum Simulator ${jahr}`]
    const daten = ausgewaehlt.map((z) => [z.name, z.kategorie ?? '', z.email, alsDatum(z.rfuDatum), alsDatum(z.simulatorDatum)])
    const blatt = XLSX.utils.aoa_to_sheet([kopf, ...daten], { cellDates: true })
    blatt['!cols'] = [{ wch: 28 }, { wch: 16 }, { wch: 34 }, { wch: 18 }, { wch: 22 }]
    for (let r = 1; r <= daten.length; r++) {
      for (const c of [3, 4]) {
        const zelle = blatt[XLSX.utils.encode_cell({ r, c })]
        if (zelle && zelle.t === 'd') zelle.z = 'DD.MM.YYYY'
      }
    }
    blatt['!autofilter'] = { ref: `A1:E${daten.length + 1}` }
    const mappe = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(mappe, blatt, `RFU und Simulator ${jahr}`.slice(0, 31))
    XLSX.writeFile(mappe, `Termine_RFU_Simulator_${jahr}.xlsx`, { cellDates: true })
    toast.erfolg(`Excel-Datei mit ${ausgewaehlt.length} Mitarbeitern erstellt.`)
  }

  function jahrHinzufuegen() {
    const naechstesJahr = Math.max(...verfuegbareJahre, jahr) + 1
    setVerfuegbareJahre((vorher) =>
      Array.from(new Set([...vorher, naechstesJahr])).sort((a, b) => a - b)
    )
    setJahr(naechstesJahr)
  }

  if (ladeVorgang) {
    return <p style={{ color: 'var(--text-muted)' }}>Lade Mitarbeiter...</p>
  }

  const KURZ: Record<string, string> = { Lokführer: 'TF', Wagenmeister: 'WGM' }
  const filterKnoepfe = [
    { id: 'alle', text: 'Alle', anzahl: zeilen.length },
    ...KATEGORIEN.map((k) => ({
      id: k,
      text: KURZ[k] ? `${KURZ[k]} (${k})` : k,
      anzahl: zeilen.filter((z) => z.kategorie === k).length,
    })),
    { id: '__keine', text: 'Ohne Qualifikation', anzahl: zeilen.filter((z) => !z.kategorie).length },
  ].filter((f) => f.id === 'alle' || f.anzahl > 0)
  const sichtbareZeilen = zeilen.filter(
    (z) =>
      (qualiFilter === 'alle' || (qualiFilter === '__keine' ? !z.kategorie : z.kategorie === qualiFilter)) &&
      (suche.trim() === '' || z.name.toLowerCase().includes(suche.trim().toLowerCase()))
  )

  const anzahlTF = zeilen.filter((z) => z.kategorie === 'Lokführer').length
  const anzahlWGM = zeilen.filter((z) => z.kategorie === 'Wagenmeister').length
  const anzahlRfu = zeilen.filter((z) => z.rfuDatum).length
  const anzahlSim = zeilen.filter((z) => z.simulatorDatum).length
  const kennzahlen = [
    { titel: 'Mitarbeiter', wert: String(zeilen.length), hinweis: 'insgesamt' },
    { titel: 'Lokführer', wert: String(anzahlTF), hinweis: 'TF' },
    { titel: 'Wagenmeister', wert: String(anzahlWGM), hinweis: 'WGM' },
    { titel: `RFU ${jahr}`, wert: `${anzahlRfu} / ${zeilen.length}`, hinweis: 'Termine eingetragen' },
    { titel: `Simulator ${jahr}`, wert: `${anzahlSim} / ${zeilen.length}`, hinweis: 'Termine eingetragen' },
  ]
  const kartenStil: React.CSSProperties = {
    background: '#ffffff',
    border: '1px solid var(--border)',
    borderRadius: 10,
    boxShadow: '0 1px 2px rgba(16,24,40,0.05)',
  }

  return (
    <div className="mv-seite">
      <style>{`
        .mv-tabelle tbody tr:nth-child(even) { background: #fafbfc; }
        .mv-tabelle tbody tr:hover { background: #eef3f9; }
        .mv-tabelle input, .mv-tabelle select { border-color: transparent !important; transition: border-color .12s, box-shadow .12s; }
        .mv-tabelle input:not([type=date]), .mv-tabelle select { background-color: transparent !important; }
        .mv-tabelle input:hover, .mv-tabelle select:hover { border-color: var(--border) !important; }
        .mv-tabelle input:focus, .mv-tabelle select:focus { border-color: var(--navy) !important; background-color: #ffffff !important; outline: none; box-shadow: 0 0 0 3px rgba(20,50,92,0.14); }
        .mv-tabelle td { vertical-align: middle; }
        .mv-knopf:hover { filter: brightness(0.96); }
      `}</style>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 14 }}>
        {kennzahlen.map((k) => (
          <div key={k.titel} style={{ ...kartenStil, padding: '12px 16px' }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500 }}>{k.titel}</div>
            <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--navy)', lineHeight: 1.25 }}>{k.wert}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{k.hinweis}</div>
          </div>
        ))}
      </div>

      <div style={{ ...kartenStil, padding: 16, marginBottom: 14, display: 'grid', gap: 14 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center', paddingRight: 12, borderRight: '1px solid var(--border)' }}>
            {verfuegbareJahre.map((j) => (
              <button
                key={j}
                onClick={() => setJahr(j)}
                style={{
                  background: j === jahr ? 'var(--navy)' : '#ffffff',
                  color: j === jahr ? '#ffffff' : 'var(--text-muted)',
                  border: '1px solid ' + (j === jahr ? 'var(--navy)' : 'var(--border)'),
                  borderRadius: 6,
                  padding: '6px 14px',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {j}
              </button>
            ))}
            <button
              onClick={jahrHinzufuegen}
              title="Weiteres Jahr hinzufügen"
              style={{ background: '#ffffff', border: '1px dashed var(--border)', borderRadius: 6, padding: '6px 10px', fontSize: 13, color: 'var(--navy)', cursor: 'pointer' }}
            >
              + Jahr
            </button>
          </div>

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            {filterKnoepfe.map((f) => (
              <button
                key={f.id}
                onClick={() => setQualiFilter(f.id)}
                style={{
                  background: qualiFilter === f.id ? 'var(--navy)' : '#f3f5f8',
                  color: qualiFilter === f.id ? '#ffffff' : 'var(--text)',
                  border: 'none',
                  borderRadius: 999,
                  padding: '6px 13px',
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                {f.text} <span style={{ opacity: 0.65 }}>{f.anzahl}</span>
              </button>
            ))}
          </div>

          <input
            type="search"
            placeholder="🔍  Name suchen…"
            value={suche}
            onChange={(e) => setSuche(e.target.value)}
            style={{ marginLeft: 'auto', padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, minWidth: 220 }}
          />
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', paddingTop: 14, borderTop: '1px solid var(--border)' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4, marginRight: 4 }}>Export</span>
          <button className="mv-knopf" style={aktionsKnopf(true)} onClick={() => excelExportieren(sichtbareZeilen)} title="Excel-Tabelle mit Name, Qualifikation, E-Mail, RFU- und Simulator-Datum der aktuellen Auswahl">
            ⬇ Excel-Export
          </button>
          <button className="mv-knopf" style={aktionsKnopf(false)} onClick={() => termineKopieren('rfu', sichtbareZeilen)} title="Eingetragene RFU-Termine der aktuellen Auswahl kopieren">
            RFU-Termine kopieren
          </button>
          <button className="mv-knopf" style={aktionsKnopf(false)} onClick={() => termineKopieren('simulator', sichtbareZeilen)} title="Eingetragene Simulator-Termine der aktuellen Auswahl kopieren">
            Simulator-Termine kopieren
          </button>
          <span style={{ width: 1, height: 22, background: 'var(--border)', margin: '0 6px' }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.4, marginRight: 4 }}>E-Mail</span>
          <button className="mv-knopf" style={aktionsKnopf(false)} onClick={() => emailsKopieren(sichtbareZeilen)} title="E-Mail-Adressen der aktuellen Auswahl kopieren (mit Semikolon getrennt)">
            Adressen kopieren
          </button>
          <button className="mv-knopf" style={aktionsKnopf(false)} onClick={() => emailsAutomatischEintragen(sichtbareZeilen)} title="Leere E-Mail-Felder nach dem Schema vorname.nachname@railbavaria.de füllen">
            Automatisch eintragen
          </button>
          <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 'auto' }}>
            Gilt für {jahr} und die angezeigten Mitarbeiter ({sichtbareZeilen.length})
          </span>
        </div>

        <div style={{ display: 'flex', gap: 8, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
          <input
            type="text"
            placeholder="Neuen Mitarbeiter anlegen: Name eingeben …"
            value={neuerName}
            onChange={(e) => setNeuerName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && mitarbeiterHinzufuegen()}
            style={{ flex: 1, padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 14 }}
          />
          <button
            onClick={mitarbeiterHinzufuegen}
            disabled={wirdHinzugefuegt || !neuerName.trim()}
            style={{
              background: 'var(--navy)',
              color: '#ffffff',
              border: 'none',
              borderRadius: 8,
              padding: '8px 18px',
              fontSize: 14,
              fontWeight: 600,
              cursor: 'pointer',
              opacity: wirdHinzugefuegt || !neuerName.trim() ? 0.5 : 1,
            }}
          >
            + Hinzufügen
          </button>
        </div>
      </div>

      <div style={{ ...kartenStil, overflow: 'auto', maxHeight: 'max(420px, calc(100vh - 150px))' }}>
        <table className="mv-tabelle" style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={kopfZelleStil}>Name</th>
              <th style={kopfZelleStil}>Rolle</th>
              <th style={kopfZelleStil}>Qualifikation</th>
              <th style={kopfZelleStil}>Lok-Typen</th>
              <th style={kopfZelleStil}>E-Mail</th>
              <th style={kopfZelleStil}>Datum RFU</th>
              <th style={kopfZelleStil}>Datum Simulator</th>
              <th style={kopfZelleStil}>Resturlaub Vorjahr</th>
              <th style={kopfZelleStil}>Urlaubsanspruch</th>
              <th style={kopfZelleStil}>Resturlaub</th>
              <th style={kopfZelleStil}>Gesamt verfügbar</th>
              <th style={kopfZelleStil}>Urlaubstage genommen</th>
              <th style={kopfZelleStil}></th>
              <th style={kopfZelleStil}></th>
            </tr>
          </thead>
          <tbody>
            {sichtbareZeilen.length === 0 && (
              <tr>
                <td colSpan={14} style={{ ...zellStil, color: 'var(--text-muted)', textAlign: 'center', padding: 20 }}>
                  Keine Mitarbeiter in dieser Auswahl.
                </td>
              </tr>
            )}
            {sichtbareZeilen.map((zeile) => (
              <tr key={zeile.mitarbeiterId}>
                <td style={zellStil}>
                  <input
                    type="text"
                    value={zeile.name}
                    onChange={(e) => nameAendern(zeile.mitarbeiterId, e.target.value)}
                    onBlur={() => nameSpeichern(zeile)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                    }}
                    style={{ ...eingabeStil, width: 200, fontWeight: 600 }}
                  />
                </td>
                <td style={zellStil}>
                  <select
                    value={zeile.rolle}
                    onChange={(e) => rolleAendern(zeile, e.target.value)}
                    style={{
                      ...eingabeStil,
                      width: 110,
                      fontWeight: zeile.rolle === 'admin' ? 600 : 400,
                      color: zeile.rolle === 'admin' ? 'var(--navy)' : undefined,
                    }}
                  >
                    <option value="mitarbeiter">Mitarbeiter</option>
                    <option value="admin">Admin</option>
                  </select>
                </td>
                <td style={zellStil}>
                  <select
                    value={zeile.kategorie ?? ''}
                    onChange={(e) => kategorieAendern(zeile, e.target.value)}
                    style={{ ...eingabeStil, width: 140 }}
                  >
                    <option value="">–</option>
                    {KATEGORIEN.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                </td>
                <td style={{ ...zellStil, position: 'relative' }}>
                  {zeile.kategorie === 'Lokführer' ? (
                    <>
                      <button
                        onClick={() =>
                          setOffenesLokMenue(
                            offenesLokMenue === zeile.mitarbeiterId ? null : zeile.mitarbeiterId
                          )
                        }
                        style={{
                          background: 'none',
                          border: '1px solid var(--border)',
                          borderRadius: 4,
                          padding: '4px 8px',
                          fontSize: 12,
                          cursor: 'pointer',
                          minWidth: 120,
                          textAlign: 'left',
                        }}
                      >
                        {zeile.lokTypen.length > 0 ? zeile.lokTypen.join(', ') : 'Auswählen...'}
                      </button>

                      {offenesLokMenue === zeile.mitarbeiterId && (
                        <div
                          style={{
                            position: 'absolute',
                            top: '100%',
                            left: 0,
                            zIndex: 10,
                            background: 'var(--card)',
                            border: '1px solid var(--border)',
                            borderRadius: 6,
                            padding: 8,
                            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                            minWidth: 140,
                          }}
                        >
                          {LOK_TYPEN.map((lokTyp) => (
                            <label
                              key={lokTyp}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                fontSize: 12,
                                padding: '3px 0',
                                cursor: 'pointer',
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={zeile.lokTypen.includes(lokTyp)}
                                onChange={(e) => lokTypAendern(zeile, lokTyp, e.target.checked)}
                              />
                              {lokTyp}
                            </label>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <span style={{ color: 'var(--text-muted)' }}>–</span>
                  )}
                </td>
                <td style={zellStil}>
                  <input
                    type="email"
                    value={zeile.email}
                    placeholder="name@firma.de"
                    onChange={(e) => emailAendern(zeile.mitarbeiterId, e.target.value)}
                    onBlur={() => emailSpeichern(zeile)}
                    style={{ ...eingabeStil, width: 210 }}
                  />
                </td>
                <td style={zellStil}>
                  <input
                    type="date"
                    value={zeile.rfuDatum ?? ''}
                    onChange={(e) => datumAendern(zeile, 'rfuDatum', e.target.value)}
                    title={zeile.rfuDatum ? 'Durchgeführt am' : jahr === new Date().getFullYear() ? 'Dieses Jahr noch nicht eingetragen' : 'Nicht eingetragen'}
                    style={datumStil(zeile.rfuDatum, jahr)}
                  />
                </td>
                <td style={zellStil}>
                  <input
                    type="date"
                    value={zeile.simulatorDatum ?? ''}
                    onChange={(e) => datumAendern(zeile, 'simulatorDatum', e.target.value)}
                    title={zeile.simulatorDatum ? 'Durchgeführt am' : jahr === new Date().getFullYear() ? 'Dieses Jahr noch nicht eingetragen' : 'Nicht eingetragen'}
                    style={datumStil(zeile.simulatorDatum, jahr)}
                  />
                </td>
                <td style={zellStil}>
                  <input
                    type="number"
                    value={zeile.resturlaub_vorjahr ?? ''}
                    onChange={(e) =>
                      feldAendern(zeile.mitarbeiterId, 'resturlaub_vorjahr', e.target.value)
                    }
                    onBlur={() => speichern(zeile)}
                    style={eingabeStil}
                  />
                </td>
                <td style={zellStil}>
                  <input
                    type="number"
                    value={zeile.urlaubsanspruch ?? ''}
                    onChange={(e) =>
                      feldAendern(zeile.mitarbeiterId, 'urlaubsanspruch', e.target.value)
                    }
                    onBlur={() => speichern(zeile)}
                    style={eingabeStil}
                  />
                </td>
                <td style={zellStil}>
                  <input
                    type="number"
                    value={zeile.resturlaub ?? ''}
                    onChange={(e) => feldAendern(zeile.mitarbeiterId, 'resturlaub', e.target.value)}
                    onBlur={() => speichern(zeile)}
                    style={eingabeStil}
                  />
                </td>
                <td style={{ ...zellStil, fontWeight: 600 }}>
                  {(zeile.resturlaub ?? 0) + (zeile.resturlaub_vorjahr ?? 0)}
                </td>
                <td style={zellStil}>{zeile.tageGenommen}</td>
                <td style={{ ...zellStil, color: 'var(--success)', fontSize: 12 }}>
                  {gespeichertId === zeile.mitarbeiterId ? 'Gespeichert' : ''}
                </td>
                <td style={zellStil}>
                  <button
                    type="button"
                    onClick={() => mitarbeiterLoeschen(zeile)}
                    disabled={zeile.mitarbeiterId === eigenerMitarbeiter?.id}
                    title={zeile.mitarbeiterId === eigenerMitarbeiter?.id ? 'Du kannst dich nicht selbst löschen' : 'Mitarbeiter löschen'}
                    style={{ border: 'none', background: 'transparent', cursor: zeile.mitarbeiterId === eigenerMitarbeiter?.id ? 'not-allowed' : 'pointer', opacity: zeile.mitarbeiterId === eigenerMitarbeiter?.id ? 0.3 : 0.7, fontSize: 16 }}
                  >
                    🗑
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const kopfZelleStil: React.CSSProperties = {
  textAlign: 'left',
  padding: '6px 8px',
  borderBottom: '1px solid var(--border)',
  color: 'var(--text-muted)',
  fontWeight: 600,
  fontSize: 12,
  textTransform: 'uppercase',
  letterSpacing: 0.3,
  background: '#f8fafc',
  position: 'sticky',
  top: 0,
  zIndex: 2,
  whiteSpace: 'nowrap',
}

const zellStil: React.CSSProperties = {
  padding: '3px 8px',
  borderBottom: '1px solid var(--border)',
}

function aktionsKnopf(primaer: boolean): React.CSSProperties {
  return {
    background: primaer ? 'var(--navy)' : '#ffffff',
    color: primaer ? '#ffffff' : 'var(--navy)',
    border: '1px solid var(--navy)',
    borderRadius: 6,
    padding: '6px 12px',
    fontSize: 13,
    fontWeight: 500,
    cursor: 'pointer',
  }
}

function datumStil(datum: string | null, jahr: number): React.CSSProperties {
  const dieserJahr = jahr === new Date().getFullYear()
  return {
    ...eingabeStil,
    width: 140,
    background: datum ? '#dcfce7' : dieserJahr ? '#fef3c7' : undefined,
  }
}

const eingabeStil: React.CSSProperties = {
  width: 80,
  padding: '4px 6px',
  border: '1px solid var(--border)',
  borderRadius: 4,
  fontSize: 13,
}
