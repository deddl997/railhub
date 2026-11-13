import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from './lib/supabase'
import { useLiveAktualisierung } from './liveAktualisierung'
import { datumZuISO } from './datumUtils'
import StatusMailDialog from './StatusMailDialog'
import type { MailAuftrag } from './StatusMailDialog'
import { LeerHinweis, Skelett, bestaetigen, useToast } from './ui'

interface Zug extends MailAuftrag {
  id: string
}
interface Meldung {
  auftrag_id: string
  art: string
  gemeldet_am: string
}
type Stand = 'ohne' | 'gemeldet' | 'laeuft' | 'angekommen'
type Filter = 'alle' | Stand

const WOCHENTAGE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']
const kurz = (z: string | null) => (z ? z.slice(0, 5) : '')
const plus = (iso: string, n: number) => {
  const d = new Date(iso + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return datumZuISO(d)
}
const datumLang = (iso: string) => `${WOCHENTAGE[new Date(iso + 'T12:00:00').getDay()]}, ${iso.split('-').reverse().join('.')}`

function abwMin(soll: string | null, ist: string | null): number | null {
  if (!soll || !ist) return null
  const m = (z: string) => Number(z.slice(0, 2)) * 60 + Number(z.slice(3, 5))
  return m(ist) - m(soll)
}

const STAND_TEXT: Record<Stand, { titel: string; farbe: string; bg: string }> = {
  ohne: { titel: 'Ohne Meldung', farbe: '#b45309', bg: '#fef3c7' },
  gemeldet: { titel: 'Gemeldet', farbe: '#1d4ed8', bg: '#dbeafe' },
  laeuft: { titel: 'Läuft', farbe: '#15803d', bg: '#dcfce7' },
  angekommen: { titel: 'Angekommen', farbe: '#475569', bg: '#e2e8f0' },
}

export default function Zuglaeufe({ darfSchreiben, mitarbeiterId }: { darfSchreiben: boolean; mitarbeiterId?: string | null }) {
  const toast = useToast()
  const [tag, setTag] = useState(datumZuISO(new Date()))
  const [zuege, setZuege] = useState<Zug[]>([])
  const [meldungen, setMeldungen] = useState<Meldung[]>([])
  const [fahrer, setFahrer] = useState<Record<string, string[]>>({})
  const [laedt, setLaedt] = useState(true)
  const [fehler, setFehler] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('alle')
  const [suche, setSuche] = useState('')
  const [mailFuer, setMailFuer] = useState<Zug | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [editAb, setEditAb] = useState('')
  const [editAn, setEditAn] = useState('')

  const laden = useCallback(async () => {
    const r = await supabase
      .from('auftraege')
      .select('id, kunde, referenz, zug_nr, status, abfahrt_ort, abfahrt_datum, abfahrt_soll, abfahrt_ist, ankunft_ort, ankunft_datum, ankunft_soll, ankunft_ist, anzahl_wagen, lok, storno_datum, storno_zeit')
      .eq('abfahrt_datum', tag)
      .neq('status', 'storniert')
      .order('abfahrt_soll')
    if (r.error) {
      setFehler(r.error.message)
      setLaedt(false)
      return
    }
    setFehler(null)
    const liste = (r.data ?? []) as Zug[]
    setZuege(liste)
    const ids = liste.map((z) => z.id)
    if (ids.length === 0) {
      setMeldungen([])
      setFahrer({})
      setLaedt(false)
      return
    }
    const [m, e] = await Promise.all([
      supabase.from('zuglauf_meldungen').select('auftrag_id, art, gemeldet_am').in('auftrag_id', ids),
      supabase.from('dienstplan_eintraege').select('auftrag_id, mitarbeiter_id').in('auftrag_id', ids),
    ])
    setMeldungen(m.error ? [] : ((m.data ?? []) as Meldung[]))
    const eint = (e.data ?? []) as { auftrag_id: string; mitarbeiter_id: string }[]
    const maIds = [...new Set(eint.map((x) => x.mitarbeiter_id))]
    const namen = new Map<string, string>()
    if (maIds.length > 0) {
      const ma = await supabase.from('mitarbeiter').select('id, name').in('id', maIds)
      for (const x of (ma.data ?? []) as { id: string; name: string }[]) namen.set(x.id, x.name)
    }
    const f: Record<string, string[]> = {}
    for (const x of eint) {
      const n = namen.get(x.mitarbeiter_id)
      if (n) (f[x.auftrag_id] ??= []).push(n)
    }
    setFahrer(f)
    setLaedt(false)
  }, [tag])

  useEffect(() => {
    setLaedt(true)
    laden()
  }, [laden])
  useLiveAktualisierung(['auftraege', 'zuglauf_meldungen', 'dienstplan_eintraege'], laden)

  const standVon = useCallback(
    (z: Zug): Stand => {
      if (z.ankunft_ist || z.status === 'gefahren') return 'angekommen'
      if (z.abfahrt_ist) return 'laeuft'
      if (meldungen.some((m) => m.auftrag_id === z.id)) return 'gemeldet'
      return 'ohne'
    },
    [meldungen]
  )

  const zaehler = useMemo(() => {
    const c: Record<Filter, number> = { alle: zuege.length, ohne: 0, gemeldet: 0, laeuft: 0, angekommen: 0 }
    for (const z of zuege) c[standVon(z)]++
    return c
  }, [zuege, standVon])

  const sichtbar = useMemo(() => {
    const s = suche.trim().toLowerCase()
    return zuege.filter((z) => {
      if (filter !== 'alle' && standVon(z) !== filter) return false
      if (!s) return true
      const heu = [z.zug_nr, z.referenz, z.kunde, z.abfahrt_ort, z.ankunft_ort, z.lok, ...(fahrer[z.id] ?? [])].join(' ').toLowerCase()
      return s.split(/\s+/).every((w) => heu.includes(w))
    })
  }, [zuege, filter, suche, standVon, fahrer])

  async function speichern(id: string, felder: Record<string, string | null>) {
    const r = await supabase.from('auftraege').update(felder).eq('id', id)
    if (r.error) toast.fehler(`Speichern fehlgeschlagen: ${r.error.message}`)
    else laden()
  }

  async function meldungVermerken(z: Zug, art: 'erstmeldung' | 'update') {
    const r = await supabase.from('zuglauf_meldungen').insert({ auftrag_id: z.id, art, gemeldet_von: mitarbeiterId ?? null })
    if (r.error) toast.fehler(`Meldung konnte nicht vermerkt werden: ${r.error.message}`)
    else laden()
  }

  async function mailGeschlossen(z: Zug) {
    setMailFuer(null)
    if (!darfSchreiben) return
    const art = meldungen.some((m) => m.auftrag_id === z.id) ? 'update' : 'erstmeldung'
    const ja = await bestaetigen(`Wurde die ${art === 'erstmeldung' ? 'Erstmeldung' : 'Meldung'} an ${z.kunde ?? 'den Kunden'} abgeschickt?`, { titel: 'Meldung vermerken', jaText: 'Ja, vermerken' })
    if (ja) await meldungVermerken(z, art)
  }

  const knopf = (aktiv: boolean): React.CSSProperties => ({
    border: '1px solid ' + (aktiv ? 'var(--navy)' : 'var(--border)'),
    background: aktiv ? 'var(--navy)' : '#fff',
    color: aktiv ? '#fff' : '#334155',
    borderRadius: 999,
    padding: '6px 14px',
    fontSize: 14,
    cursor: 'pointer',
    font: 'inherit',
  })
  const klein: React.CSSProperties = { border: '1px solid var(--border)', background: '#fff', borderRadius: 8, padding: '7px 12px', fontSize: 13, cursor: 'pointer', font: 'inherit', color: '#334155' }
  const istHeute = tag === datumZuISO(new Date())

  return (
    <div>
      <div style={{ color: '#64748b', fontSize: 14, marginBottom: 14 }}>Alle Züge eines Tages: ob schon eine Zuglaufmeldung raus ist, der letzte Stand und Updates mit einem Klick.</div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <button style={klein} onClick={() => setTag(plus(tag, -1))} aria-label="Vortag">◀</button>
        <input type="date" value={tag} onChange={(e) => e.target.value && setTag(e.target.value)} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '7px 10px', font: 'inherit' }} />
        <button style={klein} onClick={() => setTag(plus(tag, 1))} aria-label="Folgetag">▶</button>
        <button style={{ ...klein, fontWeight: 600 }} onClick={() => setTag(datumZuISO(new Date()))} disabled={istHeute}>Heute</button>
        <strong style={{ color: '#14325c', marginLeft: 6 }}>{datumLang(tag)}</strong>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        {(['alle', 'ohne', 'gemeldet', 'laeuft', 'angekommen'] as Filter[]).map((f) => (
          <button key={f} style={knopf(filter === f)} onClick={() => setFilter(f)}>
            {f === 'alle' ? 'Alle' : STAND_TEXT[f].titel} {zaehler[f]}
          </button>
        ))}
        <input
          value={suche}
          onChange={(e) => setSuche(e.target.value)}
          placeholder="Zug, Bahnhof, Referenz, Kunde, Lokführer …"
          style={{ flex: '1 1 240px', minWidth: 200, border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', font: 'inherit' }}
        />
      </div>

      {fehler && <div style={{ color: '#b91c1c', marginBottom: 10 }}>Fehler: {fehler}</div>}
      {laedt ? (
        <Skelett hoehe={160} />
      ) : sichtbar.length === 0 ? (
        <LeerHinweis symbol="🚆">{zuege.length === 0 ? 'Für diesen Tag sind keine Züge geplant.' : 'Keine Züge für diesen Filter.'}</LeerHinweis>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {sichtbar.map((z) => {
            const st = standVon(z)
            const s = STAND_TEXT[st]
            const meld = meldungen.filter((m) => m.auftrag_id === z.id).sort((a, b) => b.gemeldet_am.localeCompare(a.gemeldet_am))
            const abw = abwMin(z.abfahrt_soll, z.abfahrt_ist)
            const abwAn = abwMin(z.ankunft_soll, z.ankunft_ist)
            const leute = fahrer[z.id] ?? []
            const editiert = editId === z.id
            return (
              <div key={z.id} style={{ background: '#fff', border: '1px solid var(--border)', borderLeft: `5px solid ${s.farbe}`, borderRadius: 12, padding: '12px 16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0, flex: '1 1 320px' }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: 17, color: '#14325c' }}>{z.zug_nr ?? '–'}</strong>
                      {z.referenz && <span style={{ color: '#64748b', fontSize: 13 }}>{z.referenz}</span>}
                      {z.kunde && <span style={{ color: '#64748b', fontSize: 13 }}>· {z.kunde}</span>}
                    </div>
                    <div style={{ marginTop: 2, fontSize: 15 }}>
                      {z.abfahrt_ort ?? '?'} {kurz(z.abfahrt_soll)} → {z.ankunft_ort ?? '?'} {kurz(z.ankunft_soll)}
                    </div>
                    <div style={{ marginTop: 2, fontSize: 13, color: '#64748b' }}>
                      {z.lok ? `Lok ${z.lok}` : 'Lok offen'}
                      {leute.length > 0 ? ` · ${leute.join(', ')}` : ' · kein Personal eingeteilt'}
                      {z.anzahl_wagen != null ? ` · ${z.anzahl_wagen} Wagen` : ''}
                    </div>
                    <div style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{ background: s.bg, color: s.farbe, borderRadius: 999, padding: '2px 10px', fontSize: 12, fontWeight: 700 }}>{s.titel}</span>
                      <span style={{ fontSize: 13, color: '#475569' }}>
                        {st === 'ohne' && 'Noch keine Zuglaufmeldung'}
                        {st === 'gemeldet' && `Letzte Meldung ${new Date(meld[0].gemeldet_am).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} Uhr`}
                        {st === 'laeuft' && `Abgefahren ${kurz(z.abfahrt_ist)}${abw ? (abw > 0 ? ` (+${abw} Min.)` : ` (${abw} Min.)`) : abw === 0 ? ' (pünktlich)' : ''}`}
                        {st === 'angekommen' && `Angekommen ${kurz(z.ankunft_ist) || ''}${abwAn ? (abwAn > 0 ? ` (+${abwAn} Min.)` : ` (${abwAn} Min.)`) : ''}`}
                      </span>
                    </div>
                  </div>

                  {darfSchreiben && (
                    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                      {st !== 'laeuft' && st !== 'angekommen' && z.abfahrt_soll && (
                        <button style={klein} onClick={() => speichern(z.id, { abfahrt_ist: z.abfahrt_soll })}>
                          ✓ Planmäßig unterwegs
                        </button>
                      )}
                      {st === 'laeuft' && z.ankunft_soll && (
                        <button style={klein} onClick={() => speichern(z.id, { ankunft_ist: z.ankunft_soll })}>
                          ✓ Planmäßig angekommen
                        </button>
                      )}
                      <button
                        style={{ ...klein, background: st === 'ohne' ? '#16a34a' : '#fff', color: st === 'ohne' ? '#fff' : '#334155', borderColor: st === 'ohne' ? '#16a34a' : 'var(--border)', fontWeight: 600 }}
                        onClick={() => setMailFuer(z)}
                      >
                        {meld.length === 0 ? 'Erstmeldung' : 'Update senden'}
                      </button>
                      <button
                        style={klein}
                        title="Ist-Zeiten bearbeiten"
                        onClick={() => {
                          setEditId(editiert ? null : z.id)
                          setEditAb(kurz(z.abfahrt_ist))
                          setEditAn(kurz(z.ankunft_ist))
                        }}
                      >
                        ✎
                      </button>
                    </div>
                  )}
                </div>

                {editiert && (
                  <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)', display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                    <label style={{ fontSize: 13, color: '#475569' }}>
                      Abfahrt Ist
                      <br />
                      <input type="time" value={editAb} onChange={(e) => setEditAb(e.target.value)} style={{ border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', font: 'inherit' }} />
                    </label>
                    <label style={{ fontSize: 13, color: '#475569' }}>
                      Ankunft Ist
                      <br />
                      <input type="time" value={editAn} onChange={(e) => setEditAn(e.target.value)} style={{ border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', font: 'inherit' }} />
                    </label>
                    <button
                      style={{ ...klein, background: 'var(--navy)', color: '#fff', borderColor: 'var(--navy)' }}
                      onClick={async () => {
                        await speichern(z.id, { abfahrt_ist: editAb || null, ankunft_ist: editAn || null })
                        setEditId(null)
                      }}
                    >
                      Speichern
                    </button>
                    <button style={klein} onClick={() => setEditId(null)}>
                      Abbrechen
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {mailFuer && <StatusMailDialog auftrag={mailFuer} darfSpeichern={darfSchreiben} onSchliessen={() => mailGeschlossen(mailFuer)} />}
    </div>
  )
}
