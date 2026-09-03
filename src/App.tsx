import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import Kopfzeile from './Kopfzeile'
import Anmeldung from './Anmeldung'
import UrlaubAntragUpload from './UrlaubAntragUpload'
import MeineAntraege from './MeineAntraege'
import MeineEigenenAntraege from './MeineEigenenAntraege'
import Kalender from './Kalender'
import MitarbeiterVerwaltung from './MitarbeiterVerwaltung'
import Streckenkunde from './Streckenkunde'
import { useAktuellerMitarbeiter } from './useAktuellerMitarbeiter'

const ALLE_TABS = [
  { id: 'antrag', label: 'Antrag einreichen', nurAdmin: false },
  { id: 'kalender', label: 'Personalplanung', nurAdmin: true },
  { id: 'antraege', label: 'Anträge', nurAdmin: false },
  { id: 'mitarbeiter', label: 'Mitarbeiter', nurAdmin: true },
  { id: 'streckenkunde', label: 'Streckenkunde', nurAdmin: false },
] as const

type TabId = (typeof ALLE_TABS)[number]['id']

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [ladeSession, setLadeSession] = useState(true)
  const [neuLadenAuslöser, setNeuLadenAuslöser] = useState(0)
  const [aktiverTab, setAktiverTab] = useState<TabId>('antrag')

  const { mitarbeiter, istAdmin, ladeVorgang: ladeRolle } = useAktuellerMitarbeiter()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLadeSession(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, neueSession) => {
      setSession(neueSession)
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  function neuLaden() {
    setNeuLadenAuslöser((n) => n + 1)
  }

  async function abmelden() {
    await supabase.auth.signOut()
  }

  if (ladeSession) {
    return (
      <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-muted)' }}>Lädt...</div>
    )
  }

  if (!session) {
    return <Anmeldung />
  }

  if (ladeRolle) {
    return (
      <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-muted)' }}>Lädt...</div>
    )
  }

  const sichtbareTabs = ALLE_TABS.filter((tab) => !tab.nurAdmin || istAdmin)

  return (
    <div>
      <Kopfzeile angemeldeterName={mitarbeiter?.name ?? null} onAbmelden={abmelden} />

      <nav
        style={{
          display: 'flex',
          gap: 4,
          borderBottom: '1px solid var(--border)',
          background: 'var(--card)',
          padding: '0 20px',
          overflowX: 'auto',
        }}
      >
        {sichtbareTabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setAktiverTab(tab.id)}
            style={{
              background: 'none',
              border: 'none',
              borderBottom:
                aktiverTab === tab.id ? '2px solid var(--navy)' : '2px solid transparent',
              color: aktiverTab === tab.id ? 'var(--navy)' : 'var(--text-muted)',
              fontWeight: aktiverTab === tab.id ? 600 : 500,
              fontSize: 14,
              padding: '12px 14px',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 20px' }}>
        {aktiverTab === 'antrag' && (
          <div
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: 24,
              maxWidth: 640,
            }}
          >
            <UrlaubAntragUpload onGespeichert={neuLaden} />
          </div>
        )}

        {aktiverTab === 'kalender' && istAdmin && (
          <div
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: 24,
            }}
          >
            <h3 style={{ marginTop: 0 }}>Personalplanung</h3>
            <Kalender neuLadenAuslöser={neuLadenAuslöser} />
          </div>
        )}

        {aktiverTab === 'antraege' && (
          <div>
            <h3 style={{ marginTop: 0, marginBottom: 12 }}>
              {istAdmin ? 'Eingereichte Anträge' : 'Meine Anträge'}
            </h3>
            {istAdmin ? (
              <MeineAntraege neuLadenAuslöser={neuLadenAuslöser} onGeaendert={neuLaden} />
            ) : (
              <MeineEigenenAntraege />
            )}
          </div>
        )}

        {aktiverTab === 'mitarbeiter' && istAdmin && (
          <div
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: 24,
            }}
          >
            <h3 style={{ marginTop: 0 }}>Mitarbeiterübersicht</h3>
            <MitarbeiterVerwaltung neuLadenAuslöser={neuLadenAuslöser} />
          </div>
        )}

        {aktiverTab === 'streckenkunde' && (
          <div
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: 24,
            }}
          >
            <h3 style={{ marginTop: 0 }}>Streckenkunde{istAdmin ? '-Überwachung' : ''}</h3>
            <Streckenkunde />
          </div>
        )}
      </main>
    </div>
  )
}

export default App
