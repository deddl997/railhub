import { useState } from 'react'
import Kopfzeile from './Kopfzeile'
import UrlaubAntragUpload from './UrlaubAntragUpload'
import MeineAntraege from './MeineAntraege'

function App() {
  const [neuLadenAuslöser, setNeuLadenAuslöser] = useState(0)

  return (
    <div>
      <Kopfzeile />
      <main style={{ maxWidth: 640, margin: '0 auto', padding: '32px 20px' }}>
        <div
          style={{
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            padding: 24,
            marginBottom: 32,
          }}
        >
          <UrlaubAntragUpload onGespeichert={() => setNeuLadenAuslöser((n) => n + 1)} />
        </div>

        <h3 style={{ marginBottom: 12 }}>Eingereichte Anträge</h3>
        <MeineAntraege neuLadenAuslöser={neuLadenAuslöser} />
      </main>
    </div>
  )
}

export default App