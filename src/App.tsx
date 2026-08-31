import { useState } from 'react'
import Kopfzeile from './Kopfzeile'
import UrlaubAntragUpload from './UrlaubAntragUpload'
import MeineAntraege from './MeineAntraege'
import Kalender from './Kalender'
import MitarbeiterVerwaltung from './MitarbeiterVerwaltung'

const TABS = [
  { id: 'antrag', label: 'Antrag einreichen' },
  { id: 'kalender', label: 'Personalplanung' },
  { id: 'antraege', label: 'Anträge' },
  { id: 'mitarbeiter', label: 'Mitarbeiter' },
] as const

type TabId = (typeof TABS)[number]['id']

function App() {
  const [neuLadenAuslöser, setNeuLadenAuslöser] = useState(0)
  const [aktiverTab, setAktiverTab] = useState<TabId>('antrag')

  function neuLaden() {
    setNeuLadenAuslöser((n) => n + 1)
  }

  return (
    <div>
      <Kopfzeile />

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
        {TABS.map((tab) => (
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

        {aktiverTab === 'kalender' && (
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
            <h3 style={{ marginTop: 0, marginBottom: 12 }}>Eingereichte Anträge</h3>
            <MeineAntraege neuLadenAuslöser={neuLadenAuslöser} onGeaendert={neuLaden} />
          </div>
        )}

        {aktiverTab === 'mitarbeiter' && (
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
      </main>
    </div>
  )
}

export default App
