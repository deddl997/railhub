import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase'
import { useLiveAktualisierung } from './liveAktualisierung'
import { datumZuISO } from './datumUtils'
import { LeerHinweis, Skelett, StatusMarke, TabellenRahmen, useToast } from './ui'

interface AuftragZeile {
  id: string
  kunde: string | null
  referenz: string | null
  zug_nr: string | null
  status: string
  abfahrt_ort: string | null
  ankunft_ort: string | null
  abfahrt_datum: string
  abfahrt_soll: string | null
}
interface KundeInfo {
  name: string
  anzahl: number
  naechster: string | null
  monat: number
  email: string
}

const datumKurz = (iso: string) => iso.split('-').reverse().slice(0, 2).join('.') + '.'

export default function Kunden({ darfSchreiben }: { darfSchreiben: boolean }) {
  const toast = useToast()
  const [zeilen, setZeilen] = useState<AuftragZeile[]>([])
  const [emails, setEmails] = useState<Record<string, string>>({})
  const [laedt, setLaedt] = useState(true)
  const [suche, setSuche] = useState('')
  const [offen, setOffen] = useState<string | null>(null)
  const [mailEdit, setMailEdit] = useState('')

  const laden = useCallback(async () => {
    const heute = new Date()
    const von = datumZuISO(new Date(heute.getFullYear(), heute.getMonth() - 1, 1))
    const bis = datumZuISO(new Date(heute.getTime() + 90 * 86400000))
    const [a, e] = await Promise.all([
      supabase
        .from('auftraege')
        .select('id, kunde, referenz, zug_nr, status, abfahrt_ort, ankunft_ort, abfahrt_datum, abfahrt_soll')
        .gte('abfahrt_datum', von)
        .lte('abfahrt_datum', bis)
        .neq('status', 'storniert')
        .order('abfahrt_datum')
        .limit(5000),
      supabase.from('kunden_emails').select('kunde, email'),
    ])
    setZeilen(a.error ? [] : ((a.data ?? []) as AuftragZeile[]))
    const m: Record<string, string> = {}
    for (const x of (e.data ?? []) as { kunde: string; email: string }[]) m[x.kunde] = x.email
    setEmails(m)
    setLaedt(false)
  }, [])

  useEffect(() => {
    laden()
  }, [laden])
  useLiveAktualisierung(['auftraege', 'kunden_emails'], laden)

  const kunden = useMemo<KundeInfo[]>(() => {
    const heute = datumZuISO(new Date())
    const monat = heute.slice(0, 7)
    const map = new Map<string, KundeInfo>()
    for (const z of zeilen) {
      const n = (z.kunde ?? '').trim() || '(ohne Kunde)'
      const k = map.get(n) ?? { name: n, anzahl: 0, naechster: null, monat: 0, email: emails[n] ?? '' }
      if (z.abfahrt_datum >= heute) {
        k.anzahl++
        if (!k.naechster || z.abfahrt_datum < k.naechster) k.naechster = z.abfahrt_datum
      }
      if (z.abfahrt_datum.startsWith(monat)) k.monat++
      map.set(n, k)
    }
    for (const n of Object.keys(emails)) if (!map.has(n)) map.set(n, { name: n, anzahl: 0, naechster: null, monat: 0, email: emails[n] })
    const s = suche.trim().toLowerCase()
    return [...map.values()].filter((k) => !s || k.name.toLowerCase().includes(s)).sort((a, b) => b.anzahl - a.anzahl || a.name.localeCompare(b.name, 'de'))
  }, [zeilen, emails, suche])

  async function emailSpeichern(kunde: string) {
    const r = mailEdit.trim()
      ? await supabase.from('kunden_emails').upsert({ kunde, email: mailEdit.trim(), updated_at: new Date().toISOString() })
      : await supabase.from('kunden_emails').delete().eq('kunde', kunde)
    if (r.error) toast.fehler('Speichern fehlgeschlagen: ' + r.error.message)
    else {
      toast.erfolg('E-Mail gespeichert.')
      laden()
    }
  }

  const heute = datumZuISO(new Date())

  return (
    <div>
      <div style={{ color: '#64748b', fontSize: 14, marginBottom: 14 }}>Alle Kunden aus den Aufträgen (letzter Monat bis 90 Tage voraus) mit Meldeadresse und den nächsten Zügen.</div>
      <input
        value={suche}
        onChange={(e) => setSuche(e.target.value)}
        placeholder="Kunde suchen …"
        style={{ width: '100%', maxWidth: 360, boxSizing: 'border-box', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', font: 'inherit', marginBottom: 14 }}
      />
      {laedt ? (
        <Skelett hoehe={160} />
      ) : kunden.length === 0 ? (
        <LeerHinweis symbol="🏢">Keine Kunden gefunden.</LeerHinweis>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
          {kunden.map((k) => {
            const aufgeklappt = offen === k.name
            return (
              <div key={k.name} style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 12, padding: '12px 16px', gridColumn: aufgeklappt ? '1 / -1' : undefined }}>
                <button
                  type="button"
                  onClick={() => {
                    setOffen(aufgeklappt ? null : k.name)
                    setMailEdit(k.email)
                  }}
                  style={{ all: 'unset', cursor: 'pointer', display: 'block', width: '100%' }}
                >
                  <div style={{ fontWeight: 700, color: '#14325c', fontSize: 16 }}>{k.name}</div>
                  <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>
                    {k.anzahl} kommende Züge{k.naechster ? ` · nächster ${k.naechster === heute ? 'heute' : datumKurz(k.naechster)}` : ''} · {k.monat} in diesem Monat
                  </div>
                  <div style={{ fontSize: 13, marginTop: 4, color: k.email ? '#475569' : '#b45309' }}>{k.email ? `✉ ${k.email}` : '✉ keine E-Mail hinterlegt'}</div>
                </button>
                {aufgeklappt && (
                  <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                    {darfSchreiben && (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                        <input
                          value={mailEdit}
                          onChange={(e) => setMailEdit(e.target.value)}
                          placeholder="E-Mail für Zuglaufmeldungen (mehrere mit ; trennen)"
                          style={{ flex: '1 1 280px', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', font: 'inherit' }}
                        />
                        <button onClick={() => emailSpeichern(k.name)} style={{ border: '1px solid var(--navy)', background: 'var(--navy)', color: '#fff', borderRadius: 8, padding: '8px 14px', cursor: 'pointer', font: 'inherit' }}>
                          Speichern
                        </button>
                      </div>
                    )}
                    <TabellenRahmen hoehe="40vh">
                      <table className="rbl-tabelle">
                        <thead>
                          <tr>
                            <th>Datum</th>
                            <th>Zeit</th>
                            <th>Zug / Referenz</th>
                            <th>Strecke</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {zeilen
                            .filter((z) => ((z.kunde ?? '').trim() || '(ohne Kunde)') === k.name && z.abfahrt_datum >= heute)
                            .slice(0, 30)
                            .map((z) => (
                              <tr key={z.id}>
                                <td>{datumKurz(z.abfahrt_datum)}</td>
                                <td>{z.abfahrt_soll?.slice(0, 5) ?? ''}</td>
                                <td>{[z.zug_nr, z.referenz].filter(Boolean).join(' · ')}</td>
                                <td>
                                  {z.abfahrt_ort ?? '?'} → {z.ankunft_ort ?? '?'}
                                </td>
                                <td>
                                  <StatusMarke status={z.status} />
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </TabellenRahmen>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
