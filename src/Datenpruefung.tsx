import { useCallback, useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from './lib/supabase'
import { namensSignatur } from './namensAbgleich'
import { bestaetigen, useToast } from './ui'
import { useLiveAktualisierung } from './liveAktualisierung'

interface Person {
  id: string
  name: string
  email: string | null
  auth_user_id: string | null
}
interface Jahr {
  id: string
  mitarbeiter_id: string
  jahr: number
  urlaubsanspruch: number | null
  resturlaub: number | null
  resturlaub_vorjahr: number | null
}
interface Antrag {
  id: string
  name: string | null
  mitarbeiter_id: string | null
  erster_tag: string
  status: string
  brauchbare_tage: number | null
  anzahl_tage: number | null
}

// ---------- Namensvergleich ----------
function wortTeile(n: string): string[] {
  return n
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .split(/[\s\-,]+/)
    .filter((w) => w.length > 1)
}
function editDistanz(x: string, y: string): number {
  const d: number[][] = Array.from({ length: x.length + 1 }, (_, i) => [i, ...Array(y.length).fill(0)])
  for (let j = 1; j <= y.length; j++) d[0][j] = j
  for (let i = 1; i <= x.length; i++)
    for (let j = 1; j <= y.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1))
  return d[x.length][y.length]
}
function aehnlichkeit(a: string, b: string): number {
  if (namensSignatur(a) === namensSignatur(b)) return 1
  const wa = wortTeile(a)
  const wb = wortTeile(b)
  if (wa.length === 0 || wb.length === 0) return 0
  let punkte = 0
  for (const x of wa) {
    let best = 0
    for (const y of wb) {
      if (x === y) best = Math.max(best, 1)
      else if (x.length >= 4 && y.length >= 4 && Math.abs(x.length - y.length) <= 2 && editDistanz(x, y) <= 2) best = Math.max(best, 0.7)
    }
    punkte += best
  }
  return punkte / Math.max(wa.length, wb.length)
}

const SCHWELLE = 0.55
const SPEICHER_KEY = 'rbl-datenpruefung-ignoriert'

function ignorierteLesen(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SPEICHER_KEY) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}
function ignorierteSchreiben(s: Set<string>) {
  try {
    localStorage.setItem(SPEICHER_KEY, JSON.stringify([...s]))
  } catch {
    // Speicher nicht verfügbar
  }
}

async function alleLaden<T>(tabelle: string, spalten: string): Promise<T[]> {
  const ergebnis: T[] = []
  for (let von = 0; ; von += 1000) {
    const r = await supabase.from(tabelle).select(spalten).range(von, von + 999)
    if (r.error) throw new Error(`${tabelle}: ${r.error.message}`)
    const teil = (r.data ?? []) as unknown as T[]
    ergebnis.push(...teil)
    if (teil.length < 1000) break
  }
  return ergebnis
}

const knopf = (primaer: boolean, gefahr = false): React.CSSProperties => ({
  border: '1px solid ' + (gefahr ? '#b91c1c' : 'var(--navy)'),
  background: primaer ? (gefahr ? '#b91c1c' : 'var(--navy)') : '#fff',
  color: primaer ? '#fff' : gefahr ? '#b91c1c' : 'var(--navy)',
  borderRadius: 6,
  padding: '5px 10px',
  fontSize: 13,
  cursor: 'pointer',
})

function Abschnitt({ titel, anzahl, children, hinweis }: { titel: string; anzahl: number; children: React.ReactNode; hinweis?: string }) {
  return (
    <section style={{ background: 'var(--card, #fff)', border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginBottom: 16 }}>
      <h3 style={{ margin: '0 0 4px', color: '#14325c', display: 'flex', alignItems: 'center', gap: 8 }}>
        {titel}
        <span style={{ fontSize: 12, fontWeight: 600, padding: '2px 8px', borderRadius: 999, background: anzahl === 0 ? '#dcfce7' : '#fee2e2', color: anzahl === 0 ? '#166534' : '#991b1b' }}>
          {anzahl === 0 ? 'in Ordnung' : anzahl}
        </span>
      </h3>
      {hinweis && <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 10 }}>{hinweis}</div>}
      {anzahl > 0 && <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>{children}</div>}
    </section>
  )
}

const zeileStil: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  alignItems: 'center',
  padding: '8px 10px',
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: '#f8fafc',
}

export default function Datenpruefung() {
  const toast = useToast()
  const [personen, setPersonen] = useState<Person[]>([])
  const [jahre, setJahre] = useState<Jahr[]>([])
  const [antraege, setAntraege] = useState<Antrag[]>([])
  const [laedt, setLaedt] = useState(true)
  const [fehler, setFehler] = useState<string | null>(null)
  const [ignoriert, setIgnoriert] = useState<Set<string>>(() => ignorierteLesen())
  const [arbeitet, setArbeitet] = useState(false)
  const [sicherungLaeuft, setSicherungLaeuft] = useState(false)

  const laden = useCallback(async () => {
    try {
      const [p, j, a] = await Promise.all([
        alleLaden<Person>('mitarbeiter', 'id, name, email, auth_user_id'),
        alleLaden<Jahr>('mitarbeiter_jahresdaten', 'id, mitarbeiter_id, jahr, urlaubsanspruch, resturlaub, resturlaub_vorjahr'),
        alleLaden<Antrag>('urlaubsantraege', 'id, name, mitarbeiter_id, erster_tag, status, brauchbare_tage, anzahl_tage'),
      ])
      setPersonen(p)
      setJahre(j)
      setAntraege(a)
      setFehler(null)
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e))
    }
    setLaedt(false)
  }, [])

  useEffect(() => {
    void laden()
  }, [laden])
  useLiveAktualisierung(['mitarbeiter', 'mitarbeiter_jahresdaten', 'urlaubsantraege'], laden)

  // ---------- 1. Anträge ohne Mitarbeiter ----------
  const lose = useMemo(() => {
    const gruppen = new Map<string, number>()
    for (const a of antraege) {
      if (a.mitarbeiter_id) continue
      const n = (a.name ?? '').trim()
      gruppen.set(n, (gruppen.get(n) ?? 0) + 1)
    }
    return [...gruppen.entries()]
      .map(([name, anzahl]) => ({
        name,
        anzahl,
        vorschlaege: personen
          .map((p) => ({ p, w: name ? aehnlichkeit(name, p.name) : 0 }))
          .filter((x) => x.w >= SCHWELLE)
          .sort((x, y) => y.w - x.w)
          .slice(0, 3),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'de'))
  }, [antraege, personen])

  async function zuordnen(name: string, ziel: Person) {
    if (!name) return
    setArbeitet(true)
    const { error } = await supabase
      .from('urlaubsantraege')
      .update({ mitarbeiter_id: ziel.id, name: ziel.name })
      .is('mitarbeiter_id', null)
      .eq('name', name)
    setArbeitet(false)
    if (error) toast.fehler('Zuordnen fehlgeschlagen: ' + error.message)
    else {
      toast.erfolg(`Anträge von „${name}“ wurden ${ziel.name} zugeordnet.`)
      void laden()
    }
  }

  // ---------- 2. Mögliche Doppelte ----------
  const doppelte = useMemo(() => {
    const paare: { a: Person; b: Person; w: number; key: string }[] = []
    for (let i = 0; i < personen.length; i++) {
      for (let j = i + 1; j < personen.length; j++) {
        const w = aehnlichkeit(personen[i].name, personen[j].name)
        if (w < SCHWELLE) continue
        const key = [personen[i].id, personen[j].id].sort().join('|')
        if (ignoriert.has(key)) continue
        paare.push({ a: personen[i], b: personen[j], w, key })
      }
    }
    return paare.sort((x, y) => y.w - x.w)
  }, [personen, ignoriert])

  const anzahlAntraege = (id: string) => antraege.filter((a) => a.mitarbeiter_id === id).length
  const anzahlJahre = (id: string) => jahre.filter((j) => j.mitarbeiter_id === id).length

  async function zusammenfuehren(behalten: Person, loeschen: Person) {
    const ok = await bestaetigen(
      `„${loeschen.name}“ wird in „${behalten.name}“ zusammengeführt.\n\nAlle Anträge, Dienstplan-Einträge und Jahresdaten von „${loeschen.name}“ gehen auf „${behalten.name}“ über, danach wird „${loeschen.name}“ gelöscht. Das kann nicht rückgängig gemacht werden.`,
      { titel: 'Mitarbeiter zusammenführen', jaText: 'Ja, zusammenführen', gefahr: true }
    )
    if (!ok) return
    setArbeitet(true)
    const { data, error } = await supabase.rpc('mitarbeiter_zusammenfuehren', { p_behalten: behalten.id, p_loeschen: loeschen.id })
    setArbeitet(false)
    if (error) {
      toast.fehler('Zusammenführen fehlgeschlagen: ' + error.message)
      return
    }
    const teile = Object.entries((data ?? {}) as Record<string, number>).map(([k, v]) => `${k}: ${v}`)
    toast.erfolg(`Zusammengeführt. ${teile.length ? teile.join(', ') : ''}`)
    void laden()
  }

  function keinDoppelter(key: string) {
    const neu = new Set(ignoriert).add(key)
    setIgnoriert(neu)
    ignorierteSchreiben(neu)
  }

  // ---------- 3. Urlaubskonten ----------
  const konten = useMemo(() => {
    const jetzt = new Date().getFullYear()
    const genehmigt = new Map<string, number>()
    for (const a of antraege) {
      if (!a.mitarbeiter_id || a.status !== 'genehmigt') continue
      const k = `${a.mitarbeiter_id}|${a.erster_tag.slice(0, 4)}`
      genehmigt.set(k, (genehmigt.get(k) ?? 0) + Number(a.brauchbare_tage ?? a.anzahl_tage ?? 0))
    }
    const namen = new Map(personen.map((p) => [p.id, p.name]))
    const liste: { j: Jahr; name: string; grund: string; reparierbar: boolean }[] = []
    for (const j of jahre) {
      if (j.jahr < jetzt || j.jahr > jetzt + 1) continue
      const name = namen.get(j.mitarbeiter_id)
      if (!name) continue
      const anspruch = Number(j.urlaubsanspruch ?? 0)
      const rest = Number(j.resturlaub ?? 0)
      const vorjahr = Number(j.resturlaub_vorjahr ?? 0)
      const gen = genehmigt.get(`${j.mitarbeiter_id}|${j.jahr}`) ?? 0
      if (rest < 0 || vorjahr < 0) liste.push({ j, name, grund: 'negativer Wert', reparierbar: false })
      else if (rest > anspruch + 0.01) liste.push({ j, name, grund: 'Resturlaub höher als Anspruch', reparierbar: false })
      else if (gen === 0 && vorjahr > 0 && Math.abs(rest - anspruch) > 0.01)
        liste.push({ j, name, grund: 'nichts genehmigt, aber Resturlaub ≠ Anspruch', reparierbar: true })
    }
    return liste.sort((a, b) => a.name.localeCompare(b.name, 'de') || a.j.jahr - b.j.jahr)
  }, [jahre, antraege, personen])

  async function restAufAnspruch(k: { j: Jahr; name: string }) {
    const anspruch = Number(k.j.urlaubsanspruch ?? 0)
    const ok = await bestaetigen(
      `Bei ${k.name} (${k.j.jahr}) wird der Resturlaub von ${k.j.resturlaub ?? 0} auf ${anspruch} Tage gesetzt (= Anspruch, da nichts genehmigt ist). Rest Vorjahr (${k.j.resturlaub_vorjahr ?? 0}) bleibt unverändert.`,
      { titel: 'Resturlaub korrigieren', jaText: 'Ja, korrigieren' }
    )
    if (!ok) return
    setArbeitet(true)
    const { error } = await supabase.from('mitarbeiter_jahresdaten').update({ resturlaub: anspruch }).eq('id', k.j.id)
    setArbeitet(false)
    if (error) toast.fehler('Korrigieren fehlgeschlagen: ' + error.message)
    else {
      toast.erfolg('Resturlaub korrigiert.')
      void laden()
    }
  }

  // ---------- 4. Ohne E-Mail ----------
  const ohneEmail = useMemo(() => personen.filter((p) => !p.email || !p.email.trim()).sort((a, b) => a.name.localeCompare(b.name, 'de')), [personen])

  // ---------- Sicherung ----------
  async function sicherung() {
    setSicherungLaeuft(true)
    try {
      const tabellen = [
        'mitarbeiter',
        'mitarbeiter_jahresdaten',
        'urlaubsantraege',
        'wunschfrei',
        'zeitkorrekturen',
        'schichtvorlagen',
        'dienstplan_eintraege',
        'auftraege',
      ]
      const mappe = XLSX.utils.book_new()
      const fehlend: string[] = []
      for (const t of tabellen) {
        try {
          const zeilen = await alleLaden<Record<string, unknown>>(t, '*')
          const blatt = XLSX.utils.json_to_sheet(
            zeilen.map((z) =>
              Object.fromEntries(Object.entries(z).map(([k, v]) => [k, v !== null && typeof v === 'object' ? JSON.stringify(v) : v]))
            )
          )
          XLSX.utils.book_append_sheet(mappe, blatt, t.slice(0, 31))
        } catch {
          fehlend.push(t)
        }
      }
      const d = new Date()
      const stempel = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      XLSX.writeFile(mappe, `RBL_Sicherung_${stempel}.xlsx`)
      toast.erfolg(fehlend.length ? `Sicherung erstellt (nicht lesbar: ${fehlend.join(', ')}).` : 'Sicherung als Excel-Datei heruntergeladen.')
    } catch (e) {
      toast.fehler('Sicherung fehlgeschlagen: ' + (e instanceof Error ? e.message : String(e)))
    }
    setSicherungLaeuft(false)
  }

  const alleOk = lose.length === 0 && doppelte.length === 0 && konten.length === 0 && ohneEmail.length === 0

  if (laedt) return <p style={{ color: 'var(--text-muted)' }}>Prüfung läuft…</p>
  if (fehler) return <p style={{ color: 'var(--danger)' }}>Fehler: {fehler}</p>

  return (
    <div style={{ opacity: arbeitet ? 0.6 : 1, pointerEvents: arbeitet ? 'none' : 'auto' }}>
      {alleOk && (
        <div style={{ background: '#dcfce7', color: '#166534', border: '1px solid #86efac', borderRadius: 10, padding: '12px 16px', marginBottom: 16, fontWeight: 600 }}>
          ✓ Alles in Ordnung – keine Auffälligkeiten gefunden.
        </div>
      )}

      <Abschnitt
        titel="Anträge ohne Mitarbeiter"
        anzahl={lose.length}
        hinweis="Der Name im Antrag passt zu keinem Mitarbeiter, die Tage werden deshalb nirgends mitgezählt."
      >
        {lose.map((l) => (
          <div key={l.name || '(leer)'} style={zeileStil}>
            <b>{l.name || '(ohne Namen)'}</b>
            <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{l.anzahl} Antrag/Anträge</span>
            {l.vorschlaege.length > 0 ? (
              <>
                <span style={{ fontSize: 13 }}>Zuordnen zu:</span>
                {l.vorschlaege.map(({ p }) => (
                  <button key={p.id} style={knopf(true)} onClick={() => zuordnen(l.name, p)}>
                    {p.name}
                  </button>
                ))}
              </>
            ) : (
              <span style={{ fontSize: 13, color: '#92400e' }}>Kein ähnlicher Mitarbeiter gefunden – bitte in der Mitarbeiterübersicht anlegen.</span>
            )}
          </div>
        ))}
      </Abschnitt>

      <Abschnitt
        titel="Mögliche Doppelte"
        anzahl={doppelte.length}
        hinweis="Zwei Einträge, die dieselbe Person sein könnten. Du entscheidest, welcher bleibt. Alle Daten gehen dorthin."
      >
        {doppelte.map((d) => (
          <div key={d.key} style={zeileStil}>
            <span>
              <b>{d.a.name}</b> <small style={{ color: 'var(--text-muted)' }}>({anzahlAntraege(d.a.id)} Anträge, {anzahlJahre(d.a.id)} Jahre{d.a.auth_user_id ? ', mit Login' : ''})</small>
            </span>
            <span style={{ color: 'var(--text-muted)' }}>↔</span>
            <span>
              <b>{d.b.name}</b> <small style={{ color: 'var(--text-muted)' }}>({anzahlAntraege(d.b.id)} Anträge, {anzahlJahre(d.b.id)} Jahre{d.b.auth_user_id ? ', mit Login' : ''})</small>
            </span>
            <span style={{ flex: 1 }} />
            <button style={knopf(true)} onClick={() => zusammenfuehren(d.a, d.b)} title={`„${d.b.name}“ in „${d.a.name}“ zusammenführen`}>
              „{d.a.name}“ behalten
            </button>
            <button style={knopf(true)} onClick={() => zusammenfuehren(d.b, d.a)} title={`„${d.a.name}“ in „${d.b.name}“ zusammenführen`}>
              „{d.b.name}“ behalten
            </button>
            <button style={knopf(false)} onClick={() => keinDoppelter(d.key)}>
              Verschiedene Personen
            </button>
          </div>
        ))}
      </Abschnitt>

      <Abschnitt
        titel="Urlaubskonten prüfen"
        anzahl={konten.length}
        hinweis="Dieses und nächstes Jahr: Werte, die nicht zusammenpassen (negativ, höher als der Anspruch, nichts genehmigt aber weniger als der Anspruch)."
      >
        {konten.map((k) => (
          <div key={k.j.id} style={zeileStil}>
            <b>{k.name}</b>
            <span style={{ fontSize: 13 }}>
              {k.j.jahr}: Anspruch {k.j.urlaubsanspruch ?? 0} · Resturlaub {k.j.resturlaub ?? 0} · Rest Vorjahr {k.j.resturlaub_vorjahr ?? 0}
            </span>
            <span style={{ fontSize: 13, color: '#991b1b' }}>{k.grund}</span>
            <span style={{ flex: 1 }} />
            {k.reparierbar ? (
              <button style={knopf(true)} onClick={() => restAufAnspruch(k)}>
                Resturlaub = Anspruch setzen
              </button>
            ) : (
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>in der Mitarbeiterübersicht korrigieren</span>
            )}
          </div>
        ))}
      </Abschnitt>

      <Abschnitt titel="Mitarbeiter ohne E-Mail" anzahl={ohneEmail.length} hinweis="E-Mail in der Mitarbeiterübersicht nachtragen (wird für die Anmeldung per Namenssuche und für Benachrichtigungen gebraucht).">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {ohneEmail.map((p) => (
            <span key={p.id} style={{ padding: '3px 10px', borderRadius: 999, background: '#fef9c3', color: '#854d0e', fontSize: 13 }}>
              {p.name}
            </span>
          ))}
        </div>
      </Abschnitt>

      <section style={{ background: 'var(--card, #fff)', border: '1px solid var(--border)', borderRadius: 10, padding: 16 }}>
        <h3 style={{ margin: '0 0 4px', color: '#14325c' }}>Datensicherung</h3>
        <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 10 }}>
          Lädt die wichtigsten Tabellen (Mitarbeiter, Jahresdaten, Anträge, Wunschfrei, Zeitkorrekturen, Schichtvorlagen, Dienstplan, Aufträge) als eine Excel-Datei herunter. Empfehlung: einmal im Monat und vor größeren Änderungen wie dem Jahreswechsel.
        </div>
        <button style={knopf(true)} onClick={sicherung} disabled={sicherungLaeuft}>
          {sicherungLaeuft ? 'Sicherung läuft…' : '⬇ Sicherung als Excel herunterladen'}
        </button>
      </section>
    </div>
  )
}
