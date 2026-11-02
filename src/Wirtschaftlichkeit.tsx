import { Fragment, useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import { datumZuISO } from './datumUtils'

interface Auftrag {
  id: string
  kunde: string | null
  referenz: string | null
  zug_nr: string | null
  status: string
  abfahrt_ort: string | null
  abfahrt_datum: string
  ankunft_ort: string | null
  preis: number | null
}

interface Kosten {
  id: string
  auftrag_id: string
  art: string
  bezeichnung: string | null
  betrag: number
}

interface Satz {
  schluessel: string
  bezeichnung: string
  wert: number
  einheit: string
}

interface Schicht {
  auftrag_id: string
  mitarbeiter_id: string
  spot_beginn_zeit: string | null
  spot_ende_zeit: string | null
  spot_pause_minuten: number | null
}

const ARTEN: { id: string; text: string }[] = [
  { id: 'trasse', text: 'Trassenpreis' },
  { id: 'strom', text: 'Energie Strom' },
  { id: 'diesel', text: 'Energie Diesel' },
  { id: 'personal_extern', text: 'Personal extern' },
  { id: 'wu', text: 'WU (Wagenuntersuchung)' },
  { id: 'sonstiges', text: 'Sonstiges' },
]

const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
const euro = (v: number) => v.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })
const datumDeutsch = (iso: string) => iso.split('-').reverse().join('.')
const prozent = (v: number) => `${v.toLocaleString('de-DE', { maximumFractionDigits: 1 })} %`

function zuMinuten(z: string): number {
  const [h, m] = z.split(':').map(Number)
  return h * 60 + m
}

function schichtStunden(s: Schicht): number {
  if (!s.spot_beginn_zeit || !s.spot_ende_zeit) return 0
  const b = zuMinuten(s.spot_beginn_zeit)
  let e = zuMinuten(s.spot_ende_zeit)
  if (e <= b) e += 1440
  return Math.max(0, e - b - (s.spot_pause_minuten ?? 0)) / 60
}

function stuecke<T>(liste: T[], groesse: number): T[][] {
  const ergebnis: T[][] = []
  for (let i = 0; i < liste.length; i += groesse) ergebnis.push(liste.slice(i, i + groesse))
  return ergebnis
}

type Gruppierung = 'auftrag' | 'kunde' | 'strecke' | 'monat'

export default function Wirtschaftlichkeit() {
  const heute = new Date()
  const [jahr, setJahr] = useState(heute.getFullYear())
  const [monat, setMonat] = useState(heute.getMonth()) // -1 = ganzes Jahr
  const [ansicht, setAnsicht] = useState<'auswertung' | 'saetze'>('auswertung')
  const [gruppe, setGruppe] = useState<Gruppierung>('auftrag')
  const [auftraege, setAuftraege] = useState<Auftrag[]>([])
  const [kosten, setKosten] = useState<Kosten[]>([])
  const [schichten, setSchichten] = useState<Schicht[]>([])
  const [personBereich, setPersonBereich] = useState<Record<string, string>>({})
  const [saetze, setSaetze] = useState<Satz[]>([])
  const [satzEntwurf, setSatzEntwurf] = useState<Record<string, string>>({})
  const [laedt, setLaedt] = useState(true)
  const [fehler, setFehler] = useState<string | null>(null)
  const [meldung, setMeldung] = useState<string | null>(null)
  const [offenId, setOffenId] = useState<string | null>(null)
  const [neu, setNeu] = useState({ art: 'trasse', bezeichnung: '', betrag: '' })
  const [zaehler, setZaehler] = useState(0)

  const von = datumZuISO(new Date(jahr, monat === -1 ? 0 : monat, 1))
  const bis = datumZuISO(monat === -1 ? new Date(jahr, 11, 31) : new Date(jahr, monat + 1, 0))

  useEffect(() => {
    async function laden() {
      setLaedt(true)
      setFehler(null)
      const s = await supabase.from('kosten_saetze').select('*').order('schluessel')
      if (s.error) {
        setFehler(
          s.error.message.includes('kosten_saetze') || s.error.code === '42P01'
            ? 'Die Kosten-Tabellen fehlen noch oder du hast keine Berechtigung. Bitte kosten.sql im Supabase SQL Editor ausführen.'
            : s.error.message
        )
        setLaedt(false)
        return
      }
      const satzListe = (s.data ?? []) as Satz[]
      setSaetze(satzListe)
      setSatzEntwurf(Object.fromEntries(satzListe.map((x) => [x.schluessel, String(x.wert).replace('.', ',')])))

      const a = await supabase
        .from('auftraege')
        .select('id, kunde, referenz, zug_nr, status, abfahrt_ort, abfahrt_datum, ankunft_ort, preis')
        .gte('abfahrt_datum', von)
        .lte('abfahrt_datum', bis)
        .in('status', ['gefahren', 'storniert'])
        .order('abfahrt_datum')
        .limit(2000)
      if (a.error) {
        setFehler(a.error.message)
        setLaedt(false)
        return
      }
      const liste = (a.data ?? []) as Auftrag[]
      setAuftraege(liste)
      const ids = liste.map((x) => x.id)
      const kostenListe: Kosten[] = []
      const schichtListe: Schicht[] = []
      for (const teil of stuecke(ids, 80)) {
        const [k, e] = await Promise.all([
          supabase.from('auftrag_kosten').select('id, auftrag_id, art, bezeichnung, betrag').in('auftrag_id', teil),
          supabase
            .from('dienstplan_eintraege')
            .select('auftrag_id, mitarbeiter_id, spot_beginn_zeit, spot_ende_zeit, spot_pause_minuten')
            .eq('ist_spotschicht', true)
            .in('auftrag_id', teil),
        ])
        if (k.error) {
          setFehler(k.error.message)
          setLaedt(false)
          return
        }
        kostenListe.push(...((k.data ?? []) as Kosten[]).map((x) => ({ ...x, betrag: Number(x.betrag) })))
        schichtListe.push(...((e.data ?? []) as Schicht[]))
      }
      setKosten(kostenListe)
      setSchichten(schichtListe)
      const p = await supabase.from('mitarbeiter').select('id, kategorie')
      setPersonBereich(
        Object.fromEntries(
          ((p.data ?? []) as { id: string; kategorie: string | null }[]).map((x) => [
            x.id,
            (x.kategorie ?? '').toLowerCase().includes('wagen') ? 'wagenmeister' : 'lokfuehrer',
          ])
        )
      )
      setLaedt(false)
    }
    laden()
  }, [von, bis, zaehler])

  const satz = (schluessel: string) => Number(saetze.find((x) => x.schluessel === schluessel)?.wert ?? 0)

  // Kosten je Auftrag
  const zeilen = auftraege.map((a) => {
    const erloes = a.preis ?? 0
    const eigene = kosten.filter((k) => k.auftrag_id === a.id)
    const nachArt = (art: string) => eigene.filter((k) => k.art === art).reduce((s, k) => s + k.betrag, 0)
    const meine = schichten.filter((x) => x.auftrag_id === a.id)
    const stdLok = meine.filter((x) => personBereich[x.mitarbeiter_id] !== 'wagenmeister').reduce((s, x) => s + schichtStunden(x), 0)
    const stdWgm = meine.filter((x) => personBereich[x.mitarbeiter_id] === 'wagenmeister').reduce((s, x) => s + schichtStunden(x), 0)
    const personalIntern = stdLok * satz('personal_lokfuehrer') + stdWgm * satz('personal_wagenmeister')
    const manuell = eigene.reduce((s, k) => s + k.betrag, 0)
    const summe = personalIntern + manuell
    const gewinn = erloes - summe
    return {
      a,
      erloes,
      trasse: nachArt('trasse'),
      energie: nachArt('strom') + nachArt('diesel'),
      extern: nachArt('personal_extern'),
      wu: nachArt('wu'),
      sonstiges: nachArt('sonstiges'),
      personalIntern,
      stunden: stdLok + stdWgm,
      summe,
      gewinn,
      marge: erloes > 0 ? (gewinn / erloes) * 100 : null,
      ohneKosten: eigene.length === 0 && personalIntern === 0,
      ohnePreis: a.preis == null,
    }
  })

  const gesErloes = zeilen.reduce((s, z) => s + z.erloes, 0)
  const gesKosten = zeilen.reduce((s, z) => s + z.summe, 0)
  const gesGewinn = gesErloes - gesKosten
  const verlust = zeilen.filter((z) => z.gewinn < 0 && !z.ohnePreis).length
  const ohneKosten = zeilen.filter((z) => z.ohneKosten).length
  const ohnePreis = zeilen.filter((z) => z.ohnePreis).length

  // Gruppierte Sicht
  interface Gruppenzeile {
    name: string
    anz: number
    erloes: number
    summe: number
    gewinn: number
  }
  const gruppen = new Map<string, Gruppenzeile>()
  for (const z of zeilen) {
    let key: string
    if (gruppe === 'kunde') key = z.a.kunde ?? '(ohne Kunde)'
    else if (gruppe === 'strecke') key = `${z.a.abfahrt_ort ?? '?'} → ${z.a.ankunft_ort ?? '?'}`
    else key = MONATE[Number(z.a.abfahrt_datum.slice(5, 7)) - 1] + ' ' + z.a.abfahrt_datum.slice(0, 4)
    const g = gruppen.get(key) ?? { name: key, anz: 0, erloes: 0, summe: 0, gewinn: 0 }
    g.anz += 1
    g.erloes += z.erloes
    g.summe += z.summe
    g.gewinn += z.gewinn
    gruppen.set(key, g)
  }
  const gruppenListe = Array.from(gruppen.values()).sort((a, b) => (gruppe === 'monat' ? 0 : a.gewinn - b.gewinn))

  async function kostenAnlegen(auftragId: string) {
    const betrag = Number(neu.betrag.replace(',', '.'))
    if (!Number.isFinite(betrag) || neu.betrag.trim() === '') {
      setFehler('Bitte einen Betrag eintragen.')
      return
    }
    const { error } = await supabase.from('auftrag_kosten').insert({
      auftrag_id: auftragId,
      art: neu.art,
      bezeichnung: neu.bezeichnung.trim() || null,
      betrag,
    })
    if (error) {
      setFehler(error.message)
      return
    }
    setFehler(null)
    setNeu({ art: neu.art, bezeichnung: '', betrag: '' })
    setZaehler((z) => z + 1)
  }

  async function kostenLoeschen(id: string) {
    if (!window.confirm('Diese Kostenposition löschen?')) return
    const { error } = await supabase.from('auftrag_kosten').delete().eq('id', id)
    if (error) setFehler(error.message)
    else setZaehler((z) => z + 1)
  }

  async function saetzeSpeichern() {
    setMeldung(null)
    setFehler(null)
    for (const s of saetze) {
      const wert = Number((satzEntwurf[s.schluessel] ?? '0').replace(',', '.'))
      if (!Number.isFinite(wert) || wert < 0) {
        setFehler(`Ungültiger Wert bei „${s.bezeichnung}“.`)
        return
      }
      if (wert !== Number(s.wert)) {
        const { error } = await supabase.from('kosten_saetze').update({ wert }).eq('schluessel', s.schluessel)
        if (error) {
          setFehler(error.message)
          return
        }
      }
    }
    setMeldung('Kostensätze gespeichert.')
    setZaehler((z) => z + 1)
  }

  function csv() {
    const kopf = ['Datum', 'Kunde', 'Referenz', 'Zug', 'Strecke', 'Status', 'Erlös', 'Personal intern', 'Personal extern', 'Trasse', 'Energie', 'WU', 'Sonstiges', 'Kosten gesamt', 'Gewinn', 'Marge %']
    const f = (v: number) => v.toFixed(2).replace('.', ',')
    const rows = zeilen.map((z) => [
      datumDeutsch(z.a.abfahrt_datum),
      z.a.kunde ?? '',
      z.a.referenz ?? '',
      z.a.zug_nr ?? '',
      `${z.a.abfahrt_ort ?? ''} - ${z.a.ankunft_ort ?? ''}`,
      z.a.status,
      f(z.erloes),
      f(z.personalIntern),
      f(z.extern),
      f(z.trasse),
      f(z.energie),
      f(z.wu),
      f(z.sonstiges),
      f(z.summe),
      f(z.gewinn),
      z.marge == null ? '' : f(z.marge),
    ])
    const text = [kopf, ...rows].map((r) => r.map((w) => `"${String(w).replace(/"/g, '""')}"`).join(';')).join('\r\n')
    const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `Wirtschaftlichkeit_${jahr}${monat === -1 ? '' : '-' + String(monat + 1).padStart(2, '0')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const feld: React.CSSProperties = { padding: '5px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13 }
  const zelle: React.CSSProperties = { padding: '6px 8px', borderBottom: '1px solid #eef2f8', fontSize: 12.5, textAlign: 'left', verticalAlign: 'top' }
  const rechts: React.CSSProperties = { ...zelle, textAlign: 'right', whiteSpace: 'nowrap' }
  const kachel: React.CSSProperties = { background: '#f1f5f9', borderRadius: 10, padding: '10px 14px', minWidth: 140, flex: '1 1 140px' }
  const knopf = (aktiv: boolean): React.CSSProperties => ({
    background: aktiv ? '#14325c' : '#eef2f8',
    color: aktiv ? '#ffffff' : '#14325c',
    border: 'none',
    borderRadius: 999,
    padding: '6px 14px',
    fontSize: 13,
    cursor: 'pointer',
  })
  const gewinnFarbe = (v: number) => (v < 0 ? '#b91c1c' : '#15803d')

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
        <button style={knopf(ansicht === 'auswertung')} onClick={() => setAnsicht('auswertung')}>
          Auswertung
        </button>
        <button style={knopf(ansicht === 'saetze')} onClick={() => setAnsicht('saetze')}>
          Kostensätze
        </button>
        <span style={{ width: 8 }} />
        <select value={jahr} onChange={(e) => setJahr(Number(e.target.value))} style={feld}>
          {[heute.getFullYear() - 1, heute.getFullYear(), heute.getFullYear() + 1].map((j) => (
            <option key={j} value={j}>
              {j}
            </option>
          ))}
        </select>
        <select value={monat} onChange={(e) => setMonat(Number(e.target.value))} style={feld}>
          <option value={-1}>Ganzes Jahr</option>
          {MONATE.map((m, i) => (
            <option key={m} value={i}>
              {m}
            </option>
          ))}
        </select>
        {laedt && <span style={{ fontSize: 12, color: '#64748b' }}>Lade...</span>}
      </div>
      {fehler && <div style={{ background: '#fee2e2', color: '#991b1b', padding: '8px 12px', borderRadius: 8, fontSize: 13, marginBottom: 10 }}>{fehler}</div>}
      {meldung && <div style={{ background: '#dcfce7', color: '#166534', padding: '8px 12px', borderRadius: 8, fontSize: 13, marginBottom: 10 }}>{meldung}</div>}

      {ansicht === 'saetze' && (
        <div style={{ maxWidth: 560 }}>
          <p style={{ fontSize: 13, color: '#475569', marginTop: 0 }}>
            Diese Sätze gelten für die automatische Berechnung. Die Personalkosten intern ergeben sich aus den Stunden der Auftragsschichten mal dem Stundensatz
            (Pausen zählen nicht mit). Strom, Diesel, WU, Trasse und externes Personal trägst du pro Auftrag in der Auswertung ein.
          </p>
          {saetze.map((s) => (
            <div key={s.schluessel} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '1px solid #eef2f8' }}>
              <div style={{ flex: 1, fontSize: 13 }}>
                {s.bezeichnung}
                <div style={{ fontSize: 11, color: '#64748b' }}>{s.einheit}</div>
              </div>
              <input
                value={satzEntwurf[s.schluessel] ?? ''}
                onChange={(e) => setSatzEntwurf((alt) => ({ ...alt, [s.schluessel]: e.target.value }))}
                style={{ ...feld, width: 100, textAlign: 'right' }}
              />
            </div>
          ))}
          <button
            onClick={saetzeSpeichern}
            style={{ marginTop: 12, padding: '7px 16px', borderRadius: 8, border: 'none', background: '#14325c', color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}
          >
            Sätze speichern
          </button>
        </div>
      )}

      {ansicht === 'auswertung' && (
        <>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
            <div style={kachel}>
              <div style={{ fontSize: 11, color: '#64748b' }}>Erlös</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--navy)' }}>{euro(gesErloes)}</div>
            </div>
            <div style={kachel}>
              <div style={{ fontSize: 11, color: '#64748b' }}>Kosten</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: '#334155' }}>{euro(gesKosten)}</div>
            </div>
            <div style={kachel}>
              <div style={{ fontSize: 11, color: '#64748b' }}>Gewinn</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: gewinnFarbe(gesGewinn) }}>
                {euro(gesGewinn)}{' '}
                <span style={{ fontSize: 13 }}>{gesErloes > 0 ? `(${prozent((gesGewinn / gesErloes) * 100)})` : ''}</span>
              </div>
            </div>
            <div style={kachel}>
              <div style={{ fontSize: 11, color: '#64748b' }}>Verlustaufträge</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: verlust > 0 ? '#b91c1c' : '#334155' }}>{verlust}</div>
            </div>
          </div>
          {(ohneKosten > 0 || ohnePreis > 0) && (
            <div style={{ background: '#fef3c7', color: '#92400e', padding: '8px 12px', borderRadius: 8, fontSize: 13, marginBottom: 12 }}>
              {ohneKosten > 0 && <div>Bei {ohneKosten} Aufträgen sind noch keine Kosten erfasst. Ihr Gewinn ist deshalb zu hoch ausgewiesen.</div>}
              {ohnePreis > 0 && <div>Bei {ohnePreis} Aufträgen fehlt der Preis (Erlös 0).</div>}
            </div>
          )}

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10, alignItems: 'center' }}>
            {(
              [
                ['auftrag', 'Pro Auftrag'],
                ['kunde', 'Pro Kunde'],
                ['strecke', 'Pro Strecke'],
                ['monat', 'Pro Monat'],
              ] as [Gruppierung, string][]
            ).map(([id, text]) => (
              <button key={id} style={knopf(gruppe === id)} onClick={() => setGruppe(id)}>
                {text}
              </button>
            ))}
            <button onClick={csv} style={{ ...knopf(false), marginLeft: 'auto' }} title="Als Excel-Datei (CSV) speichern">
              Export (CSV)
            </button>
          </div>

          {gruppe !== 'auftrag' ? (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 560 }}>
                <thead>
                  <tr style={{ background: '#f1f5f9' }}>
                    <th style={zelle}>{gruppe === 'kunde' ? 'Kunde' : gruppe === 'strecke' ? 'Strecke' : 'Monat'}</th>
                    <th style={rechts}>Aufträge</th>
                    <th style={rechts}>Erlös</th>
                    <th style={rechts}>Kosten</th>
                    <th style={rechts}>Gewinn</th>
                    <th style={rechts}>Marge</th>
                  </tr>
                </thead>
                <tbody>
                  {gruppenListe.map((g) => (
                    <tr key={g.name}>
                      <td style={zelle}>{g.name}</td>
                      <td style={rechts}>{g.anz}</td>
                      <td style={rechts}>{euro(g.erloes)}</td>
                      <td style={rechts}>{euro(g.summe)}</td>
                      <td style={{ ...rechts, fontWeight: 700, color: gewinnFarbe(g.gewinn) }}>{euro(g.gewinn)}</td>
                      <td style={rechts}>{g.erloes > 0 ? prozent((g.gewinn / g.erloes) * 100) : '–'}</td>
                    </tr>
                  ))}
                  {gruppenListe.length === 0 && (
                    <tr>
                      <td style={zelle} colSpan={6}>
                        <span style={{ color: '#94a3b8' }}>Keine gefahrenen oder stornierten Aufträge im Zeitraum.</span>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 860 }}>
                <thead>
                  <tr style={{ background: '#f1f5f9' }}>
                    <th style={zelle}>Datum</th>
                    <th style={zelle}>Auftrag</th>
                    <th style={rechts}>Erlös</th>
                    <th style={rechts}>Personal</th>
                    <th style={rechts}>Trasse</th>
                    <th style={rechts}>Energie</th>
                    <th style={rechts}>WU</th>
                    <th style={rechts}>Sonst.</th>
                    <th style={rechts}>Gewinn</th>
                    <th style={rechts}>Marge</th>
                  </tr>
                </thead>
                <tbody>
                  {zeilen.map((z) => (
                    <Fragment key={z.a.id}>
                      <tr
                        onClick={() => setOffenId(offenId === z.a.id ? null : z.a.id)}
                        style={{ cursor: 'pointer', background: offenId === z.a.id ? '#f8fafc' : undefined }}
                      >
                        <td style={zelle}>{datumDeutsch(z.a.abfahrt_datum)}</td>
                        <td style={zelle}>
                          <b>{z.a.referenz || z.a.zug_nr || 'Auftrag'}</b> · {z.a.kunde ?? '–'}
                          {z.a.status === 'storniert' && <span style={{ color: '#b91c1c', fontWeight: 600 }}> · Storno</span>}
                          <div style={{ fontSize: 11, color: '#64748b' }}>
                            {z.a.abfahrt_ort} → {z.a.ankunft_ort}
                            {z.ohneKosten && <span style={{ color: '#b45309' }}> · keine Kosten erfasst</span>}
                          </div>
                        </td>
                        <td style={rechts}>{z.ohnePreis ? <span style={{ color: '#b45309' }}>Preis fehlt</span> : euro(z.erloes)}</td>
                        <td style={rechts}>{euro(z.personalIntern + z.extern)}</td>
                        <td style={rechts}>{euro(z.trasse)}</td>
                        <td style={rechts}>{euro(z.energie)}</td>
                        <td style={rechts}>{euro(z.wu)}</td>
                        <td style={rechts}>{euro(z.sonstiges)}</td>
                        <td style={{ ...rechts, fontWeight: 700, color: gewinnFarbe(z.gewinn) }}>{euro(z.gewinn)}</td>
                        <td style={rechts}>{z.marge == null ? '–' : prozent(z.marge)}</td>
                      </tr>
                      {offenId === z.a.id && (
                        <tr>
                          <td colSpan={10} style={{ padding: '10px 14px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                            <div style={{ fontSize: 12, color: '#475569', marginBottom: 6 }}>
                              Personal intern: {z.stunden.toLocaleString('de-DE', { maximumFractionDigits: 1 })} Std. aus den Schichten = {euro(z.personalIntern)}
                              {z.stunden === 0 && ' (noch keine Schichten zugeteilt)'}
                            </div>
                            {kosten
                              .filter((k) => k.auftrag_id === z.a.id)
                              .map((k) => (
                                <div key={k.id} style={{ display: 'flex', gap: 10, fontSize: 13, padding: '3px 0', alignItems: 'center' }}>
                                  <span style={{ width: 170 }}>{ARTEN.find((x) => x.id === k.art)?.text ?? k.art}</span>
                                  <span style={{ flex: 1, color: '#64748b' }}>{k.bezeichnung ?? ''}</span>
                                  <b>{euro(k.betrag)}</b>
                                  <button
                                    onClick={() => kostenLoeschen(k.id)}
                                    style={{ background: 'none', border: 'none', color: '#b91c1c', cursor: 'pointer', fontSize: 12 }}
                                  >
                                    löschen
                                  </button>
                                </div>
                              ))}
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8, alignItems: 'center' }}>
                              <select value={neu.art} onChange={(e) => setNeu({ ...neu, art: e.target.value })} style={feld}>
                                {ARTEN.map((x) => (
                                  <option key={x.id} value={x.id}>
                                    {x.text}
                                  </option>
                                ))}
                              </select>
                              <input
                                value={neu.bezeichnung}
                                onChange={(e) => setNeu({ ...neu, bezeichnung: e.target.value })}
                                placeholder="Notiz (optional)"
                                style={{ ...feld, minWidth: 180 }}
                              />
                              <input
                                value={neu.betrag}
                                onChange={(e) => setNeu({ ...neu, betrag: e.target.value })}
                                placeholder="Betrag in EUR"
                                style={{ ...feld, width: 120, textAlign: 'right' }}
                              />
                              <button
                                onClick={() => kostenAnlegen(z.a.id)}
                                style={{ padding: '6px 12px', borderRadius: 6, border: 'none', background: '#14325c', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                              >
                                Hinzufügen
                              </button>
                              {neu.art === 'wu' && satz('wu_pauschale') > 0 && (
                                <button
                                  onClick={() => setNeu({ ...neu, betrag: String(satz('wu_pauschale')).replace('.', ',') })}
                                  style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #cbd5e1', background: '#fff', fontSize: 12, cursor: 'pointer' }}
                                >
                                  WU-Standardbetrag ({euro(satz('wu_pauschale'))})
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                  {zeilen.length === 0 && (
                    <tr>
                      <td style={zelle} colSpan={10}>
                        <span style={{ color: '#94a3b8' }}>Keine gefahrenen oder stornierten Aufträge im Zeitraum.</span>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
          <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 10 }}>
            Erlös = Preis aus der Abrechnung (gefahren und storniert). Klick auf einen Auftrag öffnet die Kostenpositionen. Externes Personal bitte nur hier eintragen, wenn
            die Person nicht im Dienstplan als Mitarbeiter geführt wird, sonst wird sie doppelt gezählt.
          </p>
        </>
      )}
    </div>
  )
}
