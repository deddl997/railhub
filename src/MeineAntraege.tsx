import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import { namensSignatur } from './namensAbgleich'
import { erstelleUrlaubsantragPdf } from './pdfErstellung'

interface Antrag {
  id: string
  name: string | null
  kategorie: string | null
  jahr: number | null
  urlaubsanspruch: number | null
  verplant: number | null
  rest: number | null
  resturlaub_vorjahr: number | null
  ort_antragsteller: string | null
  datum_antragsteller: string | null
  bearbeitet_von: string | null
  ort_bearbeiter: string | null
  datum_bearbeiter: string | null
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

  const [pdfDialogSchluessel, setPdfDialogSchluessel] = useState<string | null>(null)
  const [pdfBearbeitetVon, setPdfBearbeitetVon] = useState('')
  const [pdfOrt, setPdfOrt] = useState('')
  const [pdfDatum, setPdfDatum] = useState('')

  async function laden() {
    setLadeVorgang(true)
    const { data } = await supabase
      .from('urlaubsantraege')
      .select(
        'id, name, kategorie, jahr, urlaubsanspruch, verplant, rest, resturlaub_vorjahr, ort_antragsteller, datum_antragsteller, bearbeitet_von, ort_bearbeiter, datum_bearbeiter, erster_tag, letzter_tag, anzahl_tage, brauchbare_tage, status, dokument_url, abzug_vorjahr, abzug_aktuell, gruppe_id'
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

  function gesamtTage(gruppe: Gruppe) {
    return gruppe.zeilen.reduce((summe, z) => summe + (z.brauchbare_tage ?? z.anzahl_tage ?? 0), 0)
  }

  async function statusAendern(gruppe: Gruppe, neuerStatus: string) {
    const ids = gruppe.zeilen.map((z) => z.id)
    const warGenehmigt = gruppe.status === 'genehmigt'
    const wirdGenehmigt = neuerStatus === 'genehmigt'
    const tageGesamt = gesamtTage(gruppe)
    const jahr = jahrDerGruppe(gruppe)

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
    const bestaetigt = window.confirm(
      `Antrag von "${gruppe.name ?? 'Ohne Namen'}" (${gruppe.zeilen.length} Zeitraum/Zeiträume) wirklich unwiderruflich löschen?`
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
    setPdfOrt(erste.ort_bearbeiter ?? '')
    setPdfDatum(erste.datum_bearbeiter ?? new Date().toISOString().slice(0, 10))
  }

  async function pdfGenerieren(gruppe: Gruppe) {
    const ids = gruppe.zeilen.map((z) => z.id)
    await supabase
      .from('urlaubsantraege')
      .update({
        bearbeitet_von: pdfBearbeitetVon,
        ort_bearbeiter: pdfOrt,
        datum_bearbeiter: pdfDatum,
      })
      .in('id', ids)

    const erste = gruppe.zeilen[0]
    erstelleUrlaubsantragPdf(
      {
        name: gruppe.name,
        kategorie: erste.kategorie,
        jahr: erste.jahr,
        urlaubsanspruch: erste.urlaubsanspruch,
        verplant: erste.verplant,
        rest: erste.rest,
        resturlaub_vorjahr: erste.resturlaub_vorjahr,
        ort_antragsteller: erste.ort_antragsteller,
        datum_antragsteller: erste.datum_antragsteller,
        zeilen: gruppe.zeilen,
      },
      { bearbeitetVon: pdfBearbeitetVon, ort: pdfOrt, datum: pdfDatum }
    )

    setPdfDialogSchluessel(null)
    await laden()
  }

  if (ladeVorgang) {
    return <p style={{ color: 'var(--text-muted)' }}>Lade Anträge...</p>
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        gap: 16,
      }}
    >
      {SPALTEN.map((spalte) => {
        const gefiltert = gruppen.filter((g) => g.status === spalte.status)
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
                      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
                        {gruppe.zeilen.map((z) => (
                          <div key={z.id}>
                            {z.erster_tag} – {z.letzter_tag} ({z.brauchbare_tage ?? z.anzahl_tage} Arbeitstage)
                          </div>
                        ))}
                        {gruppe.zeilen.length > 1 && (
                          <div style={{ fontWeight: 500, marginTop: 2 }}>
                            Gesamt: {gesamtTage(gruppe)} Arbeitstage
                          </div>
                        )}
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
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
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
                      {spalte.status === 'genehmigt' && (
                        <button
                          onClick={() => pdfDialogOeffnen(gruppe)}
                          style={aktionsKnopfStil('var(--navy)')}
                        >
                          📄 PDF erstellen
                        </button>
                      )}
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
                        Bearbeitet von
                        <input
                          value={pdfBearbeitetVon}
                          onChange={(e) => setPdfBearbeitetVon(e.target.value)}
                          style={eingabeStil}
                          placeholder="Name des Genehmigers"
                        />
                      </label>
                      <label style={beschriftungStil}>
                        Ort
                        <input
                          value={pdfOrt}
                          onChange={(e) => setPdfOrt(e.target.value)}
                          style={eingabeStil}
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
