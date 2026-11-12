import { useCallback, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { supabase } from './lib/supabase'
import { useLiveAktualisierung } from './liveAktualisierung'
import { LeerHinweis, Marke, Skelett, StatusMarke, TabellenRahmen } from './ui'

interface Props {
  name: string
  istAdmin: boolean
  darfDisponieren: boolean
  darfAbrechnen: boolean
  /** Wechselt zu einem Reiter, z. B. gehe('antraege') */
  gehe: (tab: string) => void
}

interface AuftragKurz {
  id: string
  kunde: string | null
  zug_nr: string | null
  status: string
  abfahrt_ort: string | null
  ankunft_ort: string | null
  abfahrt_datum: string
  abfahrt_soll: string | null
}

interface Zahlen {
  urlaub: number | null
  zeitkorrekturen: number | null
  wunschfrei: number | null
  heuteAuftraege: number | null
  morgenAuftraege: number | null
  ohneBesetzung: number | null
  offeneSpots: number | null
  offStandard: number | null
  offSpot: number | null
  ohnePreis: number | null
  bereitAnzahl: number | null
  bereitSumme: number | null
  imUrlaub: string[] | null
  ohneZuordnung: number | null
  ohneEmail: number | null
  ohneZuordnungNamen: string[]
  ohneEmailNamen: string[]
  kontenProbleme: { name: string; jahr: number; grund: string }[]
  liste: (AuftragKurz & { besetzung: 'besetzt' | 'offen' | 'unbesetzt' })[]
}

const euro = (v: number) => v.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function plusTage(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}
function datumKurz(isoDatum: string): string {
  const [j, m, t] = isoDatum.split('-')
  const wt = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][new Date(Number(j), Number(m) - 1, Number(t)).getDay()]
  return `${wt} ${t}.${m}.`
}

function Kachel({
  titel,
  wert,
  unter,
  farbe,
  onClick,
  laedt,
}: {
  titel: string
  wert: ReactNode
  unter?: string
  farbe: 'ok' | 'achtung' | 'neutral'
  onClick?: () => void
  laedt: boolean
}) {
  const rand = farbe === 'achtung' ? '#f59e0b' : farbe === 'ok' ? '#22c55e' : '#94a3b8'
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        textAlign: 'left',
        background: '#fff',
        border: '1px solid var(--border)',
        borderLeft: `5px solid ${rand}`,
        borderRadius: 12,
        padding: '14px 16px',
        cursor: onClick ? 'pointer' : 'default',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        minHeight: 96,
        font: 'inherit',
        color: 'inherit',
      }}
    >
      <span style={{ fontSize: 12, fontWeight: 600, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.03em' }}>{titel}</span>
      {laedt ? <Skelett hoehe={30} breite={70} /> : <span style={{ fontSize: 28, fontWeight: 700, color: '#14325c', lineHeight: 1.15 }}>{wert}</span>}
      {unter && !laedt && <span style={{ fontSize: 12, color: '#64748b' }}>{unter}</span>}
    </button>
  )
}

export default function Dashboard({ name, istAdmin, darfDisponieren, darfAbrechnen, gehe }: Props) {
  const [z, setZ] = useState<Zahlen | null>(null)
  const [laedt, setLaedt] = useState(true)
  const planer = darfDisponieren || darfAbrechnen

  const laden = useCallback(async () => {
    const heute = new Date()
    const heuteIso = iso(heute)
    const morgenIso = iso(plusTage(heute, 1))
    const in7Iso = iso(plusTage(heute, 7))
    const seitIso = iso(plusTage(heute, -120))

    const zahl = async (abfrage: PromiseLike<{ count: number | null; error: unknown }>): Promise<number | null> => {
      const r = await abfrage
      return r.error ? null : r.count ?? 0
    }

    const neu: Zahlen = {
      urlaub: null,
      zeitkorrekturen: null,
      wunschfrei: null,
      heuteAuftraege: null,
      morgenAuftraege: null,
      ohneBesetzung: null,
      offeneSpots: null,
      offStandard: null,
      offSpot: null,
      ohnePreis: null,
      bereitAnzahl: null,
      bereitSumme: null,
      imUrlaub: null,
      ohneZuordnung: null,
      ohneEmail: null,
      ohneZuordnungNamen: [],
      ohneEmailNamen: [],
      kontenProbleme: [],
      liste: [],
    }

    const aufgaben: PromiseLike<unknown>[] = []

    if (istAdmin) {
      aufgaben.push(
        (async () => {
          const r = await supabase.from('urlaubsantraege').select('id, gruppe_id').eq('status', 'offen')
          if (!r.error) neu.urlaub = new Set(((r.data ?? []) as { id: string; gruppe_id: string | null }[]).map((x) => x.gruppe_id ?? x.id)).size
        })(),
        (async () => {
          neu.zeitkorrekturen = await zahl(supabase.from('zeitkorrekturen').select('id', { count: 'exact', head: true }).eq('status', 'offen'))
        })(),
        (async () => {
          neu.wunschfrei = await zahl(supabase.from('wunschfrei').select('id', { count: 'exact', head: true }).eq('status', 'offen').gte('datum', heuteIso))
        })(),
        (async () => {
          const r = await supabase.from('urlaubsantraege').select('name').is('mitarbeiter_id', null)
          if (!r.error) {
            const namen = ((r.data ?? []) as { name: string | null }[]).map((x) => (x.name ?? '').trim() || '(ohne Namen)')
            neu.ohneZuordnung = namen.length
            neu.ohneZuordnungNamen = [...new Set(namen)].sort()
          }
        })(),
        (async () => {
          const r = await supabase.from('mitarbeiter').select('name, email')
          if (!r.error) {
            const fehlt = ((r.data ?? []) as { name: string; email: string | null }[]).filter((x) => !x.email || !x.email.trim())
            neu.ohneEmail = fehlt.length
            neu.ohneEmailNamen = fehlt.map((x) => x.name).sort()
          }
        })(),
        (async () => {
          const jahrJetzt = heute.getFullYear()
          const [jd, an, ma] = await Promise.all([
            supabase.from('mitarbeiter_jahresdaten').select('mitarbeiter_id, jahr, urlaubsanspruch, resturlaub, resturlaub_vorjahr').in('jahr', [jahrJetzt, jahrJetzt + 1]),
            supabase.from('urlaubsantraege').select('mitarbeiter_id, erster_tag, brauchbare_tage, anzahl_tage').eq('status', 'genehmigt').gte('erster_tag', `${jahrJetzt}-01-01`).lte('erster_tag', `${jahrJetzt + 1}-12-31`),
            supabase.from('mitarbeiter').select('id, name'),
          ])
          if (jd.error || an.error || ma.error) return
          const namen = new Map(((ma.data ?? []) as { id: string; name: string }[]).map((m) => [m.id, m.name]))
          const genehmigt = new Map<string, number>()
          for (const a of (an.data ?? []) as { mitarbeiter_id: string | null; erster_tag: string; brauchbare_tage: number | null; anzahl_tage: number | null }[]) {
            if (!a.mitarbeiter_id) continue
            const k = `${a.mitarbeiter_id}|${a.erster_tag.slice(0, 4)}`
            genehmigt.set(k, (genehmigt.get(k) ?? 0) + Number(a.brauchbare_tage ?? a.anzahl_tage ?? 0))
          }
          const probleme: { name: string; jahr: number; grund: string }[] = []
          for (const j of (jd.data ?? []) as { mitarbeiter_id: string; jahr: number; urlaubsanspruch: number | null; resturlaub: number | null; resturlaub_vorjahr: number | null }[]) {
            const name = namen.get(j.mitarbeiter_id)
            if (!name) continue
            const anspruch = Number(j.urlaubsanspruch ?? 0)
            const rest = Number(j.resturlaub ?? 0)
            const vorjahr = Number(j.resturlaub_vorjahr ?? 0)
            const gen = genehmigt.get(`${j.mitarbeiter_id}|${j.jahr}`) ?? 0
            let grund: string | null = null
            if (rest < 0 || vorjahr < 0) grund = 'negativer Wert'
            else if (rest > anspruch + 0.01) grund = 'Resturlaub höher als Anspruch'
            else if (gen === 0 && vorjahr > 0 && Math.abs(rest - anspruch) > 0.01) grund = 'nichts genehmigt, aber Resturlaub ≠ Anspruch'
            if (grund) probleme.push({ name, jahr: j.jahr, grund })
          }
          probleme.sort((a, b) => a.name.localeCompare(b.name, 'de'))
          neu.kontenProbleme = probleme
        })(),
        (async () => {
          const r = await supabase.from('urlaubsantraege').select('mitarbeiter_id, name').eq('status', 'genehmigt').lte('erster_tag', heuteIso).gte('letzter_tag', heuteIso)
          if (!r.error) neu.imUrlaub = [...new Set(((r.data ?? []) as { name: string | null }[]).map((x) => x.name ?? '?'))].sort()
        })()
      )
    }

    if (planer) {
      aufgaben.push(
        (async () => {
          const r = await supabase
            .from('auftraege')
            .select('id, kunde, zug_nr, status, abfahrt_ort, ankunft_ort, abfahrt_datum, abfahrt_soll')
            .gte('abfahrt_datum', heuteIso)
            .lte('abfahrt_datum', in7Iso)
            .neq('status', 'storniert')
            .order('abfahrt_datum')
            .order('abfahrt_soll')
          if (r.error) return
          const auftraege = (r.data ?? []) as AuftragKurz[]
          neu.heuteAuftraege = auftraege.filter((a) => a.abfahrt_datum === heuteIso).length
          neu.morgenAuftraege = auftraege.filter((a) => a.abfahrt_datum === morgenIso).length
          const ids = auftraege.map((a) => a.id)
          const mitPerson = new Set<string>()
          const mitOffen = new Set<string>()
          if (ids.length > 0) {
            const [e, o] = await Promise.all([
              supabase.from('dienstplan_eintraege').select('auftrag_id').eq('ist_spotschicht', true).in('auftrag_id', ids),
              supabase.from('offene_spotschichten').select('auftrag_id').in('auftrag_id', ids),
            ])
            for (const x of (e.data ?? []) as { auftrag_id: string }[]) mitPerson.add(x.auftrag_id)
            for (const x of (o.data ?? []) as { auftrag_id: string }[]) mitOffen.add(x.auftrag_id)
          }
          const mitStatus = auftraege.map((a) => ({
            ...a,
            besetzung: (mitOffen.has(a.id) ? 'offen' : mitPerson.has(a.id) ? 'besetzt' : 'unbesetzt') as 'besetzt' | 'offen' | 'unbesetzt',
          }))
          neu.ohneBesetzung = mitStatus.filter((a) => a.besetzung === 'unbesetzt').length
          neu.liste = mitStatus.filter((a) => a.abfahrt_datum <= morgenIso || a.besetzung !== 'besetzt').slice(0, 12)
        })(),
        (async () => {
          // Alle offenen Schichten der naechsten 7 Tage: Standard-Schichten (Soll minus eingeteilt) + offene Spotschichten
          const bis6 = iso(plusTage(heute, 6))
          const [vor, soll, ein, urlaub, spots] = await Promise.all([
            supabase.from('schichtvorlagen').select('id, benoetigte_wochentage').eq('aktiv', true),
            supabase.from('schicht_soll').select('schichtvorlage_id, wochentag, anzahl'),
            supabase.from('dienstplan_eintraege').select('mitarbeiter_id, datum, schichtvorlage_id').gte('datum', heuteIso).lte('datum', bis6).not('schichtvorlage_id', 'is', null),
            supabase.from('urlaubsantraege').select('mitarbeiter_id, erster_tag, letzter_tag').eq('status', 'genehmigt').lte('erster_tag', bis6).gte('letzter_tag', heuteIso),
            supabase.from('offene_spotschichten').select('id').gte('datum', heuteIso).lte('datum', bis6),
          ])
          if (spots.error) return
          neu.offSpot = (spots.data ?? []).length
          if (vor.error || ein.error) {
            neu.offeneSpots = neu.offSpot
            return
          }
          const urlaubListe = (urlaub.data ?? []) as { mitarbeiter_id: string; erster_tag: string; letzter_tag: string }[]
          const imUrlaub = (m: string, d: string) => urlaubListe.some((u) => u.mitarbeiter_id === m && u.erster_tag <= d && u.letzter_tag >= d)
          const sollListe = (soll.data ?? []) as { schichtvorlage_id: string; wochentag: number; anzahl: number }[]
          const eintraege = (ein.data ?? []) as { mitarbeiter_id: string; datum: string; schichtvorlage_id: string }[]
          let fehlend = 0
          for (let i = 0; i < 7; i++) {
            const tag = plusTage(heute, i)
            const d = iso(tag)
            for (const v of (vor.data ?? []) as { id: string; benoetigte_wochentage: number[] | null }[]) {
              const zeile = sollListe.find((x) => x.schichtvorlage_id === v.id && x.wochentag === tag.getDay())
              const sollAnzahl = zeile ? zeile.anzahl : (v.benoetigte_wochentage ?? [0, 1, 2, 3, 4, 5, 6]).includes(tag.getDay()) ? 1 : 0
              const besetzt = eintraege.filter((e) => e.schichtvorlage_id === v.id && e.datum === d && !imUrlaub(e.mitarbeiter_id, d)).length
              fehlend += Math.max(0, sollAnzahl - besetzt)
            }
          }
          neu.offStandard = fehlend
          neu.offeneSpots = fehlend + neu.offSpot
        })(),
        (async () => {
          neu.ohnePreis = await zahl(
            supabase.from('auftraege').select('id', { count: 'exact', head: true }).eq('status', 'gefahren').is('preis', null).lte('abfahrt_datum', heuteIso).gte('abfahrt_datum', seitIso)
          )
        })()
      )
    }

    if (darfAbrechnen) {
      aufgaben.push(
        (async () => {
          const r = await supabase
            .from('auftraege')
            .select('preis')
            .in('status', ['gefahren', 'storniert'])
            .neq('abrechnung_status', 'abgerechnet')
            .is('rechnungsnr', null)
            .not('preis', 'is', null)
            .limit(2000)
          if (r.error) return
          const zeilen = (r.data ?? []) as { preis: number | null }[]
          neu.bereitAnzahl = zeilen.length
          neu.bereitSumme = zeilen.reduce((s, x) => s + (x.preis ?? 0), 0)
        })()
      )
    }

    await Promise.all(aufgaben)
    setZ(neu)
    setLaedt(false)
  }, [istAdmin, planer, darfAbrechnen])

  useEffect(() => {
    laden()
  }, [laden])

  useLiveAktualisierung(['auftraege', 'dienstplan_eintraege', 'offene_spotschichten', 'urlaubsantraege', 'zeitkorrekturen', 'wunschfrei', 'mitarbeiter', 'mitarbeiter_jahresdaten'], laden)

  const stunde = new Date().getHours()
  const gruss = stunde < 11 ? 'Guten Morgen' : stunde < 18 ? 'Guten Tag' : 'Guten Abend'
  const vorname = name.split(' ')[0]
  const farbeAnzahl = (n: number | null): 'ok' | 'achtung' | 'neutral' => (n === null ? 'neutral' : n > 0 ? 'achtung' : 'ok')

  const kacheln: ReactNode[] = []
  if (istAdmin) {
    kacheln.push(
      <Kachel key="u" titel="Urlaubsanträge offen" wert={z?.urlaub ?? '–'} unter={z?.urlaub ? 'warten auf Entscheidung' : 'alles bearbeitet'} farbe={farbeAnzahl(z?.urlaub ?? null)} onClick={() => gehe('antraege')} laedt={laedt} />,
      <Kachel key="z" titel="Zeitkorrekturen offen" wert={z?.zeitkorrekturen ?? '–'} unter={z?.zeitkorrekturen ? 'im Dienstplan prüfen' : 'alles bearbeitet'} farbe={farbeAnzahl(z?.zeitkorrekturen ?? null)} onClick={() => gehe('dienstplan')} laedt={laedt} />,
      <Kachel key="w" titel="Wunschfrei offen" wert={z?.wunschfrei ?? '–'} unter={z?.wunschfrei ? 'im Dienstplan prüfen' : 'keine Wünsche offen'} farbe={farbeAnzahl(z?.wunschfrei ?? null)} onClick={() => gehe('dienstplan')} laedt={laedt} />,
      <Kachel key="oz" titel="Anträge ohne Mitarbeiter" wert={z?.ohneZuordnung ?? '–'} unter={z?.ohneZuordnung ? 'Name passt zu keinem Mitarbeiter' : 'alle zugeordnet'} farbe={farbeAnzahl(z?.ohneZuordnung ?? null)} onClick={() => gehe('datenpruefung')} laedt={laedt} />,
      <Kachel key="oe" titel="Mitarbeiter ohne E-Mail" wert={z?.ohneEmail ?? '–'} unter={z?.ohneEmail ? 'E-Mail nachtragen' : 'alle hinterlegt'} farbe={farbeAnzahl(z?.ohneEmail ?? null)} onClick={() => gehe('mitarbeiter')} laedt={laedt} />,
      <Kachel key="uk" titel="Urlaubskonten prüfen" wert={z?.kontenProbleme.length ?? '–'} unter={z?.kontenProbleme.length ? 'Zahlen passen nicht zusammen' : 'alles plausibel'} farbe={farbeAnzahl(z?.kontenProbleme.length ?? null)} onClick={() => gehe('datenpruefung')} laedt={laedt} />
    )
  }
  if (planer) {
    kacheln.push(
      <Kachel key="h" titel="Aufträge heute" wert={z?.heuteAuftraege ?? '–'} unter={`morgen: ${z?.morgenAuftraege ?? '–'}`} farbe="neutral" onClick={() => gehe('auftraege')} laedt={laedt} />,
      <Kachel key="b" titel="Ohne Besetzung (7 Tage)" wert={z?.ohneBesetzung ?? '–'} unter={z?.ohneBesetzung ? 'noch kein Lokführer eingeteilt' : 'alle Aufträge haben Personal'} farbe={farbeAnzahl(z?.ohneBesetzung ?? null)} onClick={() => gehe('auftraege')} laedt={laedt} />,
      <Kachel key="o" titel="Offene Schichten (7 Tage)" wert={z?.offeneSpots ?? '–'} unter={z?.offeneSpots ? `${z.offStandard ?? 0} Standard · ${z.offSpot ?? 0} Spot` : 'alle Schichten besetzt'} farbe={farbeAnzahl(z?.offeneSpots ?? null)} onClick={() => gehe(istAdmin ? 'dienstplan' : 'auftraege')} laedt={laedt} />,
      <Kachel key="p" titel="Gefahren ohne Preis" wert={z?.ohnePreis ?? '–'} unter={z?.ohnePreis ? 'Preis fehlt (letzte 120 Tage)' : 'alles bepreist'} farbe={farbeAnzahl(z?.ohnePreis ?? null)} onClick={() => gehe('auftraege')} laedt={laedt} />
    )
  }
  if (darfAbrechnen) {
    kacheln.push(
      <Kachel key="a" titel="Bereit zur Abrechnung" wert={z?.bereitAnzahl ?? '–'} unter={z?.bereitSumme ? `Summe ${euro(z.bereitSumme)}` : 'nichts offen'} farbe={z?.bereitAnzahl ? 'achtung' : 'ok'} onClick={() => gehe('abrechnung')} laedt={laedt} />
    )
  }

  return (
    <div>
      <h2 style={{ margin: '0 0 4px', color: '#14325c' }}>
        {gruss}
        {vorname ? `, ${vorname}` : ''}!
      </h2>
      <div style={{ color: '#64748b', fontSize: 14, marginBottom: 18 }}>
        {new Date().toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })} – das steht heute an:
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 12, marginBottom: 24 }}>{kacheln}</div>

      {planer && (
        <>
          <h3 style={{ margin: '0 0 8px', color: '#14325c' }}>Aufträge heute, morgen und alles ohne volle Besetzung</h3>
          {laedt ? (
            <Skelett hoehe={120} />
          ) : !z || z.liste.length === 0 ? (
            <LeerHinweis symbol="✅">Keine Aufträge, die Aufmerksamkeit brauchen.</LeerHinweis>
          ) : (
            <TabellenRahmen hoehe="50vh">
              <table className="rbl-tabelle">
                <thead>
                  <tr>
                    <th>Datum</th>
                    <th>Zeit</th>
                    <th>Kunde / Zug</th>
                    <th>Strecke</th>
                    <th>Status</th>
                    <th>Besetzung</th>
                  </tr>
                </thead>
                <tbody>
                  {z.liste.map((a) => (
                    <tr key={a.id} onClick={() => gehe('auftraege')} style={{ cursor: 'pointer' }}>
                      <td>{datumKurz(a.abfahrt_datum)}</td>
                      <td>{a.abfahrt_soll?.slice(0, 5) ?? ''}</td>
                      <td>
                        {a.kunde ?? '–'}
                        {a.zug_nr ? ` · ${a.zug_nr}` : ''}
                      </td>
                      <td>
                        {a.abfahrt_ort ?? '?'} → {a.ankunft_ort ?? '?'}
                      </td>
                      <td>
                        <StatusMarke status={a.status} />
                      </td>
                      <td>
                        {a.besetzung === 'besetzt' ? <Marke farbe="gruen">Besetzt</Marke> : a.besetzung === 'offen' ? <Marke farbe="gelb">Schicht offen</Marke> : <Marke farbe="rot">Unbesetzt</Marke>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TabellenRahmen>
          )}
        </>
      )}

      {istAdmin && z && (z.ohneZuordnungNamen.length > 0 || z.ohneEmailNamen.length > 0 || z.kontenProbleme.length > 0) && (
        <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {z.ohneZuordnungNamen.length > 0 && (
            <div>
              <h3 style={{ margin: '0 0 8px', color: '#14325c' }}>Anträge ohne zugeordneten Mitarbeiter</h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {z.ohneZuordnungNamen.map((n) => (
                  <span key={n} onClick={() => gehe('datenpruefung')} style={{ cursor: 'pointer' }}>
                    <Marke farbe="rot">{n}</Marke>
                  </span>
                ))}
              </div>
              <div style={{ color: '#64748b', fontSize: 13, marginTop: 6 }}>Name im Antrag passt zu keinem Mitarbeiter – unter „Datenprüfung“ mit einem Klick zuordnen.</div>
            </div>
          )}
          {z.kontenProbleme.length > 0 && (
            <div>
              <h3 style={{ margin: '0 0 8px', color: '#14325c' }}>Urlaubskonten prüfen</h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {z.kontenProbleme.map((p) => (
                  <span key={`${p.name}${p.jahr}`} onClick={() => gehe('datenpruefung')} style={{ cursor: 'pointer' }} title={p.grund}>
                    <Marke farbe="rot">{p.name} ({p.jahr}): {p.grund}</Marke>
                  </span>
                ))}
              </div>
              <div style={{ color: '#64748b', fontSize: 13, marginTop: 6 }}>Mehr dazu unter „Datenprüfung“.</div>
            </div>
          )}
          {z.ohneEmailNamen.length > 0 && (
            <div>
              <h3 style={{ margin: '0 0 8px', color: '#14325c' }}>Mitarbeiter ohne E-Mail</h3>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {z.ohneEmailNamen.map((n) => (
                  <span key={n} onClick={() => gehe('mitarbeiter')} style={{ cursor: 'pointer' }}>
                    <Marke farbe="gelb">{n}</Marke>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {istAdmin && z?.imUrlaub && (
        <div style={{ marginTop: 24 }}>
          <h3 style={{ margin: '0 0 8px', color: '#14325c' }}>Heute im Urlaub</h3>
          {z.imUrlaub.length === 0 ? (
            <span style={{ color: '#64748b', fontSize: 14 }}>Niemand.</span>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {z.imUrlaub.map((n) => (
                <Marke key={n} farbe="blau">
                  {n}
                </Marke>
              ))}
            </div>
          )}
        </div>
      )}

      {!planer && !istAdmin && <LeerHinweis symbol="👋">Willkommen! Deinen Dienstplan findest du unter „Mein Dienstplan“.</LeerHinweis>}
    </div>
  )
}
