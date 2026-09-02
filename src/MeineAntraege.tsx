import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'

interface Antrag {
  id: string
  name: string | null
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

async function holeOderErstelleJahresdaten(name: string, jahr: number) {
  const { data: mitarbeiter } = await supabase
    .from('mitarbeiter')
    .select('id')
    .ilike('name', name)
    .maybeSingle()

  if (!mitarbeiter) return null

  const { data: jahresdaten } = await supabase
    .from('mitarbeiter_jahresdaten')
    .select('id, resturlaub, resturlaub_vorjahr')
    .eq('mitarbeiter_id', mitarbeiter.id)
    .eq('jahr', jahr)
    .maybeSingle()

  if (jahresdaten) return jahresdaten

  const { data: neueDaten } = await supabase
    .from('mitarbeiter_jahresdaten')
    .insert({
      mitarbeiter_id: mitarbeiter.id,
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

  async function laden() {
    setLadeVorgang(true)
    const { data } = await supabase
      .from('urlaubsantraege')
      .select(
        'id, name, erster_tag, letzter_tag, anzahl_tage, brauchbare_tage, status, dokument_url, abzug_vorjahr, abzug_aktuell, gruppe_id'
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
        const vorjahrVerfuegbar = jahresdaten.resturlaub_vorjahr ?? 0
        const abzugVorjahr = Math.min(vorjahrVerfuegbar, tageGesamt)
        const abzugAktuell = tageGesamt - abzugVorjahr

        await supabase
          .from('mitarbeiter_jahresdaten')
          .update({
            resturlaub_vorjahr: vorjahrVerfuegbar - abzugVorjahr,
            resturlaub: (jahresdaten.resturlaub ?? 0) - abzugAktuell,
          })
          .eq('id', jahresdaten.id)

        await supabase
          .from('urlaubsantraege')
          .update({ abzug_vorjahr: abzugVorjahr, abzug_aktuell: abzugAktuell })
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
                    <button
                      onClick={() => statusAendern(gruppe, 'offen')}
                      style={{ ...aktionsKnopfStil('var(--text-muted)'), marginTop: 8 }}
                    >
                      Zurücksetzen
                    </button>
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
