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
import PersonalProtokoll from './PersonalProtokoll'
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
import { FIRMA } from './firma'
import './design.css'
import {
  SymbolAbmelden,
  SymbolAntrag,
  SymbolAuftrag,
  SymbolBlitz,
  SymbolDiagramm,
  SymbolEuro,
  SymbolKalender,
  SymbolKarte,
  SymbolListe,
  SymbolPersonen,
  SymbolPfeilRunter,
  SymbolSchild,
  SymbolSchluessel,
  SymbolStart,
} from './symbole'
import type { ReactNode } from 'react'

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
  { id: 'personalprotokoll', label: 'Personal-Protokoll', kurz: 'Protokoll', nurAdmin: true },
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
    return <Ladebildschirm />
  }

  if (session && passwortZuruecksetzen) {
    return <PasswortDialog modus="zuruecksetzen" onFertig={() => setPasswortZuruecksetzen(false)} />
  }

  if (!session) {
    return <Anmeldung />
  }

  if (ladeRolle) {
    return <Ladebildschirm />
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
    { id: 'mitarbeiter', label: 'Mitarbeiter', tabs: ['mitarbeiter', 'benutzer', 'personalprotokoll'] },
    { id: 'streckenkunde', label: 'Streckenkunde', tabs: ['streckenkunde'] },
  ]
  const UNTERPUNKT_NAME: Partial<Record<TabId, string>> = { auftraege: 'Aufträge', abrechnung: 'Abrechnung', mitarbeiter: 'Mitarbeiter', benutzer: 'Profile & Rollen', meinplan: 'Mein Plan', dienstplan: 'Dienstplan', antraege: istAdmin ? 'Anträge' : 'Meine Anträge' }
  const sichtbareGruppen = GRUPPEN.map((g) => ({ ...g, tabs: g.tabs.filter((t) => sichtbareTabs.some((x) => x.id === t)) })).filter((g) => g.tabs.length > 0)
  const aktiveGruppe = sichtbareGruppen.find((g) => g.tabs.includes(aktiverTab)) ?? sichtbareGruppen[0]

  // Mitarbeiter (ohne Planer-Rechte) sehen am Handy ihre Punkte direkt in der unteren Leiste
  const nurMitarbeiter = !istAdmin && !darfDisponieren && !darfAbrechnen
  const MITARBEITER_TABS: TabId[] = ['meinplan', 'antrag', 'antraege', 'uebersicht', 'streckenkunde']
  const untenLeiste: { id: TabId; label: string }[] = nurMitarbeiter
    ? MITARBEITER_TABS.filter((id) => sichtbareTabs.some((x) => x.id === id)).map((id) => ({ id, label: ALLE_TABS.find((t) => t.id === id)?.kurz ?? id }))
    : sichtbareGruppen.map((g) => ({ id: g.tabs[0], label: g.label === 'Mein Dienstplan' ? 'Dienstplan' : g.label }))
  const rollenName = istAdmin ? 'Admin' : rolle === 'disponent' ? 'Disposition' : rolle === 'abrechnung' ? 'Abrechnung' : 'Mitarbeiter'
  const initialen = (mitarbeiter?.name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => t[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  function seite(titel: string, inhalt: ReactNode, optionen: { breite?: number; untertitel?: string; ohneKarte?: boolean; ohneTitel?: boolean } = {}) {
    return (
      <div className="rbl-seite" style={{ maxWidth: optionen.breite, margin: optionen.breite ? '0 auto' : undefined }}>
        {!optionen.ohneTitel && (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, margin: handy ? '2px 4px 10px' : '0 2px 14px', flexWrap: 'wrap' }}>
            <h1 style={{ margin: 0, fontSize: handy ? 20 : 24, fontWeight: 700, color: 'var(--anthrazit)' }}>{titel}</h1>
            {optionen.untertitel && <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{optionen.untertitel}</span>}
          </div>
        )}
        {optionen.ohneKarte ? (
          inhalt
        ) : (
          <div
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              boxShadow: 'var(--schatten)',
              padding: handy ? 14 : 24,
            }}
          >
            {inhalt}
          </div>
        )}
      </div>
    )
  }

  function geheZu(tab: TabId) {
    setMenueOffen(false)
    setAktiverTab(tab)
  }

  const benutzerMenue = (
    <div style={{ position: 'relative', marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
      {istAdmin && !handy && (
        <button
          onClick={() => geheZu('benutzer')}
          className="rbl-kopf-knopf"
          title="Profile und Rollen (Admin, Disposition, Abrechnung, Mitarbeiter) verwalten"
          style={{
            background: aktiverTab === 'benutzer' ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.1)',
            border: '1px solid rgba(255,255,255,0.28)',
            color: '#ffffff',
            borderRadius: 10,
            padding: '7px 12px',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          <SymbolSchild groesse={17} /> Profile &amp; Rollen
        </button>
      )}
      <button
        onClick={() => setMenueOffen(!menueOffen)}
        aria-label="Benutzermenü"
        className="rbl-kopf-knopf"
        style={{
          background: menueOffen ? 'rgba(255,255,255,0.14)' : 'transparent',
          border: 'none',
          color: '#ffffff',
          borderRadius: 10,
          padding: handy ? 4 : '5px 8px 5px 5px',
          cursor: 'pointer',
          gap: 10,
        }}
      >
        <span
          style={{
            width: handy ? 32 : 34,
            height: handy ? 32 : 34,
            borderRadius: '50%',
            background: '#ffffff',
            color: 'var(--navy)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
            fontSize: 13,
          }}
        >
          {initialen || '?'}
        </span>
        {!handy && (
          <span style={{ textAlign: 'left', lineHeight: 1.2 }}>
            <span style={{ display: 'block', fontSize: 13, fontWeight: 600 }}>{mitarbeiter?.name ?? ''}</span>
            <span style={{ display: 'block', fontSize: 11, color: '#bcd6e6' }}>{rollenName}</span>
          </span>
        )}
        {!handy && <SymbolPfeilRunter groesse={16} />}
      </button>
      {menueOffen && (
        <>
          <div onClick={() => setMenueOffen(false)} style={{ position: 'fixed', inset: 0, zIndex: 600 }} />
          <div
            className="rbl-seite"
            style={{
              position: 'absolute',
              top: 'calc(100% + 8px)',
              right: 0,
              zIndex: 700,
              background: '#ffffff',
              borderRadius: 12,
              boxShadow: '0 12px 40px rgba(15,23,42,0.22)',
              padding: 6,
              minWidth: 240,
              display: 'flex',
              flexDirection: 'column',
              color: 'var(--text)',
            }}
          >
            <div style={{ padding: '10px 12px 8px', borderBottom: '1px solid var(--border)', marginBottom: 4 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{mitarbeiter?.name ?? ''}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {rollenName} · {FIRMA.name}
              </div>
            </div>
            {istAdmin && (
              <>
                <button onClick={() => geheZu('benutzer')} className="rbl-menue-eintrag" style={menueKnopfStil}>
                  <SymbolSchild groesse={18} /> Profile &amp; Rollen verwalten
                </button>
                <button onClick={() => geheZu('mitarbeiter')} className="rbl-menue-eintrag" style={menueKnopfStil}>
                  <SymbolPersonen groesse={18} /> Mitarbeiter bearbeiten
                </button>
                <div style={{ height: 1, background: 'var(--border)', margin: '4px 6px' }} />
              </>
            )}
            <button
              onClick={() => {
                setMenueOffen(false)
                setPasswortDialogOffen(true)
              }}
              className="rbl-menue-eintrag"
              style={menueKnopfStil}
            >
              <SymbolSchluessel groesse={18} /> Passwort ändern
            </button>
            <button onClick={abmelden} className="rbl-menue-eintrag" style={{ ...menueKnopfStil, color: '#b91c1c' }}>
              <SymbolAbmelden groesse={18} /> Abmelden
            </button>
          </div>
        </>
      )}
    </div>
  )

  const navigation = (
    <nav
          style={
            nurMitarbeiter
              ? {
                  // Mitarbeiter: Reiter oben unter der Kopfzeile (wird auf dem iPhone unten nicht abgeschnitten)
                  position: 'sticky',
                  top: 52,
                  zIndex: 450,
                  background: '#ffffff',
                  borderBottom: '1px solid var(--border)',
                  boxShadow: '0 2px 8px rgba(15,23,42,0.06)',
                  display: 'flex',
                }
              : {
                  position: 'fixed',
                  left: 0,
                  right: 0,
                  bottom: 0,
                  zIndex: 800,
                  background: '#ffffff',
                  borderTop: '1px solid var(--border)',
                  boxShadow: '0 -4px 16px rgba(15,23,42,0.06)',
                  display: 'flex',
                  paddingBottom: 'max(env(safe-area-inset-bottom), 14px)',
                }
          }
        >
          {untenLeiste.map((eintrag) => {
            const gruppe = sichtbareGruppen.find((g) => g.tabs.includes(eintrag.id))
            const aktiv = nurMitarbeiter ? aktiverTab === eintrag.id : aktiveGruppe?.id === gruppe?.id
            return (
              <button
                key={eintrag.id}
                onClick={() => setAktiverTab(eintrag.id)}
                style={{
                  flex: 1,
                  minWidth: 0,
                  background: 'transparent',
                  border: 'none',
                  padding: '8px 2px 7px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 3,
                  color: aktiv ? 'var(--navy)' : '#8a99ab',
                  fontSize: 11,
                  fontWeight: aktiv ? 700 : 500,
                  cursor: 'pointer',
                  position: 'relative',
                }}
              >
                {aktiv && (
                  <span
                    style={{
                      position: 'absolute',
                      ...(nurMitarbeiter ? { bottom: 0, borderRadius: '3px 3px 0 0' } : { top: 0, borderRadius: '0 0 3px 3px' }),
                      left: '25%',
                      right: '25%',
                      height: 3,
                      background: 'var(--navy)',
                    }}
                  />
                )}
                {nurMitarbeiter ? tabSymbol(eintrag.id, 20) : gruppenSymbol(gruppe?.id ?? '', 22)}
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>{eintrag.label}</span>
              </button>
            )
          })}
    </nav>
  )

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh', paddingBottom: handy && !nurMitarbeiter ? 'calc(80px + env(safe-area-inset-bottom))' : 0 }}>
      <header
        style={{
          background: 'linear-gradient(100deg, #0d2747 0%, #14325c 45%, #1d4a82 100%)',
          color: '#ffffff',
          display: 'flex',
          alignItems: 'center',
          gap: handy ? 10 : 28,
          padding: handy ? '8px 12px' : '0 24px',
          minHeight: handy ? 52 : 64,
          position: 'sticky',
          top: 0,
          zIndex: 500,
          boxShadow: '0 2px 10px rgba(13,39,71,0.25)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <div
            style={{
              height: handy ? 36 : 44,
              minWidth: handy ? 36 : 44,
              borderRadius: 10,
              background: '#ffffff',
              color: 'var(--navy)',
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              padding: '2px 6px',
              boxSizing: 'border-box',
              boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
            }}
          >
            {logoFehler ? (
              FIRMA.kurz
            ) : (
              <img src="/rbl-logo.png" alt={FIRMA.name} onError={() => setLogoFehler(true)} style={{ height: handy ? 28 : 36, width: 'auto', display: 'block' }} />
            )}
          </div>
          <div style={{ lineHeight: 1.15, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: handy ? 15 : 16, letterSpacing: -0.2 }}>{FIRMA.appName}</div>
            {!handy && <div style={{ fontWeight: 400, fontSize: 11, color: '#bcd0e6', whiteSpace: 'nowrap' }}>{FIRMA.name}</div>}
          </div>
        </div>

        {!handy && (
          <nav style={{ display: 'flex', gap: 2, alignSelf: 'stretch', alignItems: 'stretch', overflowX: 'auto' }}>
            {sichtbareGruppen.map((g) => {
              const aktiv = aktiveGruppe?.id === g.id
              return (
                <div key={g.id} style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <button
                    onClick={() => setAktiverTab(g.tabs[0])}
                    className={`rbl-nav-knopf${aktiv ? ' aktiv' : ''}`}
                    style={{
                      background: aktiv ? 'rgba(255,255,255,0.12)' : 'transparent',
                      border: 'none',
                      borderRadius: 8,
                      color: aktiv ? '#ffffff' : '#cfdcee',
                      fontWeight: aktiv ? 600 : 500,
                      fontSize: 14,
                      padding: '9px 13px',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {gruppenSymbol(g.id, 18)}
                    {g.label}
                  </button>
                  {aktiv && <span style={{ position: 'absolute', left: 13, right: 13, bottom: 0, height: 3, borderRadius: '3px 3px 0 0', background: '#ffffff' }} />}
                </div>
              )
            })}
          </nav>
        )}

        {benutzerMenue}
      </header>

      {handy && nurMitarbeiter && untenLeiste.length > 1 && navigation}

      {aktiveGruppe && aktiveGruppe.tabs.length > 1 && !(handy && nurMitarbeiter) && (
        <div
          style={{
            background: '#ffffff',
            borderBottom: '1px solid var(--border)',
            padding: handy ? '8px 10px' : '10px 24px',
            display: 'flex',
            gap: 6,
            overflowX: 'auto',
            position: 'sticky',
            top: handy ? 52 : 64,
            zIndex: 400,
          }}
        >
          {aktiveGruppe.tabs.map((id) => {
            const tab = ALLE_TABS.find((t) => t.id === id)
            const aktiv = aktiverTab === id
            return (
              <button
                key={id}
                onClick={() => setAktiverTab(id)}
                style={{
                  background: aktiv ? 'var(--navy)' : 'var(--navy-zart)',
                  color: aktiv ? '#ffffff' : 'var(--navy)',
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
            bottom: handy && !nurMitarbeiter ? 'calc(90px + env(safe-area-inset-bottom))' : 'calc(12px + env(safe-area-inset-bottom))',
            zIndex: 3000,
            background: 'var(--anthrazit)',
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
            style={{ background: '#ffffff', color: 'var(--navy)', border: 'none', borderRadius: 8, padding: '8px 14px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
          >
            Jetzt aktualisieren
          </button>
        </div>
      )}

      {passwortDialogOffen && (
        <PasswortDialog modus="aendern" onFertig={() => setPasswortDialogOffen(false)} onAbbrechen={() => setPasswortDialogOffen(false)} />
      )}

      <main
        key={aktiverTab}
        style={{
          maxWidth: aktiverTab === 'dienstplan' || aktiverTab === 'auftraege' || aktiverTab === 'abrechnung' || aktiverTab === 'mitarbeiter' ? 1600 : 1140,
          margin: '0 auto',
          padding: handy ? '14px 10px 24px' : '28px 24px 48px',
        }}
      >
        {aktiverTab === 'start' &&
          (istAdmin || darfDisponieren || darfAbrechnen) &&
          seite(
            'Start',
            <Dashboard name={mitarbeiter?.name ?? ''} istAdmin={istAdmin} darfDisponieren={darfDisponieren} darfAbrechnen={darfAbrechnen} gehe={(t) => setAktiverTab(t as TabId)} />,
            { ohneTitel: true }
          )}

        {aktiverTab === 'meinplan' && !istAdmin && mitarbeiter && seite('Mein Dienstplan', <MeinDienstplan mitarbeiterId={mitarbeiter.id} />, { breite: 760 })}

        {aktiverTab === 'antrag' && seite('Urlaubsantrag', <UrlaubAntragUpload onGespeichert={neuLaden} />, { breite: 680, ohneTitel: true })}

        {aktiverTab === 'kalender' && istAdmin && seite('Personalplanung', <Kalender neuLadenAuslöser={neuLadenAuslöser} onGeaendert={neuLaden} />)}

        {aktiverTab === 'antraege' &&
          seite(
            istAdmin ? 'Eingereichte Anträge' : 'Meine Anträge',
            istAdmin ? <MeineAntraege neuLadenAuslöser={neuLadenAuslöser} onGeaendert={neuLaden} /> : <MeineEigenenAntraege key={neuLadenAuslöser} />,
            { ohneKarte: true, breite: istAdmin ? undefined : 760 }
          )}

        {aktiverTab === 'auftraege' && (darfDisponieren || darfAbrechnen) && seite('Aufträge', <Auftraege darfDisponieren={darfDisponieren} darfAbrechnen={darfAbrechnen} />)}

        {aktiverTab === 'bahnstrom' && (darfDisponieren || darfAbrechnen) && seite('Bahnstrom', <Bahnstrom />)}

        {aktiverTab === 'abrechnung' && darfAbrechnen && seite('Abrechnung', <Abrechnung istAdmin={istAdmin} />)}

        {aktiverTab === 'rechnungen' && darfAbrechnen && seite('Rechnungsentwurf', <Rechnungen />)}

        {aktiverTab === 'kennzahlen' && darfAbrechnen && seite('Kennzahlen', <Kennzahlen />)}

        {aktiverTab === 'wirtschaft' && darfKosten && seite('Wirtschaftlichkeit', <Wirtschaftlichkeit />)}

        {aktiverTab === 'trassenpreise' && darfKosten && seite('Trassenpreise', <Trassenpreise />)}

        {aktiverTab === 'urlaubimport' && istAdmin && seite('Urlaub aus Excel importieren', <UrlaubImport />)}

        {aktiverTab === 'jahreswechsel' && istAdmin && seite('Jahreswechsel: Resturlaub übernehmen', <Jahreswechsel />)}

        {aktiverTab === 'protokoll' && (darfDisponieren || darfAbrechnen) && seite('Änderungsprotokoll', <Protokoll />, { untertitel: 'alle Aufträge' })}

        {aktiverTab === 'personalprotokoll' && istAdmin && seite('Personal-Protokoll', <PersonalProtokoll />, { untertitel: 'wer hat wann was geändert – Urlaub, Namen, Dienstplan, Wunschfrei' })}

        {aktiverTab === 'benutzer' && istAdmin && seite('Profile & Rollen', <BenutzerVerwaltung />, { untertitel: 'wer ist Admin, Disposition, Abrechnung oder Mitarbeiter' })}

        {aktiverTab === 'uebersicht' &&
          (istAdmin || mitarbeiter) &&
          seite(istAdmin ? 'Auswertung' : 'Meine Übersicht', <Uebersichten eigeneId={istAdmin ? null : mitarbeiter?.id ?? null} />, {
            untertitel: istAdmin ? 'Monat und Urlaub' : undefined,
          })}

        {aktiverTab === 'mitarbeiter' && istAdmin && seite('Mitarbeiterübersicht', <MitarbeiterVerwaltung neuLadenAuslöser={neuLadenAuslöser} />, { ohneKarte: true })}

        {aktiverTab === 'streckenkunde' && seite(`Streckenkunde${istAdmin ? '-Überwachung' : ''}`, <Streckenkunde />)}

        {aktiverTab === 'dienstplan' && istAdmin && seite('Dienstplan', <Dienstplan />)}

        {aktiverTab === 'schichtvorlagen' && istAdmin && seite('Schichtvorlagen', <SchichtvorlagenVerwaltung />)}
      </main>

      {handy && !nurMitarbeiter && untenLeiste.length > 1 && navigation}
    </div>
  )
}

function gruppenSymbol(id: string, groesse: number) {
  if (id === 'start') return <SymbolStart groesse={groesse} />
  if (id === 'plan') return <SymbolKalender groesse={groesse} />
  if (id === 'auftraege') return <SymbolAuftrag groesse={groesse} />
  if (id === 'abrechnung') return <SymbolEuro groesse={groesse} />
  if (id === 'bahnstrom') return <SymbolBlitz groesse={groesse} />
  if (id === 'mitarbeiter') return <SymbolPersonen groesse={groesse} />
  if (id === 'streckenkunde') return <SymbolKarte groesse={groesse} />
  return <SymbolListe groesse={groesse} />
}

function tabSymbol(id: string, groesse: number) {
  if (id === 'meinplan') return <SymbolKalender groesse={groesse} />
  if (id === 'antrag') return <SymbolAntrag groesse={groesse} />
  if (id === 'antraege') return <SymbolListe groesse={groesse} />
  if (id === 'uebersicht') return <SymbolDiagramm groesse={groesse} />
  if (id === 'streckenkunde') return <SymbolKarte groesse={groesse} />
  return <SymbolListe groesse={groesse} />
}

// Ladebildschirm beim Start der App
function Ladebildschirm() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 18,
        background: 'linear-gradient(160deg, #ffffff 0%, #eef4f8 100%)',
      }}
    >
      <img src="/rbl-logo.png" alt={FIRMA.name} style={{ height: 70, width: 'auto', objectFit: 'contain' }} />
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontWeight: 700, fontSize: 18, color: 'var(--anthrazit)' }}>{FIRMA.name}</div>
        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>{FIRMA.appName}</div>
      </div>
      <div className="rbl-ladekreis" />
    </div>
  )
}

const menueKnopfStil: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  background: 'none',
  border: 'none',
  textAlign: 'left',
  padding: '10px 12px',
  fontSize: 14,
  color: 'var(--text)',
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
