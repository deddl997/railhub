import { useEffect, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from './lib/supabase'
import { datumZuISO } from './datumUtils'

interface Position {
  id: string
  kunde: string | null
  referenz: string | null
  zug_nr: string | null
  status: string
  abfahrt_ort: string | null
  abfahrt_datum: string
  ankunft_ort: string | null
  anzahl_wagen: number | null
  ggk: string | null
  preis: number | null
  rechnungsnr: string | null
  abrechnung_status: string
  storno_grund: string | null
}

const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
const euro = (v: number) => v.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })
const datumDeutsch = (iso: string) => iso.split('-').reverse().join('.')
const runden = (v: number) => Math.round(v * 100) / 100

export default function Rechnungen() {
  const heute = new Date()
  const [jahr, setJahr] = useState(heute.getFullYear())
  const [monat, setMonat] = useState(heute.getMonth())
  const [kunde, setKunde] = useState('')
  const [positionen, setPositionen] = useState<Position[]>([])
  const [abgewaehlt, setAbgewaehlt] = useState<Set<string>>(new Set())
  const [rechnungsnr, setRechnungsnr] = useState('')
  const [mwst, setMwst] = useState(19)
  const [laedt, setLaedt] = useState(true)
  const [fehler, setFehler] = useState<string | null>(null)
  const [meldung, setMeldung] = useState<string | null>(null)
  const [zaehler, setZaehler] = useState(0)
  const [bucht, setBucht] = useState(false)
  const kundeGewaehlt = useRef(false)

  const von = datumZuISO(new Date(jahr, monat, 1))
  const bis = datumZuISO(new Date(jahr, monat + 1, 0))

  useEffect(() => {
    async function laden() {
      setLaedt(true)
      setFehler(null)
      const antwort = await supabase
        .from('auftraege')
        .select('id, kunde, referenz, zug_nr, status, abfahrt_ort, abfahrt_datum, ankunft_ort, anzahl_wagen, ggk, preis, rechnungsnr, abrechnung_status, storno_grund')
        .gte('abfahrt_datum', von)
        .lte('abfahrt_datum', bis)
        .in('status', ['gefahren', 'storniert'])
        .order('abfahrt_datum')
        .order('abfahrt_soll')
        .limit(2000)
      if (antwort.error) {
        setFehler(antwort.error.message)
      } else {
        setPositionen((antwort.data ?? []) as Position[])
      }
      setAbgewaehlt(new Set())
      setLaedt(false)
    }
    laden()
  }, [von, bis, zaehler])

  // Nur Aufträge, die noch keine Rechnungsnummer haben
  const offene = positionen.filter((p) => !p.rechnungsnr || p.rechnungsnr.trim() === '')
  const kundenNamen = Array.from(new Set(offene.map((p) => p.kunde ?? '(ohne Kunde)'))).sort()

  useEffect(() => {
    if (kunde === '' || !kundenNamen.includes(kunde)) {
      if (!kundeGewaehlt.current || !kundenNamen.includes(kunde)) setKunde(kundenNamen[0] ?? '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positionen])

  const zeilen = offene.filter((p) => (p.kunde ?? '(ohne Kunde)') === kunde)
  const gewaehlt = zeilen.filter((p) => !abgewaehlt.has(p.id))
  const mitPreis = gewaehlt.filter((p) => p.preis != null)
  const ohnePreis = gewaehlt.filter((p) => p.preis == null)
  const netto = runden(mitPreis.reduce((s, p) => s + (p.preis ?? 0), 0))
  const steuer = runden((netto * mwst) / 100)
  const brutto = runden(netto + steuer)
  const schonBerechnet = positionen.length - offene.length

  function beschreibung(p: Position): string {
    const strecke = `${p.abfahrt_ort ?? ''} – ${p.ankunft_ort ?? ''}`.trim()
    const teile = [p.zug_nr ? `Zug ${p.zug_nr}` : null, p.referenz, strecke !== '–' ? strecke : null].filter(Boolean)
    return teile.join(' · ') + (p.status === 'storniert' ? ' · STORNO' : '')
  }

  function excelErzeugen() {
    const kopf: (string | number)[][] = [
      ['Rechnungsentwurf'],
      ['Kunde', kunde],
      ['Zeitraum', `${datumDeutsch(von)} – ${datumDeutsch(bis)}`],
      ['Rechnungsnummer', rechnungsnr || '(noch offen)'],
      [],
      ['Pos.', 'Datum', 'Leistung', 'Wagen', 'Zuschläge', 'Status', 'Preis netto (EUR)'],
    ]
    const daten = mitPreis.map((p, i) => [
      i + 1,
      datumDeutsch(p.abfahrt_datum),
      beschreibung(p),
      p.anzahl_wagen ?? '',
      p.ggk ?? '',
      p.status === 'storniert' ? `Storniert${p.storno_grund ? ': ' + p.storno_grund : ''}` : 'Gefahren',
      p.preis ?? 0,
    ])
    const fuss: (string | number)[][] = [
      [],
      ['', '', '', '', '', 'Summe netto', netto],
      ['', '', '', '', '', `MwSt ${mwst} %`, steuer],
      ['', '', '', '', '', 'Gesamt brutto', brutto],
    ]
    if (ohnePreis.length > 0) {
      fuss.push([], [`Hinweis: ${ohnePreis.length} Auftrag/Aufträge ohne Preis sind nicht enthalten.`])
    }
    const blatt = XLSX.utils.aoa_to_sheet([...kopf, ...daten, ...fuss])
    blatt['!cols'] = [{ wch: 6 }, { wch: 12 }, { wch: 60 }, { wch: 8 }, { wch: 20 }, { wch: 28 }, { wch: 18 }]
    const mappe = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(mappe, blatt, 'Rechnungsentwurf')
    const dateiKunde = kunde.replace(/[^\wäöüÄÖÜß-]+/g, '_')
    XLSX.writeFile(mappe, `Rechnungsentwurf_${dateiKunde}_${jahr}-${String(monat + 1).padStart(2, '0')}.xlsx`)
  }

  async function buchen() {
    if (rechnungsnr.trim() === '') {
      setFehler('Bitte zuerst eine Rechnungsnummer eintragen.')
      return
    }
    if (mitPreis.length === 0) return
    const text =
      `${mitPreis.length} Aufträge von „${kunde}“ mit der Rechnungsnummer ${rechnungsnr.trim()} versehen und als „abgerechnet“ markieren?\n` +
      `Danach sind sie in dieser Liste nicht mehr offen.`
    if (!window.confirm(text)) return
    setBucht(true)
    setFehler(null)
    setMeldung(null)
    const { error } = await supabase
      .from('auftraege')
      .update({ rechnungsnr: rechnungsnr.trim(), abrechnung_status: 'abgerechnet' })
      .in('id', mitPreis.map((p) => p.id))
    setBucht(false)
    if (error) {
      setFehler(error.message)
      return
    }
    setMeldung(`${mitPreis.length} Aufträge als abgerechnet gebucht (Rechnung ${rechnungsnr.trim()}).`)
    setRechnungsnr('')
    kundeGewaehlt.current = false
    setZaehler((z) => z + 1)
  }

  const feld: React.CSSProperties = { padding: '5px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13 }
  const zelle: React.CSSProperties = { padding: '6px 8px', borderBottom: '1px solid #eef2f8', fontSize: 12.5, textAlign: 'left', verticalAlign: 'top' }
  const knopf: React.CSSProperties = { padding: '7px 14px', borderRadius: 8, border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer' }

  return (
    <div>
      <p style={{ fontSize: 13, color: '#475569', marginTop: 0 }}>
        Stellt aus allen gefahrenen und stornierten Aufträgen eines Kunden einen Rechnungsentwurf zusammen. Es werden nur Aufträge ohne Rechnungsnummer gezeigt.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
        <select value={jahr} onChange={(e) => setJahr(Number(e.target.value))} style={feld}>
          {[heute.getFullYear() - 1, heute.getFullYear(), heute.getFullYear() + 1].map((j) => (
            <option key={j} value={j}>
              {j}
            </option>
          ))}
        </select>
        <select value={monat} onChange={(e) => setMonat(Number(e.target.value))} style={feld}>
          {MONATE.map((m, i) => (
            <option key={m} value={i}>
              {m}
            </option>
          ))}
        </select>
        <select
          value={kunde}
          onChange={(e) => {
            kundeGewaehlt.current = true
            setKunde(e.target.value)
            setAbgewaehlt(new Set())
          }}
          style={{ ...feld, minWidth: 200 }}
        >
          {kundenNamen.length === 0 && <option value="">Keine offenen Aufträge</option>}
          {kundenNamen.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        {laedt && <span style={{ fontSize: 12, color: '#64748b' }}>Lade...</span>}
        {schonBerechnet > 0 && <span style={{ fontSize: 12, color: '#64748b' }}>{schonBerechnet} Aufträge dieses Monats haben schon eine Rechnungsnummer.</span>}
      </div>
      {fehler && <div style={{ background: '#fee2e2', color: '#991b1b', padding: '8px 12px', borderRadius: 8, fontSize: 13, marginBottom: 10 }}>{fehler}</div>}
      {meldung && <div style={{ background: '#dcfce7', color: '#166534', padding: '8px 12px', borderRadius: 8, fontSize: 13, marginBottom: 10 }}>{meldung}</div>}

      {zeilen.length > 0 && (
        <>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 640 }}>
              <thead>
                <tr style={{ background: '#f1f5f9' }}>
                  <th style={zelle}></th>
                  <th style={zelle}>Datum</th>
                  <th style={zelle}>Leistung</th>
                  <th style={zelle}>Status</th>
                  <th style={{ ...zelle, textAlign: 'right' }}>Preis netto</th>
                </tr>
              </thead>
              <tbody>
                {zeilen.map((p) => (
                  <tr key={p.id} style={{ opacity: abgewaehlt.has(p.id) ? 0.4 : 1 }}>
                    <td style={zelle}>
                      <input
                        type="checkbox"
                        checked={!abgewaehlt.has(p.id)}
                        onChange={() =>
                          setAbgewaehlt((alt) => {
                            const neu = new Set(alt)
                            if (neu.has(p.id)) neu.delete(p.id)
                            else neu.add(p.id)
                            return neu
                          })
                        }
                      />
                    </td>
                    <td style={zelle}>{datumDeutsch(p.abfahrt_datum)}</td>
                    <td style={zelle}>{beschreibung(p)}</td>
                    <td style={{ ...zelle, color: p.status === 'storniert' ? '#b91c1c' : '#15803d', fontWeight: 600 }}>
                      {p.status === 'storniert' ? 'Storniert' : 'Gefahren'}
                    </td>
                    <td style={{ ...zelle, textAlign: 'right' }}>
                      {p.preis != null ? euro(p.preis) : <span style={{ color: '#b45309', fontWeight: 600 }}>Preis fehlt</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
            <div style={{ minWidth: 280, fontSize: 13 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                <span>Summe netto</span>
                <b>{euro(netto)}</b>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', alignItems: 'center' }}>
                <span>
                  MwSt{' '}
                  <input
                    type="number"
                    value={mwst}
                    min={0}
                    max={30}
                    onChange={(e) => setMwst(Number(e.target.value))}
                    style={{ ...feld, width: 56, padding: '2px 6px' }}
                  />{' '}
                  %
                </span>
                <b>{euro(steuer)}</b>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderTop: '2px solid #14325c', marginTop: 4, fontSize: 15 }}>
                <span>Gesamt brutto</span>
                <b>{euro(brutto)}</b>
              </div>
            </div>
          </div>
          {ohnePreis.length > 0 && (
            <div style={{ background: '#fef3c7', color: '#92400e', padding: '8px 12px', borderRadius: 8, fontSize: 13, marginTop: 10 }}>
              {ohnePreis.length} Auftrag/Aufträge ohne Preis sind nicht in der Summe. Der Preis wird in der Abrechnung eingetragen.
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 16 }}>
            <button onClick={excelErzeugen} disabled={mitPreis.length === 0} style={{ ...knopf, background: '#eef2f8', color: '#14325c' }}>
              Excel-Entwurf herunterladen
            </button>
            <input
              value={rechnungsnr}
              onChange={(e) => setRechnungsnr(e.target.value)}
              placeholder="Rechnungsnummer"
              style={{ ...feld, width: 180 }}
            />
            <button
              onClick={buchen}
              disabled={bucht || mitPreis.length === 0}
              style={{ ...knopf, background: '#14325c', color: '#ffffff', opacity: bucht || mitPreis.length === 0 ? 0.5 : 1 }}
              title="Trägt die Rechnungsnummer ein und setzt die Aufträge auf abgerechnet"
            >
              {bucht ? 'Buche...' : 'Als abgerechnet buchen'}
            </button>
          </div>
        </>
      )}
      {!laedt && zeilen.length === 0 && (
        <p style={{ color: '#94a3b8', fontSize: 13 }}>Für diesen Monat gibt es keine Aufträge ohne Rechnungsnummer.</p>
      )}
    </div>
  )
}
