import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import Anmeldung from './Anmeldung'
import PasswortDialog from './PasswortDialog'
import Uebersichten from './Uebersichten'
import UrlaubAntragUpload from './UrlaubAntragUpload'
import MeineAntraege from './MeineAntraege'
import MeineEigenenAntraege from './MeineEigenenAntraege'
import Kalender from './Kalender'
import MitarbeiterVerwaltung from './MitarbeiterVerwaltung'
import Streckenkunde from './Streckenkunde'
import Dienstplan from './Dienstplan'
import MeinDienstplan from './MeinDienstplan'
import SchichtvorlagenVerwaltung from './SchichtvorlagenVerwaltung'
import { useAktuellerMitarbeiter } from './useAktuellerMitarbeiter'

const ALLE_TABS = [
  { id: 'meinplan', label: 'Mein Dienstplan', kurz: 'Dienstplan', nurAdmin: false },
  { id: 'antrag', label: 'Antrag einreichen', kurz: 'Antrag', nurAdmin: false },
  { id: 'kalender', label: 'Personalplanung', kurz: 'Planung', nurAdmin: true },
  { id: 'antraege', label: 'Anträge', kurz: 'Anträge', nurAdmin: false },
  { id: 'uebersicht', label: 'Übersicht', kurz: 'Übersicht', nurAdmin: false },
  { id: 'mitarbeiter', label: 'Mitarbeiter', kurz: 'Personal', nurAdmin: true },
  { id: 'streckenkunde', label: 'Streckenkunde', kurz: 'Strecken', nurAdmin: false },
  { id: 'dienstplan', label: 'Dienstplan', kurz: 'Dienstplan', nurAdmin: true },
  { id: 'schichtvorlagen', label: 'Schichtvorlagen', kurz: 'Vorlagen', nurAdmin: true },
] as const

type TabId = (typeof ALLE_TABS)[number]['id']

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [ladeSession, setLadeSession] = useState(true)
  const [neuLadenAuslöser, setNeuLadenAuslöser] = useState(0)
  const [aktiverTab, setAktiverTab] = useState<TabId>('antrag')
  const [logoFehler, setLogoFehler] = useState(false)
  const [passwortDialogOffen, setPasswortDialogOffen] = useState(false)
  const [passwortZuruecksetzen, setPasswortZuruecksetzen] = useState(false)
  const [handy, setHandy] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 700px)').matches)
  const [menueOffen, setMenueOffen] = useState(false)

  // Handy-Ansicht: schmale Kopfzeile, Reiter unten am Bildschirmrand
  useEffect(() => {
    const abfrage = window.matchMedia('(max-width: 700px)')
    const aendern = () => setHandy(abfrage.matches)
    abfrage.addEventListener('change', aendern)
    return () => abfrage.removeEventListener('change', aendern)
  }, [])

  const { mitarbeiter, istAdmin, ladeVorgang: ladeRolle } = useAktuellerMitarbeiter()
  const [startTabGesetzt, setStartTabGesetzt] = useState(false)

  // Mitarbeiter starten direkt in ihrem Dienstplan
  useEffect(() => {
    if (!ladeRolle && !startTabGesetzt) {
      if (mitarbeiter && !istAdmin) setAktiverTab('meinplan')
      setStartTabGesetzt(true)
    }
  }, [ladeRolle, mitarbeiter, istAdmin, startTabGesetzt])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLadeSession(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((event, neueSession) => {
      setSession(neueSession)
      // Nutzer kommt ueber den Link aus der E-Mail "Passwort vergessen"
      if (event === 'PASSWORD_RECOVERY') setPasswortZuruecksetzen(true)
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

  if (session && passwortZuruecksetzen) {
    return <PasswortDialog modus="zuruecksetzen" onFertig={() => setPasswortZuruecksetzen(false)} />
  }

  if (!session) {
    return <Anmeldung />
  }

  if (ladeRolle) {
    return (
      <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-muted)' }}>Lädt...</div>
    )
  }

  const sichtbareTabs = ALLE_TABS.filter((tab) =>
    tab.id === 'meinplan' ? !istAdmin : !tab.nurAdmin || istAdmin
  )

  return (
    <div style={{ background: '#f1f4f9', minHeight: '100vh' }}>
      <header
        style={{
          background: '#14325c',
          color: '#ffffff',
          display: 'flex',
          alignItems: 'center',
          gap: handy ? 10 : 24,
          padding: handy ? '6px 12px' : '8px 24px',
          minHeight: handy ? 48 : 56,
          flexWrap: 'wrap',
          position: handy ? 'sticky' : 'static',
          top: 0,
          zIndex: 500,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              height: handy ? 34 : 44,
              minWidth: handy ? 34 : 44,
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
                style={{ height: handy ? 28 : 38, width: 'auto', display: 'block' }}
              />
            )}
          </div>
          <div style={{ fontWeight: 600, fontSize: 15, lineHeight: 1.2 }}>
            RBL Planung
            {!handy && <div style={{ fontWeight: 400, fontSize: 11, color: '#c9d6ea' }}>Rail Bavaria Logistik GmbH</div>}
          </div>
        </div>

        <nav
          style={{
            display: 'flex',
            gap: 4,
            flexGrow: 1,
            overflowX: 'auto',
            ...(handy ? { order: 3, flexBasis: '100%', margin: '0 -4px' } : {}),
          }}
        >
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
                padding: handy ? '8px 12px' : '8px 14px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {handy && (
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <span style={{ fontSize: 12, color: '#c9d6ea', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140 }}>
              {mitarbeiter?.name ?? ''}
            </span>
            <button
              onClick={() => setMenueOffen(!menueOffen)}
              aria-label="Menü"
              style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.4)', color: '#ffffff', borderRadius: 8, width: 38, height: 34, fontSize: 18, lineHeight: 1, cursor: 'pointer' }}
            >
              ⋯
            </button>
            {menueOffen && (
              <>
                <div onClick={() => setMenueOffen(false)} style={{ position: 'fixed', inset: 0, zIndex: 600 }} />
                <div
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 4px)',
                    right: 8,
                    zIndex: 700,
                    background: '#ffffff',
                    borderRadius: 10,
                    boxShadow: '0 8px 30px rgba(0,0,0,0.25)',
                    padding: 6,
                    minWidth: 190,
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  <button
                    onClick={() => {
                      setMenueOffen(false)
                      setPasswortDialogOffen(true)
                    }}
                    style={menueKnopfStil}
                  >
                    Passwort ändern
                  </button>
                  <button onClick={abmelden} style={menueKnopfStil}>
                    Abmelden
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {!handy && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 13, color: '#c9d6ea' }}>
          <span>
            {istAdmin ? 'Planer · ' : ''}
            {mitarbeiter?.name ?? ''}
          </span>
          <button
            onClick={() => setPasswortDialogOffen(true)}
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
            Passwort ändern
          </button>
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
        )}
      </header>

      {passwortDialogOffen && (
        <PasswortDialog modus="aendern" onFertig={() => setPasswortDialogOffen(false)} onAbbrechen={() => setPasswortDialogOffen(false)} />
      )}

      <main
        style={{
          maxWidth: aktiverTab === 'dienstplan' ? 1600 : 1100,
          margin: '0 auto',
          padding: handy ? '12px 10px 24px' : '32px 20px',
        }}
      >
        {aktiverTab === 'meinplan' && !istAdmin && mitarbeiter && (
          <div
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: handy ? 14 : 24,
              maxWidth: 720,
              margin: '0 auto',
            }}
          >
            <h3 style={{ marginTop: 0 }}>Mein Dienstplan</h3>
            <MeinDienstplan mitarbeiterId={mitarbeiter.id} />
          </div>
        )}

        {aktiverTab === 'antrag' && (
          <div
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: handy ? 14 : 24,
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
              padding: handy ? 14 : 24,
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

        {aktiverTab === 'uebersicht' && (istAdmin || mitarbeiter) && (
          <div
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: handy ? 14 : 24,
            }}
          >
            <h3 style={{ marginTop: 0 }}>{istAdmin ? 'Auswertung: Monat und Urlaub' : 'Meine Übersicht'}</h3>
            <Uebersichten eigeneId={istAdmin ? null : mitarbeiter?.id ?? null} />
          </div>
        )}

        {aktiverTab === 'mitarbeiter' && istAdmin && (
          <div
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: handy ? 14 : 24,
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
              padding: handy ? 14 : 24,
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
              padding: handy ? 14 : 24,
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
              padding: handy ? 14 : 24,
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

const menueKnopfStil: React.CSSProperties = {
  background: 'none',
  border: 'none',
  textAlign: 'left',
  padding: '12px 14px',
  fontSize: 15,
  color: '#14325c',
  borderRadius: 8,
  cursor: 'pointer',
}

export default App
