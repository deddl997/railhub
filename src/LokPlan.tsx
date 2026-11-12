import { useCallback, useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from './lib/supabase'
import { useLiveAktualisierung } from './liveAktualisierung'
import { datumZuISO } from './datumUtils'
import { fahrtenAusAuftrag, fahrtenPruefen } from './auftragSchicht'
import type { Fahrtzeile } from './auftragSchicht'

// Mindest-Wendezeit zwischen zwei Leistungen derselben Lok (Minuten). Darunter gibt es eine Warnung.
const WENDE_MINUTEN = 15
const OHNE_LOK = '(ohne Lok)'
const WOCHENTAGE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']

interface AuftragZeile {
  id: string
  kunde: string | null
  referenz: string | null
  zug_nr: string | null
  abfahrt_ort: string | null
  abfahrt_datum: string
  abfahrt_soll: string | null
  ankunft_ort: string | null
  ankunft_datum: string | null
  ankunft_soll: string | null
  lok: string | null
  fahrten: unknown
  status: string | null
  storno_datum: string | null
}

interface Leistung {
  key: string
  auftragId: string
  lok: string
  art: string
  titel: string
  kunde: string
  von: string
  nach: string
  start: number // Minuten seit 1970 (lokale Zeit als UTC gelesen)
  ende: number
  warnungen: string[]
}

type Ansicht = 'tag' | 'woche'

// ---------- Hilfen ----------
function tagStart(iso: string): number {
  const [j, m, t] = iso.split('-').map(Number)
  return Date.UTC(j, m - 1, t) / 60000
}
function zeitMin(z: string): number {
  const [h, m] = z.slice(0, 5).split(':').map(Number)
  return h * 60 + m
}
function isoPlus(iso: string, tage: number): string {
  const [j, m, t] = iso.split('-').map(Number)
  return datumZuISO(new Date(j, m - 1, t + tage))
}
function montagVon(iso: string): string {
  const [j, m, t] = iso.split('-').map(Number)
  const d = new Date(j, m - 1, t)
  const wt = (d.getDay() + 6) % 7
  return datumZuISO(new Date(j, m - 1, t - wt))
}
function minutenAlsUhr(abs: number): string {
  const rest = ((abs % 1440) + 1440) % 1440
  return `${String(Math.floor(rest / 60)).padStart(2, '0')}:${String(rest % 60).padStart(2, '0')}`
}
function absAlsIso(abs: number): string {
  const d = new Date(abs * 60000)
  return datumZuISO(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}
function datumDe(iso: string): string {
  const [j, m, t] = iso.split('-')
  return `${t}.${m}.${j}`
}
function ortGleich(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}
function lokName(roh: string | null | undefined): string {
  const t = (roh ?? '').replace(/\s+/g, ' ').trim()
  return t === '' ? OHNE_LOK : t
}

// Zerlegt die Aufträge in einzelne Leistungen (Lokzuführung, Zugfahrt, Rückführung, Rangieren ...) mit absoluten Zeiten
function leistungenAus(auftraege: AuftragZeile[]): Leistung[] {
  const ergebnis: Leistung[] = []
  for (const a of auftraege) {
    let fahrten: Fahrtzeile[] = fahrtenPruefen(a.fahrten).filter((f) => f.von_zeit && f.nach_zeit)
    if (fahrten.length === 0) {
      fahrten = fahrtenAusAuftrag({
        referenz: a.referenz,
        zug_nr: a.zug_nr,
        abfahrt_ort: a.abfahrt_ort,
        abfahrt_datum: a.abfahrt_datum,
        abfahrt_soll: a.abfahrt_soll,
        ankunft_ort: a.ankunft_ort,
        ankunft_datum: a.ankunft_datum,
        ankunft_soll: a.ankunft_soll,
        lok: a.lok,
        mitarbeiter_info: null,
      }).filter((f) => f.von_zeit && f.nach_zeit)
    }
    if (fahrten.length === 0) continue

    const basis = tagStart(a.abfahrt_datum)
    let versatz = 0
    // liegt die erste Zeit viel später als die Abfahrt des Auftrags, war sie am Vortag (z. B. Lokzuführung am Abend)
    if (a.abfahrt_soll && zeitMin(fahrten[0].von_zeit) - zeitMin(a.abfahrt_soll) > 720) versatz = -1440
    let letzte = -Infinity
    fahrten.forEach((f, i) => {
      let start = (f.datum ? tagStart(f.datum) : basis + versatz) + zeitMin(f.von_zeit)
      while (start < letzte) start += 1440
      let ende = start - zeitMin(f.von_zeit) + zeitMin(f.nach_zeit)
      while (ende < start) ende += 1440
      letzte = ende
      const titel = f.zug || [a.referenz, a.zug_nr ? `(${a.zug_nr})` : ''].filter(Boolean).join(' ') || f.art
      ergebnis.push({
        key: `${a.id}-${i}`,
        auftragId: a.id,
        lok: lokName(f.lok || a.lok),
        art: f.art,
        titel,
        kunde: a.kunde ?? '',
        von: f.von,
        nach: f.nach,
        start,
        ende,
        warnungen: [],
      })
    })
  }
  return ergebnis
}

// Prüft pro Lok: Doppelbelegung, zu kurze Wendezeit, Ortssprung
function pruefen(leistungen: Leistung[]): string[] {
  const hinweise: string[] = []
  const proLok = new Map<string, Leistung[]>()
  for (const l of leistungen) {
    if (l.lok === OHNE_LOK) continue
    proLok.set(l.lok, [...(proLok.get(l.lok) ?? []), l])
  }
  for (const [lok, liste] of proLok) {
    liste.sort((a, b) => a.start - b.start)
    for (let i = 1; i < liste.length; i++) {
      const v = liste[i - 1]
      const n = liste[i]
      const bezug = `Lok ${lok}: ${v.titel} (${minutenAlsUhr(v.start)}–${minutenAlsUhr(v.ende)}) und ${n.titel} (${minutenAlsUhr(n.start)}–${minutenAlsUhr(n.ende)}, ${datumDe(absAlsIso(n.start))})`
      if (n.start < v.ende && n.auftragId !== v.auftragId) {
        v.warnungen.push('Doppelbelegung')
        n.warnungen.push('Doppelbelegung')
        hinweise.push(`${bezug}: Doppelbelegung, die Lok ist zweimal gleichzeitig eingeplant.`)
      } else if (n.start >= v.ende && n.start - v.ende < WENDE_MINUTEN) {
        v.warnungen.push('Wendezeit')
        n.warnungen.push('Wendezeit')
        hinweise.push(`${bezug}: nur ${n.start - v.ende} Min. Wendezeit (Minimum ${WENDE_MINUTEN} Min.).`)
      }
      if (v.nach && n.von && !ortGleich(v.nach, n.von) && n.start >= v.ende) {
        v.warnungen.push('Ortssprung')
        n.warnungen.push('Ortssprung')
        hinweise.push(`Lok ${lok}: ${v.titel} endet in ${v.nach}, die nächste Leistung ${n.titel} beginnt in ${n.von}.`)
      }
    }
  }
  return hinweise
}

function farbe(art: string): { bg: string; fg: string; rand: string } {
  if (art === 'Zugfahrt') return { bg: '#14325c', fg: '#ffffff', rand: '#14325c' }
  if (art === 'Lokzuführung' || art === 'Lokrückführung') return { bg: '#e2e8f0', fg: '#334155', rand: '#94a3b8' }
  return { bg: '#fde68a', fg: '#92400e', rand: '#f59e0b' }
}

const knopf = (primaer: boolean): React.CSSProperties => ({
  border: '1px solid var(--navy)',
  background: primaer ? 'var(--navy)' : '#fff',
  color: primaer ? '#fff' : 'var(--navy)',
  borderRadius: 6,
  padding: '6px 12px',
  fontSize: 13,
  cursor: 'pointer',
})

export default function LokPlan() {
  const heuteIso = datumZuISO(new Date())
  const [ansicht, setAnsicht] = useState<Ansicht>('tag')
  const [tag, setTag] = useState(heuteIso)
  const [auftraege, setAuftraege] = useState<AuftragZeile[]>([])
  const [tfProAuftrag, setTfProAuftrag] = useState<Map<string, string[]>>(new Map())
  const [laedt, setLaedt] = useState(true)
  const [fehler, setFehler] = useState<string | null>(null)
  const [gewaehlt, setGewaehlt] = useState<string | null>(null)

  const vonIso = ansicht === 'tag' ? tag : montagVon(tag)
  const bisIso = ansicht === 'tag' ? tag : isoPlus(montagVon(tag), 6)

  const laden = useCallback(async () => {
    const r = await supabase
      .from('auftraege')
      .select('id, kunde, referenz, zug_nr, abfahrt_ort, abfahrt_datum, abfahrt_soll, ankunft_ort, ankunft_datum, ankunft_soll, lok, fahrten, status, storno_datum')
      .gte('abfahrt_datum', isoPlus(vonIso, -1))
      .lte('abfahrt_datum', isoPlus(bisIso, 1))
    if (r.error) {
      setFehler(r.error.message)
      setLaedt(false)
      return
    }
    const liste = ((r.data ?? []) as AuftragZeile[]).filter((a) => !a.storno_datum && a.status !== 'storniert')
    setAuftraege(liste)

    // Eingeteilte Lokführer aus dem Dienstplan
    const ids = liste.map((a) => a.id)
    const eintraege: { auftrag_id: string; mitarbeiter_id: string }[] = []
    for (let i = 0; i < ids.length; i += 80) {
      const e = await supabase.from('dienstplan_eintraege').select('auftrag_id, mitarbeiter_id').in('auftrag_id', ids.slice(i, i + 80))
      if (!e.error) eintraege.push(...((e.data ?? []) as { auftrag_id: string; mitarbeiter_id: string }[]))
    }
    const m = await supabase.from('mitarbeiter').select('id, name')
    const namen = new Map(((m.data ?? []) as { id: string; name: string }[]).map((x) => [x.id, x.name]))
    const karte = new Map<string, string[]>()
    for (const e of eintraege) {
      const n = namen.get(e.mitarbeiter_id)
      if (!n) continue
      const alt = karte.get(e.auftrag_id) ?? []
      if (!alt.includes(n)) karte.set(e.auftrag_id, [...alt, n])
    }
    setTfProAuftrag(karte)
    setFehler(null)
    setLaedt(false)
  }, [vonIso, bisIso])

  useEffect(() => {
    setLaedt(true)
    void laden()
  }, [laden])
  useLiveAktualisierung(['auftraege', 'dienstplan_eintraege'], laden)

  // Alle Leistungen, die das gewählte Zeitfenster berühren
  const fensterStart = tagStart(vonIso)
  const fensterEnde = tagStart(bisIso) + 1440
  const { leistungen, hinweise } = useMemo(() => {
    const alle = leistungenAus(auftraege)
    const hinw = pruefen(alle)
    const imFenster = alle.filter((l) => l.ende > fensterStart && l.start < fensterEnde)
    // Hinweise nur für Leistungen im Fenster
    const relevant = hinw.filter((h) => imFenster.some((l) => h.includes(l.titel)))
    return { leistungen: imFenster, hinweise: Array.from(new Set(relevant)) }
  }, [auftraege, fensterStart, fensterEnde])

  const loks = useMemo(() => {
    const namen = Array.from(new Set(leistungen.map((l) => l.lok)))
    return namen.sort((a, b) => (a === OHNE_LOK ? -1 : b === OHNE_LOK ? 1 : a.localeCompare(b, 'de', { numeric: true })))
  }, [leistungen])

  const ohneLokAnzahl = new Set(leistungen.filter((l) => l.lok === OHNE_LOK).map((l) => l.auftragId)).size
  const gewaehlteLeistung = leistungen.find((l) => l.key === gewaehlt) ?? null

  function springen(tage: number) {
    setTag(isoPlus(tag, ansicht === 'tag' ? tage : tage * 7))
    setGewaehlt(null)
  }

  // ---------- Excel ----------
  function excelExportieren() {
    const zeilen = [...leistungen]
      .sort((a, b) => a.lok.localeCompare(b.lok, 'de', { numeric: true }) || a.start - b.start)
      .map((l) => ({
        Datum: datumDe(absAlsIso(l.start)),
        Lok: l.lok,
        Art: l.art,
        Zug: l.titel,
        Kunde: l.kunde,
        Von: l.von,
        Nach: l.nach,
        Beginn: minutenAlsUhr(l.start),
        Ende: minutenAlsUhr(l.ende),
        Lokführer: (tfProAuftrag.get(l.auftragId) ?? []).join(', '),
        Hinweis: Array.from(new Set(l.warnungen)).join(', '),
      }))
    const mappe = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(mappe, XLSX.utils.json_to_sheet(zeilen), 'Lokplan')
    XLSX.writeFile(mappe, `Lokplan_${vonIso}${vonIso === bisIso ? '' : '_bis_' + bisIso}.xlsx`)
  }

  const tageDerWoche = Array.from({ length: 7 }, (_, i) => isoPlus(montagVon(tag), i))

  // ---------- Darstellung ----------
  const kopf = (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
      <button style={knopf(ansicht === 'tag')} onClick={() => setAnsicht('tag')}>Tag</button>
      <button style={knopf(ansicht === 'woche')} onClick={() => setAnsicht('woche')}>Woche</button>
      <span style={{ width: 8 }} />
      <button style={knopf(false)} onClick={() => springen(-1)} aria-label="Zurück">◀</button>
      <input
        type="date"
        value={tag}
        onChange={(e) => e.target.value && (setTag(e.target.value), setGewaehlt(null))}
        style={{ padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 14 }}
      />
      <button style={knopf(false)} onClick={() => springen(1)} aria-label="Weiter">▶</button>
      <button style={knopf(false)} onClick={() => (setTag(heuteIso), setGewaehlt(null))}>Heute</button>
      <span style={{ flex: 1 }} />
      <button style={knopf(false)} onClick={excelExportieren}>⬇ Excel</button>
      <button style={knopf(false)} onClick={() => window.print()}>🖨 Drucken / PDF</button>
    </div>
  )

  return (
    <div id="lokplan-druck">
      <style>{`@media print { body * { visibility: hidden !important; } #lokplan-druck, #lokplan-druck * { visibility: visible !important; } #lokplan-druck { position: absolute; left: 0; top: 0; width: 100%; } .lp-nodruck { display: none !important; } }`}</style>
      <div className="lp-nodruck">{kopf}</div>
      <div style={{ fontWeight: 600, marginBottom: 10, color: '#14325c' }}>
        {ansicht === 'tag' ? `${WOCHENTAGE[new Date(tag).getDay()]}, ${datumDe(tag)}` : `Woche ${datumDe(vonIso)} – ${datumDe(bisIso)}`}
      </div>

      {fehler && <p style={{ color: 'var(--danger)' }}>Fehler: {fehler}</p>}
      {laedt ? (
        <p style={{ color: 'var(--text-muted)' }}>Lädt…</p>
      ) : leistungen.length === 0 ? (
        <p style={{ color: 'var(--text-muted)' }}>Keine Aufträge mit Zeiten in diesem Zeitraum.</p>
      ) : (
        <>
          {(ohneLokAnzahl > 0 || hinweise.length > 0) && (
            <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 12px', marginBottom: 14, fontSize: 13, color: '#92400e' }}>
              <b>Hinweise ({hinweise.length + (ohneLokAnzahl > 0 ? 1 : 0)})</b>
              <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {ohneLokAnzahl > 0 && <li>{ohneLokAnzahl} Auftrag/Aufträge ohne Lok (Zeile „{OHNE_LOK}“). Die Lok wird im Auftrag eingetragen.</li>}
                {hinweise.map((h) => (
                  <li key={h}>{h}</li>
                ))}
              </ul>
            </div>
          )}

          {ansicht === 'tag' ? (
            <TagesBalken tag={tag} leistungen={leistungen} loks={loks} gewaehlt={gewaehlt} onWahl={setGewaehlt} />
          ) : (
            <WochenTabelle tage={tageDerWoche} leistungen={leistungen} loks={loks} tfProAuftrag={tfProAuftrag} onWahl={(k) => { setGewaehlt(k) }} />
          )}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', marginTop: 12, fontSize: 12, color: 'var(--text-muted)' }} className="lp-nodruck">
            <span><i style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, background: '#14325c', marginRight: 5, verticalAlign: -2 }} />Zugfahrt</span>
            <span><i style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, background: '#e2e8f0', border: '1px dashed #94a3b8', marginRight: 5, verticalAlign: -2 }} />Lokzuführung / Rückführung</span>
            <span><i style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, background: '#fde68a', marginRight: 5, verticalAlign: -2 }} />Rangieren, Warten, Sonstiges</span>
            <span><i style={{ display: 'inline-block', width: 12, height: 12, borderRadius: 3, outline: '2px solid #b91c1c', marginRight: 5, verticalAlign: -2 }} />Warnung</span>
          </div>

          {gewaehlteLeistung && (
            <div className="lp-nodruck" style={{ marginTop: 14, border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px', background: '#f8fafc', fontSize: 14 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>
                {gewaehlteLeistung.art}: {gewaehlteLeistung.titel}
              </div>
              <div>
                {gewaehlteLeistung.von || '?'} {minutenAlsUhr(gewaehlteLeistung.start)} → {gewaehlteLeistung.nach || '?'} {minutenAlsUhr(gewaehlteLeistung.ende)}
                <span style={{ color: 'var(--text-muted)' }}> · {datumDe(absAlsIso(gewaehlteLeistung.start))}</span>
              </div>
              <div>Lok: <b>{gewaehlteLeistung.lok}</b></div>
              {gewaehlteLeistung.kunde && <div style={{ color: 'var(--text-muted)' }}>Kunde: {gewaehlteLeistung.kunde}</div>}
              <div>
                Lokführer im Dienstplan:{' '}
                {(tfProAuftrag.get(gewaehlteLeistung.auftragId) ?? []).length > 0 ? (
                  <b>{(tfProAuftrag.get(gewaehlteLeistung.auftragId) ?? []).join(', ')}</b>
                ) : (
                  <span style={{ color: '#b45309' }}>noch niemand eingeteilt</span>
                )}
              </div>
              {gewaehlteLeistung.warnungen.length > 0 && (
                <div style={{ color: '#b91c1c', marginTop: 4 }}>⚠ {Array.from(new Set(gewaehlteLeistung.warnungen)).join(', ')}</div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ---------- Tagesansicht ----------
function TagesBalken({
  tag,
  leistungen,
  loks,
  gewaehlt,
  onWahl,
}: {
  tag: string
  leistungen: Leistung[]
  loks: string[]
  gewaehlt: string | null
  onWahl: (k: string | null) => void
}) {
  const start = tagStart(tag)
  const prozent = (min: number) => ((Math.min(Math.max(min, start), start + 1440) - start) / 1440) * 100
  return (
    <div style={{ fontSize: 12 }}>
      <div style={{ display: 'flex', marginLeft: 120, position: 'relative', height: 18, color: 'var(--text-muted)' }}>
        <div style={{ position: 'relative', flex: 1 }}>
          {[0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => (
            <span key={h} style={{ position: 'absolute', left: `${(h / 24) * 100}%`, transform: 'translateX(-50%)', fontSize: 11 }}>
              {String(h).padStart(2, '0')}:00
            </span>
          ))}
        </div>
      </div>
      {loks.map((lok) => {
        const meine = leistungen.filter((l) => l.lok === lok)
        const ohne = lok === OHNE_LOK
        return (
          <div key={lok} style={{ display: 'flex', alignItems: 'center', borderTop: '1px solid var(--border)', minHeight: 44 }}>
            <div style={{ width: 120, flex: 'none', fontWeight: 600, fontSize: 13, color: ohne ? '#b91c1c' : 'var(--text)' }}>{lok}</div>
            <div style={{ position: 'relative', flex: 1, height: 34, background: ohne ? '#fef2f2' : '#f1f5f9', borderRadius: 4 }}>
              {[3, 6, 9, 12, 15, 18, 21].map((h) => (
                <div key={h} style={{ position: 'absolute', left: `${(h / 24) * 100}%`, top: 0, bottom: 0, borderLeft: '1px solid #e2e8f0' }} />
              ))}
              {meine.map((l) => {
                const f = farbe(l.art)
                const links = prozent(l.start)
                const breite = Math.max(prozent(l.ende) - links, 0.8)
                const warn = l.warnungen.length > 0
                return (
                  <div
                    key={l.key}
                    onClick={() => onWahl(gewaehlt === l.key ? null : l.key)}
                    title={`${l.art}: ${l.titel}\n${l.von} ${minutenAlsUhr(l.start)} → ${l.nach} ${minutenAlsUhr(l.ende)}`}
                    style={{
                      position: 'absolute',
                      top: 3,
                      height: 28,
                      left: `${links}%`,
                      width: `${breite}%`,
                      background: f.bg,
                      color: f.fg,
                      border: `1px ${l.art.startsWith('Lok') ? 'dashed' : 'solid'} ${f.rand}`,
                      outline: warn ? '2px solid #b91c1c' : gewaehlt === l.key ? '2px solid #f59e0b' : undefined,
                      outlineOffset: 1,
                      borderRadius: 4,
                      boxSizing: 'border-box',
                      overflow: 'hidden',
                      whiteSpace: 'nowrap',
                      fontSize: 11,
                      lineHeight: '26px',
                      padding: '0 5px',
                      cursor: 'pointer',
                    }}
                  >
                    {l.titel}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ---------- Wochenansicht ----------
function WochenTabelle({
  tage,
  leistungen,
  loks,
  tfProAuftrag,
  onWahl,
}: {
  tage: string[]
  leistungen: Leistung[]
  loks: string[]
  tfProAuftrag: Map<string, string[]>
  onWahl: (k: string | null) => void
}) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', minWidth: 900, fontSize: 12 }}>
        <colgroup>
          <col style={{ width: 110 }} />
          {tage.map((t) => (
            <col key={t} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: '6px', borderBottom: '1px solid var(--border-strong, #cbd5e1)', color: 'var(--text-muted)' }}>Lok</th>
            {tage.map((t) => (
              <th key={t} style={{ textAlign: 'left', padding: '6px', borderBottom: '1px solid var(--border-strong, #cbd5e1)', color: 'var(--text-muted)', fontWeight: 600 }}>
                {WOCHENTAGE[new Date(t).getDay()]} {t.slice(8, 10)}.{t.slice(5, 7)}.
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loks.map((lok) => (
            <tr key={lok}>
              <td style={{ verticalAlign: 'top', padding: 6, borderBottom: '1px solid var(--border)', fontWeight: 600, color: lok === OHNE_LOK ? '#b91c1c' : 'var(--text)' }}>{lok}</td>
              {tage.map((t) => {
                const ab = tagStart(t)
                const zelle = leistungen.filter((l) => l.lok === lok && l.start >= ab && l.start < ab + 1440).sort((a, b) => a.start - b.start)
                return (
                  <td key={t} style={{ verticalAlign: 'top', padding: 4, borderBottom: '1px solid var(--border)' }}>
                    {zelle.map((l) => {
                      const f = farbe(l.art)
                      const tf = tfProAuftrag.get(l.auftragId) ?? []
                      return (
                        <div
                          key={l.key}
                          onClick={() => onWahl(l.key)}
                          style={{
                            background: f.bg,
                            color: f.fg,
                            border: `1px ${l.art.startsWith('Lok') ? 'dashed' : 'solid'} ${f.rand}`,
                            outline: l.warnungen.length ? '2px solid #b91c1c' : undefined,
                            outlineOffset: 1,
                            borderRadius: 4,
                            padding: '3px 5px',
                            marginBottom: 4,
                            fontSize: 11,
                            lineHeight: 1.35,
                            cursor: 'pointer',
                          }}
                        >
                          <b>{l.titel}</b>
                          <div>
                            {minutenAlsUhr(l.start)}–{minutenAlsUhr(l.ende)} {l.von && l.nach ? `· ${l.von}→${l.nach}` : ''}
                          </div>
                          {tf.length > 0 && <div style={{ opacity: 0.9 }}>{tf.join(', ')}</div>}
                        </div>
                      )
                    })}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
