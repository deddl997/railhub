import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'

interface Schichtvorlage {
  id: string
  name: string
  beginn_zeit: string
  ende_zeit: string
  pause_minuten: number | null
  pause_von: string | null
  pause_bis: string | null
  dienstort: string | null
  farbe: string
  aktiv: boolean
  benoetigte_wochentage: number[]
}

// JS-Wochentag-Zahlen (0=Sonntag ... 6=Samstag) in Mo-So Anzeigereihenfolge
export const WOCHENTAGE_JS_REIHENFOLGE = [1, 2, 3, 4, 5, 6, 0]
export const WOCHENTAGE_LABEL = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']

const LEERE_VORLAGE = {
  name: '',
  beginn_zeit: '06:00',
  ende_zeit: '18:00',
  pause_minuten: 45,
  pause_von: '12:00',
  pause_bis: '12:45',
  dienstort: '',
  farbe: '#94a3b8',
  benoetigte_wochentage: [0, 1, 2, 3, 4, 5, 6],
}

export default function SchichtvorlagenVerwaltung() {
  const [vorlagen, setVorlagen] = useState<Schichtvorlage[]>([])
  const [ladeVorgang, setLadeVorgang] = useState(true)
  const [neueVorlage, setNeueVorlage] = useState(LEERE_VORLAGE)
  const [formularOffen, setFormularOffen] = useState(false)

  async function laden() {
    setLadeVorgang(true)
    const { data } = await supabase.from('schichtvorlagen').select('*').order('name')
    setVorlagen(data ?? [])
    setLadeVorgang(false)
  }

  useEffect(() => {
    laden()
  }, [])

  async function vorlageSpeichern() {
    if (!neueVorlage.name.trim()) return
    await supabase.from('schichtvorlagen').insert(neueVorlage)
    setNeueVorlage(LEERE_VORLAGE)
    setFormularOffen(false)
    await laden()
  }

  async function vorlageAktualisieren(vorlage: Schichtvorlage, aenderungen: Partial<Schichtvorlage>) {
    setVorlagen((vorher) =>
      vorher.map((v) => (v.id === vorlage.id ? { ...v, ...aenderungen } : v))
    )
    await supabase.from('schichtvorlagen').update(aenderungen).eq('id', vorlage.id)
  }

  async function vorlageLoeschen(vorlage: Schichtvorlage) {
    const bestaetigt = window.confirm(
      `Schichtvorlage "${vorlage.name}" wirklich löschen? Bereits im Dienstplan verwendete Einträge bleiben bestehen, verlieren aber den Bezug zur Vorlage.`
    )
    if (!bestaetigt) return
    await supabase.from('schichtvorlagen').delete().eq('id', vorlage.id)
    await laden()
  }

  if (ladeVorgang) {
    return <p style={{ color: 'var(--text-muted)' }}>Lade Schichtvorlagen...</p>
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>
          Feste, wiederverwendbare Dienstarten für den Dienstplan (z.B. "Nacht Dienstort NRHF").
        </p>
        <button onClick={() => setFormularOffen(!formularOffen)} style={primaerKnopfStil}>
          {formularOffen ? 'Abbrechen' : '+ Neue Schichtvorlage'}
        </button>
      </div>

      {formularOffen && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: 10,
            padding: 14,
            background: '#f8fafc',
            border: '1px solid var(--border)',
            borderRadius: 8,
            marginBottom: 16,
          }}
        >
          <label style={beschriftungStil}>
            Name
            <input
              value={neueVorlage.name}
              onChange={(e) => setNeueVorlage({ ...neueVorlage, name: e.target.value })}
              style={eingabeStil}
              placeholder="z.B. Nacht Dienstort NRHF"
            />
          </label>
          <label style={beschriftungStil}>
            Beginn
            <input
              type="time"
              value={neueVorlage.beginn_zeit}
              onChange={(e) => setNeueVorlage({ ...neueVorlage, beginn_zeit: e.target.value })}
              style={eingabeStil}
            />
          </label>
          <label style={beschriftungStil}>
            Ende
            <input
              type="time"
              value={neueVorlage.ende_zeit}
              onChange={(e) => setNeueVorlage({ ...neueVorlage, ende_zeit: e.target.value })}
              style={eingabeStil}
            />
          </label>
          <label style={beschriftungStil}>
            Pause (Min.)
            <input
              type="number"
              value={neueVorlage.pause_minuten}
              onChange={(e) => setNeueVorlage({ ...neueVorlage, pause_minuten: Number(e.target.value) })}
              style={eingabeStil}
            />
          </label>
          <label style={beschriftungStil}>
            Pause von
            <input
              type="time"
              value={neueVorlage.pause_von}
              onChange={(e) => setNeueVorlage({ ...neueVorlage, pause_von: e.target.value })}
              style={eingabeStil}
            />
          </label>
          <label style={beschriftungStil}>
            Pause bis
            <input
              type="time"
              value={neueVorlage.pause_bis}
              onChange={(e) => setNeueVorlage({ ...neueVorlage, pause_bis: e.target.value })}
              style={eingabeStil}
            />
          </label>
          <label style={beschriftungStil}>
            Dienstort
            <input
              value={neueVorlage.dienstort}
              onChange={(e) => setNeueVorlage({ ...neueVorlage, dienstort: e.target.value })}
              style={eingabeStil}
              placeholder="z.B. NRHF"
            />
          </label>
          <label style={beschriftungStil}>
            Farbe
            <input
              type="color"
              value={neueVorlage.farbe}
              onChange={(e) => setNeueVorlage({ ...neueVorlage, farbe: e.target.value })}
              style={{ ...eingabeStil, padding: 2, height: 36 }}
            />
          </label>
          <label style={{ ...beschriftungStil, gridColumn: '1 / -1' }}>
            Benötigt an
            <WochentagCheckboxen
              ausgewaehlt={neueVorlage.benoetigte_wochentage}
              onAendern={(tage) => setNeueVorlage({ ...neueVorlage, benoetigte_wochentage: tage })}
            />
          </label>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button onClick={vorlageSpeichern} style={primaerKnopfStil}>
              Speichern
            </button>
          </div>
        </div>
      )}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={kopfZelleStil}>Farbe</th>
              <th style={kopfZelleStil}>Name</th>
              <th style={kopfZelleStil}>Beginn</th>
              <th style={kopfZelleStil}>Ende</th>
              <th style={kopfZelleStil}>Pause</th>
              <th style={kopfZelleStil}>Dienstort</th>
              <th style={kopfZelleStil}>Benötigt an</th>
              <th style={kopfZelleStil}>Aktiv</th>
              <th style={kopfZelleStil}></th>
            </tr>
          </thead>
          <tbody>
            {vorlagen.map((vorlage) => (
              <tr key={vorlage.id}>
                <td style={zellStil}>
                  <input
                    type="color"
                    value={vorlage.farbe}
                    onChange={(e) => vorlageAktualisieren(vorlage, { farbe: e.target.value })}
                    style={{ width: 32, height: 24, padding: 0, border: 'none' }}
                  />
                </td>
                <td style={zellStil}>
                  <input
                    value={vorlage.name}
                    onChange={(e) => vorlageAktualisieren(vorlage, { name: e.target.value })}
                    style={eingabeStil}
                  />
                </td>
                <td style={zellStil}>
                  <input
                    type="time"
                    value={vorlage.beginn_zeit?.slice(0, 5)}
                    onChange={(e) => vorlageAktualisieren(vorlage, { beginn_zeit: e.target.value })}
                    style={eingabeStil}
                  />
                </td>
                <td style={zellStil}>
                  <input
                    type="time"
                    value={vorlage.ende_zeit?.slice(0, 5)}
                    onChange={(e) => vorlageAktualisieren(vorlage, { ende_zeit: e.target.value })}
                    style={eingabeStil}
                  />
                </td>
                <td style={zellStil}>
                  <input
                    type="number"
                    value={vorlage.pause_minuten ?? 0}
                    onChange={(e) => vorlageAktualisieren(vorlage, { pause_minuten: Number(e.target.value) })}
                    style={{ ...eingabeStil, width: 70 }}
                  />
                </td>
                <td style={zellStil}>
                  <input
                    value={vorlage.dienstort ?? ''}
                    onChange={(e) => vorlageAktualisieren(vorlage, { dienstort: e.target.value })}
                    style={{ ...eingabeStil, width: 90 }}
                  />
                </td>
                <td style={zellStil}>
                  <WochentagCheckboxen
                    ausgewaehlt={vorlage.benoetigte_wochentage ?? [0, 1, 2, 3, 4, 5, 6]}
                    onAendern={(tage) => vorlageAktualisieren(vorlage, { benoetigte_wochentage: tage })}
                    kompakt
                  />
                </td>
                <td style={zellStil}>
                  <input
                    type="checkbox"
                    checked={vorlage.aktiv}
                    onChange={(e) => vorlageAktualisieren(vorlage, { aktiv: e.target.checked })}
                  />
                </td>
                <td style={zellStil}>
                  <button onClick={() => vorlageLoeschen(vorlage)} style={loeschenKnopfStil}>
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function WochentagCheckboxen({
  ausgewaehlt,
  onAendern,
  kompakt,
}: {
  ausgewaehlt: number[]
  onAendern: (tage: number[]) => void
  kompakt?: boolean
}) {
  function umschalten(tag: number) {
    const neu = ausgewaehlt.includes(tag) ? ausgewaehlt.filter((t) => t !== tag) : [...ausgewaehlt, tag]
    onAendern(neu)
  }

  return (
    <div style={{ display: 'flex', gap: kompakt ? 3 : 6 }}>
      {WOCHENTAGE_JS_REIHENFOLGE.map((tag, i) => {
        const aktiv = ausgewaehlt.includes(tag)
        return (
          <button
            key={tag}
            type="button"
            onClick={() => umschalten(tag)}
            title={WOCHENTAGE_LABEL[i]}
            style={{
              width: kompakt ? 22 : 30,
              height: kompakt ? 22 : 30,
              borderRadius: 5,
              border: '1px solid ' + (aktiv ? 'var(--navy)' : 'var(--border)'),
              background: aktiv ? 'var(--navy)' : '#ffffff',
              color: aktiv ? '#ffffff' : 'var(--text-muted)',
              fontSize: kompakt ? 9 : 11,
              fontWeight: 600,
              cursor: 'pointer',
              padding: 0,
            }}
          >
            {WOCHENTAGE_LABEL[i]}
          </button>
        )
      })}
    </div>
  )
}

const kopfZelleStil: React.CSSProperties = {
  textAlign: 'left',
  padding: '6px 10px',
  borderBottom: '1px solid var(--border)',
  color: 'var(--text-muted)',
  fontWeight: 500,
}

const zellStil: React.CSSProperties = {
  padding: '4px 8px',
  borderBottom: '1px solid var(--border)',
}

const eingabeStil: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  border: '1px solid var(--border)',
  borderRadius: 4,
  fontSize: 13,
  boxSizing: 'border-box',
}

const beschriftungStil: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 500,
  color: 'var(--text-muted)',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
}

const primaerKnopfStil: React.CSSProperties = {
  background: 'var(--navy)',
  color: '#ffffff',
  border: 'none',
  borderRadius: 6,
  padding: '8px 14px',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
}

const loeschenKnopfStil: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--danger)',
  cursor: 'pointer',
  fontSize: 14,
}
