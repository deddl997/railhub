import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'

interface Person {
  id: string
  name: string
}

interface Jahresdaten {
  mitarbeiter_id: string
  jahr: number
  urlaubsanspruch: number | null
  resturlaub: number | null
  resturlaub_vorjahr: number | null
}

interface AntragKurz {
  mitarbeiter_id: string | null
  anzahl_tage: number | null
  brauchbare_tage: number | null
}

const zahlText = (v: number) => v.toLocaleString('de-DE', { maximumFractionDigits: 2 })
const zahl = (v: unknown) => (typeof v === 'number' ? v : Number(v ?? 0) || 0)

export default function Jahreswechsel() {
  const heute = new Date()
  const [von, setVon] = useState(heute.getFullYear())
  const [personen, setPersonen] = useState<Person[]>([])
  const [alt, setAlt] = useState<Jahresdaten[]>([])
  const [neu, setNeu] = useState<Jahresdaten[]>([])
  const [antraege, setAntraege] = useState<AntragKurz[]>([])
  const [anspruchNeu, setAnspruchNeu] = useState<Record<string, string>>({})
  const [aktiv, setAktiv] = useState<Record<string, boolean>>({})
  const [maxUebertrag, setMaxUebertrag] = useState('')
  const [laedt, setLaedt] = useState(true)
  const [fehler, setFehler] = useState<string | null>(null)
  const [meldung, setMeldung] = useState<string | null>(null)
  const [zaehler, setZaehler] = useState(0)

  const nach = von + 1

  useEffect(() => {
    async function laden() {
      setLaedt(true)
      setFehler(null)
      const [p, j, a] = await Promise.all([
        supabase.from('mitarbeiter').select('id, name').order('name'),
        supabase
          .from('mitarbeiter_jahresdaten')
          .select('mitarbeiter_id, jahr, urlaubsanspruch, resturlaub, resturlaub_vorjahr')
          .in('jahr', [von, nach]),
        supabase
          .from('urlaubsantraege')
          .select('mitarbeiter_id, anzahl_tage, brauchbare_tage')
          .eq('status', 'genehmigt')
          .gte('erster_tag', `${von}-01-01`)
          .lte('erster_tag', `${von}-12-31`),
      ])
      const err = p.error ?? j.error ?? a.error
      if (err) {
        setFehler(err.message)
        setLaedt(false)
        return
      }
      const liste = (p.data ?? []) as Person[]
      const jd = (j.data ?? []) as Jahresdaten[]
      const altListe = jd.filter((x) => x.jahr === von)
      setPersonen(liste)
      setAlt(altListe)
      setNeu(jd.filter((x) => x.jahr === nach))
      setAntraege((a.data ?? []) as AntragKurz[])
      setAnspruchNeu(
        Object.fromEntries(liste.map((x) => [x.id, String(altListe.find((d) => d.mitarbeiter_id === x.id)?.urlaubsanspruch ?? 30).replace('.', ',')]))
      )
      setAktiv(Object.fromEntries(liste.map((x) => [x.id, true])))
      setLaedt(false)
    }
    laden()
  }, [von, nach, zaehler])

  const cap = maxUebertrag.trim() === '' ? null : Number(maxUebertrag.replace(',', '.'))
  const capGueltig = cap === null || (Number.isFinite(cap) && cap >= 0)

  const zeilen = personen.map((p) => {
    const a = alt.find((d) => d.mitarbeiter_id === p.id)
    const n = neu.find((d) => d.mitarbeiter_id === p.id)
    const genehmigt = antraege
      .filter((x) => x.mitarbeiter_id === p.id)
      .reduce((s, x) => s + zahl(x.brauchbare_tage ?? x.anzahl_tage), 0)
    const restAktuell = a ? zahl(a.resturlaub) : 30 - genehmigt
    const restVorjahr = a ? zahl(a.resturlaub_vorjahr) : 0
    const gesamt = restAktuell + restVorjahr
    const anspruch = Number((anspruchNeu[p.id] ?? '30').replace(',', '.'))
    let uebertrag = Math.max(gesamt, 0)
    if (cap !== null && capGueltig) uebertrag = Math.min(uebertrag, cap)
    const verfaellt = Math.max(gesamt, 0) - uebertrag
    return {
      p,
      standard: !a,
      restAktuell,
      restVorjahr,
      gesamt,
      uebertrag,
      verfaellt,
      anspruch,
      vorhanden: n,
      restAktuellNeu: anspruch + Math.min(gesamt, 0),
    }
  })

  const gewaehlt = zeilen.filter((z) => aktiv[z.p.id] && Number.isFinite(z.anspruch))
  const summeUebertrag = gewaehlt.reduce((s, z) => s + z.uebertrag, 0)

  async function uebernehmen() {
    if (!capGueltig) {
      setFehler('Die Obergrenze für den Übertrag ist keine gültige Zahl.')
      return
    }
    const text =
      `Resturlaub ${von} → ${nach} für ${gewaehlt.length} Personen übernehmen?\n` +
      `Gesamt werden ${zahlText(summeUebertrag)} Tage übertragen.\n\n` +
      `Wo ${nach} schon Daten hat, wird nur „Rest Vorjahr“ gesetzt.`
    if (!window.confirm(text)) return
    setLaedt(true)
    setFehler(null)
    setMeldung(null)
    const { data, error } = await supabase.rpc('admin_jahreswechsel', {
      p_nach: nach,
      p_zeilen: gewaehlt.map((z) => ({
        mitarbeiter_id: z.p.id,
        anspruch: z.anspruch,
        uebertrag: z.uebertrag,
        rest_aktuell: z.restAktuellNeu,
      })),
    })
    if (error) {
      setLaedt(false)
      setFehler(
        error.message.includes('admin_jahreswechsel')
          ? 'Die Datenbank-Funktion fehlt noch. Bitte jahreswechsel.sql im Supabase SQL Editor ausführen.'
          : error.message
      )
      return
    }
    const r = data as { neu_angelegt: number; aktualisiert: number }
    setMeldung(`Fertig: ${r.neu_angelegt} Personen neu für ${nach} angelegt, bei ${r.aktualisiert} wurde „Rest Vorjahr“ aktualisiert.`)
    setZaehler((z) => z + 1)
  }

  const zelle: React.CSSProperties = { padding: '6px 8px', borderBottom: '1px solid #eef2f8', fontSize: 12.5, textAlign: 'left', verticalAlign: 'middle' }
  const rechts: React.CSSProperties = { ...zelle, textAlign: 'right', whiteSpace: 'nowrap' }
  const feld: React.CSSProperties = { padding: '5px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13 }

  return (
    <div>
      <p style={{ fontSize: 13, color: '#475569', marginTop: 0 }}>
        Überträgt den Resturlaub (laufendes Jahr plus Rest Vorjahr) ins nächste Jahr. Bei einem Minus wird es vom neuen Anspruch abgezogen. Du siehst vorher, was passiert,
        und kannst den neuen Anspruch pro Person anpassen.
      </p>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <label style={{ fontSize: 13 }}>
          Von{' '}
          <select value={von} onChange={(e) => setVon(Number(e.target.value))} style={feld}>
            {[heute.getFullYear() - 1, heute.getFullYear(), heute.getFullYear() + 1].map((j) => (
              <option key={j} value={j}>
                {j} → {j + 1}
              </option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: 13 }}>
          Höchstens{' '}
          <input
            value={maxUebertrag}
            onChange={(e) => setMaxUebertrag(e.target.value)}
            placeholder="alle"
            style={{ ...feld, width: 70, textAlign: 'right', borderColor: capGueltig ? '#cbd5e1' : '#dc2626' }}
          />{' '}
          Tage übertragen (leer = alles)
        </label>
        {laedt && <span style={{ fontSize: 12, color: '#64748b' }}>Lade...</span>}
      </div>
      {fehler && <div style={{ background: '#fee2e2', color: '#991b1b', padding: '8px 12px', borderRadius: 8, fontSize: 13, marginBottom: 10 }}>{fehler}</div>}
      {meldung && <div style={{ background: '#dcfce7', color: '#166534', padding: '8px 12px', borderRadius: 8, fontSize: 13, marginBottom: 10 }}>{meldung}</div>}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 820 }}>
          <thead>
            <tr style={{ background: '#f1f5f9' }}>
              <th style={zelle}></th>
              <th style={zelle}>Mitarbeiter</th>
              <th style={rechts}>Rest {von}</th>
              <th style={rechts}>Übertrag</th>
              <th style={rechts}>Anspruch {nach}</th>
              <th style={rechts}>Ergebnis {nach}</th>
              <th style={zelle}>Hinweis</th>
            </tr>
          </thead>
          <tbody>
            {zeilen.map((z) => (
              <tr key={z.p.id} style={{ opacity: aktiv[z.p.id] ? 1 : 0.5 }}>
                <td style={zelle}>
                  <input type="checkbox" checked={!!aktiv[z.p.id]} onChange={(e) => setAktiv((a) => ({ ...a, [z.p.id]: e.target.checked }))} />
                </td>
                <td style={zelle}>
                  <b>{z.p.name}</b>
                </td>
                <td style={rechts}>
                  <b style={{ color: z.gesamt < 0 ? '#b91c1c' : undefined }}>{zahlText(z.gesamt)}</b>
                  {z.restVorjahr !== 0 && <div style={{ fontSize: 10.5, color: '#64748b' }}>davon Vorjahr {zahlText(z.restVorjahr)}</div>}
                </td>
                <td style={rechts}>
                  {zahlText(z.uebertrag)}
                  {z.verfaellt > 0 && <div style={{ fontSize: 10.5, color: '#b45309' }}>{zahlText(z.verfaellt)} verfallen</div>}
                </td>
                <td style={rechts}>
                  {z.vorhanden ? (
                    zahlText(zahl(z.vorhanden.urlaubsanspruch))
                  ) : (
                    <input
                      value={anspruchNeu[z.p.id] ?? ''}
                      onChange={(e) => setAnspruchNeu((a) => ({ ...a, [z.p.id]: e.target.value }))}
                      style={{ ...feld, width: 64, textAlign: 'right', borderColor: Number.isFinite(z.anspruch) ? '#cbd5e1' : '#dc2626' }}
                    />
                  )}
                </td>
                <td style={rechts}>
                  <b>
                    {zahlText(
                      z.vorhanden
                        ? zahl(z.vorhanden.resturlaub) + z.uebertrag
                        : z.restAktuellNeu + z.uebertrag
                    )}
                  </b>
                  <div style={{ fontSize: 10.5, color: '#64748b' }}>davon Vorjahr {zahlText(z.uebertrag)}</div>
                </td>
                <td style={{ ...zelle, fontSize: 11.5, color: '#64748b' }}>
                  {z.vorhanden && `${nach} gibt es schon: nur Rest Vorjahr wird gesetzt`}
                  {!z.vorhanden && z.gesamt < 0 && 'Minus wird vom neuen Anspruch abgezogen'}
                  {z.standard && !z.vorhanden && z.gesamt >= 0 && `Keine Daten ${von}, Standard (30 Tage) angenommen`}
                </td>
              </tr>
            ))}
            {!laedt && zeilen.length === 0 && (
              <tr>
                <td style={zelle} colSpan={7}>
                  <span style={{ color: '#94a3b8' }}>Keine Mitarbeiter gefunden.</span>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 14, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          onClick={uebernehmen}
          disabled={laedt || gewaehlt.length === 0}
          style={{
            padding: '9px 20px',
            borderRadius: 8,
            border: 'none',
            background: '#14325c',
            color: '#fff',
            fontWeight: 600,
            fontSize: 14,
            cursor: 'pointer',
            opacity: laedt || gewaehlt.length === 0 ? 0.5 : 1,
          }}
        >
          Resturlaub {von} → {nach} übernehmen ({gewaehlt.length} Personen)
        </button>
        <span style={{ fontSize: 12, color: '#64748b' }}>Mehrfaches Übernehmen ist ungefährlich: Das Ergebnis bleibt gleich.</span>
      </div>
    </div>
  )
}
