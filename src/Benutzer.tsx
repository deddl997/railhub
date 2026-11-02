import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'

interface Benutzer {
  id: string
  name: string
  kategorie: string | null
  rolle: string | null
  auth_user_id: string | null
  email: string | null
  letzter_login: string | null
}

interface FreierLogin {
  id: string
  email: string
}

const ROLLEN: { wert: string; text: string; hilfe: string }[] = [
  { wert: 'mitarbeiter', text: 'Mitarbeiter', hilfe: 'Sieht nur den eigenen Dienstplan und eigene Anträge' },
  { wert: 'disponent', text: 'Disponent', hilfe: 'Darf Aufträge anlegen und disponieren' },
  { wert: 'abrechnung', text: 'Abrechnung', hilfe: 'Darf Aufträge abrechnen' },
  { wert: 'admin', text: 'Admin', hilfe: 'Darf alles, auch Rollen vergeben' },
]

export default function BenutzerVerwaltung() {
  const [liste, setListe] = useState<Benutzer[]>([])
  const [freie, setFreie] = useState<FreierLogin[]>([])
  const [laedt, setLaedt] = useState(true)
  const [fehler, setFehler] = useState<string | null>(null)
  const [meldung, setMeldung] = useState<string | null>(null)
  const [suche, setSuche] = useState('')

  async function laden() {
    setFehler(null)
    const [a, b] = await Promise.all([supabase.rpc('admin_benutzerliste'), supabase.rpc('admin_freie_logins')])
    if (a.error) {
      setFehler(
        a.error.message.includes('admin_benutzerliste')
          ? 'Die Datenbank-Funktionen fehlen noch. Bitte benutzer_admin.sql im Supabase SQL Editor ausführen.'
          : a.error.message
      )
      setLaedt(false)
      return
    }
    setListe((a.data ?? []) as Benutzer[])
    setFreie((b.data ?? []) as FreierLogin[])
    setLaedt(false)
  }

  useEffect(() => {
    laden()
  }, [])

  async function rolleAendern(b: Benutzer, neu: string) {
    if (neu === b.rolle) return
    const text = ROLLEN.find((r) => r.wert === neu)?.text ?? neu
    if (!window.confirm(`${b.name} bekommt die Rolle „${text}“. Fortfahren?`)) return
    setMeldung(null)
    const { error } = await supabase.rpc('admin_rolle_setzen', { p_id: b.id, p_rolle: neu })
    if (error) {
      setFehler(error.message)
      return
    }
    setFehler(null)
    setMeldung(`${b.name} ist jetzt „${text}“. Die Person muss sich einmal ab- und wieder anmelden.`)
    await laden()
  }

  async function loginSetzen(b: Benutzer, loginId: string | null) {
    setMeldung(null)
    const { error } = await supabase.rpc('admin_login_verknuepfen', { p_id: b.id, p_login: loginId })
    if (error) {
      setFehler(error.message)
      return
    }
    setFehler(null)
    setMeldung(loginId ? `Login für ${b.name} verknüpft.` : `Login von ${b.name} getrennt.`)
    await laden()
  }

  const gefiltert = liste.filter((b) => {
    const t = suche.trim().toLowerCase()
    return t === '' || b.name.toLowerCase().includes(t) || (b.email ?? '').toLowerCase().includes(t)
  })
  const ohneLogin = liste.filter((b) => !b.auth_user_id).length

  const zelle: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #eef2f8', fontSize: 13, textAlign: 'left', verticalAlign: 'middle' }

  return (
    <div>
      <p style={{ fontSize: 13, color: '#475569', marginTop: 0 }}>
        Hier legst du fest, wer was darf. Ein neuer Login (Supabase → Authentication → Users) muss einer Person aus der Mitarbeiterliste zugeordnet werden,
        sonst sieht die Person nichts.
      </p>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
        <input
          value={suche}
          onChange={(e) => setSuche(e.target.value)}
          placeholder="Name oder E-Mail suchen"
          style={{ padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: 6, fontSize: 13, minWidth: 220 }}
        />
        <span style={{ fontSize: 12, color: '#64748b' }}>
          {liste.length} Personen · {ohneLogin} ohne Login · {freie.length} Logins ohne Person
        </span>
      </div>
      {fehler && <div style={{ background: '#fee2e2', color: '#991b1b', padding: '8px 12px', borderRadius: 8, fontSize: 13, marginBottom: 10 }}>{fehler}</div>}
      {meldung && <div style={{ background: '#dcfce7', color: '#166534', padding: '8px 12px', borderRadius: 8, fontSize: 13, marginBottom: 10 }}>{meldung}</div>}
      {laedt ? (
        <p style={{ color: '#64748b' }}>Lade...</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 720 }}>
            <thead>
              <tr style={{ background: '#f1f5f9' }}>
                <th style={zelle}>Name</th>
                <th style={zelle}>Login (E-Mail)</th>
                <th style={zelle}>Rolle</th>
                <th style={zelle}>Letzte Anmeldung</th>
              </tr>
            </thead>
            <tbody>
              {gefiltert.map((b) => (
                <tr key={b.id}>
                  <td style={zelle}>
                    <div style={{ fontWeight: 600 }}>{b.name}</div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>{b.kategorie ?? 'Ohne Qualifikation'}</div>
                  </td>
                  <td style={zelle}>
                    {b.auth_user_id ? (
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <span>{b.email ?? '(unbekannt)'}</span>
                        <button
                          onClick={() => window.confirm(`Login von ${b.name} wirklich trennen?`) && loginSetzen(b, null)}
                          style={{ background: 'none', border: 'none', color: '#b91c1c', cursor: 'pointer', fontSize: 11 }}
                          title="Login von dieser Person trennen"
                        >
                          trennen
                        </button>
                      </div>
                    ) : (
                      <select
                        value=""
                        onChange={(e) => e.target.value && loginSetzen(b, e.target.value)}
                        style={{ padding: '4px 6px', fontSize: 12, borderRadius: 6, border: '1px solid #f59e0b', background: '#fffbeb' }}
                      >
                        <option value="">Kein Login – verknüpfen…</option>
                        {freie.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.email}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td style={zelle}>
                    <select
                      value={b.rolle ?? 'mitarbeiter'}
                      onChange={(e) => rolleAendern(b, e.target.value)}
                      style={{ padding: '4px 6px', fontSize: 13, borderRadius: 6, border: '1px solid #cbd5e1' }}
                      title={ROLLEN.find((r) => r.wert === (b.rolle ?? 'mitarbeiter'))?.hilfe}
                    >
                      {ROLLEN.map((r) => (
                        <option key={r.wert} value={r.wert}>
                          {r.text}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td style={{ ...zelle, color: '#64748b' }}>
                    {b.letzter_login ? new Date(b.letzter_login).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) : '–'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ marginTop: 14, fontSize: 12, color: '#64748b' }}>
        {ROLLEN.map((r) => (
          <div key={r.wert}>
            <b>{r.text}:</b> {r.hilfe}
          </div>
        ))}
      </div>
    </div>
  )
}
