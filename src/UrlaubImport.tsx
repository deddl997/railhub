import { Fragment, useState } from 'react'
import { supabase } from './lib/supabase'
import { bestaetigen } from './ui'
import { excelLesen, resturlaubVerteilen, bestenTreffer, type ExcelErgebnis } from './urlaubImportLogik'

interface Person {
  id: string
  name: string
  kategorie: string | null
}

interface Bestehend {
  mitarbeiter_id: string
  erster_tag: string
  letzter_tag: string
}

const datumDeutsch = (iso: string) => iso.split('-').reverse().join('.')
const zahlText = (v: number) => v.toLocaleString('de-DE', { maximumFractionDigits: 2 })

export default function UrlaubImport() {
  const [ergebnis, setErgebnis] = useState<ExcelErgebnis | null>(null)
  const [dateiName, setDateiName] = useState('')
  const [personen, setPersonen] = useState<Person[]>([])
  const [bestehend, setBestehend] = useState<Bestehend[]>([])
  const [zuordnung, setZuordnung] = useState<Record<number, string>>({}) // zeile -> mitarbeiter-id | 'neu' | ''
  const [unsicher, setUnsicher] = useState<Record<number, boolean>>({})
  const [aktiv, setAktiv] = useState<Record<number, boolean>>({})
  const [offen, setOffen] = useState<number | null>(null)
  const [urlaubeAnlegen, setUrlaubeAnlegen] = useState(true)
  const [restSetzen, setRestSetzen] = useState(true)
  const [laedt, setLaedt] = useState(false)
  const [importiert, setImportiert] = useState(false)
  const [fehler, setFehler] = useState<string | null>(null)
  const [meldung, setMeldung] = useState<string | null>(null)

  async function dateiGewaehlt(datei: File | undefined) {
    if (!datei) return
    setFehler(null)
    setMeldung(null)
    setLaedt(true)
    try {
      const e = excelLesen(await datei.arrayBuffer())
      const p = await supabase.from('mitarbeiter').select('id, name, kategorie').order('name')
      if (p.error) throw new Error(p.error.message)
      const liste = (p.data ?? []) as Person[]
      const b = await supabase
        .from('urlaubsantraege')
        .select('mitarbeiter_id, erster_tag, letzter_tag')
        .in('status', ['genehmigt', 'offen'])
        .lte('erster_tag', `${e.jahr}-12-31`)
        .gte('letzter_tag', `${e.jahr}-01-01`)
      if (b.error) throw new Error(b.error.message)

      const z: Record<number, string> = {}
      const u: Record<number, boolean> = {}
      const a: Record<number, boolean> = {}
      for (const x of e.personen) {
        const t = bestenTreffer(x.name, liste)
        z[x.zeile] = t.person ? t.person.id : ''
        u[x.zeile] = t.guete === 1
        a[x.zeile] = t.person !== null
      }
      setErgebnis(e)
      setDateiName(datei.name)
      setPersonen(liste)
      setBestehend((b.data ?? []) as Bestehend[])
      setZuordnung(z)
      setUnsicher(u)
      setAktiv(a)
      setImportiert(false)
      setOffen(null)
    } catch (err) {
      setFehler((err as Error).message)
      setErgebnis(null)
    }
    setLaedt(false)
  }

  function ueberschneidet(mitarbeiterId: string, von: string, bis: string): boolean {
    return bestehend.some((x) => x.mitarbeiter_id === mitarbeiterId && x.erster_tag <= bis && x.letzter_tag >= von)
  }

  const zeilen = (ergebnis?.personen ?? []).map((p) => {
    const mid = zuordnung[p.zeile] ?? ''
    const neu = p.bloecke.filter((b) => !(mid && mid !== 'neu' && ueberschneidet(mid, b.von, b.bis)))
    const verteilung = resturlaubVerteilen(p)
    return { p, mid, neu, verteilung, kalenderAbweichung: Math.abs(p.tageKalender - p.genommen) > 0.01 }
  })
  const gewaehlt = zeilen.filter((z) => aktiv[z.p.zeile] && z.mid !== '')
  const doppelt = new Set(
    gewaehlt
      .map((z) => z.mid)
      .filter((m, i, arr) => m !== 'neu' && arr.indexOf(m) !== i)
  )
  const blockSumme = gewaehlt.reduce((s, z) => s + (urlaubeAnlegen ? z.neu.length : 0), 0)

  async function importieren() {
    if (!ergebnis) return
    if (doppelt.size > 0) {
      setFehler('Mindestens zwei Zeilen sind derselben Person zugeordnet. Bitte korrigieren.')
      return
    }
    const text =
      `${gewaehlt.length} Personen importieren` +
      (urlaubeAnlegen ? `, ${blockSumme} Urlaubszeiträume anlegen` : '') +
      (restSetzen ? ', Resturlaub und Anspruch überschreiben' : '') +
      '?\n\nBereits vorhandene Urlaube werden nicht doppelt angelegt.'
    if (!(await bestaetigen(text, { titel: 'Import starten', jaText: 'Ja, importieren' }))) return
    setLaedt(true)
    setFehler(null)
    setMeldung(null)
    const payload = gewaehlt.map((z) => {
      const kat = personen.find((x) => x.id === z.mid)?.kategorie ?? ''
      return {
        mitarbeiter_id: z.mid === 'neu' ? null : z.mid,
        name: z.p.name,
        kategorie: kat,
        anspruch: z.p.anspruch,
        vorjahr: z.p.vorjahr,
        genommen: z.p.genommen,
        rest_gesamt: z.p.rest,
        rest_vorjahr: z.verteilung.restVorjahr,
        rest_aktuell: z.verteilung.restAktuell,
        bloecke: urlaubeAnlegen ? z.p.bloecke : [],
      }
    })
    const { data, error } = await supabase.rpc('admin_urlaub_import', {
      p_jahr: ergebnis.jahr,
      p_personen: payload,
      p_resturlaub_setzen: restSetzen,
    })
    setLaedt(false)
    if (error) {
      setFehler(
        error.message.includes('admin_urlaub_import')
          ? 'Die Datenbank-Funktion fehlt noch. Bitte urlaub_import.sql im Supabase SQL Editor ausführen.'
          : error.message
      )
      return
    }
    const r = data as { personen: number; angelegt: number; uebersprungen: number; neu_angelegt: number }
    setImportiert(true)
    setMeldung(
      `Fertig: ${r.personen} Personen verarbeitet, ${r.angelegt} Urlaubszeiträume angelegt, ${r.uebersprungen} übersprungen (gab es schon)` +
        (r.neu_angelegt > 0 ? `, ${r.neu_angelegt} neue Mitarbeiter angelegt` : '') +
        '.'
    )
  }

  const zelle: React.CSSProperties = { padding: '6px 8px', borderBottom: '1px solid #eef2f8', fontSize: 12.5, textAlign: 'left', verticalAlign: 'middle' }
  const rechts: React.CSSProperties = { ...zelle, textAlign: 'right', whiteSpace: 'nowrap' }

  return (
    <div>
      <p style={{ fontSize: 13, color: '#475569', marginTop: 0 }}>
        Lade den Urlaubsplaner als Excel-Datei hoch (Zeile pro Mitarbeiter, Spalten für Resturlaub Vorjahr, Anspruch, genommen und ein Tageskalender mit U und u).
        Du siehst zuerst eine Vorschau. Erst nach deiner Bestätigung wird etwas gespeichert.
      </p>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <label
          style={{ padding: '8px 16px', borderRadius: 8, background: '#14325c', color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}
        >
          Excel-Datei wählen
          <input type="file" accept=".xlsx,.xlsm" style={{ display: 'none' }} onChange={(e) => dateiGewaehlt(e.target.files?.[0])} />
        </label>
        {dateiName && <span style={{ fontSize: 13, color: '#475569' }}>{dateiName}</span>}
        {laedt && <span style={{ fontSize: 12, color: '#64748b' }}>Bitte warten...</span>}
      </div>
      {fehler && <div style={{ background: '#fee2e2', color: '#991b1b', padding: '8px 12px', borderRadius: 8, fontSize: 13, marginBottom: 10 }}>{fehler}</div>}
      {meldung && <div style={{ background: '#dcfce7', color: '#166534', padding: '8px 12px', borderRadius: 8, fontSize: 13, marginBottom: 10 }}>{meldung}</div>}

      {ergebnis && (
        <>
          {ergebnis.hinweise.length > 0 && (
            <div style={{ background: '#fef3c7', color: '#92400e', padding: '8px 12px', borderRadius: 8, fontSize: 12.5, marginBottom: 10 }}>
              {ergebnis.hinweise.map((h, i) => (
                <div key={i}>{h}</div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginBottom: 10, fontSize: 13 }}>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={urlaubeAnlegen} onChange={(e) => setUrlaubeAnlegen(e.target.checked)} />
              Urlaube {ergebnis.jahr} anlegen (als genehmigt)
            </label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={restSetzen} onChange={(e) => setRestSetzen(e.target.checked)} />
              Anspruch und Resturlaub {ergebnis.jahr} setzen
            </label>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="rbl-tabelle" style={{ borderCollapse: 'collapse', width: '100%', minWidth: 900 }}>
              <thead>
                <tr style={{ background: '#f1f5f9' }}>
                  <th style={zelle}></th>
                  <th style={zelle}>Name in Excel</th>
                  <th style={zelle}>Mitarbeiter im System</th>
                  <th style={rechts}>Rest Vorjahr</th>
                  <th style={rechts}>Anspruch</th>
                  <th style={rechts}>Genommen</th>
                  <th style={rechts}>Resturlaub neu</th>
                  <th style={rechts}>Urlaube</th>
                </tr>
              </thead>
              <tbody>
                {zeilen.map(({ p, mid, neu, verteilung, kalenderAbweichung }) => (
                  <Fragment key={p.zeile}>
                    <tr style={{ opacity: aktiv[p.zeile] ? 1 : 0.5 }}>
                      <td style={zelle}>
                        <input
                          type="checkbox"
                          checked={!!aktiv[p.zeile]}
                          disabled={mid === ''}
                          onChange={(e) => setAktiv((a) => ({ ...a, [p.zeile]: e.target.checked }))}
                        />
                      </td>
                      <td style={zelle}>
                        <b>{p.name}</b>
                        {kalenderAbweichung && (
                          <div style={{ fontSize: 11, color: '#b45309' }}>
                            Kalender zeigt {zahlText(p.tageKalender)} Tage, Spalte „genommen“ {zahlText(p.genommen)}
                          </div>
                        )}
                      </td>
                      <td style={zelle}>
                        <select
                          value={mid}
                          onChange={(e) => {
                            const v = e.target.value
                            setZuordnung((z) => ({ ...z, [p.zeile]: v }))
                            setUnsicher((u) => ({ ...u, [p.zeile]: false }))
                            setAktiv((a) => ({ ...a, [p.zeile]: v !== '' }))
                          }}
                          style={{
                            padding: '4px 6px',
                            fontSize: 12.5,
                            borderRadius: 6,
                            border: `1px solid ${mid === '' ? '#dc2626' : unsicher[p.zeile] ? '#f59e0b' : '#cbd5e1'}`,
                            maxWidth: 230,
                          }}
                        >
                          <option value="">– nicht zugeordnet (überspringen) –</option>
                          <option value="neu">+ neuen Mitarbeiter anlegen</option>
                          {personen.map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.name}
                            </option>
                          ))}
                        </select>
                        {mid === '' && <div style={{ fontSize: 11, color: '#dc2626' }}>nicht gefunden</div>}
                        {unsicher[p.zeile] && mid !== '' && <div style={{ fontSize: 11, color: '#b45309' }}>unsicher, bitte prüfen</div>}
                        {mid !== '' && doppelt.has(mid) && <div style={{ fontSize: 11, color: '#dc2626' }}>mehrfach zugeordnet</div>}
                      </td>
                      <td style={rechts}>{zahlText(p.vorjahr)}</td>
                      <td style={rechts}>{zahlText(p.anspruch)}</td>
                      <td style={rechts}>{zahlText(p.genommen)}</td>
                      <td style={rechts}>
                        <b>{zahlText(verteilung.restAktuell + verteilung.restVorjahr)}</b>
                        <div style={{ fontSize: 10.5, color: '#64748b' }}>
                          davon Vorjahr {zahlText(verteilung.restVorjahr)}
                        </div>
                      </td>
                      <td style={rechts}>
                        <button
                          onClick={() => setOffen(offen === p.zeile ? null : p.zeile)}
                          style={{ background: 'none', border: 'none', color: '#14325c', cursor: 'pointer', fontSize: 12.5, textDecoration: 'underline' }}
                        >
                          {neu.length} neu{p.bloecke.length !== neu.length ? ` (${p.bloecke.length - neu.length} schon da)` : ''}
                        </button>
                      </td>
                    </tr>
                    {offen === p.zeile && (
                      <tr>
                        <td colSpan={8} style={{ background: '#f8fafc', padding: '8px 14px', borderBottom: '1px solid #e2e8f0' }}>
                          {p.bloecke.length === 0 && <span style={{ color: '#94a3b8', fontSize: 12.5 }}>Keine Urlaubstage im Kalender.</span>}
                          {p.bloecke.map((b) => {
                            const schonDa = mid !== '' && mid !== 'neu' && ueberschneidet(mid, b.von, b.bis)
                            return (
                              <div key={b.von} style={{ fontSize: 12.5, padding: '2px 0', color: schonDa ? '#94a3b8' : '#334155' }}>
                                {datumDeutsch(b.von)}
                                {b.bis !== b.von ? ` – ${datumDeutsch(b.bis)}` : ''} · {zahlText(b.tage)} Tage
                                {schonDa && ' · gibt es schon, wird übersprungen'}
                              </div>
                            )
                          })}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 14, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              onClick={importieren}
              disabled={laedt || importiert || gewaehlt.length === 0}
              style={{
                padding: '9px 20px',
                borderRadius: 8,
                border: 'none',
                background: '#14325c',
                color: '#fff',
                fontWeight: 600,
                fontSize: 14,
                cursor: 'pointer',
                opacity: laedt || importiert || gewaehlt.length === 0 ? 0.5 : 1,
              }}
            >
              {importiert ? 'Importiert' : `Jetzt importieren (${gewaehlt.length} Personen${urlaubeAnlegen ? `, ${blockSumme} Zeiträume` : ''})`}
            </button>
            <span style={{ fontSize: 12, color: '#64748b' }}>
              Der Vorjahresurlaub wird zuerst verbraucht. Die Summe aus „Resturlaub neu“ entspricht der Spalte „Resturlaub“ der Excel-Datei.
            </span>
          </div>
        </>
      )}
    </div>
  )
}
