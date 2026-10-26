import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import { pushSenden } from './pushAbo'
import { useLiveAktualisierung } from './liveAktualisierung'
import { datumDeutsch, differenzText, mehrzeitMinuten, stundenText, arbeitsMinuten, zeitKurz } from './zeitkorrekturUtils'
import type { Zeitkorrektur } from './zeitkorrekturUtils'

interface Person {
  id: string
  name: string
}

const knopfPrimaer: React.CSSProperties = {
  background: 'var(--navy)',
  color: '#ffffff',
  border: 'none',
  borderRadius: 6,
  padding: '8px 14px',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
}

const knopfSekundaer: React.CSSProperties = {
  background: 'none',
  border: '1px solid var(--navy)',
  color: 'var(--navy)',
  borderRadius: 6,
  padding: '8px 14px',
  fontSize: 13,
  cursor: 'pointer',
}

const knopfRot: React.CSSProperties = {
  background: 'none',
  border: '1px solid var(--danger)',
  color: 'var(--danger)',
  borderRadius: 6,
  padding: '8px 14px',
  fontSize: 13,
  cursor: 'pointer',
}

export default function ZeitkorrekturPlaner() {
  const [liste, setListe] = useState<Zeitkorrektur[]>([])
  const [personen, setPersonen] = useState<Person[]>([])
  const [panelOffen, setPanelOffen] = useState(false)
  const [nurOffene, setNurOffene] = useState(true)
  const [notizen, setNotizen] = useState<Record<string, string>>({})
  const [meldung, setMeldung] = useState<string | null>(null)

  async function laden() {
    const [korrekturen, mitarbeiter] = await Promise.all([
      supabase.from('zeitkorrekturen').select('*').order('datum', { ascending: false }).limit(300),
      supabase.from('mitarbeiter').select('id, name'),
    ])
    if (korrekturen.error) {
      setMeldung(korrekturen.error.message)
      return
    }
    setListe((korrekturen.data ?? []) as Zeitkorrektur[])
    setPersonen((mitarbeiter.data ?? []) as Person[])
  }

  useEffect(() => {
    laden()
  }, [])

  useLiveAktualisierung(['zeitkorrekturen'], laden)

  const offene = liste.filter((k) => k.status === 'offen')
  const angezeigt = nurOffene ? offene : liste.filter((k) => k.status !== 'offen')

  function nameVon(id: string): string {
    return personen.find((p) => p.id === id)?.name ?? 'Unbekannt'
  }

  async function entscheiden(k: Zeitkorrektur, status: 'genehmigt' | 'abgelehnt') {
    const notiz = (notizen[k.id] ?? '').trim()
    if (status === 'abgelehnt' && notiz.length === 0) {
      setMeldung('Bitte bei einer Ablehnung kurz begründen (Feld „Antwort an den Mitarbeiter“).')
      return
    }
    setMeldung(null)
    const { error } = await supabase
      .from('zeitkorrekturen')
      .update({ status, planer_notiz: notiz || null, entschieden_am: new Date().toISOString() })
      .eq('id', k.id)
    if (error) {
      setMeldung(error.message)
      return
    }
    const text =
      status === 'genehmigt'
        ? `Deine Zeitkorrektur vom ${datumDeutsch(k.datum)} wurde genehmigt.`
        : `Deine Zeitkorrektur vom ${datumDeutsch(k.datum)} wurde abgelehnt.${notiz ? ' ' + notiz : ''}`
    await pushSenden(status === 'genehmigt' ? 'Zeitkorrektur genehmigt' : 'Zeitkorrektur abgelehnt', text, [k.mitarbeiter_id])
    await laden()
  }

  return (
    <>
      <button
        onClick={() => {
          setPanelOffen(true)
          laden()
        }}
        title="Zeitkorrekturen der Mitarbeiter genehmigen oder ablehnen"
        style={{
          ...knopfSekundaer,
          borderColor: offene.length > 0 ? '#d97706' : 'var(--navy)',
          color: offene.length > 0 ? '#92400e' : 'var(--navy)',
          background: offene.length > 0 ? '#fef3c7' : 'none',
        }}
      >
        Zeitkorrekturen{offene.length > 0 ? ` (${offene.length})` : ''}
      </button>

      {panelOffen && (
        <div
          onClick={() => setPanelOffen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#ffffff',
              borderRadius: 12,
              padding: 20,
              width: 600,
              maxWidth: '100%',
              maxHeight: '85vh',
              overflowY: 'auto',
              boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--navy)' }}>Zeitkorrekturen</div>
              <button
                onClick={() => setPanelOffen(false)}
                style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)', lineHeight: 1 }}
              >
                ✕
              </button>
            </div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <button onClick={() => setNurOffene(true)} style={nurOffene ? knopfPrimaer : knopfSekundaer}>
                Offen ({offene.length})
              </button>
              <button onClick={() => setNurOffene(false)} style={!nurOffene ? knopfPrimaer : knopfSekundaer}>
                Entschieden
              </button>
            </div>
            {meldung && (
              <div style={{ background: '#fee2e2', color: '#991b1b', padding: '8px 12px', borderRadius: 8, marginBottom: 10, fontSize: 13 }}>
                {meldung}
              </div>
            )}
            {angezeigt.length === 0 && (
              <div style={{ fontSize: 13, color: '#94a3b8' }}>{nurOffene ? 'Keine offenen Korrekturen.' : 'Noch nichts entschieden.'}</div>
            )}
            {angezeigt.map((k) => {
              const diff = mehrzeitMinuten(k)
              return (
                <div key={k.id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 12, marginBottom: 10 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>
                    {nameVon(k.mitarbeiter_id)} · {datumDeutsch(k.datum)}
                    {k.status !== 'offen' && (
                      <span style={{ marginLeft: 8, fontSize: 12, color: k.status === 'genehmigt' ? '#15803d' : '#b91c1c' }}>
                        {k.status === 'genehmigt' ? 'Genehmigt' : 'Abgelehnt'}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 13, color: '#475569', marginTop: 4 }}>
                    {k.schicht_name ?? 'Dienst'} · geplant {zeitKurz(k.geplant_beginn)}–{zeitKurz(k.geplant_ende)}
                    {k.geplant_pause > 0 ? `, Pause ${k.geplant_pause} Min.` : ''}
                    {k.geplant_beginn && k.geplant_ende
                      ? ` (${stundenText(arbeitsMinuten(k.geplant_beginn, k.geplant_ende, k.geplant_pause))})`
                      : ''}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4, color: diff > 0 ? '#b45309' : '#0f2447' }}>
                    Tatsächlich {zeitKurz(k.ist_beginn)}–{zeitKurz(k.ist_ende)}
                    {k.ist_pause > 0 ? `, Pause ${k.ist_pause} Min.` : ''} ({stundenText(arbeitsMinuten(k.ist_beginn, k.ist_ende, k.ist_pause))},{' '}
                    {differenzText(diff)})
                  </div>
                  <div style={{ fontSize: 13, color: '#475569', background: '#f1f5f9', borderRadius: 6, padding: '6px 10px', marginTop: 6 }}>
                    Grund: {k.grund}
                  </div>
                  {k.status === 'offen' ? (
                    <>
                      <input
                        type="text"
                        value={notizen[k.id] ?? ''}
                        onChange={(e) => setNotizen({ ...notizen, [k.id]: e.target.value })}
                        placeholder="Antwort an den Mitarbeiter (bei Ablehnung Pflicht)"
                        style={{ width: '100%', boxSizing: 'border-box', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px', fontSize: 13, marginTop: 8 }}
                      />
                      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                        <button onClick={() => entscheiden(k, 'genehmigt')} style={knopfPrimaer}>
                          Genehmigen
                        </button>
                        <button onClick={() => entscheiden(k, 'abgelehnt')} style={knopfRot}>
                          Ablehnen
                        </button>
                      </div>
                    </>
                  ) : (
                    k.planer_notiz && <div style={{ fontSize: 12, color: '#64748b', marginTop: 6 }}>Deine Antwort: {k.planer_notiz}</div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </>
  )
}
