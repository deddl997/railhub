import { Fragment, useEffect, useRef, useState } from 'react'
import { supabase } from './lib/supabase'
import { datumZuISO } from './datumUtils'
import { useLiveAktualisierung } from './liveAktualisierung'

interface Auftrag {
  id: string
  kunde: string | null
  referenz: string | null
  zug_nr: string | null
  status: string
  abfahrt_ort: string | null
  abfahrt_datum: string
  abfahrt_soll: string | null
  abfahrt_ist: string | null
  ankunft_ort: string | null
  ankunft_soll: string | null
  ankunft_ist: string | null
  anzahl_wagen: number | null
  ggk: string | null
  lok: string | null
  abrechnung_status: string
  kuerzel_abrechnung: string | null
  kuerzel_planung: string | null
  kontrolle: string | null
  preis: number | null
  rechnungsnr: string | null
  info_abrechnung: string | null
}

type Feld = 'kontrolle' | 'kuerzel_abrechnung' | 'preis' | 'rechnungsnr' | 'info_abrechnung'

const ABRECHNUNG: Record<string, { text: string; farbe: string; hell: string }> = {
  offen: { text: 'Offen', farbe: '#b45309', hell: '#fef3c7' },
  geprueft: { text: 'Geprüft', farbe: '#1d4ed8', hell: '#dbeafe' },
  abgerechnet: { text: 'Abgerechnet', farbe: '#15803d', hell: '#dcfce7' },
}

const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
const WOCHENTAGE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']

const euro = (v: number) => v.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })
const datumDeutsch = (iso: string) => iso.split('-').reverse().join('.')
const zeit = (z: string | null) => (z ? z.slice(0, 5) : '')

function minuten(z: string): number {
  const [h, m] = z.split(':').map(Number)
  return h * 60 + m
}

function abweichung(soll: string | null, ist: string | null): number | null {
  if (!soll || !ist) return null
  let d = minuten(ist.slice(0, 5)) - minuten(soll.slice(0, 5))
  if (d > 720) d -= 1440
  if (d < -720) d += 1440
  return d
}

function csvSpeichern(name: string, kopf: string[], zeilen: string[][]) {
  const text = [kopf, ...zeilen].map((z) => z.map((w) => `"${String(w).replace(/"/g, '""')}"`).join(';')).join('\r\n')
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

export default function Abrechnung({ istAdmin }: { istAdmin: boolean }) {
  const heute = new Date()
  const [jahr, setJahr] = useState(heute.getFullYear())
  const [monat, setMonat] = useState(heute.getMonth())
  const [auftraege, setAuftraege] = useState<Auftrag[]>([])
  const [lokfuehrer, setLokfuehrer] = useState<Record<string, string[]>>({})
  const [laedt, setLaedt] = useState(true)
  const [fehler, setFehler] = useState<string | null>(null)
  const [kundeFilter, setKundeFilter] = useState('alle')
  const [statusFilter, setStatusFilter] = useState('alle')
  const [mitStornierten, setMitStornierten] = useState(false)
  const [gruppieren, setGruppieren] = useState(true)
  const [suche, setSuche] = useState('')
  const [auswahl, setAuswahl] = useState<Set<string>>(new Set())
  const still = useRef(false)
  const [zaehler, setZaehler] = useState(0)

  useLiveAktualisierung(['auftraege', 'dienstplan_eintraege'], () => {
    still.current = true
    setZaehler((z) => z + 1)
  })

  const von = datumZuISO(new Date(jahr, monat, 1))
  const bis = datumZuISO(new Date(jahr, monat + 1, 0))

  useEffect(() => {
    async function laden() {
      if (!still.current) setLaedt(true)
      still.current = false
      setFehler(null)
      const antwort = await supabase
        .from('auftraege')
        .select('*')
        .gte('abfahrt_datum', von)
        .lte('abfahrt_datum', bis)
        .order('abfahrt_datum')
        .order('abfahrt_soll')
      if (antwort.error) {
        setFehler(antwort.error.message)
        setLaedt(false)
        return
      }
      const liste = (antwort.data ?? []) as Auftrag[]
      const ids = liste.map((a) => a.id)
      const namen: Record<string, string[]> = {}
      if (ids.length > 0) {
        const [eintraege, personen] = await Promise.all([
          supabase.from('dienstplan_eintraege').select('mitarbeiter_id, auftrag_id').eq('ist_spotschicht', true).in('auftrag_id', ids),
          supabase.from('mitarbeiter').select('id, name'),
        ])
        const nameVon = new Map<string, string>((personen.data ?? []).map((p: { id: string; name: string }) => [p.id, p.name]))
        for (const e of (eintraege.data ?? []) as { mitarbeiter_id: string; auftrag_id: string }[]) {
          ;(namen[e.auftrag_id] ??= []).push(nameVon.get(e.mitarbeiter_id) ?? 'Unbekannt')
        }
      }
      setAuftraege(liste)
      setLokfuehrer(namen)
      setLaedt(false)
    }
    laden()
  }, [von, bis, zaehler])

  const kunden = Array.from(new Set(auftraege.map((a) => a.kunde ?? '(ohne Kunde)'))).sort()

  const sichtbar = auftraege.filter((a) => {
    if (!mitStornierten && a.status === 'storniert') return false
    if (kundeFilter !== 'alle' && (a.kunde ?? '(ohne Kunde)') !== kundeFilter) return false
    if (statusFilter !== 'alle' && a.abrechnung_status !== statusFilter) return false
    const s = suche.trim().toLowerCase()
    if (!s) return true
    return [a.kunde, a.referenz, a.zug_nr, a.abfahrt_ort, a.ankunft_ort, a.rechnungsnr, a.info_abrechnung]
      .filter(Boolean)
      .some((x) => String(x).toLowerCase().includes(s))
  })

  const summe = (liste: Auftrag[], status?: string) =>
    liste.filter((a) => !status || a.abrechnung_status === status).reduce((s, a) => s + (a.preis ?? 0), 0)
  const ohnePreis = sichtbar.filter((a) => a.preis == null && a.status !== 'storniert').length

  async function speichern(a: Auftrag, daten: Record<string, unknown>) {
    setFehler(null)
    const { error } = await supabase.from('auftraege').update(daten).eq('id', a.id)
    if (error) setFehler(error.message)
    still.current = true
    setZaehler((z) => z + 1)
  }

  async function feldSpeichern(a: Auftrag, feld: Feld, wert: string) {
    const text = wert.trim()
    let neu: string | number | null = text === '' ? null : text
    if (feld === 'preis') {
      if (text === '') neu = null
      else {
        const zahl = Number(text.replace(/\./g, '').replace(',', '.'))
        if (!Number.isFinite(zahl)) {
          setFehler('Der Preis ist keine gültige Zahl.')
          return
        }
        neu = zahl
      }
    }
    const alt = feld === 'preis' ? a.preis : (a[feld] as string | null)
    if ((alt ?? null) === neu) return
    await speichern(a, { [feld]: neu })
  }

  async function massenAenderung(neuerStatus: 'geprueft' | 'abgerechnet' | 'offen') {
    const ziele = sichtbar.filter((a) => auswahl.has(a.id))
    if (ziele.length === 0) return
    if (neuerStatus === 'abgerechnet') {
      const ohne = ziele.filter((a) => a.preis == null)
      if (ohne.length > 0) {
        setFehler(`${ohne.length} der ausgewählten Aufträge haben noch keinen Preis. Bitte zuerst den Preis eintragen.`)
        return
      }
      if (!window.confirm(`${ziele.length} Aufträge als abgerechnet markieren? Sie werden danach gesperrt.`)) return
    }
    setFehler(null)
    const { error } = await supabase.from('auftraege').update({ abrechnung_status: neuerStatus }).in('id', ziele.map((a) => a.id))
    if (error) setFehler(error.message)
    setAuswahl(new Set())
    still.current = true
    setZaehler((z) => z + 1)
  }

  function umschalten(id: string) {
    setAuswahl((alt) => {
      const neu = new Set(alt)
      if (neu.has(id)) neu.delete(id)
      else neu.add(id)
      return neu
    })
  }

  function exportieren() {
    csvSpeichern(
      `Abrechnung_${jahr}-${String(monat + 1).padStart(2, '0')}${kundeFilter !== 'alle' ? '_' + kundeFilter.replace(/[^\wäöüÄÖÜß-]+/g, '_') : ''}.csv`,
      ['Datum', 'Kunde', 'Referenz', 'Zugnummer', 'Von', 'Nach', 'Abfahrt Soll', 'Abfahrt Ist', 'Ankunft Soll', 'Ankunft Ist', 'Wagen', 'Last/Leer, Zuschläge', 'Lok', 'Lokführer', 'Kontrolle', 'Kürzel Abrechnung', 'Kürzel Planung', 'Preis', 'Rechnungsnr', 'Abrechnung', 'Info an Abrechnung'],
      sichtbar.map((a) => [
        datumDeutsch(a.abfahrt_datum),
        a.kunde ?? '',
        a.referenz ?? '',
        a.zug_nr ?? '',
        a.abfahrt_ort ?? '',
        a.ankunft_ort ?? '',
        zeit(a.abfahrt_soll),
        zeit(a.abfahrt_ist),
        zeit(a.ankunft_soll),
        zeit(a.ankunft_ist),
        a.anzahl_wagen == null ? '' : String(a.anzahl_wagen),
        a.ggk ?? '',
        a.lok ?? '',
        (lokfuehrer[a.id] ?? []).join(', '),
        a.kontrolle ?? '',
        a.kuerzel_abrechnung ?? '',
        a.kuerzel_planung ?? '',
        a.preis == null ? '' : String(a.preis).replace('.', ','),
        a.rechnungsnr ?? '',
        ABRECHNUNG[a.abrechnung_status]?.text ?? a.abrechnung_status,
        a.info_abrechnung ?? '',
      ])
    )
  }

  const knopf: React.CSSProperties = { background: 'none', border: '1px solid var(--navy)', color: 'var(--navy)', borderRadius: 8, padding: '8px 14px', fontSize: 13, cursor: 'pointer' }
  const eingabe: React.CSSProperties = { border: '1px solid var(--border)', borderRadius: 6, padding: '7px 9px', fontSize: 14, boxSizing: 'border-box', fontFamily: 'inherit' }
  const th: React.CSSProperties = { textAlign: 'left', padding: '8px 8px', fontSize: 12, color: '#475569', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', background: '#f8fafc', position: 'sticky', top: 0 }
  const td: React.CSSProperties = { padding: '6px 8px', fontSize: 13, borderBottom: '1px solid #eef2f8', verticalAlign: 'top' }
  const zelle: React.CSSProperties = { border: '1px solid transparent', borderRadius: 4, padding: '4px 6px', fontSize: 13, width: '100%', boxSizing: 'border-box', background: 'transparent', fontFamily: 'inherit' }

  const eingabeZelle = (a: Auftrag, feld: Feld, breite: number, rechts = false) => {
    const gesperrt = a.abrechnung_status === 'abgerechnet' && !istAdmin
    const aktuell = feld === 'preis' ? (a.preis == null ? '' : String(a.preis).replace('.', ',')) : ((a[feld] as string | null) ?? '')
    return (
      <input
        key={a.id + feld + aktuell}
        defaultValue={aktuell}
        disabled={gesperrt}
        onBlur={(e) => feldSpeichern(a, feld, e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        }}
        onFocus={(e) => (e.target.style.borderColor = 'var(--navy)')}
        onBlurCapture={(e) => (e.target.style.borderColor = 'transparent')}
        style={{ ...zelle, width: breite, textAlign: rechts ? 'right' : 'left', background: gesperrt ? '#f8fafc' : '#ffffff', borderColor: '#e2e8f0' }}
      />
    )
  }

  const kopfZeile = (
    <tr>
      <th style={th}>
        <input
          type="checkbox"
          checked={sichtbar.length > 0 && sichtbar.every((a) => auswahl.has(a.id))}
          onChange={(e) => setAuswahl(e.target.checked ? new Set(sichtbar.map((a) => a.id)) : new Set())}
        />
      </th>
      <th style={th}>Datum</th>
      <th style={th}>Zug</th>
      <th style={th}>Strecke</th>
      <th style={th}>Zeiten Soll / Ist</th>
      <th style={th}>Lokführer</th>
      <th style={th}>Wagen / Lok</th>
      <th style={th}>Kontrolle</th>
      <th style={th}>Kürzel</th>
      <th style={{ ...th, textAlign: 'right' }}>Preis (€)</th>
      <th style={th}>Rechnungsnr.</th>
      <th style={th}>Info an Abrechnung</th>
      <th style={th}>Abrechnung</th>
    </tr>
  )

  const zeile = (a: Auftrag) => {
    const tag = new Date(a.abfahrt_datum + 'T00:00:00')
    const spaetAn = abweichung(a.ankunft_soll, a.ankunft_ist)
    const gesperrt = a.abrechnung_status === 'abgerechnet'
    const stil = ABRECHNUNG[a.abrechnung_status] ?? ABRECHNUNG.offen
    return (
      <tr key={a.id} style={{ background: auswahl.has(a.id) ? '#eff6ff' : gesperrt ? '#f8fafc' : undefined, opacity: a.status === 'storniert' ? 0.55 : 1 }}>
        <td style={td}>
          <input type="checkbox" checked={auswahl.has(a.id)} onChange={() => umschalten(a.id)} />
        </td>
        <td style={{ ...td, whiteSpace: 'nowrap', fontWeight: 700 }}>
          {WOCHENTAGE[tag.getDay()]} {datumDeutsch(a.abfahrt_datum).slice(0, 5)}
        </td>
        <td style={td}>
          <div style={{ fontWeight: 700, color: 'var(--navy)' }}>{a.referenz ?? '–'}</div>
          {a.zug_nr && <div style={{ fontSize: 11, color: '#64748b' }}>{a.zug_nr}</div>}
          {a.status === 'storniert' && <div style={{ fontSize: 11, color: '#b91c1c', fontWeight: 700 }}>storniert</div>}
        </td>
        <td style={td}>
          {a.abfahrt_ort} → {a.ankunft_ort}
        </td>
        <td style={{ ...td, whiteSpace: 'nowrap' }}>
          <div>
            {zeit(a.abfahrt_soll)} → {zeit(a.ankunft_soll)}
          </div>
          {(a.abfahrt_ist || a.ankunft_ist) && (
            <div style={{ fontSize: 12, color: spaetAn && spaetAn > 0 ? '#b91c1c' : '#15803d', fontWeight: 600 }}>
              Ist {zeit(a.abfahrt_ist) || '–'} → {zeit(a.ankunft_ist) || '–'}
              {spaetAn ? ` (${spaetAn > 0 ? '+' : ''}${spaetAn} Min.)` : ''}
            </div>
          )}
        </td>
        <td style={td}>{(lokfuehrer[a.id] ?? []).join(', ') || <span style={{ color: '#94a3b8' }}>–</span>}</td>
        <td style={td}>
          <div>{a.anzahl_wagen != null ? `${a.anzahl_wagen} Wagen` : ''}</div>
          <div style={{ fontSize: 11, color: '#64748b' }}>{[a.ggk, a.lok].filter(Boolean).join(' · ')}</div>
        </td>
        <td style={td}>{eingabeZelle(a, 'kontrolle', 70)}</td>
        <td style={td}>{eingabeZelle(a, 'kuerzel_abrechnung', 60)}</td>
        <td style={td}>{eingabeZelle(a, 'preis', 90, true)}</td>
        <td style={td}>{eingabeZelle(a, 'rechnungsnr', 110)}</td>
        <td style={td}>{eingabeZelle(a, 'info_abrechnung', 200)}</td>
        <td style={td}>
          <select
            value={a.abrechnung_status}
            disabled={gesperrt && !istAdmin}
            onChange={(e) => {
              if (e.target.value === 'abgerechnet' && a.preis == null) {
                setFehler('Bitte zuerst den Preis eintragen, bevor der Auftrag als abgerechnet markiert wird.')
                return
              }
              speichern(a, { abrechnung_status: e.target.value })
            }}
            style={{ ...eingabe, padding: '4px 6px', fontSize: 12, fontWeight: 700, color: stil.farbe, background: stil.hell, border: 'none' }}
          >
            {Object.entries(ABRECHNUNG).map(([k, v]) => (
              <option key={k} value={k}>
                {v.text}
              </option>
            ))}
          </select>
        </td>
      </tr>
    )
  }

  const gruppen: { kunde: string; liste: Auftrag[] }[] = gruppieren
    ? kunden
        .map((k) => ({ kunde: k, liste: sichtbar.filter((a) => (a.kunde ?? '(ohne Kunde)') === k) }))
        .filter((g) => g.liste.length > 0)
    : [{ kunde: '', liste: sichtbar }]

  const kachel = (titel: string, wert: string, farbe?: string) => (
    <div style={{ background: '#f1f5f9', borderRadius: 10, padding: '8px 12px', minWidth: 130 }}>
      <div style={{ fontSize: 11, color: '#64748b' }}>{titel}</div>
      <div style={{ fontSize: 17, fontWeight: 700, color: farbe ?? 'var(--navy)' }}>{wert}</div>
    </div>
  )

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
        <button
          onClick={() => {
            const d = new Date(jahr, monat - 1, 1)
            setJahr(d.getFullYear())
            setMonat(d.getMonth())
          }}
          style={knopf}
        >
          ‹
        </button>
        <select value={monat} onChange={(e) => setMonat(Number(e.target.value))} style={eingabe}>
          {MONATE.map((m, i) => (
            <option key={m} value={i}>
              {m}
            </option>
          ))}
        </select>
        <select value={jahr} onChange={(e) => setJahr(Number(e.target.value))} style={eingabe}>
          {[heute.getFullYear() - 2, heute.getFullYear() - 1, heute.getFullYear(), heute.getFullYear() + 1].map((j) => (
            <option key={j} value={j}>
              {j}
            </option>
          ))}
        </select>
        <button
          onClick={() => {
            const d = new Date(jahr, monat + 1, 1)
            setJahr(d.getFullYear())
            setMonat(d.getMonth())
          }}
          style={knopf}
        >
          ›
        </button>
        <div style={{ flex: 1 }} />
        <input placeholder="Suchen (Zug, Kunde, Rechnungsnr …)" value={suche} onChange={(e) => setSuche(e.target.value)} style={{ ...eingabe, width: 240 }} />
        <select value={kundeFilter} onChange={(e) => setKundeFilter(e.target.value)} style={eingabe}>
          <option value="alle">Alle Kunden</option>
          {kunden.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={eingabe}>
          <option value="alle">Alle Stände</option>
          {Object.entries(ABRECHNUNG).map(([k, v]) => (
            <option key={k} value={k}>
              {v.text}
            </option>
          ))}
        </select>
        <label style={{ fontSize: 13, color: '#475569', display: 'flex', gap: 5, alignItems: 'center' }}>
          <input type="checkbox" checked={gruppieren} onChange={(e) => setGruppieren(e.target.checked)} />
          nach Kunde
        </label>
        <label style={{ fontSize: 13, color: '#475569', display: 'flex', gap: 5, alignItems: 'center' }}>
          <input type="checkbox" checked={mitStornierten} onChange={(e) => setMitStornierten(e.target.checked)} />
          mit stornierten
        </label>
        <button onClick={exportieren} style={knopf} title="Als Excel-Datei (CSV) speichern">
          Export
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {kachel('Aufträge', String(sichtbar.length))}
        {kachel('Summe gesamt', euro(summe(sichtbar)))}
        {kachel('Noch offen', euro(summe(sichtbar, 'offen')), '#b45309')}
        {kachel('Geprüft', euro(summe(sichtbar, 'geprueft')), '#1d4ed8')}
        {kachel('Abgerechnet', euro(summe(sichtbar, 'abgerechnet')), '#15803d')}
        {ohnePreis > 0 && kachel('Ohne Preis', String(ohnePreis), '#b91c1c')}
      </div>

      {auswahl.size > 0 && (
        <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '8px 12px', marginBottom: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
          <b>{auswahl.size}</b> ausgewählt:
          <button onClick={() => massenAenderung('geprueft')} style={knopf}>
            Als geprüft markieren
          </button>
          <button onClick={() => massenAenderung('abgerechnet')} style={{ ...knopf, background: 'var(--navy)', color: '#ffffff' }}>
            Als abgerechnet markieren
          </button>
          {istAdmin && (
            <button onClick={() => massenAenderung('offen')} style={knopf}>
              Zurück auf offen
            </button>
          )}
          <button onClick={() => setAuswahl(new Set())} style={{ ...knopf, borderColor: '#cbd5e1', color: '#64748b' }}>
            Auswahl aufheben
          </button>
        </div>
      )}

      {fehler && <div style={{ background: '#fee2e2', color: '#991b1b', padding: '8px 12px', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>{fehler}</div>}
      {laedt && <div style={{ fontSize: 14, color: '#64748b' }}>Wird geladen …</div>}
      {!laedt && sichtbar.length === 0 && <div style={{ fontSize: 14, color: '#94a3b8', padding: '20px 0' }}>Keine Aufträge in diesem Monat.</div>}

      {!laedt && sichtbar.length > 0 && (
        <div style={{ overflow: 'auto', maxHeight: '68vh', border: '1px solid var(--border)', borderRadius: 10, background: '#ffffff' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1450 }}>
            <thead>{kopfZeile}</thead>
            <tbody>
              {gruppen.map((g) => (
                <Fragment key={g.kunde || 'alle'}>
                  {gruppieren && (
                    <tr>
                      <td colSpan={9} style={{ ...td, background: '#e8eef8', fontWeight: 700, color: 'var(--navy)' }}>
                        {g.kunde} · {g.liste.length} Aufträge
                      </td>
                      <td style={{ ...td, background: '#e8eef8', fontWeight: 700, textAlign: 'right', color: 'var(--navy)' }}>{euro(summe(g.liste))}</td>
                      <td colSpan={3} style={{ ...td, background: '#e8eef8' }} />
                    </tr>
                  )}
                  {g.liste.map((a) => zeile(a))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 8 }}>
        Kontrolle, Kürzel, Preis, Rechnungsnummer und Info trägst du direkt in der Tabelle ein (mit Enter oder Klick daneben speichern). Abgerechnete Aufträge sind
        gesperrt, nur ein Admin kann sie wieder öffnen.
      </div>
    </div>
  )
}
