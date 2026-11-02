import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'

export const TRASSENFINDER_URL = 'https://trassenfinder.de/#/21/sgv?tab_id=1'

export interface Trassenpreis {
  id: string
  von: string
  nach: string
  zwischenhalte: string | null
  art: string
  triebfahrzeug: string | null
  wagenzugmasse_t: number | null
  wagenzuglaenge_m: number | null
  hoechstgeschwindigkeit: number | null
  streckenklasse: string | null
  bremshundertstel: number | null
  bremsstellung: string | null
  parameter_notiz: string | null
  preis: number
  km: number | null
  fahrzeit: string | null
  kwh: number | null
  stand_datum: string
  notiz: string | null
}

interface Entwurf {
  von: string
  nach: string
  zwischenhalte: string
  art: string
  triebfahrzeug: string
  masse: string
  laenge: string
  vmax: string
  klasse: string
  bremsh: string
  bremsst: string
  paramNotiz: string
  preis: string
  km: string
  fahrzeit: string
  kwh: string
  stand: string
  notiz: string
}

const LEER: Entwurf = {
  von: '',
  nach: '',
  zwischenhalte: '',
  art: 'Zug',
  triebfahrzeug: '',
  masse: '',
  laenge: '',
  vmax: '',
  klasse: '',
  bremsh: '',
  bremsst: '',
  paramNotiz: '',
  preis: '',
  km: '',
  fahrzeit: '',
  kwh: '',
  stand: new Date().toISOString().slice(0, 10),
  notiz: '',
}

const euro = (v: number) => v.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })
const datumDeutsch = (iso: string) => iso.split('-').reverse().join('.')
const zahl = (t: string): number | null => {
  const s = t.trim().replace(',', '.')
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}
const text = (v: number | null) => (v == null ? '' : String(v).replace('.', ','))

// Vergleichsschluessel fuer Orte: "LLMO Leipzig-Mockau" und "LLMO" sollen zusammenpassen
export function ortSchluessel(s: string | null | undefined): string {
  const t = (s ?? '').trim()
  if (t === '') return ''
  const erstes = t.split(/\s+/)[0]
  if (/^[A-Za-zÄÖÜ]{2,6}$/.test(erstes) && erstes === erstes.toUpperCase()) return erstes.toUpperCase()
  return t.toLowerCase()
}

export function ortPasst(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = ortSchluessel(a)
  const y = ortSchluessel(b)
  if (x === '' || y === '') return false
  if (x === y) return true
  const lx = (a ?? '').trim().toLowerCase()
  const ly = (b ?? '').trim().toLowerCase()
  return lx.length >= 4 && ly.length >= 4 && (lx.includes(ly) || ly.includes(lx))
}

export default function Trassenpreise() {
  const [liste, setListe] = useState<Trassenpreis[]>([])
  const [laedt, setLaedt] = useState(true)
  const [fehler, setFehler] = useState<string | null>(null)
  const [meldung, setMeldung] = useState<string | null>(null)
  const [suche, setSuche] = useState('')
  const [form, setForm] = useState<Entwurf | null>(null)
  const [bearbeiteId, setBearbeiteId] = useState<string | null>(null)
  const [zaehler, setZaehler] = useState(0)

  useEffect(() => {
    async function laden() {
      setLaedt(true)
      const { data, error } = await supabase.from('trassenpreise').select('*').order('von').order('nach').order('stand_datum', { ascending: false })
      if (error) {
        setFehler(
          error.code === '42P01' || error.message.includes('trassenpreise')
            ? 'Die Tabelle fehlt noch oder du hast keine Berechtigung. Bitte trassenpreise.sql im Supabase SQL Editor ausführen.'
            : error.message
        )
      } else {
        setListe(
          ((data ?? []) as Trassenpreis[]).map((x) => ({ ...x, preis: Number(x.preis) }))
        )
      }
      setLaedt(false)
    }
    laden()
  }, [zaehler])

  function bearbeiten(t: Trassenpreis, kopie: boolean) {
    setBearbeiteId(kopie ? null : t.id)
    setForm({
      von: t.von,
      nach: t.nach,
      zwischenhalte: t.zwischenhalte ?? '',
      art: t.art,
      triebfahrzeug: t.triebfahrzeug ?? '',
      masse: text(t.wagenzugmasse_t),
      laenge: text(t.wagenzuglaenge_m),
      vmax: text(t.hoechstgeschwindigkeit),
      klasse: t.streckenklasse ?? '',
      bremsh: text(t.bremshundertstel),
      bremsst: t.bremsstellung ?? '',
      paramNotiz: t.parameter_notiz ?? '',
      preis: kopie ? '' : text(t.preis),
      km: kopie ? '' : text(t.km),
      fahrzeit: kopie ? '' : t.fahrzeit ?? '',
      kwh: kopie ? '' : text(t.kwh),
      stand: kopie ? LEER.stand : t.stand_datum,
      notiz: kopie ? '' : t.notiz ?? '',
    })
    setMeldung(null)
    setFehler(null)
  }

  async function speichern() {
    if (!form) return
    const preis = zahl(form.preis)
    if (form.von.trim() === '' || form.nach.trim() === '' || preis == null) {
      setFehler('Bitte Von, Nach und den Preis eintragen.')
      return
    }
    const werte = {
      von: form.von.trim(),
      nach: form.nach.trim(),
      zwischenhalte: form.zwischenhalte.trim() || null,
      art: form.art,
      triebfahrzeug: form.triebfahrzeug.trim() || null,
      wagenzugmasse_t: zahl(form.masse),
      wagenzuglaenge_m: zahl(form.laenge),
      hoechstgeschwindigkeit: zahl(form.vmax),
      streckenklasse: form.klasse.trim() || null,
      bremshundertstel: zahl(form.bremsh),
      bremsstellung: form.bremsst.trim() || null,
      parameter_notiz: form.paramNotiz.trim() || null,
      preis,
      km: zahl(form.km),
      fahrzeit: form.fahrzeit.trim() || null,
      kwh: zahl(form.kwh),
      stand_datum: form.stand || LEER.stand,
      notiz: form.notiz.trim() || null,
    }
    const { error } = bearbeiteId
      ? await supabase.from('trassenpreise').update(werte).eq('id', bearbeiteId)
      : await supabase.from('trassenpreise').insert(werte)
    if (error) {
      setFehler(error.message)
      return
    }
    setFehler(null)
    setMeldung('Gespeichert.')
    setForm(null)
    setBearbeiteId(null)
    setZaehler((z) => z + 1)
  }

  async function loeschen(t: Trassenpreis) {
    if (!window.confirm(`Preis ${t.von} → ${t.nach} (${euro(t.preis)}) löschen?`)) return
    const { error } = await supabase.from('trassenpreise').delete().eq('id', t.id)
    if (error) setFehler(error.message)
    else setZaehler((z) => z + 1)
  }

  const gefiltert = liste.filter((t) => {
    const s = suche.trim().toLowerCase()
    return s === '' || [t.von, t.nach, t.triebfahrzeug, t.zwischenhalte, t.notiz].some((x) => (x ?? '').toLowerCase().includes(s))
  })

  const feld: React.CSSProperties = { padding: '5px 8px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13, width: '100%', boxSizing: 'border-box' }
  const label: React.CSSProperties = { fontSize: 11, color: '#64748b', marginBottom: 2 }
  const zelle: React.CSSProperties = { padding: '6px 8px', borderBottom: '1px solid #eef2f8', fontSize: 12.5, textAlign: 'left', verticalAlign: 'top' }
  const feldBlock = (titel: string, key: keyof Entwurf, platzhalter?: string, breite = 150) => (
    <div style={{ flex: `1 1 ${breite}px`, minWidth: breite }}>
      <div style={label}>{titel}</div>
      <input
        value={form?.[key] ?? ''}
        onChange={(e) => setForm((f) => (f ? { ...f, [key]: e.target.value } : f))}
        placeholder={platzhalter}
        style={feld}
      />
    </div>
  )

  return (
    <div>
      <p style={{ fontSize: 13, color: '#475569', marginTop: 0 }}>
        Hier sammelst du Trassenpreise aus dem Trassenfinder. Einmal eingetragen, schlägt die Wirtschaftlichkeit den Preis bei gleichem Von und Nach automatisch vor.
        Trage Von und Nach so ein wie im Trassenfinder (z. B. „LLMO Leipzig-Mockau“).
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
        <a
          href={TRASSENFINDER_URL}
          target="_blank"
          rel="noreferrer"
          style={{ padding: '7px 14px', borderRadius: 8, background: '#eef2f8', color: '#14325c', fontWeight: 600, fontSize: 13, textDecoration: 'none' }}
        >
          Trassenfinder öffnen ↗
        </a>
        <button
          onClick={() => {
            setBearbeiteId(null)
            setForm({ ...LEER })
            setMeldung(null)
          }}
          style={{ padding: '7px 14px', borderRadius: 8, border: 'none', background: '#14325c', color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}
        >
          + Preis eintragen
        </button>
        <input value={suche} onChange={(e) => setSuche(e.target.value)} placeholder="Suchen (Ort, Fahrzeug)" style={{ ...feld, width: 220 }} />
        <span style={{ fontSize: 12, color: '#64748b' }}>{gefiltert.length} Einträge</span>
      </div>
      {fehler && <div style={{ background: '#fee2e2', color: '#991b1b', padding: '8px 12px', borderRadius: 8, fontSize: 13, marginBottom: 10 }}>{fehler}</div>}
      {meldung && <div style={{ background: '#dcfce7', color: '#166534', padding: '8px 12px', borderRadius: 8, fontSize: 13, marginBottom: 10 }}>{meldung}</div>}

      {form && (
        <div style={{ border: '1px solid #cbd5e1', borderRadius: 10, padding: 14, marginBottom: 16, background: '#f8fafc' }}>
          <div style={{ fontWeight: 700, color: 'var(--navy)', fontSize: 14, marginBottom: 8 }}>
            {bearbeiteId ? 'Eintrag bearbeiten' : 'Neuer Trassenpreis'}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            {feldBlock('Von (Start)', 'von', 'LLMO Leipzig-Mockau', 200)}
            {feldBlock('Nach (Ziel)', 'nach', 'LGW Markkleeberg-Gas…', 200)}
            {feldBlock('Zwischenhalte (optional)', 'zwischenhalte', '', 200)}
            <div style={{ flex: '0 1 130px' }}>
              <div style={label}>Art</div>
              <select value={form.art} onChange={(e) => setForm({ ...form, art: e.target.value })} style={feld}>
                <option value="Zug">Zug (mit Wagen)</option>
                <option value="LZ">LZ (Lokzug)</option>
              </select>
            </div>
          </div>
          <div style={{ fontSize: 11, color: '#64748b', margin: '8px 0 4px' }}>Zug konfigurieren (wie im Trassenfinder)</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            {feldBlock('Triebfahrzeug', 'triebfahrzeug', 'V-Tfz - Vossloh DE 18', 200)}
            {feldBlock('Wagenzugmasse (t)', 'masse', '200', 110)}
            {feldBlock('Wagenzuglänge (m)', 'laenge', '100', 110)}
            {feldBlock('Höchstgeschw. (km/h)', 'vmax', '100', 110)}
            {feldBlock('Streckenklasse', 'klasse', 'C2', 90)}
            {feldBlock('Bremshundertstel', 'bremsh', '70', 100)}
            {feldBlock('Bremsstellung', 'bremsst', 'P', 90)}
            {feldBlock('Weitere Einstellungen (Notiz)', 'paramNotiz', 'z. B. Kupplung, PZB/LZB, ETCS', 220)}
          </div>
          <div style={{ fontSize: 11, color: '#64748b', margin: '8px 0 4px' }}>Ergebnis aus dem Trassenfinder</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            {feldBlock('Preis (EUR)', 'preis', '41', 110)}
            {feldBlock('Kilometer', 'km', '19,7', 90)}
            {feldBlock('Fahrzeit', 'fahrzeit', '0:29', 90)}
            {feldBlock('Energie (kWh)', 'kwh', '214', 100)}
            <div style={{ flex: '0 1 150px' }}>
              <div style={label}>Datum der Abfrage / Fahrtag</div>
              <input type="date" value={form.stand} onChange={(e) => setForm({ ...form, stand: e.target.value })} style={feld} />
            </div>
            {feldBlock('Notiz', 'notiz', '', 200)}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={speichern} style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: '#14325c', color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
              Speichern
            </button>
            <button
              onClick={() => {
                setForm(null)
                setBearbeiteId(null)
              }}
              style={{ padding: '7px 16px', borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', fontSize: 13, cursor: 'pointer' }}
            >
              Abbrechen
            </button>
          </div>
        </div>
      )}

      {laedt && <p style={{ color: '#64748b' }}>Lade...</p>}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 760 }}>
          <thead>
            <tr style={{ background: '#f1f5f9' }}>
              <th style={zelle}>Strecke</th>
              <th style={zelle}>Zug</th>
              <th style={{ ...zelle, textAlign: 'right' }}>Preis</th>
              <th style={{ ...zelle, textAlign: 'right' }}>km</th>
              <th style={{ ...zelle, textAlign: 'right' }}>kWh</th>
              <th style={zelle}>Stand</th>
              <th style={zelle}></th>
            </tr>
          </thead>
          <tbody>
            {gefiltert.map((t) => (
              <tr key={t.id}>
                <td style={zelle}>
                  <b>{t.von}</b> → <b>{t.nach}</b>
                  {t.zwischenhalte && <div style={{ fontSize: 11, color: '#64748b' }}>über {t.zwischenhalte}</div>}
                </td>
                <td style={zelle}>
                  <span style={{ fontWeight: 600, color: t.art === 'LZ' ? '#b45309' : '#14325c' }}>{t.art === 'LZ' ? 'LZ' : 'Zug'}</span>
                  <div style={{ fontSize: 11, color: '#64748b' }}>
                    {[t.triebfahrzeug, t.wagenzugmasse_t != null ? `${t.wagenzugmasse_t} t` : null, t.wagenzuglaenge_m != null ? `${t.wagenzuglaenge_m} m` : null, t.hoechstgeschwindigkeit != null ? `${t.hoechstgeschwindigkeit} km/h` : null, t.streckenklasse]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </td>
                <td style={{ ...zelle, textAlign: 'right', fontWeight: 700 }}>{euro(t.preis)}</td>
                <td style={{ ...zelle, textAlign: 'right' }}>{t.km != null ? t.km.toLocaleString('de-DE') : ''}</td>
                <td style={{ ...zelle, textAlign: 'right' }}>{t.kwh != null ? t.kwh.toLocaleString('de-DE') : ''}</td>
                <td style={zelle}>{datumDeutsch(t.stand_datum)}</td>
                <td style={{ ...zelle, whiteSpace: 'nowrap' }}>
                  <button onClick={() => bearbeiten(t, false)} style={{ background: 'none', border: 'none', color: '#14325c', cursor: 'pointer', fontSize: 12 }}>
                    bearbeiten
                  </button>
                  <button onClick={() => bearbeiten(t, true)} style={{ background: 'none', border: 'none', color: '#14325c', cursor: 'pointer', fontSize: 12 }} title="Gleiche Zugdaten, neue Strecke">
                    kopieren
                  </button>
                  <button onClick={() => loeschen(t)} style={{ background: 'none', border: 'none', color: '#b91c1c', cursor: 'pointer', fontSize: 12 }}>
                    löschen
                  </button>
                </td>
              </tr>
            ))}
            {!laedt && gefiltert.length === 0 && (
              <tr>
                <td style={zelle} colSpan={7}>
                  <span style={{ color: '#94a3b8' }}>Noch keine Preise eingetragen.</span>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
