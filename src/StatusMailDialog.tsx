import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import { abweichung } from './AuftragKarten'

export interface MailAuftrag {
  kunde: string | null
  referenz: string | null
  zug_nr: string | null
  status: string
  abfahrt_ort: string | null
  abfahrt_datum: string
  abfahrt_soll: string | null
  abfahrt_ist: string | null
  ankunft_ort: string | null
  ankunft_datum: string | null
  ankunft_soll: string | null
  ankunft_ist: string | null
  anzahl_wagen: number | null
  lok: string | null
}

const kurz = (z: string | null) => (z ? z.slice(0, 5) : '')
const WOCHENTAGE = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag']

function datumLang(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  return `${WOCHENTAGE[d.getDay()]}, ${iso.split('-').reverse().join('.')}`
}

function abwWort(min: number | null, art: 'ab' | 'an'): string {
  if (min === null) return ''
  if (min === 0) return ' (pünktlich)'
  if (min > 0) return art === 'ab' ? ` (${min} Min. später)` : ` (${min} Min. Verspätung)`
  return art === 'ab' ? ` (${-min} Min. früher)` : ` (${-min} Min. früher)`
}

function statusSatz(a: MailAuftrag): string {
  if (a.status === 'storniert') return 'Der Auftrag wurde storniert.'
  if (a.status === 'gefahren' || a.ankunft_ist) return 'Der Zug ist gefahren.'
  if (a.abfahrt_ist) return 'Der Zug ist abgefahren und unterwegs.'
  if (a.status === 'bestaetigt') return 'Der Zug ist bestätigt und disponiert.'
  return 'Der Zug ist geplant.'
}

export function statusMailBetreff(a: MailAuftrag): string {
  const zug = [a.referenz, a.zug_nr].filter(Boolean).join(' / ')
  return `Status Zug ${zug} am ${a.abfahrt_datum.split('-').reverse().join('.')}`
}

// Nur betriebliche Daten, kein Preis und keine internen Angaben
export function statusMailText(a: MailAuftrag): string {
  const zeilen: string[] = ['Sehr geehrte Damen und Herren,', '', 'hier der aktuelle Status zu Ihrem Zug:', '']
  if (a.referenz) zeilen.push(`Auftrag: ${a.referenz}`)
  if (a.zug_nr) zeilen.push(`Zugnummer: ${a.zug_nr}`)
  zeilen.push(`Datum: ${datumLang(a.abfahrt_datum)}`)
  zeilen.push(`Status: ${statusSatz(a)}`, '')
  zeilen.push(
    `Abfahrt: ${a.abfahrt_ort ?? ''} ${kurz(a.abfahrt_soll)} Uhr` +
      (a.abfahrt_ist ? ` – Ist ${kurz(a.abfahrt_ist)} Uhr${abwWort(abweichung(a.abfahrt_soll, a.abfahrt_ist), 'ab')}` : '')
  )
  zeilen.push(
    `Ankunft: ${a.ankunft_ort ?? ''} ${kurz(a.ankunft_soll)} Uhr` +
      (a.ankunft_ist ? ` – Ist ${kurz(a.ankunft_ist)} Uhr${abwWort(abweichung(a.ankunft_soll, a.ankunft_ist), 'an')}` : '')
  )
  if (a.anzahl_wagen != null || a.lok) zeilen.push('')
  if (a.anzahl_wagen != null) zeilen.push(`Wagen: ${a.anzahl_wagen}`)
  if (a.lok) zeilen.push(`Lok: ${a.lok}`)
  zeilen.push('', 'Bei Rückfragen melden Sie sich gern bei uns.', '', 'Mit freundlichen Grüßen', 'Rail Bavaria Logistik GmbH', 'Disposition')
  return zeilen.join('\n')
}

export default function StatusMailDialog({ auftrag, darfSpeichern, onSchliessen }: { auftrag: MailAuftrag; darfSpeichern: boolean; onSchliessen: () => void }) {
  const [empfaenger, setEmpfaenger] = useState('')
  const [betreff, setBetreff] = useState(statusMailBetreff(auftrag))
  const [text, setText] = useState(statusMailText(auftrag))
  const [merken, setMerken] = useState(true)
  const [meldung, setMeldung] = useState<string | null>(null)

  useEffect(() => {
    if (!auftrag.kunde) return
    supabase
      .from('kunden_emails')
      .select('email')
      .eq('kunde', auftrag.kunde)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.email) setEmpfaenger(data.email)
      })
  }, [auftrag.kunde])

  async function adresseMerken() {
    if (merken && darfSpeichern && auftrag.kunde && empfaenger.trim()) {
      await supabase.from('kunden_emails').upsert({ kunde: auftrag.kunde, email: empfaenger.trim(), updated_at: new Date().toISOString() })
    }
  }

  async function mailOeffnen() {
    if (!empfaenger.trim()) {
      setMeldung('Bitte die E-Mail-Adresse des Kunden eintragen.')
      return
    }
    await adresseMerken()
    const an = empfaenger.split(/[;,]/).map((x) => x.trim()).filter(Boolean).join(',')
    window.location.href = `mailto:${an}?subject=${encodeURIComponent(betreff)}&body=${encodeURIComponent(text)}`
    setMeldung('Dein E-Mail-Programm wurde geöffnet. Dort kannst du die Mail noch prüfen und absenden.')
  }

  async function kopieren() {
    try {
      await navigator.clipboard.writeText(text)
      setMeldung('Der Text wurde kopiert.')
    } catch {
      setMeldung('Kopieren hat nicht geklappt. Bitte den Text von Hand markieren und kopieren.')
    }
  }

  const eingabe: React.CSSProperties = { border: '1px solid var(--border)', borderRadius: 6, padding: '7px 9px', fontSize: 14, width: '100%', boxSizing: 'border-box', fontFamily: 'inherit' }
  const knopf: React.CSSProperties = { background: 'none', border: '1px solid var(--navy)', color: 'var(--navy)', borderRadius: 8, padding: '8px 14px', fontSize: 13, cursor: 'pointer' }

  return (
    <div onClick={onSchliessen} style={{ position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: 16 }}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: '#ffffff', borderRadius: 12, padding: 20, width: 640, maxWidth: '100%', maxHeight: '92vh', overflowY: 'auto', boxShadow: '0 10px 40px rgba(0,0,0,0.3)' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
          <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--navy)' }}>Status-Mail an den Kunden</div>
          <button onClick={onSchliessen} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)', lineHeight: 1 }}>
            ✕
          </button>
        </div>
        <div style={{ fontSize: 12, color: '#64748b', marginBottom: 12 }}>
          Der Text enthält nur betriebliche Daten, keinen Preis. Du kannst alles vor dem Versand ändern.
        </div>
        <label style={{ fontSize: 12, color: '#475569', display: 'block', marginBottom: 8 }}>
          An (mehrere Adressen mit Komma trennen)
          <input value={empfaenger} onChange={(e) => setEmpfaenger(e.target.value)} placeholder="kunde@firma.de" style={eingabe} />
        </label>
        {darfSpeichern && auftrag.kunde && (
          <label style={{ fontSize: 12, color: '#475569', display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8 }}>
            <input type="checkbox" checked={merken} onChange={(e) => setMerken(e.target.checked)} />
            Adresse für „{auftrag.kunde}“ merken
          </label>
        )}
        <label style={{ fontSize: 12, color: '#475569', display: 'block', marginBottom: 8 }}>
          Betreff
          <input value={betreff} onChange={(e) => setBetreff(e.target.value)} style={eingabe} />
        </label>
        <label style={{ fontSize: 12, color: '#475569', display: 'block' }}>
          Text
          <textarea value={text} rows={16} onChange={(e) => setText(e.target.value)} style={{ ...eingabe, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 }} />
        </label>
        <button onClick={() => setText(statusMailText(auftrag))} style={{ ...knopf, padding: '3px 8px', fontSize: 11, marginTop: 4 }}>
          Text neu erzeugen
        </button>
        {meldung && <div style={{ background: '#eff6ff', color: '#1e3a8a', padding: '8px 12px', borderRadius: 8, marginTop: 12, fontSize: 13 }}>{meldung}</div>}
        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          <button onClick={mailOeffnen} style={{ ...knopf, background: 'var(--navy)', color: '#ffffff' }}>
            E-Mail öffnen
          </button>
          <button onClick={kopieren} style={knopf}>
            Text kopieren
          </button>
          <button onClick={onSchliessen} style={knopf}>
            Schließen
          </button>
        </div>
      </div>
    </div>
  )
}
