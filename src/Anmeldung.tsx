import { useState } from 'react'
import { supabase } from './lib/supabase'

interface Kandidat {
  m_id: string
  m_name: string
  hat_login: boolean
  exakt: boolean
}

// Fehlermeldungen der Datenbank-Funktion in verständliche Sätze übersetzen
function fehlerText(meldung: string): string {
  if (meldung.includes('EMAIL_PASST_NICHT'))
    return 'Für diesen Mitarbeiter ist eine andere E-Mail-Adresse hinterlegt. Bitte melde dich mit deiner Firmen-Adresse an oder sprich kurz mit deinem Planer.'
  if (meldung.includes('KONTO_EXISTIERT'))
    return 'Für diesen Namen gibt es schon ein Konto. Bitte melde dich an (Reiter „Anmelden“).'
  if (meldung.includes('NAME_MEHRDEUTIG'))
    return 'Dieser Name kommt mehrfach vor. Bitte sprich kurz mit deinem Planer.'
  if (meldung.includes('NEUANLAGE_NUR_FIRMENMAIL'))
    return 'Neue Mitarbeiter können nur mit einer Firmen-Adresse (@railbavaria.de) angelegt werden. Bitte melde dich beim Planer.'
  return meldung
}

export default function Anmeldung() {
  const [modus, setModus] = useState<'anmelden' | 'registrieren'>('anmelden')
  const [schritt, setSchritt] = useState<'formular' | 'auswahl'>('formular')
  const [vorname, setVorname] = useState('')
  const [nachname, setNachname] = useState('')
  const [email, setEmail] = useState('')
  const [passwort, setPasswort] = useState('')
  const [passwortWiederholen, setPasswortWiederholen] = useState('')
  const [kandidaten, setKandidaten] = useState<Kandidat[]>([])
  const [auswahl, setAuswahl] = useState<string>('neu')
  const [fehler, setFehler] = useState<string | null>(null)
  const [hinweis, setHinweis] = useState<string | null>(null)
  const [ladeVorgang, setLadeVorgang] = useState(false)

  const vollname = `${vorname.trim()} ${nachname.trim()}`.replace(/\s+/g, ' ').trim()

  function moduswechsel(neu: 'anmelden' | 'registrieren') {
    setModus(neu)
    setSchritt('formular')
    setFehler(null)
    setHinweis(null)
  }

  // Nach erfolgreichem Login: Konto mit Mitarbeiter verknüpfen bzw. neu anlegen.
  // Gibt true zurück, wenn die Seite danach neu geladen wird.
  async function profilVerknuepfen(): Promise<boolean> {
    const { data, error } = await supabase.rpc('profil_verknuepfen')
    if (error) {
      // Funktion noch nicht eingerichtet -> alter Ablauf, Login trotzdem zulassen
      if (/profil_verknuepfen/.test(error.message) && /(find|exist)/i.test(error.message)) return false
      await supabase.auth.signOut()
      setFehler(fehlerText(error.message))
      return true
    }
    if (data === 'verknuepft' || data === 'neu_angelegt') {
      window.location.reload()
      return true
    }
    return false
  }

  async function anmelden() {
    setFehler(null)
    setLadeVorgang(true)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: passwort })
    if (error) {
      setFehler('Anmeldung fehlgeschlagen: ' + error.message)
      setLadeVorgang(false)
      return
    }
    await profilVerknuepfen()
    setLadeVorgang(false)
  }

  // Schritt 1: Eingaben prüfen und nach dem Namen suchen
  async function weiter() {
    setFehler(null)
    setHinweis(null)

    if (vorname.trim().length < 2 || nachname.trim().length < 2) {
      setFehler('Bitte Vor- und Nachname eingeben.')
      return
    }
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setFehler('Bitte eine gültige E-Mail-Adresse eingeben.')
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
    const { data, error } = await supabase.rpc('mitarbeiter_suchen', { p_name: vollname })
    if (error) {
      setFehler('Die Namenssuche ist noch nicht eingerichtet: ' + error.message)
      setLadeVorgang(false)
      return
    }
    const treffer = (data ?? []) as Kandidat[]
    const exakt = treffer.find((t) => t.exakt)

    if (exakt) {
      if (exakt.hat_login) {
        setFehler(`Für „${exakt.m_name}“ gibt es schon ein Konto. Bitte melde dich an (Reiter „Anmelden“).`)
        setLadeVorgang(false)
        return
      }
      await registrieren(exakt.m_id)
      return
    }

    if (treffer.length > 0) {
      // Ähnliche Namen gefunden: Person soll bestätigen, wer sie ist
      setKandidaten(treffer)
      setAuswahl(treffer.find((t) => !t.hat_login)?.m_id ?? 'neu')
      setSchritt('auswahl')
      setLadeVorgang(false)
      return
    }

    // Niemand gefunden -> wird neu angelegt
    await registrieren(null)
  }

  // Schritt 2: Konto erstellen (mit gewähltem Mitarbeiter oder als neuer Mitarbeiter)
  async function registrieren(mitarbeiterId: string | null) {
    setLadeVorgang(true)
    setFehler(null)
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password: passwort,
      options: { data: { vollname, ...(mitarbeiterId ? { mitarbeiter_id: mitarbeiterId } : {}) } },
    })

    if (error) {
      setFehler('Registrierung fehlgeschlagen: ' + error.message)
      setLadeVorgang(false)
      return
    }

    if (data.session) {
      const beendet = await profilVerknuepfen()
      if (!beendet) setLadeVorgang(false)
      return
    }

    setSchritt('formular')
    setHinweis(
      'Registrierung erfolgreich! Bitte bestätige deine E-Mail (Link in der Mail). Danach kannst du dich anmelden – dein Name wird automatisch zugeordnet bzw. neu angelegt.'
    )
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
          width: 400,
          maxWidth: '92vw',
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
          <button onClick={() => moduswechsel('anmelden')} style={tabKnopfStil(modus === 'anmelden')}>
            Anmelden
          </button>
          <button onClick={() => moduswechsel('registrieren')} style={tabKnopfStil(modus === 'registrieren')}>
            Registrieren
          </button>
        </div>

        {modus === 'registrieren' && schritt === 'auswahl' ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 14 }}>
              Zu „<strong>{vollname}</strong>“ gibt es keinen genau passenden Eintrag. Bist du einer von diesen?
            </div>

            {kandidaten.map((k) => (
              <label
                key={k.m_id}
                style={{
                  ...auswahlStil,
                  opacity: k.hat_login ? 0.5 : 1,
                  borderColor: auswahl === k.m_id ? 'var(--navy)' : 'var(--border)',
                }}
              >
                <input type="radio" name="wahl" disabled={k.hat_login} checked={auswahl === k.m_id} onChange={() => setAuswahl(k.m_id)} />
                <span>
                  <strong>{k.m_name}</strong>
                  {k.hat_login && <span style={{ color: 'var(--text-muted)', fontSize: 12 }}> – hat schon ein Konto</span>}
                </span>
              </label>
            ))}

            <label style={{ ...auswahlStil, borderColor: auswahl === 'neu' ? 'var(--navy)' : 'var(--border)' }}>
              <input type="radio" name="wahl" checked={auswahl === 'neu'} onChange={() => setAuswahl('neu')} />
              <span>
                <strong>Keiner davon</strong>
                <span style={{ color: 'var(--text-muted)', fontSize: 12 }}> – als „{vollname}“ neu anlegen</span>
              </span>
            </label>

            {fehler && <p style={{ color: 'var(--danger)', fontSize: 13, margin: 0 }}>{fehler}</p>}

            <button onClick={() => registrieren(auswahl === 'neu' ? null : auswahl)} disabled={ladeVorgang} style={hauptKnopfStil}>
              {ladeVorgang ? 'Bitte warten…' : 'Registrieren'}
            </button>
            <button
              onClick={() => {
                setSchritt('formular')
                setFehler(null)
              }}
              disabled={ladeVorgang}
              style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13 }}
            >
              ← Zurück
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {modus === 'registrieren' && (
              <>
                <div style={{ display: 'flex', gap: 10 }}>
                  <label style={{ ...beschriftungStil, flex: 1 }}>
                    Vorname
                    <input value={vorname} onChange={(e) => setVorname(e.target.value)} style={eingabeStil} autoComplete="given-name" />
                  </label>
                  <label style={{ ...beschriftungStil, flex: 1 }}>
                    Nachname
                    <input value={nachname} onChange={(e) => setNachname(e.target.value)} style={eingabeStil} autoComplete="family-name" />
                  </label>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: -4 }}>
                  Wir suchen dich automatisch in der Mitarbeiterliste. Wenn es dich noch nicht gibt, wirst du neu angelegt.
                </div>
              </>
            )}

            <label style={beschriftungStil}>
              E-Mail
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && modus === 'anmelden' && anmelden()}
                style={eingabeStil}
                autoComplete="email"
              />
            </label>

            <label style={beschriftungStil}>
              Passwort
              <input
                type="password"
                value={passwort}
                onChange={(e) => setPasswort(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && modus === 'anmelden' && anmelden()}
                style={eingabeStil}
                autoComplete={modus === 'anmelden' ? 'current-password' : 'new-password'}
              />
            </label>

            {modus === 'registrieren' && (
              <label style={beschriftungStil}>
                Passwort wiederholen
                <input
                  type="password"
                  value={passwortWiederholen}
                  onChange={(e) => setPasswortWiederholen(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && weiter()}
                  style={eingabeStil}
                  autoComplete="new-password"
                />
              </label>
            )}

            {fehler && <p style={{ color: 'var(--danger)', fontSize: 13, margin: 0 }}>{fehler}</p>}
            {hinweis && <p style={{ color: 'var(--success)', fontSize: 13, margin: 0 }}>{hinweis}</p>}

            <button onClick={modus === 'anmelden' ? anmelden : weiter} disabled={ladeVorgang} style={hauptKnopfStil}>
              {ladeVorgang ? 'Bitte warten…' : modus === 'anmelden' ? 'Anmelden' : 'Weiter'}
            </button>
          </div>
        )}
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
  width: '100%',
  boxSizing: 'border-box',
}

const hauptKnopfStil: React.CSSProperties = {
  background: 'var(--navy)',
  color: '#ffffff',
  border: 'none',
  borderRadius: 6,
  padding: '10px 16px',
  fontSize: 14,
  fontWeight: 500,
  cursor: 'pointer',
  marginTop: 4,
}

const auswahlStil: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '10px 12px',
  border: '2px solid var(--border)',
  borderRadius: 8,
  cursor: 'pointer',
  fontSize: 14,
}
