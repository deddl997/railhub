import type { ReactNode } from 'react'
import { fahrtenPruefen } from './auftragSchicht'

export interface KartenAuftrag {
  id: string
  kunde: string | null
  referenz: string | null
  zug_nr: string | null
  evu: string | null
  status: string
  abfahrt_ort: string | null
  abfahrt_datum: string
  abfahrt_soll: string | null
  abfahrt_ist: string | null
  ankunft_ort: string | null
  ankunft_soll: string | null
  ankunft_ist: string | null
  anzahl_wagen: number | null
  lok: string | null
  infos: string | null
  preis: number | null
  fahrten: unknown
}

export interface KartenBesetzung {
  namen: string[]
  offen: boolean
  spotId: string | null
  wgm: { namen: string[]; offen: boolean; spotId: string | null }
}

const kurz = (z: string | null | undefined) => (z ? z.slice(0, 5) : '')

function minuten(z: string): number {
  const [h, m] = z.split(':').map(Number)
  return h * 60 + m
}

export function abweichung(soll: string | null, ist: string | null): number | null {
  if (!soll || !ist) return null
  let d = minuten(kurz(ist)) - minuten(kurz(soll))
  if (d > 720) d -= 1440
  if (d < -720) d += 1440
  return d
}

interface Schritt {
  art: string
  zug: string
  von: string
  nach: string
  vonZeit: string
  nachZeit: string
  lok: string
  haupt: boolean
}

// Reihenfolge: Lokzuführung → Zugfahrt → Rückführung. Die Zugfahrt kommt immer aktuell aus dem Auftrag.
export function ablaufSchritte(a: KartenAuftrag): Schritt[] {
  const haupt: Schritt = {
    art: 'Zugfahrt',
    zug: [a.referenz, a.zug_nr ? `(${a.zug_nr})` : ''].filter(Boolean).join(' '),
    von: a.abfahrt_ort ?? '',
    nach: a.ankunft_ort ?? '',
    vonZeit: kurz(a.abfahrt_soll),
    nachZeit: kurz(a.ankunft_soll),
    lok: a.lok ?? '',
    haupt: true,
  }
  const gespeichert = fahrtenPruefen(a.fahrten).filter((f) => f.von || f.nach || f.von_zeit || f.nach_zeit)
  const index = gespeichert.findIndex((f) => f.art === 'Zugfahrt')
  if (gespeichert.length === 0 || index < 0) {
    const davor = gespeichert.filter((f) => f.art === 'Lokzuführung')
    const danach = gespeichert.filter((f) => f.art !== 'Lokzuführung')
    return [...davor, ...danach].length === 0 ? [haupt] : [...davor.map(zuSchritt), haupt, ...danach.map(zuSchritt)]
  }
  return gespeichert.map((f, i) => (i === index ? haupt : zuSchritt(f)))
}

function zuSchritt(f: ReturnType<typeof fahrtenPruefen>[number]): Schritt {
  return { art: f.art, zug: f.zug, von: f.von, nach: f.nach, vonZeit: f.von_zeit, nachZeit: f.nach_zeit, lok: f.lok, haupt: false }
}

function abwText(min: number | null): ReactNode {
  if (min === null || min === 0) return null
  return (
    <span style={{ color: min > 0 ? '#b91c1c' : '#15803d', fontWeight: 600 }}>
      {' '}
      ({min > 0 ? '+' : ''}
      {min} Min.)
    </span>
  )
}

export function Ablauf({ a }: { a: KartenAuftrag }) {
  const schritte = ablaufSchritte(a)
  return (
    <div>
      {schritte.map((s, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            gap: 10,
            alignItems: 'flex-start',
            borderLeft: `4px solid ${s.haupt ? '#14325c' : '#d97706'}`,
            background: s.haupt ? '#f1f5fb' : '#fffbeb',
            borderRadius: 6,
            padding: '6px 10px',
            marginBottom: 5,
          }}
        >
          <div style={{ minWidth: 50, fontWeight: 700, fontSize: 14, lineHeight: 1.35 }}>
            <div>{s.vonZeit || '–'}</div>
            <div style={{ color: '#64748b', fontWeight: 500 }}>{s.nachZeit || '–'}</div>
          </div>
          <div style={{ flex: 1, fontSize: 13, minWidth: 0 }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: 0.3, color: s.haupt ? '#14325c' : '#b45309', textTransform: 'uppercase' }}>
              {s.art}
              {s.zug ? ` · ${s.zug}` : ''}
            </div>
            <div>
              <b>{s.von || '?'}</b> → <b>{s.nach || '?'}</b>
            </div>
            {s.lok && <div style={{ fontSize: 11.5, color: '#64748b' }}>Lok {s.lok}</div>}
            {s.haupt && (a.abfahrt_ist || a.ankunft_ist) && (
              <div style={{ fontSize: 12, marginTop: 2 }}>
                Ist: ab {a.abfahrt_ist ? kurz(a.abfahrt_ist) : '–'}
                {abwText(abweichung(a.abfahrt_soll, a.abfahrt_ist))} · an {a.ankunft_ist ? kurz(a.ankunft_ist) : '–'}
                {abwText(abweichung(a.ankunft_soll, a.ankunft_ist))}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

const WOCHENTAGE_LANG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']

export function tagUeberschrift(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  return `${WOCHENTAGE_LANG[d.getDay()]}, ${iso.split('-').reverse().join('.')}`
}

function Person({
  titel,
  namen,
  offen,
  darfDisponieren,
  storniert,
  onAnlegen,
  onAendern,
}: {
  titel: string
  namen: string[]
  offen: boolean
  darfDisponieren: boolean
  storniert: boolean
  onAnlegen: () => void
  onAendern: () => void
}) {
  const knopf: React.CSSProperties = { background: 'none', border: '1px solid #14325c', color: '#14325c', borderRadius: 6, padding: '3px 9px', fontSize: 12, cursor: 'pointer' }
  return (
    <div style={{ flex: 1, minWidth: 120 }}>
      <div style={{ fontSize: 10.5, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.3 }}>{titel}</div>
      {namen.length > 0 ? (
        <div style={{ fontWeight: 600, color: '#15803d', fontSize: 14 }}>{namen.join(', ')}</div>
      ) : offen ? (
        <div style={{ fontSize: 13 }}>
          <span style={{ fontWeight: 600, color: '#b45309' }}>Schicht offen</span>{' '}
          {darfDisponieren && (
            <button onClick={onAendern} style={{ ...knopf, padding: '1px 7px', fontSize: 11 }}>
              ändern
            </button>
          )}
        </div>
      ) : darfDisponieren && !storniert ? (
        <button onClick={onAnlegen} style={knopf}>
          Schicht anlegen
        </button>
      ) : (
        <div style={{ color: '#94a3b8' }}>–</div>
      )}
    </div>
  )
}

export function AuftragKarte({
  a,
  b,
  darfDisponieren,
  zeigePreis,
  statusBadge,
  abrechnungBadge,
  onOeffnen,
  onSchicht,
}: {
  a: KartenAuftrag
  b: KartenBesetzung
  darfDisponieren: boolean
  zeigePreis: boolean
  statusBadge: ReactNode
  abrechnungBadge: ReactNode
  onOeffnen: () => void
  onSchicht: (bereich: 'Lokführer' | 'Wagenmeister', spotId: string | null) => void
}) {
  return (
    <div
      style={{
        background: '#ffffff',
        border: '1px solid #dbe3ef',
        borderRadius: 12,
        padding: 14,
        opacity: a.status === 'storniert' ? 0.6 : 1,
        boxShadow: '0 1px 3px rgba(15,23,42,0.06)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div onClick={onOeffnen} style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 16, color: '#14325c' }}>{a.referenz ?? '–'}</div>
          <div style={{ fontSize: 12, color: '#64748b' }}>
            {[a.zug_nr ? `Zug ${a.zug_nr}` : '', a.kunde, a.evu].filter(Boolean).join(' · ')}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {statusBadge}
          {abrechnungBadge}
        </div>
      </div>

      <div onClick={onOeffnen} style={{ cursor: 'pointer' }}>
        <Ablauf a={a} />
      </div>

      <div onClick={onOeffnen} style={{ cursor: 'pointer', fontSize: 12.5, color: '#475569', display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        {a.anzahl_wagen != null && <span>{a.anzahl_wagen} Wagen</span>}
        {a.lok && <span>Lok {a.lok}</span>}
        {zeigePreis && a.preis != null && <span>{a.preis.toFixed(2).replace('.', ',')} €</span>}
        {a.infos && <span style={{ color: '#92400e' }}>ℹ {a.infos.length > 70 ? a.infos.slice(0, 70) + ' …' : a.infos}</span>}
      </div>

      <div style={{ display: 'flex', gap: 12, borderTop: '1px solid #eef2f8', paddingTop: 8, flexWrap: 'wrap' }}>
        <Person
          titel="Lokführer"
          namen={b.namen}
          offen={b.offen}
          darfDisponieren={darfDisponieren}
          storniert={a.status === 'storniert'}
          onAnlegen={() => onSchicht('Lokführer', null)}
          onAendern={() => onSchicht('Lokführer', b.spotId)}
        />
        <Person
          titel="Wagenmeister"
          namen={b.wgm.namen}
          offen={b.wgm.offen}
          darfDisponieren={darfDisponieren}
          storniert={a.status === 'storniert'}
          onAnlegen={() => onSchicht('Wagenmeister', null)}
          onAendern={() => onSchicht('Wagenmeister', b.wgm.spotId)}
        />
      </div>
    </div>
  )
}
