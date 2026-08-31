import { useState } from 'react'
import Kopfzeile from './Kopfzeile'
import UrlaubAntragUpload from './UrlaubAntragUpload'
import MeineAntraege from './MeineAntraege'
import Kalender from './Kalender'
import MitarbeiterVerwaltung from './MitarbeiterVerwaltung'

function App() {
  const [neuLadenAuslöser, setNeuLadenAuslöser] = useState(0)

  function neuLaden() {
    setNeuLadenAuslöser((n) => n + 1)
  }

  return (
    <div>
      <Kopfzeile />
      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 20px' }}>
        <div
          style={{
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            padding: 24,
            marginBottom: 32,
            maxWidth: 640,
          }}
        >
          <UrlaubAntragUpload onGespeichert={neuLaden} />
        </div>

        <div
          style={{
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            padding: 24,
            marginBottom: 32,
          }}
        >
          <h3 style={{ marginTop: 0 }}>Personalplanung</h3>
          <Kalender neuLadenAuslöser={neuLadenAuslöser} />
        </div>

        <div
          style={{
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            padding: 24,
            marginBottom: 32,
          }}
        >
          <h3 style={{ marginTop: 0 }}>Mitarbeiterübersicht</h3>
          <MitarbeiterVerwaltung neuLadenAuslöser={neuLadenAuslöser} />
        </div>

        <h3 style={{ marginBottom: 12 }}>Eingereichte Anträge</h3>
        <MeineAntraege neuLadenAuslöser={neuLadenAuslöser} onGeaendert={neuLaden} />
      </main>
    </div>
  )
}

export default App
