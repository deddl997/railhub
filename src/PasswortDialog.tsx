import { useState } from 'react'
import { supabase } from './lib/supabase'

interface Props {
  // 'aendern': eingeloggter Nutzer aendert sein Passwort (Fenster ueber der App)
  // 'zuruecksetzen': Nutzer kommt ueber den Link aus der E-Mail "Passwort vergessen"
  modus: 'aendern' | 'zuruecksetzen'
  onFertig: () => void
  onAbbrechen?: () => void
}

const MIN_LAENGE = 8

function fehlerText(meldung: string): string {
  const m = meldung.toLowerCase()
  if (m.includes('different from the old password')) return 'Das neue Passwort muss sich vom bisherigen unterscheiden.'
  if (m.includes('at least') || m.includes('weak') || m.includes('should contain'))
    return 'Das Passwort ist zu schwach. Bitte ein längeres Passwort mit Buchstaben und Zahlen wählen.'
  if (m.includes('reauthentication') || m.includes('session')) return 'Bitte melde dich einmal ab und neu an. Danach kannst du das Passwort ändern.'
  return 'Das Passwort konnte nicht geändert werden: ' + meldung
}

export default function PasswortDialog({ modus, onFertig, onAbbrechen }: Props) {
  const [neu, setNeu] = useState('')
  const [wiederholen, setWiederholen] = useState('')
  const [zeigen, setZeigen] = useState(false)
  const [fehler, setFehler] = useState<string | null>(null)
  const [erledigt, setErledigt] = useState(false)
  const [laedt, setLaedt] = useState(false)

  async function speichern() {
    setFehler(null)
    if (neu.length < MIN_LAENGE) {
      setFehler(`Das Passwort muss mindestens ${MIN_LAENGE} Zeichen haben.`)
      return
    }
    if (neu !== wiederholen) {
      setFehler('Die beiden Passwörter stimmen nicht überein.')
      return
    }
    setLaedt(true)
    const { error } = await supabase.auth.updateUser({ password: neu })
    setLaedt(false)
    if (error) {
      setFehler(fehlerText(error.message))
      return
    }
    setErledigt(true)
  }

  const karte = (
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        background: 'var(--card, #ffffff)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: 28,
        width: 380,
        maxWidth: '100%',
        boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 17, color: 'var(--navy)', marginBottom: 4 }}>
        {modus === 'zuruecksetzen' ? 'Neues Passwort festlegen' : 'Passwort ändern'}
      </div>

      {erledigt ? (
        <>
          <div style={{ color: '#15803d', fontSize: 14, margin: '12px 0 16px' }}>
            Dein Passwort wurde geändert. Ab jetzt meldest du dich mit dem neuen Passwort an.
          </div>
          <button onClick={onFertig} style={primaerStil}>
            {modus === 'zuruecksetzen' ? 'Weiter zur App' : 'Schließen'}
          </button>
        </>
      ) : (
        <>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14 }}>
            Mindestens {MIN_LAENGE} Zeichen. Am besten Buchstaben, Zahlen und ein Sonderzeichen mischen.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label style={beschriftungStil}>
              Neues Passwort
              <input
                type={zeigen ? 'text' : 'password'}
                value={neu}
                onChange={(e) => setNeu(e.target.value)}
                autoComplete="new-password"
                style={eingabeStil}
              />
            </label>
            <label style={beschriftungStil}>
              Neues Passwort wiederholen
              <input
                type={zeigen ? 'text' : 'password'}
                value={wiederholen}
                onChange={(e) => setWiederholen(e.target.value)}
                autoComplete="new-password"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') speichern()
                }}
                style={eingabeStil}
              />
            </label>
            <label style={{ fontSize: 13, color: 'var(--text-muted)', display: 'flex', gap: 6, alignItems: 'center' }}>
              <input type="checkbox" checked={zeigen} onChange={(e) => setZeigen(e.target.checked)} />
              Passwort anzeigen
            </label>
            {fehler && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{fehler}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={speichern} disabled={laedt} style={primaerStil}>
                {laedt ? 'Wird gespeichert ...' : 'Passwort speichern'}
              </button>
              {onAbbrechen && (
                <button onClick={onAbbrechen} style={sekundaerStil}>
                  Abbrechen
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )

  if (modus === 'zuruecksetzen') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: 20 }}>
        {karte}
      </div>
    )
  }

  return (
    <div
      onClick={onAbbrechen}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2000,
        padding: 20,
      }}
    >
      {karte}
    </div>
  )
}

const beschriftungStil: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 500,
  color: 'var(--text-muted)',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
}

const eingabeStil: React.CSSProperties = {
  padding: '8px 10px',
  border: '1px solid var(--border)',
  borderRadius: 6,
  fontSize: 14,
}

const primaerStil: React.CSSProperties = {
  background: 'var(--navy)',
  color: '#ffffff',
  border: 'none',
  borderRadius: 6,
  padding: '10px 16px',
  fontSize: 14,
  fontWeight: 500,
  cursor: 'pointer',
}

const sekundaerStil: React.CSSProperties = {
  background: 'none',
  border: '1px solid var(--navy)',
  color: 'var(--navy)',
  borderRadius: 6,
  padding: '10px 16px',
  fontSize: 14,
  cursor: 'pointer',
}
