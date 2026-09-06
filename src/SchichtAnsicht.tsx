import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import { datumZuISO } from './datumUtils'

interface Mitarbeiter {
  id: string
  name: string
  kategorie: string | null
}

interface Schichtvorlage {
  id: string
  name: string
  beginn_zeit: string
  ende_zeit: string
  pause_minuten: number | null
  dienstort: string | null
  farbe: string
  aktiv: boolean
  benoetigte_wochentage: number[] | null
}

interface DienstplanEintrag {
  id: string
  mitarbeiter_id: string
  datum: string
  schichtvorlage_id: string | null
}

const WOCHENTAGE_KURZ = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']

function montagDerWoche(datum: Date): Date {
  const tag = datum.getDay()
  const differenz = tag === 0 ? -6 : 1 - tag
  const montag = new Date(datum)
  montag.setDate(datum.getDate() + differenz)
  montag.setHours(0, 0, 0, 0)
  return montag
}

function datumKurz(datum: Date): string {
  const tag = String(datum.getDate()).padStart(2, '0')
  const monat = String(datum.getMonth() + 1).padStart(2, '0')
  return `${tag}.${monat}.`
}

function istHeute(datum: Date): boolean {
  const heute = new Date()
  return (
    datum.getFullYear() === heute.getFullYear() &&
    datum.getMonth() === heute.getMonth() &&
    datum.getDate() === heute.getDate()
  )
}

function zeitKurz(zeit: string): string {
  return zeit.slice(0, 5)
}

function initialen(name: string): string {
  const teile = name.trim().split(/\s+/)
  if (teile.length === 1) return teile[0].slice(0, 2).toUpperCase()
  return (teile[0][0] + teile[teile.length - 1][0]).toUpperCase()
}

export default function SchichtAnsicht() {
  const [wochenStart, setWochenStart] = useState(() => montagDerWoche(new Date()))
  const [mitarbeiterListe, setMitarbeiterListe] = useState<Mitarbeiter[]>([])
  const [vorlagen, setVorlagen] = useState<Schichtvorlage[]>([])
  const [eintraege, setEintraege] = useState<DienstplanEintrag[]>([])
  const [ladeVorgang, setLadeVorgang] = useState(true)
  const [ziehendeMitarbeiterId, setZiehendeMitarbeiterId] = useState<string | null>(null)
  const [hoverZiel, setHoverZiel] = useState<string | null>(null)

  const tage = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(wochenStart)
    d.setDate(wochenStart.getDate() + i)
    return d
  })

  async function laden() {
    setLadeVorgang(true)
    const startIso = datumZuISO(wochenStart)
    const endeIso = datumZuISO(tage[6])

    const [{ data: mitarbeiterData }, { data: vorlagenData }, { data: eintraegeData }] = await Promise.all([
      supabase.from('mitarbeiter').select('id, name, kategorie').order('name'),
      supabase.from('schichtvorlagen').select('*').eq('aktiv', true).order('beginn_zeit'),
      supabase
        .from('dienstplan_eintraege')
        .select('id, mitarbeiter_id, datum, schichtvorlage_id')
        .gte('datum', startIso)
        .lte('datum', endeIso)
        .not('schichtvorlage_id', 'is', null),
    ])

    setMitarbeiterListe(mitarbeiterData ?? [])
    setVorlagen(vorlagenData ?? [])
    setEintraege(eintraegeData ?? [])
    setLadeVorgang(false)
  }

  useEffect(() => {
    laden()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wochenStart])

  function zugewiesenerMitarbeiter(vorlageId: string, datumIso: string): Mitarbeiter | null {
    const eintrag = eintraege.find((e) => e.schichtvorlage_id === vorlageId && e.datum === datumIso)
    if (!eintrag) return null
    return mitarbeiterListe.find((m) => m.id === eintrag.mitarbeiter_id) ?? null
  }

  async function zuweisen(vorlageId: string, datumIso: string, mitarbeiterId: string) {
    // Falls dieser Mitarbeiter an diesem Tag schon eine andere Schicht hat, diese zuerst entfernen
    await supabase.from('dienstplan_eintraege').delete().eq('mitarbeiter_id', mitarbeiterId).eq('datum', datumIso)

    await supabase.from('dienstplan_eintraege').insert({
      mitarbeiter_id: mitarbeiterId,
      datum: datumIso,
      schichtvorlage_id: vorlageId,
      ist_spotschicht: false,
    })
    await laden()
  }

  async function slotFreigeben(vorlageId: string, datumIso: string) {
    await supabase
      .from('dienstplan_eintraege')
      .delete()
      .eq('schichtvorlage_id', vorlageId)
      .eq('datum', datumIso)
    await laden()
  }

  async function beiDrop(vorlageId: string, datumIso: string) {
    setHoverZiel(null)
    if (!ziehendeMitarbeiterId) return

    const bereitsBesetztVon = zugewiesenerMitarbeiter(vorlageId, datumIso)
    if (bereitsBesetztVon && bereitsBesetztVon.id !== ziehendeMitarbeiterId) {
      const bestaetigt = window.confirm(
        `Dieser Dienst ist bereits mit ${bereitsBesetztVon.name} besetzt. Ersetzen?`
      )
      if (!bestaetigt) {
        setZiehendeMitarbeiterId(null)
        return
      }
    }

    await zuweisen(vorlageId, datumIso, ziehendeMitarbeiterId)
    setZiehendeMitarbeiterId(null)
  }

  if (ladeVorgang) {
    return <p style={{ color: 'var(--text-muted)' }}>Lade Schichtplan...</p>
  }

  const lokfuehrer = mitarbeiterListe.filter((m) => m.kategorie === 'Lokführer')

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <button
          onClick={() => setWochenStart(new Date(wochenStart.getTime() - 7 * 86400000))}
          style={navigationsKnopfStil}
        >
          ← Vorherige Woche
        </button>
        <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--navy)' }}>
          {datumKurz(tage[0])} – {datumKurz(tage[6])} {tage[0].getFullYear()}
        </div>
        <button
          onClick={() => setWochenStart(new Date(wochenStart.getTime() + 7 * 86400000))}
          style={navigationsKnopfStil}
        >
          Nächste Woche →
        </button>
      </div>

      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              border: '1px solid var(--border)',
              borderRadius: 12,
              overflow: 'hidden',
              boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
            }}
          >
            <table style={{ borderCollapse: 'collapse', width: '100%', tableLayout: 'fixed', fontSize: 12 }}>
              <colgroup>
                <col style={{ width: 190 }} />
                {tage.map((_, i) => (
                  <col key={i} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <th style={{ ...kopfZelleStil, textAlign: 'left', paddingLeft: 16 }}>Dienst</th>
                  {tage.map((tag, i) => (
                    <th
                      key={i}
                      style={{
                        ...kopfZelleStil,
                        background: istHeute(tag) ? '#dbe6f5' : '#f8fafc',
                        color: istHeute(tag) ? 'var(--navy)' : '#475569',
                      }}
                    >
                      <div style={{ fontWeight: 700 }}>{WOCHENTAGE_KURZ[i]}</div>
                      <div style={{ fontSize: 10, fontWeight: 400 }}>{datumKurz(tag)}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {vorlagen.map((vorlage, zeilenIndex) => (
                  <tr key={vorlage.id} style={{ background: zeilenIndex % 2 === 0 ? '#ffffff' : '#fafbfc' }}>
                    <td style={{ ...zellBasisStil, padding: '8px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span
                          style={{ width: 10, height: 10, borderRadius: 3, background: vorlage.farbe, flexShrink: 0 }}
                        />
                        <div>
                          <div style={{ fontWeight: 600, color: '#1e293b' }}>{vorlage.name}</div>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                            {zeitKurz(vorlage.beginn_zeit)}–{zeitKurz(vorlage.ende_zeit)}
                          </div>
                        </div>
                      </div>
                    </td>
                    {tage.map((tag) => {
                      const datumIso = datumZuISO(tag)
                      const wochentag = tag.getDay()
                      const benoetigt = (vorlage.benoetigte_wochentage ?? [0, 1, 2, 3, 4, 5, 6]).includes(
                        wochentag
                      )
                      const mitarbeiter = zugewiesenerMitarbeiter(vorlage.id, datumIso)
                      const zielSchluessel = `${vorlage.id}-${datumIso}`

                      if (!benoetigt) {
                        return (
                          <td key={datumIso} style={{ ...zellBasisStil, background: '#f8fafc' }}>
                            <div style={{ textAlign: 'center', color: '#cbd5e1', fontSize: 10 }}>–</div>
                          </td>
                        )
                      }

                      return (
                        <td
                          key={datumIso}
                          onDragOver={(e) => {
                            e.preventDefault()
                            setHoverZiel(zielSchluessel)
                          }}
                          onDragLeave={() => setHoverZiel((z) => (z === zielSchluessel ? null : z))}
                          onDrop={(e) => {
                            e.preventDefault()
                            beiDrop(vorlage.id, datumIso)
                          }}
                          style={{
                            ...zellBasisStil,
                            background: hoverZiel === zielSchluessel ? '#e0f2fe' : undefined,
                          }}
                        >
                          {mitarbeiter ? (
                            <div
                              draggable
                              onDragStart={() => setZiehendeMitarbeiterId(mitarbeiter.id)}
                              onDragEnd={() => setZiehendeMitarbeiterId(null)}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: 4,
                                background: vorlage.farbe,
                                color: '#ffffff',
                                borderRadius: 8,
                                padding: '6px 8px',
                                cursor: 'grab',
                                fontSize: 11,
                                fontWeight: 600,
                              }}
                            >
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {mitarbeiter.name}
                              </span>
                              <button
                                onClick={() => slotFreigeben(vorlage.id, datumIso)}
                                title="Zuweisung entfernen"
                                style={{
                                  background: 'rgba(255,255,255,0.25)',
                                  border: 'none',
                                  borderRadius: 4,
                                  color: '#ffffff',
                                  cursor: 'pointer',
                                  fontSize: 10,
                                  padding: '1px 5px',
                                  flexShrink: 0,
                                }}
                              >
                                ✕
                              </button>
                            </div>
                          ) : (
                            <div
                              style={{
                                height: 32,
                                borderRadius: 8,
                                border: '1.5px dashed #fca5a5',
                                background: '#fef2f2',
                                color: '#dc2626',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 10,
                                fontWeight: 700,
                              }}
                            >
                              Offen
                            </div>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div
          style={{
            width: 190,
            flexShrink: 0,
            background: '#f8fafc',
            border: '1px solid var(--border)',
            borderRadius: 10,
            padding: 12,
          }}
        >
          <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 8, color: 'var(--navy)' }}>
            Lokführer (ziehen zum Zuweisen)
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {lokfuehrer.map((mitarbeiter) => (
              <div
                key={mitarbeiter.id}
                draggable
                onDragStart={() => setZiehendeMitarbeiterId(mitarbeiter.id)}
                onDragEnd={() => setZiehendeMitarbeiterId(null)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  background: '#ffffff',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  padding: '6px 8px',
                  cursor: 'grab',
                  fontSize: 12,
                }}
              >
                <div
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: '50%',
                    background: 'var(--navy)',
                    color: '#ffffff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 9,
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  {initialen(mitarbeiter.name)}
                </div>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {mitarbeiter.name}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 12 }}>
        Mitarbeiter aus der rechten Liste auf einen Tag ziehen, um den Dienst zuzuweisen. Bereits
        zugewiesene Mitarbeiter können per Ziehen auf einen anderen Tag/Dienst verschoben werden, oder
        über das ✕ entfernt werden. "Offen" markiert einen noch unbesetzten, aber benötigten Dienst.
      </p>
    </div>
  )
}

const navigationsKnopfStil: React.CSSProperties = {
  background: 'none',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '6px 14px',
  cursor: 'pointer',
  fontSize: 13,
  color: 'var(--navy)',
  fontWeight: 500,
}

const kopfZelleStil: React.CSSProperties = {
  padding: '10px 6px',
  borderBottom: '1px solid var(--border)',
  textAlign: 'center',
  fontWeight: 600,
}

const zellBasisStil: React.CSSProperties = {
  borderBottom: '1px solid #f1f5f9',
  padding: 5,
  verticalAlign: 'middle',
}
