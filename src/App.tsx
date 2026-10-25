import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import Anmeldung from './Anmeldung'
import UrlaubAntragUpload from './UrlaubAntragUpload'
import MeineAntraege from './MeineAntraege'
import MeineEigenenAntraege from './MeineEigenenAntraege'
import Kalender from './Kalender'
import MitarbeiterVerwaltung from './MitarbeiterVerwaltung'
import Streckenkunde from './Streckenkunde'
import Dienstplan from './Dienstplan'
import SchichtvorlagenVerwaltung from './SchichtvorlagenVerwaltung'
import { useAktuellerMitarbeiter } from './useAktuellerMitarbeiter'

const ALLE_TABS = [
  { id: 'antrag', label: 'Antrag einreichen', nurAdmin: false },
  { id: 'kalender', label: 'Personalplanung', nurAdmin: true },
  { id: 'antraege', label: 'Anträge', nurAdmin: false },
  { id: 'mitarbeiter', label: 'Mitarbeiter', nurAdmin: true },
  { id: 'streckenkunde', label: 'Streckenkunde', nurAdmin: false },
  { id: 'dienstplan', label: 'Dienstplan', nurAdmin: true },
  { id: 'schichtvorlagen', label: 'Schichtvorlagen', nurAdmin: true },
] as const

type TabId = (typeof ALLE_TABS)[number]['id']

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [ladeSession, setLadeSession] = useState(true)
  const [neuLadenAuslöser, setNeuLadenAuslöser] = useState(0)
  const [aktiverTab, setAktiverTab] = useState<TabId>('antrag')
  const [logoFehler, setLogoFehler] = useState(false)

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
    <div style={{ background: '#f1f4f9', minHeight: '100vh' }}>
      <header
        style={{
          background: '#14325c',
          color: '#ffffff',
          display: 'flex',
          alignItems: 'center',
          gap: 24,
          padding: '8px 24px',
          minHeight: 56,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              height: 44,
              minWidth: 44,
              borderRadius: 8,
              background: '#ffffff',
              color: '#14325c',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '2px 6px',
              boxSizing: 'border-box',
              letterSpacing: -0.5,
            }}
          >
            {logoFehler ? (
              'RBL'
            ) : (
              <img
                src="/rbl-logo.png"
                alt="Rail Bavaria Logistik"
                onError={() => setLogoFehler(true)}
                style={{ height: 38, width: 'auto', display: 'block' }}
              />
            )}
          </div>
          <div style={{ fontWeight: 600, fontSize: 15, lineHeight: 1.2 }}>
            RBL Planung
            <div style={{ fontWeight: 400, fontSize: 11, color: '#c9d6ea' }}>Rail Bavaria Logistik GmbH</div>
          </div>
        </div>

        <nav style={{ display: 'flex', gap: 4, flexGrow: 1, overflowX: 'auto' }}>
          {sichtbareTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setAktiverTab(tab.id)}
              style={{
                background: aktiverTab === tab.id ? 'rgba(255,255,255,0.14)' : 'transparent',
                border: 'none',
                borderRadius: 8,
                color: aktiverTab === tab.id ? '#ffffff' : '#c9d6ea',
                fontWeight: aktiverTab === tab.id ? 600 : 500,
                fontSize: 14,
                padding: '8px 14px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 13, color: '#c9d6ea' }}>
          <span>
            {istAdmin ? 'Planer · ' : ''}
            {mitarbeiter?.name ?? ''}
          </span>
          <button
            onClick={abmelden}
            style={{
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.4)',
              color: '#ffffff',
              borderRadius: 8,
              padding: '6px 12px',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            Abmelden
          </button>
        </div>
      </header>

      <main
        style={{
          maxWidth: aktiverTab === 'dienstplan' ? 1600 : 1100,
          margin: '0 auto',
          padding: '32px 20px',
        }}
      >
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

        {aktiverTab === 'dienstplan' && istAdmin && (
          <div
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: 24,
            }}
          >
            <h3 style={{ marginTop: 0 }}>Dienstplan</h3>
            <Dienstplan />
          </div>
        )}

        {aktiverTab === 'schichtvorlagen' && istAdmin && (
          <div
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: 24,
            }}
          >
            <h3 style={{ marginTop: 0 }}>Schichtvorlagen</h3>
            <SchichtvorlagenVerwaltung />
          </div>
        )}
      </main>
    </div>
  )
}

export default App
