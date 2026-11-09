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

  return (
    <div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        {verfuegbareJahre.map((j) => (
          <button
            key={j}
            onClick={() => setJahr(j)}
            style={{
              background: j === jahr ? 'var(--navy)' : 'none',
              color: j === jahr ? '#ffffff' : 'var(--text-muted)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '6px 14px',
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            {j}
          </button>
        ))}
        <button
          onClick={jahrHinzufuegen}
          title="Weiteres Jahr hinzufügen"
          style={{
            background: 'none',
            border: '1px dashed var(--border)',
            borderRadius: 6,
            padding: '6px 10px',
            fontSize: 13,
            color: 'var(--navy)',
            cursor: 'pointer',
          }}
        >
          + Jahr
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          type="text"
          placeholder="Name des neuen Mitarbeiters"
          value={neuerName}
          onChange={(e) => setNeuerName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && mitarbeiterHinzufuegen()}
          style={{
            flex: 1,
            padding: '8px 10px',
            border: '1px solid var(--border)',
            borderRadius: 6,
            fontSize: 14,
          }}
        />
        <button
          onClick={mitarbeiterHinzufuegen}
          disabled={wirdHinzugefuegt || !neuerName.trim()}
          style={{
            background: 'var(--navy)',
            color: '#ffffff',
            border: 'none',
            borderRadius: 6,
            padding: '8px 16px',
            fontSize: 14,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          + Hinzufügen
        </button>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        {filterKnoepfe.map((f) => (
          <button
            key={f.id}
            onClick={() => setQualiFilter(f.id)}
            style={{
              background: qualiFilter === f.id ? 'var(--navy)' : 'none',
              color: qualiFilter === f.id ? '#ffffff' : 'var(--text-muted)',
              border: '1px solid var(--border)',
              borderRadius: 999,
              padding: '5px 12px',
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            {f.text} · {f.anzahl}
          </button>
        ))}
        <input
          type="search"
          placeholder="Name suchen…"
          value={suche}
          onChange={(e) => setSuche(e.target.value)}
          style={{ marginLeft: 'auto', padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, minWidth: 160 }}
        />
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <button style={aktionsKnopf(true)} onClick={() => excelExportieren(sichtbareZeilen)} title="Excel-Tabelle mit Name, Qualifikation, E-Mail, RFU- und Simulator-Datum der aktuellen Auswahl">
          ⬇ Excel: RFU- und Simulator-Termine
        </button>
        <button style={aktionsKnopf(false)} onClick={() => termineKopieren('rfu', sichtbareZeilen)} title="Eingetragene RFU-Termine der aktuellen Auswahl kopieren">
          📋 RFU-Termine kopieren
        </button>
        <button style={aktionsKnopf(false)} onClick={() => termineKopieren('simulator', sichtbareZeilen)} title="Eingetragene Simulator-Termine der aktuellen Auswahl kopieren">
          📋 Simulator-Termine kopieren
        </button>
        <button style={aktionsKnopf(false)} onClick={() => emailsKopieren(sichtbareZeilen)} title="E-Mail-Adressen der aktuellen Auswahl kopieren (mit Semikolon getrennt)">
          ✉ E-Mail-Adressen kopieren
        </button>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>gilt für Jahr {jahr} und die aktuell angezeigten Mitarbeiter</span>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
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
            </tr>
          </thead>
          <tbody>
            {sichtbareZeilen.length === 0 && (
              <tr>
                <td colSpan={13} style={{ ...zellStil, color: 'var(--text-muted)', textAlign: 'center', padding: 20 }}>
                  Keine Mitarbeiter in dieser Auswahl.
                </td>
              </tr>
            )}
            {sichtbareZeilen.map((zeile) => (
              <tr key={zeile.mitarbeiterId}>
                <td style={zellStil}>{zeile.name}</td>
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
  padding: '6px 10px',
  borderBottom: '1px solid var(--border)',
  color: 'var(--text-muted)',
  fontWeight: 500,
}

const zellStil: React.CSSProperties = {
  padding: '4px 10px',
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
