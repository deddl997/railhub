import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import { feiertageBayern } from './feiertage'
import { datumZuISO } from './datumUtils'
import { namensSignatur } from './namensAbgleich'
import { KATEGORIEN, LOK_TYPEN } from './qualifikationen'
import { berechneBrauchbareTage } from './urlaubsberechnung'
import { Knopf, StatusMarke, bestaetigen, useToast } from './ui'

interface KalenderEintrag {
  id: string
  name: string | null
  erster_tag: string
  letzter_tag: string
  status: string
  gruppe_id: string | null
  brauchbare_tage: number | null
}

interface GruppenZeile {
  id: string
  erster_tag: string | null
  brauchbare_tage: number | null
  abzug_vorjahr: number | null
  abzug_aktuell: number | null
  dokument_url: string | null
}

interface Mitarbeiter {
  id: string
  name: string
  kategorie: string | null
  lok_typen: string[] | null
}

const MONATSNAMEN = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
]

const WOCHENTAGE_KURZ = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']

function tagImBereich(tag: Date, start: string, ende: string) {
  const t = datumZuISO(tag)
  return t >= start && t <= ende
}

function farbeFuerStatus(status: string) {
  if (status === 'genehmigt') return 'var(--success)'
  return 'var(--warning)'
}

function normalisiereName(name: string) {
  return namensSignatur(name)
}

function istWochenende(tag: Date) {
  const wochentag = tag.getDay()
  return wochentag === 0 || wochentag === 6
}

function istHeute(tag: Date) {
  const heute = new Date()
  return (
    tag.getFullYear() === heute.getFullYear() &&
    tag.getMonth() === heute.getMonth() &&
    tag.getDate() === heute.getDate()
  )
}

function auslastungsFarbe(anteil: number) {
  if (anteil === 0) return null
  if (anteil < 0.34) return '#dcfce7'
  if (anteil < 0.67) return '#fef3c7'
  if (anteil < 1) return '#fed7aa'
  return '#fecaca'
}

function tagPlus(isoDatum: string, n: number): string {
  const [j, m, t] = isoDatum.split('-').map(Number)
  return datumZuISO(new Date(j, m - 1, t + n))
}

function datumDeutsch(isoDatum: string): string {
  const [j, m, t] = isoDatum.split('-')
  return `${t}.${m}.${j}`
}

async function holeOderErstelleJahresdaten(name: string, jahr: number) {
  const { data: alle } = await supabase.from('mitarbeiter').select('id, name')
  const signatur = namensSignatur(name)
  const treffer = (alle ?? []).find((m) => namensSignatur(m.name) === signatur)
  if (!treffer) return null
  const { data: vorhanden } = await supabase
    .from('mitarbeiter_jahresdaten')
    .select('id, resturlaub, resturlaub_vorjahr')
    .eq('mitarbeiter_id', treffer.id)
    .eq('jahr', jahr)
    .maybeSingle()
  if (vorhanden) return vorhanden
  const { data: neu } = await supabase
    .from('mitarbeiter_jahresdaten')
    .insert({ mitarbeiter_id: treffer.id, jahr, urlaubsanspruch: 30, resturlaub: 30, resturlaub_vorjahr: 0 })
    .select('id, resturlaub, resturlaub_vorjahr')
    .single()
  return neu
}

async function gruppenZeilenLaden(e: KalenderEintrag): Promise<GruppenZeile[]> {
  const basis = supabase.from('urlaubsantraege').select('id, erster_tag, brauchbare_tage, abzug_vorjahr, abzug_aktuell, dokument_url')
  const { data, error } = e.gruppe_id ? await basis.eq('gruppe_id', e.gruppe_id) : await basis.eq('id', e.id)
  if (error) throw new Error(error.message)
  return (data ?? []) as GruppenZeile[]
}

/**
 * Bucht Urlaubstage auf dem Resturlaub um (nur bei genehmigten Urlauben).
 * tageZurueck > 0: Tage gehen an die Person zurueck (zuerst auf Rest Vorjahr, soweit von dort abgezogen), < 0: es werden Tage zusaetzlich abgezogen.
 * Danach wird die Abzugs-Buchung auf die uebrig bleibenden Zeilen des Antrags verteilt.
 */
async function umbuchen(e: KalenderEintrag, gz: GruppenZeile[], tageZurueck: number, uebrigeIds: string[]) {
  if (e.status !== 'genehmigt') return
  let gv = gz.reduce((s, z) => s + (z.abzug_vorjahr ?? 0), 0)
  let ga = gz.reduce((s, z) => s + (z.abzug_aktuell ?? 0), 0)
  if (e.name && tageZurueck !== 0) {
    const fruehester = gz.map((z) => z.erster_tag ?? '').filter(Boolean).sort()[0] ?? e.erster_tag
    const jd = await holeOderErstelleJahresdaten(e.name, Number(fruehester.slice(0, 4)))
    if (jd) {
      if (tageZurueck > 0) {
        const rv = Math.min(tageZurueck, gv)
        const ra = tageZurueck - rv
        const r = await supabase
          .from('mitarbeiter_jahresdaten')
          .update({ resturlaub_vorjahr: (jd.resturlaub_vorjahr ?? 0) + rv, resturlaub: (jd.resturlaub ?? 0) + ra })
          .eq('id', jd.id)
        if (r.error) throw new Error(r.error.message)
        gv -= rv
        ga = Math.max(0, ga - ra)
      } else {
        const nehmen = -tageZurueck
        const r = await supabase
          .from('mitarbeiter_jahresdaten')
          .update({ resturlaub: (jd.resturlaub ?? 0) - nehmen })
          .eq('id', jd.id)
        if (r.error) throw new Error(r.error.message)
        ga += nehmen
      }
    }
  }
  if (uebrigeIds.length > 0 && (gv > 0 || ga > 0 || tageZurueck !== 0)) {
    await supabase.from('urlaubsantraege').update({ abzug_vorjahr: 0, abzug_aktuell: 0 }).in('id', uebrigeIds)
    const r = await supabase.from('urlaubsantraege').update({ abzug_vorjahr: gv, abzug_aktuell: ga }).eq('id', uebrigeIds[0])
    if (r.error) throw new Error(r.error.message)
  }
}

function UrlaubDialog({
  eintrag,
  tag,
  onSchliessen,
  onGeaendert,
}: {
  eintrag: KalenderEintrag
  tag: string
  onSchliessen: () => void
  onGeaendert: () => void
}) {
  const toast = useToast()
  const [von, setVon] = useState(eintrag.erster_tag)
  const [bis, setBis] = useState(eintrag.letzter_tag)
  const [arbeitet, setArbeitet] = useState(false)
  const alteTage = eintrag.brauchbare_tage ?? berechneBrauchbareTage(eintrag.erster_tag, eintrag.letzter_tag) ?? 0
  const neueTage = von && bis && bis >= von ? berechneBrauchbareTage(von, bis) ?? 0 : 0
  const genehmigt = eintrag.status === 'genehmigt'
  const einTagUrlaub = eintrag.erster_tag === eintrag.letzter_tag

  useEffect(() => {
    const taste = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onSchliessen()
    }
    window.addEventListener('keydown', taste)
    return () => window.removeEventListener('keydown', taste)
  }, [onSchliessen])

  async function ausfuehren(aktion: () => Promise<string>) {
    setArbeitet(true)
    try {
      const meldung = await aktion()
      toast.erfolg(meldung)
      onGeaendert()
    } catch (err) {
      toast.fehler(err instanceof Error ? err.message : 'Das hat nicht geklappt.')
      setArbeitet(false)
    }
  }

  function speichern() {
    if (!von || !bis) return toast.fehler('Bitte Von und Bis angeben.')
    if (bis < von) return toast.fehler('Das Bis-Datum liegt vor dem Von-Datum.')
    ausfuehren(async () => {
      const gz = await gruppenZeilenLaden(eintrag)
      const r = await supabase
        .from('urlaubsantraege')
        .update({ erster_tag: von, letzter_tag: bis, brauchbare_tage: neueTage, anzahl_tage: null })
        .eq('id', eintrag.id)
      if (r.error) throw new Error(r.error.message)
      await umbuchen(eintrag, gz, alteTage - neueTage, gz.map((z) => z.id))
      return 'Urlaub geändert.'
    })
  }

  async function zeitraumLoeschenAktion(): Promise<string> {
    const gz = await gruppenZeilenLaden(eintrag)
    const rest = gz.filter((z) => z.id !== eintrag.id)
    // Abzug dieses Zeitraums erst auf die uebrigen Zeilen verteilen, dann loeschen
    await umbuchen(eintrag, gz, alteTage, rest.map((z) => z.id))
    const dokument = gz.find((z) => z.id === eintrag.id)?.dokument_url
    const r = await supabase.from('urlaubsantraege').delete().eq('id', eintrag.id)
    if (r.error) throw new Error(r.error.message)
    if (rest.length === 0 && dokument) await supabase.storage.from('urlaubsantraege-dokumente').remove([dokument])
    return 'Urlaubszeitraum entfernt.'
  }

  async function zeitraumEntfernen() {
    const ok = await bestaetigen(
      `Urlaub von ${eintrag.name ?? 'dieser Person'} (${datumDeutsch(eintrag.erster_tag)} – ${datumDeutsch(eintrag.letzter_tag)}) komplett entfernen?` +
        (genehmigt ? `\n\n${alteTage} Urlaubstage werden dem Resturlaub wieder gutgeschrieben.` : ''),
      { titel: 'Urlaubszeitraum entfernen', jaText: 'Ja, entfernen', gefahr: true }
    )
    if (ok) ausfuehren(zeitraumLoeschenAktion)
  }

  async function tagEntfernen() {
    if (einTagUrlaub) return zeitraumEntfernen()
    const ok = await bestaetigen(`Nur den ${datumDeutsch(tag)} aus dem Urlaub von ${eintrag.name ?? 'dieser Person'} herausnehmen?`, {
      titel: 'Einzelnen Tag entfernen',
      jaText: 'Ja, Tag entfernen',
      gefahr: true,
    })
    if (!ok) return
    ausfuehren(async () => {
      const bisNeu = tagPlus(tag, -1)
      const gz = await gruppenZeilenLaden(eintrag)
      if (tag === eintrag.erster_tag || tag === eintrag.letzter_tag) {
        // Randtag: Zeitraum wird einfach kuerzer
        const nv = tag === eintrag.erster_tag ? tagPlus(tag, 1) : eintrag.erster_tag
        const nb = tag === eintrag.letzter_tag ? tagPlus(tag, -1) : eintrag.letzter_tag
        const tage = berechneBrauchbareTage(nv, nb) ?? 0
        const r = await supabase.from('urlaubsantraege').update({ erster_tag: nv, letzter_tag: nb, brauchbare_tage: tage, anzahl_tage: null }).eq('id', eintrag.id)
        if (r.error) throw new Error(r.error.message)
        await umbuchen(eintrag, gz, alteTage - tage, gz.map((z) => z.id))
        return `Der ${datumDeutsch(tag)} wurde aus dem Urlaub genommen.`
      }
      // Tag mitten im Zeitraum: Urlaub wird in zwei Teile geteilt
      const teilA = berechneBrauchbareTage(eintrag.erster_tag, bisNeu) ?? 0
      const teilB = berechneBrauchbareTage(tagPlus(tag, 1), eintrag.letzter_tag) ?? 0
      const voll = await supabase.from('urlaubsantraege').select('*').eq('id', eintrag.id).single()
      if (voll.error || !voll.data) throw new Error(voll.error?.message ?? 'Urlaub nicht gefunden.')
      const schluessel = eintrag.gruppe_id ?? eintrag.id
      const kopie: Record<string, unknown> = { ...(voll.data as Record<string, unknown>) }
      delete kopie.id
      delete kopie.erstellt_am
      delete kopie.created_at
      const neu = await supabase
        .from('urlaubsantraege')
        .insert({ ...kopie, erster_tag: tagPlus(tag, 1), letzter_tag: eintrag.letzter_tag, brauchbare_tage: teilB, anzahl_tage: null, dokument_url: null, gruppe_id: schluessel, abzug_vorjahr: 0, abzug_aktuell: 0 })
        .select('id')
        .single()
      if (neu.error || !neu.data) throw new Error(neu.error?.message ?? 'Teilzeitraum konnte nicht angelegt werden.')
      const a = await supabase
        .from('urlaubsantraege')
        .update({ letzter_tag: bisNeu, brauchbare_tage: teilA, anzahl_tage: null, gruppe_id: schluessel })
        .eq('id', eintrag.id)
      if (a.error) throw new Error(a.error.message)
      await umbuchen(eintrag, gz, alteTage - (teilA + teilB), [...gz.map((z) => z.id), (neu.data as { id: string }).id])
      return `Der ${datumDeutsch(tag)} wurde herausgenommen, der Urlaub ist jetzt in zwei Zeiträume geteilt.`
    })
  }

  const diff = alteTage - neueTage
  const eingabeStil: React.CSSProperties = { padding: '6px 10px', border: '1px solid #cbd5e1', borderRadius: 8, fontSize: 14 }

  return (
    <div
      onClick={onSchliessen}
      style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', zIndex: 1500, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(ev) => ev.stopPropagation()}
        style={{ background: '#fff', borderRadius: 14, padding: 22, width: 'min(460px, 100%)', boxShadow: '0 20px 60px rgba(0,0,0,0.35)' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: '#14325c' }}>Urlaub bearbeiten</div>
          <StatusMarke status={eintrag.status} />
        </div>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>{eintrag.name ?? 'Ohne Namen'}</div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: '#64748b' }}>
            Von
            <input type="date" value={von} onChange={(ev) => setVon(ev.target.value)} style={eingabeStil} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: '#64748b' }}>
            Bis
            <input type="date" value={bis} onChange={(ev) => setBis(ev.target.value)} style={eingabeStil} />
          </label>
        </div>

        <div style={{ fontSize: 13, color: '#475569', marginBottom: 16 }}>
          Urlaubstage: <b>{alteTage}</b>
          {diff !== 0 && (
            <>
              {' '}
              → <b>{neueTage}</b>
              {genehmigt && <span> ({diff > 0 ? `+${diff} gehen zurück auf den Resturlaub` : `${-diff} werden zusätzlich abgezogen`})</span>}
            </>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Knopf onClick={speichern} disabled={arbeitet || (von === eintrag.erster_tag && bis === eintrag.letzter_tag)}>
            Änderung speichern
          </Knopf>
          {!einTagUrlaub && (
            <Knopf art="sekundaer" onClick={tagEntfernen} disabled={arbeitet}>
              Nur den {datumDeutsch(tag)} herausnehmen
            </Knopf>
          )}
          <Knopf art="gefahr" onClick={zeitraumEntfernen} disabled={arbeitet}>
            Ganzen Zeitraum entfernen
          </Knopf>
          <Knopf art="leise" onClick={onSchliessen} disabled={arbeitet}>
            Abbrechen
          </Knopf>
        </div>
      </div>
    </div>
  )
}

export default function Kalender({ neuLadenAuslöser, onGeaendert }: { neuLadenAuslöser: number; onGeaendert?: () => void }) {
  const [monat, setMonat] = useState(() => {
    const heute = new Date()
    return new Date(heute.getFullYear(), heute.getMonth(), 1)
  })
  const [eintraege, setEintraege] = useState<KalenderEintrag[]>([])
  const [mitarbeiterListe, setMitarbeiterListe] = useState<Mitarbeiter[]>([])
  const [lokalNeu, setLokalNeu] = useState(0)
  const [bearbeiten, setBearbeiten] = useState<{ eintrag: KalenderEintrag; tag: string } | null>(null)

  useEffect(() => {
    async function laden() {
      const monatsStart = datumZuISO(new Date(monat.getFullYear(), monat.getMonth(), 1))
      const monatsEnde = datumZuISO(new Date(monat.getFullYear(), monat.getMonth() + 1, 0))

      const [{ data: antraegeData }, { data: mitarbeiterData }] = await Promise.all([
        supabase
          .from('urlaubsantraege')
          .select('id, name, erster_tag, letzter_tag, status, gruppe_id, brauchbare_tage')
          .lte('erster_tag', monatsEnde)
          .gte('letzter_tag', monatsStart)
          .in('status', ['offen', 'genehmigt']),
        supabase.from('mitarbeiter').select('id, name, kategorie, lok_typen').order('name'),
      ])

      setEintraege(antraegeData ?? [])
      setMitarbeiterListe(mitarbeiterData ?? [])
    }
    laden()
  }, [monat, neuLadenAuslöser, lokalNeu])

  const anzahlTage = new Date(monat.getFullYear(), monat.getMonth() + 1, 0).getDate()
  const tage = Array.from({ length: anzahlTage }, (_, i) =>
    new Date(monat.getFullYear(), monat.getMonth(), i + 1)
  )

  const feiertagsMap = new Map(
    feiertageBayern(monat.getFullYear()).map((f) => [f.datum, f.name])
  )
  function feiertagName(tag: Date) {
    return feiertagsMap.get(datumZuISO(tag))
  }

  const bekannteNamen = new Set(mitarbeiterListe.map((m) => normalisiereName(m.name)))
  const unbekannteNamen = Array.from(
    new Set(
      eintraege
        .map((e) => e.name)
        .filter((name): name is string => !!name && !bekannteNamen.has(normalisiereName(name)))
    )
  ).sort()

  const zeilen = [
    ...mitarbeiterListe.map((m) => ({ id: m.id, name: m.name })),
    ...unbekannteNamen.map((name) => ({ id: `unbekannt-${name}`, name })),
  ]

  function eintragFuerZelle(zeilenName: string, tag: Date) {
    return eintraege.find(
      (e) =>
        e.name &&
        normalisiereName(e.name) === normalisiereName(zeilenName) &&
        tagImBereich(tag, e.erster_tag, e.letzter_tag)
    )
  }

  function zellHintergrund(tag: Date, zeilenIndex: number, eintrag: KalenderEintrag | undefined) {
    if (eintrag) return farbeFuerStatus(eintrag.status)
    if (istHeute(tag)) return '#dbe6f5'
    if (feiertagName(tag)) return '#fbe1e4'
    if (istWochenende(tag)) return '#eef1f5'
    return zeilenIndex % 2 === 0 ? 'var(--card)' : 'var(--bg)'
  }

  function berechneAuslastung(gruppe: Mitarbeiter[]) {
    const namenSignaturen = new Set(gruppe.map((m) => normalisiereName(m.name)))
    return tage.map((tag) => {
      if (namenSignaturen.size === 0) return { anzahl: 0, anteil: 0 }
      const anzahl = eintraege.filter(
        (e) =>
          e.name &&
          namenSignaturen.has(normalisiereName(e.name)) &&
          tagImBereich(tag, e.erster_tag, e.letzter_tag)
      ).length
      return { anzahl, anteil: anzahl / gruppe.length }
    })
  }

  // Auslastung pro Qualifikation - Lokführer zusätzlich nach Lok-Typ aufgeschlüsselt
  const auslastungsZeilen: { titel: string; gesamt: number; anzahlProTag: { anzahl: number; anteil: number }[] }[] = []

  for (const kategorie of KATEGORIEN) {
    const gruppe = mitarbeiterListe.filter((m) => m.kategorie === kategorie)
    if (gruppe.length === 0) continue
    auslastungsZeilen.push({ titel: kategorie, gesamt: gruppe.length, anzahlProTag: berechneAuslastung(gruppe) })

    if (kategorie === 'Lokführer') {
      for (const lokTyp of LOK_TYPEN) {
        const lokGruppe = gruppe.filter((m) => (m.lok_typen ?? []).includes(lokTyp))
        if (lokGruppe.length === 0) continue
        auslastungsZeilen.push({
          titel: `↳ ${lokTyp}`,
          gesamt: lokGruppe.length,
          anzahlProTag: berechneAuslastung(lokGruppe),
        })
      }
    }
  }

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}
      >
        <button
          onClick={() => setMonat(new Date(monat.getFullYear(), monat.getMonth() - 1, 1))}
          style={navigationsKnopfStil}
        >
          ←
        </button>
        <div style={{ fontWeight: 600 }}>
          {MONATSNAMEN[monat.getMonth()]} {monat.getFullYear()}
        </div>
        <button
          onClick={() => setMonat(new Date(monat.getFullYear(), monat.getMonth() + 1, 1))}
          style={navigationsKnopfStil}
        >
          →
        </button>
      </div>

      <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
        <table style={{ borderCollapse: 'separate', borderSpacing: 0, fontSize: 12, width: '100%' }}>
          <thead>
            <tr>
              <th
                style={{
                  position: 'sticky',
                  left: 0,
                  top: 0,
                  background: 'var(--card)',
                  zIndex: 3,
                  padding: '6px 10px',
                  textAlign: 'left',
                  borderBottom: '1px solid var(--border)',
                  borderRight: '1px solid var(--border)',
                  minWidth: 170,
                }}
              >
                Mitarbeiter
              </th>
              {tage.map((tag) => {
                const feiertag = feiertagName(tag)
                return (
                  <th
                    key={tag.toISOString()}
                    title={feiertag ?? undefined}
                    style={{
                      padding: '4px 2px',
                      borderBottom: '1px solid var(--border)',
                      color: istHeute(tag) ? 'var(--navy)' : 'var(--text-muted)',
                      fontWeight: istHeute(tag) ? 700 : 500,
                      minWidth: 26,
                      background: istHeute(tag)
                        ? '#dbe6f5'
                        : feiertag
                        ? '#fbe1e4'
                        : istWochenende(tag)
                        ? '#eef1f5'
                        : 'var(--card)',
                    }}
                  >
                    <div>{tag.getDate()}</div>
                    <div style={{ fontSize: 9, fontWeight: 400, opacity: 0.8 }}>
                      {WOCHENTAGE_KURZ[tag.getDay()]}
                    </div>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {zeilen.map((zeile, index) => (
              <tr key={zeile.id}>
                <td
                  style={{
                    position: 'sticky',
                    left: 0,
                    background: index % 2 === 0 ? 'var(--card)' : 'var(--bg)',
                    zIndex: 1,
                    padding: '4px 10px',
                    borderRight: '1px solid var(--border)',
                    borderBottom: '1px solid var(--border)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {zeile.name}
                </td>
                {tage.map((tag) => {
                  const eintrag = eintragFuerZelle(zeile.name, tag)
                  const feiertag = feiertagName(tag)
                  return (
                    <td
                      key={tag.toISOString()}
                      title={eintrag ? `${zeile.name} – klicken zum Bearbeiten` : feiertag ?? undefined}
                      onClick={eintrag ? () => setBearbeiten({ eintrag, tag: datumZuISO(tag) }) : undefined}
                      style={{
                        borderBottom: '1px solid var(--border)',
                        background: zellHintergrund(tag, index, eintrag),
                        height: 22,
                        cursor: eintrag ? 'pointer' : 'default',
                      }}
                    />
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 16,
          marginTop: 12,
          fontSize: 12,
          color: 'var(--text-muted)',
          flexWrap: 'wrap',
        }}
      >
        <span>
          <span style={legendenPunktStil('var(--warning)')} /> In Prüfung
        </span>
        <span>
          <span style={legendenPunktStil('var(--success)')} /> Genehmigt
        </span>
        <span>
          <span style={legendenFlaecheStil('#fbe1e4')} /> Feiertag
        </span>
        <span>
          <span style={legendenFlaecheStil('#eef1f5')} /> Wochenende
        </span>
        <span>
          <span style={legendenFlaecheStil('#dbe6f5')} /> Heute
        </span>
      </div>

      <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '8px 0 0' }}>
        Tipp: Auf einen farbigen Urlaubstag klicken, um den Urlaub zu ändern, einen einzelnen Tag herauszunehmen oder den Zeitraum zu entfernen.
      </p>

      {bearbeiten && (
        <UrlaubDialog
          eintrag={bearbeiten.eintrag}
          tag={bearbeiten.tag}
          onSchliessen={() => setBearbeiten(null)}
          onGeaendert={() => {
            setBearbeiten(null)
            setLokalNeu((n) => n + 1)
            onGeaendert?.()
          }}
        />
      )}

      {auslastungsZeilen.length > 0 && (
        <div style={{ marginTop: 28 }}>
          <h4 style={{ marginBottom: 4 }}>Auslastung nach Qualifikation</h4>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 0, marginBottom: 10 }}>
            Zeigt, wie viele Mitarbeiter je Qualifikation (bei Lokführern zusätzlich je Lok-Typ)
            gleichzeitig abwesend sind - rot bedeutet hohes Ausfallrisiko.
          </p>

          <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
            <table style={{ borderCollapse: 'separate', borderSpacing: 0, fontSize: 12, width: '100%' }}>
              <thead>
                <tr>
                  <th
                    style={{
                      position: 'sticky',
                      left: 0,
                      background: 'var(--card)',
                      zIndex: 2,
                      padding: '6px 10px',
                      textAlign: 'left',
                      borderBottom: '1px solid var(--border)',
                      borderRight: '1px solid var(--border)',
                      minWidth: 170,
                    }}
                  >
                    Qualifikation
                  </th>
                  {tage.map((tag) => (
                    <th
                      key={tag.toISOString()}
                      style={{
                        padding: '4px 2px',
                        borderBottom: '1px solid var(--border)',
                        color: 'var(--text-muted)',
                        fontWeight: 500,
                        minWidth: 26,
                      }}
                    >
                      {tag.getDate()}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {auslastungsZeilen.map((zeile) => (
                  <tr key={zeile.titel}>
                    <td
                      style={{
                        position: 'sticky',
                        left: 0,
                        background: 'var(--card)',
                        zIndex: 1,
                        padding: '4px 10px',
                        borderRight: '1px solid var(--border)',
                        borderBottom: '1px solid var(--border)',
                        whiteSpace: 'nowrap',
                        color: zeile.titel.startsWith('↳') ? 'var(--text-muted)' : 'var(--text)',
                        paddingLeft: zeile.titel.startsWith('↳') ? 20 : 10,
                      }}
                    >
                      {zeile.titel}{' '}
                      <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>({zeile.gesamt})</span>
                    </td>
                    {zeile.anzahlProTag.map((eintrag, i) => {
                      const farbe = auslastungsFarbe(eintrag.anteil)
                      return (
                        <td
                          key={i}
                          title={eintrag.anzahl > 0 ? `${eintrag.anzahl} von ${zeile.gesamt} abwesend` : undefined}
                          style={{
                            borderBottom: '1px solid var(--border)',
                            background: farbe ?? 'var(--card)',
                            textAlign: 'center',
                            fontWeight: eintrag.anzahl > 0 ? 600 : 400,
                            color: eintrag.anteil >= 1 ? 'var(--danger)' : 'var(--text)',
                          }}
                        >
                          {eintrag.anzahl > 0 ? eintrag.anzahl : ''}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div
            style={{
              display: 'flex',
              gap: 16,
              marginTop: 10,
              fontSize: 12,
              color: 'var(--text-muted)',
              flexWrap: 'wrap',
            }}
          >
            <span>
              <span style={legendenFlaecheStil('#dcfce7')} /> Unkritisch
            </span>
            <span>
              <span style={legendenFlaecheStil('#fef3c7')} /> Erhöht
            </span>
            <span>
              <span style={legendenFlaecheStil('#fed7aa')} /> Hoch
            </span>
            <span>
              <span style={legendenFlaecheStil('#fecaca')} /> Alle abwesend
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

const navigationsKnopfStil: React.CSSProperties = {
  background: 'none',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '4px 10px',
  cursor: 'pointer',
  fontSize: 14,
}

function legendenPunktStil(farbe: string): React.CSSProperties {
  return {
    display: 'inline-block',
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: farbe,
    marginRight: 4,
  }
}

function legendenFlaecheStil(farbe: string): React.CSSProperties {
  return {
    display: 'inline-block',
    width: 12,
    height: 8,
    borderRadius: 2,
    background: farbe,
    marginRight: 4,
    border: '1px solid var(--border)',
  }
}
