import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

/* ============================================================
   RBL Design-Baukasten
   - Toast-Meldungen (kurze Einblendung unten rechts)
   - Bestätigungsdialog:   if (!(await bestaetigen('Wirklich löschen?'))) return
   - Knopf, Marke (Status-Badge), Leer-Hinweis, Ladebalken
   - globale Tabellen- und Knopfstile (Klasse "rbl-tabelle")
   ============================================================ */

const GLOBALES_CSS = `
.rbl-knopf{display:inline-flex;align-items:center;justify-content:center;gap:6px;border-radius:8px;font-size:14px;font-weight:600;padding:8px 14px;cursor:pointer;border:1px solid transparent;line-height:1.2;transition:background .12s,box-shadow .12s,opacity .12s;white-space:nowrap}
.rbl-knopf:disabled{opacity:.5;cursor:not-allowed}
.rbl-knopf:focus-visible{outline:2px solid #3b82f6;outline-offset:2px}
.rbl-knopf.klein{padding:5px 10px;font-size:13px}
.rbl-knopf.primaer{background:#14325c;color:#fff}
.rbl-knopf.primaer:hover:not(:disabled){background:#1d4580}
.rbl-knopf.sekundaer{background:#fff;color:#14325c;border-color:#c5d0e3}
.rbl-knopf.sekundaer:hover:not(:disabled){background:#eef2f8}
.rbl-knopf.gefahr{background:#b91c1c;color:#fff}
.rbl-knopf.gefahr:hover:not(:disabled){background:#991b1b}
.rbl-knopf.leise{background:transparent;color:#14325c}
.rbl-knopf.leise:hover:not(:disabled){background:#eef2f8}

.rbl-marke{display:inline-flex;align-items:center;gap:4px;border-radius:999px;padding:2px 10px;font-size:12px;font-weight:600;white-space:nowrap;line-height:1.5}
.rbl-marke.grau{background:#e8ecf3;color:#475569}
.rbl-marke.blau{background:#dbeafe;color:#1e40af}
.rbl-marke.gruen{background:#dcfce7;color:#166534}
.rbl-marke.gelb{background:#fef3c7;color:#92400e}
.rbl-marke.rot{background:#fee2e2;color:#991b1b}

.rbl-tabelle-rahmen{overflow:auto;max-height:70vh;border:1px solid #d9e0ec;border-radius:10px;background:#fff}
table.rbl-tabelle{border-collapse:separate;border-spacing:0;width:100%;font-size:14px}
table.rbl-tabelle th{position:sticky;top:0;z-index:2;background:#f1f4f9;color:#14325c;text-align:left;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.03em;padding:9px 12px;border-bottom:1px solid #d9e0ec;white-space:nowrap}
table.rbl-tabelle td{padding:9px 12px;border-bottom:1px solid #eef1f6;vertical-align:middle}
table.rbl-tabelle tbody tr:nth-child(even) td{background:#fafbfd}
table.rbl-tabelle tbody tr:hover td{background:#eef4ff}
table.rbl-tabelle td.zahl,table.rbl-tabelle th.zahl{text-align:right;font-variant-numeric:tabular-nums}

.rbl-leer{text-align:center;color:#64748b;padding:32px 16px;font-size:14px}
.rbl-leer .symbol{font-size:30px;margin-bottom:6px}

@keyframes rbl-puls{0%{opacity:.55}50%{opacity:1}100%{opacity:.55}}
.rbl-skelett{background:#e2e8f0;border-radius:8px;animation:rbl-puls 1.2s ease-in-out infinite}

@keyframes rbl-rein{from{transform:translateY(8px);opacity:0}to{transform:none;opacity:1}}
.rbl-toast{animation:rbl-rein .18s ease-out}
`

/* ---------- Knopf ---------- */
type KnopfArt = 'primaer' | 'sekundaer' | 'gefahr' | 'leise'
export function Knopf({
  art = 'primaer',
  klein = false,
  className = '',
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { art?: KnopfArt; klein?: boolean }) {
  return <button type={type} className={`rbl-knopf ${art}${klein ? ' klein' : ''} ${className}`} {...rest} />
}

/* ---------- Marke / Status-Badge ---------- */
export type MarkenFarbe = 'grau' | 'blau' | 'gruen' | 'gelb' | 'rot'
export function Marke({ farbe = 'grau', children, titel }: { farbe?: MarkenFarbe; children: ReactNode; titel?: string }) {
  return (
    <span className={`rbl-marke ${farbe}`} title={titel}>
      {children}
    </span>
  )
}

const STATUS_FARBEN: Record<string, { farbe: MarkenFarbe; text: string }> = {
  geplant: { farbe: 'grau', text: 'Geplant' },
  bestaetigt: { farbe: 'blau', text: 'Bestätigt' },
  gefahren: { farbe: 'gruen', text: 'Gefahren' },
  storniert: { farbe: 'rot', text: 'Storniert' },
  offen: { farbe: 'gelb', text: 'Offen' },
  geprueft: { farbe: 'blau', text: 'Geprüft' },
  abgerechnet: { farbe: 'gruen', text: 'Abgerechnet' },
  genehmigt: { farbe: 'gruen', text: 'Genehmigt' },
  abgelehnt: { farbe: 'rot', text: 'Abgelehnt' },
}
/** Fertige Marke für bekannte Statuswerte (geplant, gefahren, offen, genehmigt ...) */
export function StatusMarke({ status }: { status: string }) {
  const s = STATUS_FARBEN[status]
  return <Marke farbe={s?.farbe ?? 'grau'}>{s?.text ?? status}</Marke>
}

/* ---------- Tabelle mit Rahmen (scrollt, Kopfzeile bleibt oben) ---------- */
export function TabellenRahmen({ children, hoehe }: { children: ReactNode; hoehe?: string }) {
  return (
    <div className="rbl-tabelle-rahmen" style={hoehe ? { maxHeight: hoehe } : undefined}>
      {children}
    </div>
  )
}

/* ---------- Leer-Hinweis und Ladeanzeige ---------- */
export function LeerHinweis({ symbol = '📭', children }: { symbol?: string; children: ReactNode }) {
  return (
    <div className="rbl-leer">
      <div className="symbol">{symbol}</div>
      {children}
    </div>
  )
}

export function Skelett({ hoehe = 20, breite = '100%' }: { hoehe?: number; breite?: number | string }) {
  return <div className="rbl-skelett" style={{ height: hoehe, width: breite }} />
}

/* ---------- Toasts ---------- */
type ToastArt = 'erfolg' | 'fehler' | 'info'
interface ToastEintrag {
  id: number
  art: ToastArt
  text: string
}
interface ToastFunktionen {
  erfolg: (text: string) => void
  fehler: (text: string) => void
  info: (text: string) => void
}
const ToastKontext = createContext<ToastFunktionen>({
  erfolg: () => {},
  fehler: () => {},
  info: () => {},
})
export const useToast = () => useContext(ToastKontext)

/* ---------- Bestätigungsdialog (ersetzt window.confirm) ---------- */
interface Anfrage {
  text: string
  titel: string
  jaText: string
  gefahr: boolean
  aufloesen: (ok: boolean) => void
}
let dialogHost: ((a: Anfrage) => void) | null = null

export function bestaetigen(text: string, optionen: { titel?: string; jaText?: string; gefahr?: boolean } = {}): Promise<boolean> {
  return new Promise((aufloesen) => {
    if (!dialogHost) {
      aufloesen(window.confirm(text))
      return
    }
    dialogHost({
      text,
      titel: optionen.titel ?? 'Bitte bestätigen',
      jaText: optionen.jaText ?? 'Ja, fortfahren',
      gefahr: optionen.gefahr ?? /lösch|trenn|entfern|storn/i.test(text),
      aufloesen,
    })
  })
}

const TOAST_FARBEN: Record<ToastArt, { bg: string; rand: string; symbol: string }> = {
  erfolg: { bg: '#166534', rand: '#22c55e', symbol: '✓' },
  fehler: { bg: '#991b1b', rand: '#f87171', symbol: '!' },
  info: { bg: '#14325c', rand: '#60a5fa', symbol: 'i' },
}

export function UiAnbieter({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEintrag[]>([])
  const [anfrage, setAnfrage] = useState<Anfrage | null>(null)
  const zaehler = useRef(0)

  const zeigen = useCallback((art: ToastArt, text: string) => {
    const id = ++zaehler.current
    setToasts((t) => [...t.slice(-3), { id, art, text }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), art === 'fehler' ? 8000 : 4500)
  }, [])

  const funktionen = useRef<ToastFunktionen>({
    erfolg: (t) => zeigen('erfolg', t),
    fehler: (t) => zeigen('fehler', t),
    info: (t) => zeigen('info', t),
  }).current

  useEffect(() => {
    dialogHost = (a) => setAnfrage(a)
    return () => {
      dialogHost = null
    }
  }, [])

  function antwort(ok: boolean) {
    anfrage?.aufloesen(ok)
    setAnfrage(null)
  }

  useEffect(() => {
    if (!anfrage) return
    const taste = (e: KeyboardEvent) => {
      if (e.key === 'Escape') antwort(false)
    }
    window.addEventListener('keydown', taste)
    return () => window.removeEventListener('keydown', taste)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anfrage])

  return (
    <ToastKontext.Provider value={funktionen}>
      <style>{GLOBALES_CSS}</style>
      {children}

      <div style={{ position: 'fixed', right: 16, bottom: 16, zIndex: 5000, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 'min(380px, calc(100vw - 32px))' }}>
        {toasts.map((t) => {
          const f = TOAST_FARBEN[t.art]
          return (
            <div
              key={t.id}
              className="rbl-toast"
              role={t.art === 'fehler' ? 'alert' : 'status'}
              onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}
              style={{ background: f.bg, color: '#fff', borderLeft: `5px solid ${f.rand}`, borderRadius: 10, padding: '10px 14px', fontSize: 14, boxShadow: '0 8px 24px rgba(0,0,0,0.25)', cursor: 'pointer', display: 'flex', gap: 10, alignItems: 'flex-start' }}
            >
              <span style={{ fontWeight: 700, width: 18, textAlign: 'center' }}>{f.symbol}</span>
              <span style={{ flex: 1 }}>{t.text}</span>
            </div>
          )
        })}
      </div>

      {anfrage && (
        <div
          onClick={() => antwort(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', zIndex: 6000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
        >
          <div
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 14, padding: 22, width: 'min(440px, 100%)', boxShadow: '0 20px 60px rgba(0,0,0,0.35)' }}
          >
            <div style={{ fontSize: 17, fontWeight: 700, color: '#14325c', marginBottom: 8 }}>{anfrage.titel}</div>
            <div style={{ fontSize: 14, color: '#334155', whiteSpace: 'pre-line', lineHeight: 1.5 }}>{anfrage.text}</div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20, flexWrap: 'wrap' }}>
              <Knopf art="sekundaer" onClick={() => antwort(false)}>
                Abbrechen
              </Knopf>
              <Knopf art={anfrage.gefahr ? 'gefahr' : 'primaer'} onClick={() => antwort(true)} autoFocus>
                {anfrage.jaText}
              </Knopf>
            </div>
          </div>
        </div>
      )}
    </ToastKontext.Provider>
  )
}
