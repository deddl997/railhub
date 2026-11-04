import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import { namensSignatur } from './namensAbgleich'
import { berechneBrauchbareTage } from './urlaubsberechnung'
import { erstelleUrlaubsantragPdf } from './pdfErstellung'
import { bestaetigen } from './ui'

interface Antrag {
  id: string
  mitarbeiter_id: string | null
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
  bearbeitet_von: string | null
  datum_bearbeiter: string | null
  ablehnung_begruendung: string | null
  erster_tag: string | null
  letzter_tag: string | null
  anzahl_tage: number | null
  brauchbare_tage: number | null
  status: string
  dokument_url: string | null
  abzug_vorjahr: number | null
  abzug_aktuell: number | null
  gruppe_id: string | null
}

interface Gruppe {
  schluessel: string
  name: string | null
  status: string
  zeilen: Antrag[]
}

const SPALTEN = [
  { status: 'offen', titel: 'Nicht bearbeitet', farbe: 'var(--warning)' },
  { status: 'genehmigt', titel: 'Genehmigt', farbe: 'var(--success)' },
  { status: 'abgelehnt', titel: 'Abgelehnt', farbe: 'var(--danger)' },
]

async function findeMitarbeiterId(name: string): Promise<string | null> {
  const { data: alle } = await supabase.from('mitarbeiter').select('id, name')
  const signatur = namensSignatur(name)
  const treffer = (alle ?? []).find((m) => namensSignatur(m.name) === signatur)
  return treffer?.id ?? null
}

async function holeOderErstelleJahresdaten(name: string, jahr: number) {
  const mitarbeiterId = await findeMitarbeiterId(name)
  if (!mitarbeiterId) return null

  const { data: jahresdaten } = await supabase
    .from('mitarbeiter_jahresdaten')
    .select('id, resturlaub, resturlaub_vorjahr')
    .eq('mitarbeiter_id', mitarbeiterId)
    .eq('jahr', jahr)
    .maybeSingle()

  if (jahresdaten) return jahresdaten

  const { data: neueDaten } = await supabase
    .from('mitarbeiter_jahresdaten')
    .insert({
      mitarbeiter_id: mitarbeiterId,
      jahr,
      urlaubsanspruch: 30,
      resturlaub: 30,
      resturlaub_vorjahr: 0,
    })
    .select('id, resturlaub, resturlaub_vorjahr')
    .single()

  return neueDaten
}

function datumDe(iso: string): string {
  const [j, m, t] = iso.split('-')
  return `${t}.${m}.${j.slice(2)}`
}

function tageZwischen(von: string, bis: string): string[] {
  const tage: string[] = []
  const d = new Date(von + 'T00:00:00')
  const ende = new Date(bis + 'T00:00:00')
  let schutz = 0
  while (d <= ende && schutz++ < 400) {
    tage.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
    d.setDate(d.getDate() + 1)
  }
  return tage
}

/**
 * Prueft vor dem Genehmigen, ob der Urlaub Probleme macht:
 * - ist die Person in dem Zeitraum schon im Dienstplan eingeteilt (auch auf Auftraegen)?
 * - wie viele der gleichen Qualifikation waeren dann gleichzeitig weg?
 */
async function konfliktPruefen(zeilen: Antrag[], name: string | null): Promise<string[]> {
  const hinweise: string[] = []
  const zeitraeume = zeilen.filter((z) => z.erster_tag && z.letzter_tag) as (Antrag & { erster_tag: string; letzter_tag: string })[]
  if (zeitraeume.length === 0 || !name) return hinweise
  const von = zeitraeume.map((z) => z.erster_tag).sort()[0]
  const bis = zeitraeume.map((z) => z.letzter_tag).sort().slice(-1)[0]

  const { data: alle } = await supabase.from('mitarbeiter').select('id, name, kategorie')
  const personen = (alle ?? []) as { id: string; name: string; kategorie: string | null }[]
  const signatur = namensSignatur(name)
  const person = personen.find((m) => m.id === zeilen[0].mitarbeiter_id) ?? personen.find((m) => namensSignatur(m.name) === signatur)

  // 1) Schon eingeteilt?
  if (person) {
    const { data: dienste } = await supabase
      .from('dienstplan_eintraege')
      .select('datum, auftrag_id, ist_spotschicht')
      .eq('mitarbeiter_id', person.id)
      .gte('datum', von)
      .lte('datum', bis)
    const betroffen = ((dienste ?? []) as { datum: string; auftrag_id: string | null }[]).filter((d) =>
      zeitraeume.some((z) => d.datum >= z.erster_tag && d.datum <= z.letzter_tag)
    )
    if (betroffen.length > 0) {
      const mitAuftrag = betroffen.filter((d) => d.auftrag_id).length
      const tage = Array.from(new Set(betroffen.map((d) => d.datum))).sort()
      hinweise.push(
        `${name} ist in diesem Zeitraum schon an ${tage.length} Tag${tage.length === 1 ? '' : 'en'} im Dienstplan eingeteilt` +
          (mitAuftrag > 0 ? `, davon ${mitAuftrag} Mal auf einem Auftrag` : '') +
          `: ${tage.slice(0, 5).map(datumDe).join(', ')}${tage.length > 5 ? ' …' : ''}.`
      )
    }
  }

  // 2) Wie viele gleichzeitig weg?
  const kategorie = person?.kategorie ?? null
  if (kategorie) {
    const gruppe = personen.filter((m) => m.kategorie === kategorie)
    const { data: andere } = await supabase
      .from('urlaubsantraege')
      .select('mitarbeiter_id, name, erster_tag, letzter_tag')
      .eq('status', 'genehmigt')
      .lte('erster_tag', bis)
      .gte('letzter_tag', von)
    const urlaube = (andere ?? []) as { mitarbeiter_id: string | null; name: string | null; erster_tag: string; letzter_tag: string }[]
    const idsGruppe = new Map(gruppe.map((m) => [m.id, namensSignatur(m.name)]))
    const eigeneTage = new Set(zeitraeume.flatMap((z) => tageZwischen(z.erster_tag, z.letzter_tag)))
    const kritisch: { tag: string; weg: number }[] = []
    for (const tag of eigeneTage) {
      const weg = new Set<string>([person!.id])
      for (const u of urlaube) {
        if (tag < u.erster_tag || tag > u.letzter_tag) continue
        const id = u.mitarbeiter_id && idsGruppe.has(u.mitarbeiter_id) ? u.mitarbeiter_id : gruppe.find((m) => u.name && namensSignatur(m.name) === namensSignatur(u.name))?.id
        if (id) weg.add(id)
      }
      if (gruppe.length >= 3 && weg.size / gruppe.length >= 0.4) kritisch.push({ tag, weg: weg.size })
    }
    if (kritisch.length > 0) {
      kritisch.sort((a, b) => b.weg - a.weg || a.tag.localeCompare(b.tag))
      const schlimmster = kritisch[0]
      hinweise.push(
        `Bei „${kategorie}“ wären an ${kritisch.length} Tag${kritisch.length === 1 ? '' : 'en'} 40 % oder mehr gleichzeitig weg, am knappsten am ${datumDe(schlimmster.tag)}: ${schlimmster.weg} von ${gruppe.length} im Urlaub.`
      )
    }
  }
  return hinweise
}

function jahrDerGruppe(gruppe: Gruppe): number {
  const erstesDatum = gruppe.zeilen[0]?.erster_tag
  return erstesDatum ? new Date(erstesDatum).getFullYear() : new Date().getFullYear()
}

export default function MeineAntraege({
  neuLadenAuslöser,
  onGeaendert,
}: {
  neuLadenAuslöser: number
  onGeaendert: () => void
}) {
  const [antraege, setAntraege] = useState<Antrag[]>([])
  const [ladeVorgang, setLadeVorgang] = useState(true)
  const [fehler, setFehler] = useState<string | null>(null)

  const [pdfDialogSchluessel, setPdfDialogSchluessel] = useState<string | null>(null)
  const [pdfBearbeitetVon, setPdfBearbeitetVon] = useState('')
  const [pdfDatum, setPdfDatum] = useState('')
  const [pdfAblehnungBegruendung, setPdfAblehnungBegruendung] = useState('')

  const [zeitraumDialogSchluessel, setZeitraumDialogSchluessel] = useState<string | null>(null)
  const [neuerZeitraumVon, setNeuerZeitraumVon] = useState('')
  const [neuerZeitraumBis, setNeuerZeitraumBis] = useState('')
  const [zeitraumWirdGespeichert, setZeitraumWirdGespeichert] = useState(false)
  const [jahrFilter, setJahrFilter] = useState<number | 'alle' | null>(null)

  async function laden() {
    setLadeVorgang(true)
    const { data } = await supabase
      .from('urlaubsantraege')
      .select(
        'id, mitarbeiter_id, name, vorgesetzter, funktion_bereich, urlaubsart, urlaubsart_begruendung, jahr, urlaubsanspruch, verplant, rest, resturlaub_vorjahr, datum_antragsteller, bearbeitet_von, datum_bearbeiter, ablehnung_begruendung, erster_tag, letzter_tag, anzahl_tage, brauchbare_tage, status, dokument_url, abzug_vorjahr, abzug_aktuell, gruppe_id'
      )
      .order('erstellt_am', { ascending: false })
    setAntraege(data ?? [])
    setLadeVorgang(false)
  }

  useEffect(() => {
    laden()
  }, [neuLadenAuslöser])

  const gruppenMap = new Map<string, Antrag[]>()
  for (const antrag of antraege) {
    const schluessel = antrag.gruppe_id ?? antrag.id
    if (!gruppenMap.has(schluessel)) gruppenMap.set(schluessel, [])
    gruppenMap.get(schluessel)!.push(antrag)
  }
  const gruppen: Gruppe[] = Array.from(gruppenMap.entries()).map(([schluessel, zeilen]) => ({
    schluessel,
    name: zeilen[0].name,
    status: zeilen[0].status,
    zeilen: zeilen.sort((a, b) => (a.erster_tag ?? '').localeCompare(b.erster_tag ?? '')),
  }))

  // Jahres-Reiter: Jahre aller Anträge plus das aktuelle Jahr
  const aktuellesJahr = new Date().getFullYear()
  const jahre = Array.from(new Set([aktuellesJahr, ...gruppen.map((g) => jahrDerGruppe(g))])).sort((a, b) => a - b)
  const offeneProJahr = new Map<number, number>()
  for (const g of gruppen) {
    if (g.status === 'offen') offeneProJahr.set(jahrDerGruppe(g), (offeneProJahr.get(jahrDerGruppe(g)) ?? 0) + 1)
  }
  const jahreMitOffenen = jahre.filter((j) => (offeneProJahr.get(j) ?? 0) > 0)
  // Voreinstellung: das aktuelle Jahr, wenn dort etwas offen ist, sonst das erste Jahr mit offenen Anträgen, sonst das aktuelle Jahr
  const vorgabeJahr = jahreMitOffenen.includes(aktuellesJahr) ? aktuellesJahr : jahreMitOffenen[0] ?? aktuellesJahr
  const aktivesJahr: number | 'alle' = jahrFilter !== null && (jahrFilter === 'alle' || jahre.includes(jahrFilter)) ? jahrFilter : vorgabeJahr
  const anzahlImJahr = (j: number) => gruppen.filter((g) => jahrDerGruppe(g) === j).length

  function gesamtTage(gruppe: Gruppe) {
    return gruppe.zeilen.reduce((summe, z) => summe + (z.brauchbare_tage ?? z.anzahl_tage ?? 0), 0)
  }

  async function statusAendern(gruppe: Gruppe, neuerStatus: string) {
    const ids = gruppe.zeilen.map((z) => z.id)
    const warGenehmigt = gruppe.status === 'genehmigt'
    const wirdGenehmigt = neuerStatus === 'genehmigt'
    const tageGesamt = gesamtTage(gruppe)
    const jahr = jahrDerGruppe(gruppe)

    if (wirdGenehmigt && !warGenehmigt) {
      const hinweise = await konfliktPruefen(gruppe.zeilen, gruppe.name)
      if (hinweise.length > 0) {
        const weiter = await bestaetigen(hinweise.map((h) => '• ' + h).join('\n\n') + '\n\nTrotzdem genehmigen?', {
          titel: 'Achtung: mögliche Konflikte',
          jaText: 'Trotzdem genehmigen',
        })
        if (!weiter) return
      }
    }

    if (gruppe.name && !warGenehmigt && wirdGenehmigt) {
      const jahresdaten = await holeOderErstelleJahresdaten(gruppe.name, jahr)

      await supabase
        .from('urlaubsantraege')
        .update({ status: neuerStatus, abzug_vorjahr: 0, abzug_aktuell: 0 })
        .in('id', ids)

      if (jahresdaten) {
        await supabase
          .from('mitarbeiter_jahresdaten')
          .update({
            resturlaub: (jahresdaten.resturlaub ?? 0) - tageGesamt,
          })
          .eq('id', jahresdaten.id)

        await supabase
          .from('urlaubsantraege')
          .update({ abzug_vorjahr: 0, abzug_aktuell: tageGesamt })
          .eq('id', ids[0])
      }
    } else if (gruppe.name && warGenehmigt && !wirdGenehmigt) {
      const abzugVorjahrGesamt = gruppe.zeilen.reduce((s, z) => s + (z.abzug_vorjahr ?? 0), 0)
      const abzugAktuellGesamt = gruppe.zeilen.reduce((s, z) => s + (z.abzug_aktuell ?? 0), 0)

      const jahresdaten = await holeOderErstelleJahresdaten(gruppe.name, jahr)

      if (jahresdaten) {
        await supabase
          .from('mitarbeiter_jahresdaten')
          .update({
            resturlaub_vorjahr: (jahresdaten.resturlaub_vorjahr ?? 0) + abzugVorjahrGesamt,
            resturlaub: (jahresdaten.resturlaub ?? 0) + abzugAktuellGesamt,
          })
          .eq('id', jahresdaten.id)
      }

      await supabase
        .from('urlaubsantraege')
        .update({ status: neuerStatus, abzug_vorjahr: 0, abzug_aktuell: 0 })
        .in('id', ids)
    } else {
      await supabase.from('urlaubsantraege').update({ status: neuerStatus }).in('id', ids)
    }

    await laden()
    onGeaendert()
  }

  async function gruppeLoeschen(gruppe: Gruppe) {
    const bestaetigt = await bestaetigen(
      `Antrag von "${gruppe.name ?? 'Ohne Namen'}" (${gruppe.zeilen.length} Zeitraum/Zeiträume) wirklich unwiderruflich löschen?`,
      { titel: 'Antrag löschen', jaText: 'Ja, löschen', gefahr: true }
    )
    if (!bestaetigt) return

    if (gruppe.status === 'genehmigt' && gruppe.name) {
      const jahr = jahrDerGruppe(gruppe)
      const abzugVorjahrGesamt = gruppe.zeilen.reduce((s, z) => s + (z.abzug_vorjahr ?? 0), 0)
      const abzugAktuellGesamt = gruppe.zeilen.reduce((s, z) => s + (z.abzug_aktuell ?? 0), 0)

      const jahresdaten = await holeOderErstelleJahresdaten(gruppe.name, jahr)

      if (jahresdaten) {
        await supabase
          .from('mitarbeiter_jahresdaten')
          .update({
            resturlaub_vorjahr: (jahresdaten.resturlaub_vorjahr ?? 0) + abzugVorjahrGesamt,
            resturlaub: (jahresdaten.resturlaub ?? 0) + abzugAktuellGesamt,
          })
          .eq('id', jahresdaten.id)
      }
    }

    const dokumentUrl = gruppe.zeilen[0].dokument_url
    if (dokumentUrl) {
      await supabase.storage.from('urlaubsantraege-dokumente').remove([dokumentUrl])
    }
    await supabase
      .from('urlaubsantraege')
      .delete()
      .in('id', gruppe.zeilen.map((z) => z.id))
    await laden()
    onGeaendert()
  }

  function pdfDialogOeffnen(gruppe: Gruppe) {
    const erste = gruppe.zeilen[0]
    setPdfDialogSchluessel(gruppe.schluessel)
    setPdfBearbeitetVon(erste.bearbeitet_von ?? '')
    setPdfDatum(erste.datum_bearbeiter ?? new Date().toISOString().slice(0, 10))
    setPdfAblehnungBegruendung(erste.ablehnung_begruendung ?? '')
  }

  async function pdfGenerieren(gruppe: Gruppe) {
    const ids = gruppe.zeilen.map((z) => z.id)
    const istAbgelehnt = gruppe.status === 'abgelehnt'

    await supabase
      .from('urlaubsantraege')
      .update({
        bearbeitet_von: pdfBearbeitetVon,
        datum_bearbeiter: pdfDatum,
        ablehnung_begruendung: istAbgelehnt ? pdfAblehnungBegruendung : null,
      })
      .in('id', ids)

    const erste = gruppe.zeilen[0]
    erstelleUrlaubsantragPdf(
      {
        name: gruppe.name,
        vorgesetzter: erste.vorgesetzter,
        funktion_bereich: erste.funktion_bereich,
        urlaubsart: erste.urlaubsart,
        urlaubsart_begruendung: erste.urlaubsart_begruendung,
        jahr: erste.jahr,
        urlaubsanspruch: erste.urlaubsanspruch,
        verplant: erste.verplant,
        rest: erste.rest,
        resturlaub_vorjahr: erste.resturlaub_vorjahr,
        datum_antragsteller: erste.datum_antragsteller,
        zeilen: gruppe.zeilen,
      },
      {
        genehmigt: !istAbgelehnt,
        bearbeitetVon: pdfBearbeitetVon,
        datum: pdfDatum,
        ablehnungBegruendung: istAbgelehnt ? pdfAblehnungBegruendung : '',
      }
    )

    setPdfDialogSchluessel(null)
    await laden()
  }

  function zeitraumDialogOeffnen(gruppe: Gruppe) {
    setZeitraumDialogSchluessel(gruppe.schluessel)
    setNeuerZeitraumVon('')
    setNeuerZeitraumBis('')
    setFehler(null)
  }

  const neuerZeitraumTage = berechneBrauchbareTage(
    neuerZeitraumVon || null,
    neuerZeitraumBis || null
  )

  async function zeitraumHinzufuegen(gruppe: Gruppe) {
    if (!neuerZeitraumVon || !neuerZeitraumBis) {
      setFehler('Bitte Von- und Bis-Datum angeben.')
      return
    }
    if (neuerZeitraumBis < neuerZeitraumVon) {
      setFehler('Das Bis-Datum liegt vor dem Von-Datum.')
      return
    }

    setZeitraumWirdGespeichert(true)
    setFehler(null)

    try {
      const erste = gruppe.zeilen[0]
      const brauchbareTage = berechneBrauchbareTage(neuerZeitraumVon, neuerZeitraumBis) ?? 0

      const { data: neueZeile, error: einfuegenFehler } = await supabase
        .from('urlaubsantraege')
        .insert({
          mitarbeiter_id: erste.mitarbeiter_id,
          name: erste.name,
          vorgesetzter: erste.vorgesetzter,
          funktion_bereich: erste.funktion_bereich,
          urlaubsart: erste.urlaubsart,
          urlaubsart_begruendung: erste.urlaubsart_begruendung,
          jahr: erste.jahr,
          urlaubsanspruch: erste.urlaubsanspruch,
          verplant: erste.verplant,
          rest: erste.rest,
          resturlaub_vorjahr: erste.resturlaub_vorjahr,
          datum_antragsteller: erste.datum_antragsteller,
          bearbeitet_von: erste.bearbeitet_von,
          datum_bearbeiter: erste.datum_bearbeiter,
          ablehnung_begruendung: erste.ablehnung_begruendung,
          erster_tag: neuerZeitraumVon,
          letzter_tag: neuerZeitraumBis,
          anzahl_tage: null,
          brauchbare_tage: brauchbareTage,
          status: gruppe.status,
          dokument_url: null,
          gruppe_id: gruppe.schluessel,
          abzug_vorjahr: 0,
          abzug_aktuell: 0,
        })
        .select('id')
        .single()

      if (einfuegenFehler) throw new Error('Speichern: ' + einfuegenFehler.message)

      if (gruppe.status === 'genehmigt' && gruppe.name && brauchbareTage > 0) {
        const jahr = jahrDerGruppe(gruppe)
        const jahresdaten = await holeOderErstelleJahresdaten(gruppe.name, jahr)

        if (jahresdaten) {
          await supabase
            .from('mitarbeiter_jahresdaten')
            .update({ resturlaub: (jahresdaten.resturlaub ?? 0) - brauchbareTage })
            .eq('id', jahresdaten.id)

          await supabase
            .from('urlaubsantraege')
            .update({ abzug_aktuell: brauchbareTage })
            .eq('id', neueZeile.id)
        }
      }

      setZeitraumDialogSchluessel(null)
      setNeuerZeitraumVon('')
      setNeuerZeitraumBis('')
      await laden()
      onGeaendert()
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Fehler beim Hinzufügen')
    } finally {
      setZeitraumWirdGespeichert(false)
    }
  }

  if (ladeVorgang) {
    return <p style={{ color: 'var(--text-muted)' }}>Lade Anträge...</p>
  }

  const reiterStil = (aktiv: boolean): React.CSSProperties => ({
    background: aktiv ? 'var(--navy)' : '#eef2f8',
    color: aktiv ? '#ffffff' : 'var(--navy)',
    border: 'none',
    borderRadius: 999,
    padding: '6px 14px',
    fontSize: 13,
    fontWeight: aktiv ? 600 : 500,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
  })

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
        {[...jahre].reverse().map((j) => {
          const offen = offeneProJahr.get(j) ?? 0
          return (
            <button key={j} onClick={() => setJahrFilter(j)} style={reiterStil(aktivesJahr === j)} title={`${anzahlImJahr(j)} Anträge in ${j}`}>
              {j}
              {offen > 0 && (
                <span
                  style={{
                    background: 'var(--warning)',
                    color: '#ffffff',
                    borderRadius: 999,
                    fontSize: 11,
                    fontWeight: 700,
                    minWidth: 18,
                    padding: '0 5px',
                    textAlign: 'center',
                  }}
                  title="Nicht bearbeitete Anträge"
                >
                  {offen}
                </span>
              )}
            </button>
          )
        })}
        <button onClick={() => setJahrFilter('alle')} style={reiterStil(aktivesJahr === 'alle')}>
          Alle Jahre
        </button>
      </div>

    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        gap: 16,
      }}
    >
      {SPALTEN.map((spalte) => {
        const gefiltert = gruppen.filter(
          (g) => g.status === spalte.status && (aktivesJahr === 'alle' || jahrDerGruppe(g) === aktivesJahr)
        )
        return (
          <div key={spalte.status}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 10,
                fontWeight: 600,
                fontSize: 14,
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: spalte.farbe,
                  display: 'inline-block',
                }}
              />
              {spalte.titel}
              <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 400 }}>
                ({gefiltert.length})
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {gefiltert.length === 0 && (
                <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>—</p>
              )}

              {gefiltert.map((gruppe) => (
                <div
                  key={gruppe.schluessel}
                  style={{
                    padding: '12px 14px',
                    background: 'var(--card)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 500 }}>{gruppe.name ?? 'Ohne Namen'}</div>
                      {gruppe.zeilen[0].urlaubsart && (
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          {gruppe.zeilen[0].urlaubsart}
                        </div>
                      )}
                      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
                        {gruppe.zeilen.map((z) => (
                          <div key={z.id}>
                            {z.erster_tag} – {z.letzter_tag} ({z.brauchbare_tage ?? z.anzahl_tage ?? '–'} Arbeitstage)
                          </div>
                        ))}
                        <div style={{ fontWeight: 500, marginTop: 2 }}>
                          Gesamt: {gesamtTage(gruppe)} Arbeitstage
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => gruppeLoeschen(gruppe)}
                      title="Antrag löschen"
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--text-muted)',
                        cursor: 'pointer',
                        fontSize: 16,
                        lineHeight: 1,
                        padding: 2,
                      }}
                    >
                      ✕
                    </button>
                  </div>

                  {spalte.status === 'offen' && (
                    <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                      <button
                        onClick={() => statusAendern(gruppe, 'genehmigt')}
                        style={aktionsKnopfStil('var(--success)')}
                      >
                        Genehmigen
                      </button>
                      <button
                        onClick={() => statusAendern(gruppe, 'abgelehnt')}
                        style={aktionsKnopfStil('var(--danger)')}
                      >
                        Ablehnen
                      </button>
                      <button
                        onClick={() => zeitraumDialogOeffnen(gruppe)}
                        style={aktionsKnopfStil('var(--navy)')}
                      >
                        + Zeitraum
                      </button>
                    </div>
                  )}

                  {spalte.status !== 'offen' && (
                    <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                      <button
                        onClick={() => statusAendern(gruppe, 'offen')}
                        style={aktionsKnopfStil('var(--text-muted)')}
                      >
                        Zurücksetzen
                      </button>
                      <button
                        onClick={() => pdfDialogOeffnen(gruppe)}
                        style={aktionsKnopfStil('var(--navy)')}
                      >
                        📄 PDF erstellen
                      </button>
                      <button
                        onClick={() => zeitraumDialogOeffnen(gruppe)}
                        style={aktionsKnopfStil('var(--navy)')}
                      >
                        + Zeitraum
                      </button>
                    </div>
                  )}

                  {zeitraumDialogSchluessel === gruppe.schluessel && (
                    <div
                      style={{
                        marginTop: 10,
                        padding: 10,
                        background: '#f8fafc',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                      }}
                    >
                      <div style={{ display: 'flex', gap: 8 }}>
                        <label style={{ ...beschriftungStil, flex: 1 }}>
                          Von
                          <input
                            type="date"
                            value={neuerZeitraumVon}
                            onChange={(e) => setNeuerZeitraumVon(e.target.value)}
                            style={eingabeStil}
                          />
                        </label>
                        <label style={{ ...beschriftungStil, flex: 1 }}>
                          Bis
                          <input
                            type="date"
                            value={neuerZeitraumBis}
                            onChange={(e) => setNeuerZeitraumBis(e.target.value)}
                            style={eingabeStil}
                          />
                        </label>
                      </div>
                      {neuerZeitraumVon && neuerZeitraumBis && (
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          Berechnete Arbeitstage: <strong>{neuerZeitraumTage ?? '–'}</strong>
                          {spalte.status === 'genehmigt' && (
                            <> – wird sofort vom Resturlaub abgezogen</>
                          )}
                        </div>
                      )}
                      {fehler && <div style={{ color: 'var(--danger)', fontSize: 12 }}>{fehler}</div>}
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          onClick={() => zeitraumHinzufuegen(gruppe)}
                          disabled={zeitraumWirdGespeichert}
                          style={{
                            background: 'var(--navy)',
                            color: '#ffffff',
                            border: 'none',
                            borderRadius: 6,
                            padding: '6px 12px',
                            fontSize: 12,
                            cursor: 'pointer',
                          }}
                        >
                          Hinzufügen
                        </button>
                        <button
                          onClick={() => {
                            setZeitraumDialogSchluessel(null)
                            setFehler(null)
                          }}
                          style={aktionsKnopfStil('var(--text-muted)')}
                        >
                          Abbrechen
                        </button>
                      </div>
                    </div>
                  )}

                  {pdfDialogSchluessel === gruppe.schluessel && (
                    <div
                      style={{
                        marginTop: 10,
                        padding: 10,
                        background: '#f8fafc',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                      }}
                    >
                      <label style={beschriftungStil}>
                        Name in Blockbuchstaben (Vorgesetzter)
                        <input
                          value={pdfBearbeitetVon}
                          onChange={(e) => setPdfBearbeitetVon(e.target.value)}
                          style={eingabeStil}
                          placeholder="Name des Genehmigers/Ablehnenden"
                        />
                      </label>
                      <label style={beschriftungStil}>
                        Datum
                        <input
                          type="date"
                          value={pdfDatum}
                          onChange={(e) => setPdfDatum(e.target.value)}
                          style={eingabeStil}
                        />
                      </label>
                      {spalte.status === 'abgelehnt' && (
                        <label style={beschriftungStil}>
                          Begründung bei Ablehnung
                          <textarea
                            value={pdfAblehnungBegruendung}
                            onChange={(e) => setPdfAblehnungBegruendung(e.target.value)}
                            style={{ ...eingabeStil, minHeight: 60, resize: 'vertical' }}
                          />
                        </label>
                      )}
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button
                          onClick={() => pdfGenerieren(gruppe)}
                          style={{
                            background: 'var(--navy)',
                            color: '#ffffff',
                            border: 'none',
                            borderRadius: 6,
                            padding: '6px 12px',
                            fontSize: 12,
                            cursor: 'pointer',
                          }}
                        >
                          PDF generieren
                        </button>
                        <button
                          onClick={() => setPdfDialogSchluessel(null)}
                          style={aktionsKnopfStil('var(--text-muted)')}
                        >
                          Abbrechen
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
    </div>
  )
}

function aktionsKnopfStil(farbe: string): React.CSSProperties {
  return {
    background: 'none',
    border: `1px solid ${farbe}`,
    color: farbe,
    borderRadius: 6,
    padding: '4px 10px',
    fontSize: 12,
    cursor: 'pointer',
  }
}

const beschriftungStil: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 500,
  color: 'var(--text-muted)',
}

const eingabeStil: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  border: '1px solid var(--border)',
  borderRadius: 4,
  fontSize: 13,
  marginTop: 2,
}