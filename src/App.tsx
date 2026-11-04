import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import Anmeldung from './Anmeldung'
import PasswortDialog from './PasswortDialog'
import Uebersichten from './Uebersichten'
import Auftraege from './Auftraege'
import Abrechnung from './Abrechnung'
import Bahnstrom from './Bahnstrom'
import Kennzahlen from './Kennzahlen'
import Rechnungen from './Rechnungen'
import Protokoll from './Protokoll'
import Wirtschaftlichkeit from './Wirtschaftlichkeit'
import Trassenpreise from './Trassenpreise'
import UrlaubImport from './UrlaubImport'
import Jahreswechsel from './Jahreswechsel'
import BenutzerVerwaltung from './Benutzer'
import { useRolle } from './useRolle'
import { useLiveAktualisierung } from './liveAktualisierung'
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
import Dashboard from './Dashboard'
import { UiAnbieter } from './ui'

const ALLE_TABS = [
  { id: 'start', label: 'Start', kurz: 'Start', nurAdmin: false },
  { id: 'meinplan', label: 'Mein Dienstplan', kurz: 'Dienstplan', nurAdmin: false },
  { id: 'antrag', label: 'Antrag einreichen', kurz: 'Antrag', nurAdmin: false },
  { id: 'kalender', label: 'Personalplanung', kurz: 'Planung', nurAdmin: true },
  { id: 'antraege', label: 'Anträge', kurz: 'Anträge', nurAdmin: false },
  { id: 'uebersicht', label: 'Übersicht', kurz: 'Übersicht', nurAdmin: false },
  { id: 'auftraege', label: 'Aufträge', kurz: 'Aufträge', nurAdmin: false },
  { id: 'abrechnung', label: 'Abrechnung', kurz: 'Abrechnung', nurAdmin: false },
  { id: 'bahnstrom', label: 'Bahnstrom', kurz: 'Bahnstrom', nurAdmin: false },
  { id: 'rechnungen', label: 'Rechnungsentwurf', kurz: 'Rechnungen', nurAdmin: false },
  { id: 'kennzahlen', label: 'Kennzahlen', kurz: 'Kennzahlen', nurAdmin: false },
  { id: 'wirtschaft', label: 'Wirtschaftlichkeit', kurz: 'Gewinn', nurAdmin: false },
  { id: 'trassenpreise', label: 'Trassenpreise', kurz: 'Trassen', nurAdmin: false },
  { id: 'urlaubimport', label: 'Urlaub importieren', kurz: 'Import', nurAdmin: true },
  { id: 'jahreswechsel', label: 'Jahreswechsel', kurz: 'Jahreswechsel', nurAdmin: true },
  { id: 'protokoll', label: 'Änderungsprotokoll', kurz: 'Protokoll', nurAdmin: false },
  { id: 'benutzer', label: 'Benutzer & Rollen', kurz: 'Benutzer', nurAdmin: true },
  { id: 'mitarbeiter', label: 'Mitarbeiter', kurz: 'Personal', nurAdmin: true },
  { id: 'streckenkunde', label: 'Streckenkunde', kurz: 'Strecken', nurAdmin: false },
  { id: 'dienstplan', label: 'Dienstplan', kurz: 'Dienstplan', nurAdmin: true },
  { id: 'schichtvorlagen', label: 'Schichtvorlagen', kurz: 'Vorlagen', nurAdmin: true },
] as const

type TabId = (typeof ALLE_TABS)[number]['id']

function AppInnen() {
  const [session, setSession] = useState<Session | null>(null)
  const [ladeSession, setLadeSession] = useState(true)
  const [neuLadenAuslöser, setNeuLadenAuslöser] = useState(0)
  const [aktiverTab, setAktiverTab] = useState<TabId>('antrag')
  const [logoFehler, setLogoFehler] = useState(false)
  const [passwortDialogOffen, setPasswortDialogOffen] = useState(false)
  const [passwortZuruecksetzen, setPasswortZuruecksetzen] = useState(false)
  const [neueVersion, setNeueVersion] = useState(false)
  const rolle = useRolle(!!session)
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
      if (istAdmin || rolle === 'disponent' || rolle === 'abrechnung') setAktiverTab('start')
      else if (mitarbeiter) setAktiverTab('meinplan')
      setStartTabGesetzt(true)
    }
  }, [ladeRolle, mitarbeiter, istAdmin, rolle, startTabGesetzt])

  // Rolle kommt manchmal etwas später: Planer (Disponent/Abrechnung) landen dann ebenfalls auf der Startseite
  const [planerStartGesetzt, setPlanerStartGesetzt] = useState(false)
  useEffect(() => {
    if (startTabGesetzt && !planerStartGesetzt && (rolle === 'disponent' || rolle === 'abrechnung')) {
      setPlanerStartGesetzt(true)
      setAktiverTab((t) => (t === 'meinplan' ? 'start' : t))
    }
  }, [startTabGesetzt, planerStartGesetzt, rolle])

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

  // Antraege und Urlaubsdaten aktualisieren sich von selbst
  useLiveAktualisierung(['urlaubsantraege', 'mitarbeiter_jahresdaten', 'mitarbeiter'], neuLaden, !!session)

  // Erkennt, wenn eine neue Version der App veroeffentlicht wurde
  useEffect(() => {
    let startVersion: string | null = null
    async function version(): Promise<string | null> {
      try {
        const antwort = await fetch('/?v=' + Date.now(), { cache: 'no-store' })
        const text = await antwort.text()
        return text.match(/assets\/index-[^"']+\.js/)?.[0] ?? null
      } catch {
        return null
      }
    }
    async function pruefen() {
      const aktuell = await version()
      if (!aktuell) return
      if (startVersion === null) startVersion = aktuell
      else if (aktuell !== startVersion) setNeueVersion(true)
    }
    pruefen()
    const timer = setInterval(pruefen, 5 * 60 * 1000)
    const beiSichtbar = () => {
      if (!document.hidden) pruefen()
    }
    document.addEventListener('visibilitychange', beiSichtbar)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', beiSichtbar)
    }
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

  const darfDisponieren = istAdmin || rolle === 'disponent'
  const darfAbrechnen = istAdmin || rolle === 'abrechnung'
  // Kosten sehen aktuell nur Admins. Spaeter fuer alle Planer: istAdmin durch (darfDisponieren || darfAbrechnen) ersetzen
  // (und in der Datenbank die Funktion darf_kosten() anpassen, siehe kosten.sql).
  const darfKosten = istAdmin
  const sichtbareTabs = ALLE_TABS.filter((tab) =>
    tab.id === 'start' ? istAdmin || darfDisponieren || darfAbrechnen : tab.id === 'meinplan' ? !istAdmin : tab.id === 'auftraege' ? darfDisponieren || darfAbrechnen : tab.id === 'abrechnung' || tab.id === 'rechnungen' || tab.id === 'kennzahlen' ? darfAbrechnen : tab.id === 'wirtschaft' || tab.id === 'trassenpreise' ? darfKosten : tab.id === 'protokoll' ? darfDisponieren || darfAbrechnen : tab.id === 'bahnstrom' ? darfDisponieren || darfAbrechnen : !tab.nurAdmin || istAdmin
  )

  // Hauptpunkte oben, Unterpunkte in einer zweiten Zeile darunter
  const GRUPPEN: { id: string; label: string; tabs: TabId[] }[] = [
    { id: 'start', label: 'Start', tabs: ['start'] },
    {
      id: 'plan',
      label: istAdmin ? 'Dienstplan' : 'Mein Dienstplan',
      tabs: ['meinplan', 'dienstplan', 'kalender', 'antrag', 'antraege', 'uebersicht', 'schichtvorlagen', 'urlaubimport', 'jahreswechsel'],
    },
    { id: 'auftraege', label: 'Aufträge', tabs: ['auftraege', 'protokoll'] },
    { id: 'abrechnung', label: 'Abrechnung', tabs: ['abrechnung', 'rechnungen', 'kennzahlen', 'wirtschaft', 'trassenpreise'] },
    { id: 'bahnstrom', label: 'Bahnstrom', tabs: ['bahnstrom'] },
    { id: 'mitarbeiter', label: 'Mitarbeiter', tabs: ['mitarbeiter', 'benutzer'] },
    { id: 'streckenkunde', label: 'Streckenkunde', tabs: ['streckenkunde'] },
  ]
  const UNTERPUNKT_NAME: Partial<Record<TabId, string>> = { auftraege: 'Aufträge', abrechnung: 'Abrechnung', mitarbeiter: 'Mitarbeiter', meinplan: 'Mein Plan', dienstplan: 'Dienstplan', antraege: istAdmin ? 'Anträge' : 'Meine Anträge' }
  const sichtbareGruppen = GRUPPEN.map((g) => ({ ...g, tabs: g.tabs.filter((t) => sichtbareTabs.some((x) => x.id === t)) })).filter((g) => g.tabs.length > 0)
  const aktiveGruppe = sichtbareGruppen.find((g) => g.tabs.includes(aktiverTab)) ?? sichtbareGruppen[0]

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
          {sichtbareGruppen.map((g) => (
            <button
              key={g.id}
              onClick={() => setAktiverTab(g.tabs[0])}
              style={{
                background: aktiveGruppe?.id === g.id ? 'rgba(255,255,255,0.14)' : 'transparent',
                border: 'none',
                borderRadius: 8,
                color: aktiveGruppe?.id === g.id ? '#ffffff' : '#c9d6ea',
                fontWeight: aktiveGruppe?.id === g.id ? 600 : 500,
                fontSize: 14,
                padding: handy ? '8px 12px' : '8px 14px',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {g.label}
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

      {aktiveGruppe && aktiveGruppe.tabs.length > 1 && (
        <div style={{ background: '#ffffff', borderBottom: '1px solid #d9e0ec', padding: handy ? '6px 10px' : '8px 24px', display: 'flex', gap: 6, overflowX: 'auto' }}>
          {aktiveGruppe.tabs.map((id) => {
            const tab = ALLE_TABS.find((t) => t.id === id)
            const aktiv = aktiverTab === id
            return (
              <button
                key={id}
                onClick={() => setAktiverTab(id)}
                style={{
                  background: aktiv ? '#14325c' : '#eef2f8',
                  color: aktiv ? '#ffffff' : '#14325c',
                  border: 'none',
                  borderRadius: 999,
                  padding: '6px 14px',
                  fontSize: 13,
                  fontWeight: aktiv ? 600 : 500,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {UNTERPUNKT_NAME[id] ?? tab?.label}
              </button>
            )
          })}
        </div>
      )}

      {neueVersion && (
        <div
          style={{
            position: 'fixed',
            left: 12,
            right: 12,
            bottom: 12,
            zIndex: 3000,
            background: '#14325c',
            color: '#ffffff',
            borderRadius: 12,
            padding: '12px 14px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            boxShadow: '0 8px 30px rgba(0,0,0,0.3)',
            maxWidth: 520,
            margin: '0 auto',
          }}
        >
          <span style={{ fontSize: 14 }}>Eine neue Version der App ist verfügbar.</span>
          <button
            onClick={() => window.location.reload()}
            style={{ background: '#ffffff', color: '#14325c', border: 'none', borderRadius: 8, padding: '8px 14px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
          >
            Jetzt aktualisieren
          </button>
        </div>
      )}

      {passwortDialogOffen && (
        <PasswortDialog modus="aendern" onFertig={() => setPasswortDialogOffen(false)} onAbbrechen={() => setPasswortDialogOffen(false)} />
      )}

      <main
        style={{
          maxWidth: aktiverTab === 'dienstplan' || aktiverTab === 'auftraege' || aktiverTab === 'abrechnung' ? 1600 : 1100,
          margin: '0 auto',
          padding: handy ? '12px 10px 24px' : '32px 20px',
        }}
      >
        {aktiverTab === 'start' && (istAdmin || darfDisponieren || darfAbrechnen) && (
          <div
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: handy ? 14 : 24,
            }}
          >
            <Dashboard
              name={mitarbeiter?.name ?? ''}
              istAdmin={istAdmin}
              darfDisponieren={darfDisponieren}
              darfAbrechnen={darfAbrechnen}
              gehe={(t) => setAktiverTab(t as TabId)}
            />
          </div>
        )}

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
            <Kalender neuLadenAuslöser={neuLadenAuslöser} onGeaendert={neuLaden} />
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
              <MeineEigenenAntraege key={neuLadenAuslöser} />
            )}
          </div>
        )}

        {aktiverTab === 'auftraege' && (darfDisponieren || darfAbrechnen) && (
          <div
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: handy ? 14 : 24,
            }}
          >
            <h3 style={{ marginTop: 0 }}>Aufträge</h3>
            <Auftraege darfDisponieren={darfDisponieren} darfAbrechnen={darfAbrechnen} />
          </div>
        )}

        {aktiverTab === 'bahnstrom' && (darfDisponieren || darfAbrechnen) && (
          <div
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: handy ? 14 : 24,
            }}
          >
            <h3 style={{ marginTop: 0 }}>Bahnstrom</h3>
            <Bahnstrom />
          </div>
        )}

        {aktiverTab === 'abrechnung' && darfAbrechnen && (
          <div
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: handy ? 14 : 24,
            }}
          >
            <h3 style={{ marginTop: 0 }}>Abrechnung</h3>
            <Abrechnung istAdmin={istAdmin} />
          </div>
        )}

        {aktiverTab === 'rechnungen' && (darfAbrechnen) && (
          <div
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: handy ? 14 : 24,
            }}
          >
            <h3 style={{ marginTop: 0 }}>Rechnungsentwurf</h3>
            <Rechnungen />
          </div>
        )}

        {aktiverTab === 'kennzahlen' && (darfAbrechnen) && (
          <div
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: handy ? 14 : 24,
            }}
          >
            <h3 style={{ marginTop: 0 }}>Kennzahlen</h3>
            <Kennzahlen />
          </div>
        )}

        {aktiverTab === 'wirtschaft' && darfKosten && (
          <div
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: handy ? 14 : 24,
            }}
          >
            <h3 style={{ marginTop: 0 }}>Wirtschaftlichkeit</h3>
            <Wirtschaftlichkeit />
          </div>
        )}

        {aktiverTab === 'trassenpreise' && darfKosten && (
          <div
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: handy ? 14 : 24,
            }}
          >
            <h3 style={{ marginTop: 0 }}>Trassenpreise</h3>
            <Trassenpreise />
          </div>
        )}

        {aktiverTab === 'urlaubimport' && istAdmin && (
          <div
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: handy ? 14 : 24,
            }}
          >
            <h3 style={{ marginTop: 0 }}>Urlaub aus Excel importieren</h3>
            <UrlaubImport />
          </div>
        )}

        {aktiverTab === 'jahreswechsel' && istAdmin && (
          <div
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: handy ? 14 : 24,
            }}
          >
            <h3 style={{ marginTop: 0 }}>Jahreswechsel: Resturlaub übernehmen</h3>
            <Jahreswechsel />
          </div>
        )}

        {aktiverTab === 'protokoll' && (darfDisponieren || darfAbrechnen) && (
          <div
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: handy ? 14 : 24,
            }}
          >
            <h3 style={{ marginTop: 0 }}>Änderungsprotokoll aller Aufträge</h3>
            <Protokoll />
          </div>
        )}

        {aktiverTab === 'benutzer' && (istAdmin) && (
          <div
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 12,
              padding: handy ? 14 : 24,
            }}
          >
            <h3 style={{ marginTop: 0 }}>Benutzer & Rollen</h3>
            <BenutzerVerwaltung />
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

export default function App() {
  return (
    <UiAnbieter>
      <AppInnen />
    </UiAnbieter>
  )
}
