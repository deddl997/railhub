import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'

interface MitarbeiterOhneLogin {
  id: string
  name: string
}

export default function Anmeldung() {
  const [modus, setModus] = useState<'anmelden' | 'registrieren'>('anmelden')
  const [email, setEmail] = useState('')
  const [passwort, setPasswort] = useState('')
  const [passwortWiederholen, setPasswortWiederholen] = useState('')
  const [ausgewaehlteMitarbeiterId, setAusgewaehlteMitarbeiterId] = useState('')
  const [mitarbeiterOhneLogin, setMitarbeiterOhneLogin] = useState<MitarbeiterOhneLogin[]>([])
  const [fehler, setFehler] = useState<string | null>(null)
  const [hinweis, setHinweis] = useState<string | null>(null)
  const [ladeVorgang, setLadeVorgang] = useState(false)

  useEffect(() => {
    if (modus === 'registrieren') {
      supabase
        .from('mitarbeiter')
        .select('id, name')
        .is('auth_user_id', null)
        .order('name')
        .then(({ data }) => setMitarbeiterOhneLogin(data ?? []))
    }
  }, [modus])

  async function anmelden() {
    setFehler(null)
    setLadeVorgang(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password: passwort })
    if (error) setFehler('Anmeldung fehlgeschlagen: ' + error.message)
    setLadeVorgang(false)
  }

  async function registrieren() {
    setFehler(null)
    setHinweis(null)

    if (!ausgewaehlteMitarbeiterId) {
      setFehler('Bitte deinen Namen auswählen.')
      return
    }
    if (passwort.length < 6) {
      setFehler('Das Passwort muss mindestens 6 Zeichen haben.')
      return
    }
    if (passwort !== passwortWiederholen) {
      setFehler('Die Passwörter stimmen nicht überein.')
      return
    }

    setLadeVorgang(true)
    const { data, error } = await supabase.auth.signUp({
      email,
      password: passwort,
      options: { data: { mitarbeiter_id: ausgewaehlteMitarbeiterId } },
    })

    if (error) {
      setFehler('Registrierung fehlgeschlagen: ' + error.message)
      setLadeVorgang(false)
      return
    }

    if (data.session && data.user) {
      await supabase
        .from('mitarbeiter')
        .update({ auth_user_id: data.user.id })
        .eq('id', ausgewaehlteMitarbeiterId)
    }

    if (!data.session) {
      setHinweis('Registrierung erfolgreich! Bitte bestätige deine E-Mail, um dich anzumelden.')
    }
    setLadeVorgang(false)
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg)',
      }}
    >
      <div
        style={{
          background: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: 32,
          width: 380,
          maxWidth: '90vw',
          boxShadow: '0 4px 20px rgba(0,0,0,0.06)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24 }}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
            <path d="M2 19L9 6L13 13L16 8L22 19H2Z" fill="#14325c" />
          </svg>
          <div>
            <div style={{ fontWeight: 600, fontSize: 15 }}>Rail Bavaria Logistik</div>
            <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>Urlaubsplan</div>
          </div>
        </div>

        <div style={{ display: 'flex', marginBottom: 20, borderBottom: '1px solid var(--border)' }}>
          <button
            onClick={() => {
              setModus('anmelden')
              setFehler(null)
              setHinweis(null)
            }}
            style={tabKnopfStil(modus === 'anmelden')}
          >
            Anmelden
          </button>
          <button
            onClick={() => {
              setModus('registrieren')
              setFehler(null)
              setHinweis(null)
            }}
            style={tabKnopfStil(modus === 'registrieren')}
          >
            Registrieren
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {modus === 'registrieren' && (
            <label style={beschriftungStil}>
              Dein Name
              <select
                value={ausgewaehlteMitarbeiterId}
                onChange={(e) => setAusgewaehlteMitarbeiterId(e.target.value)}
                style={eingabeStil}
              >
                <option value="">Auswählen...</option>
                {mitarbeiterOhneLogin.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label style={beschriftungStil}>
            E-Mail
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={eingabeStil}
            />
          </label>

          <label style={beschriftungStil}>
            Passwort
            <input
              type="password"
              value={passwort}
              onChange={(e) => setPasswort(e.target.value)}
              style={eingabeStil}
            />
          </label>

          {modus === 'registrieren' && (
            <label style={beschriftungStil}>
              Passwort wiederholen
              <input
                type="password"
                value={passwortWiederholen}
                onChange={(e) => setPasswortWiederholen(e.target.value)}
                style={eingabeStil}
              />
            </label>
          )}

          {fehler && <p style={{ color: 'var(--danger)', fontSize: 13, margin: 0 }}>{fehler}</p>}
          {hinweis && <p style={{ color: 'var(--success)', fontSize: 13, margin: 0 }}>{hinweis}</p>}

          <button
            onClick={modus === 'anmelden' ? anmelden : registrieren}
            disabled={ladeVorgang}
            style={{
              background: 'var(--navy)',
              color: '#ffffff',
              border: 'none',
              borderRadius: 6,
              padding: '10px 16px',
              fontSize: 14,
              fontWeight: 500,
              cursor: 'pointer',
              marginTop: 4,
            }}
          >
            {modus === 'anmelden' ? 'Anmelden' : 'Registrieren'}
          </button>
        </div>
      </div>
    </div>
  )
}

function tabKnopfStil(aktiv: boolean): React.CSSProperties {
  return {
    flex: 1,
    background: 'none',
    border: 'none',
    borderBottom: aktiv ? '2px solid var(--navy)' : '2px solid transparent',
    color: aktiv ? 'var(--navy)' : 'var(--text-muted)',
    fontWeight: aktiv ? 600 : 500,
    fontSize: 14,
    padding: '8px 0',
    cursor: 'pointer',
  }
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
