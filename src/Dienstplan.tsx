import { Fragment, useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import { datumZuISO } from './datumUtils'
import { KATEGORIEN } from './qualifikationen'

interface Mitarbeiter {
  id: string
  name: string
  kategorie: string | null
}

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
  benoetigte_wochentage: number[] | null
}

interface DienstplanEintrag {
  id: string
  mitarbeiter_id: string
  datum: string
  schichtvorlage_id: string | null
  ist_spotschicht: boolean
  spot_name: string | null
  spot_beginn_zeit: string | null
  spot_ende_zeit: string | null
  spot_pause_minuten: number | null
  spot_dienstort: string | null
  spot_farbe: string | null
  status: string | null
}

interface UrlaubsBlock {
  mitarbeiter_id: string
  erster_tag: string
  letzter_tag: string
}

const WOCHENTAGE_KURZ = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']

function montagDerWoche(datum: Date): Date {
  const tag = datum.getDay()
  const differenz = tag === 0 ? -6 : 1 - tag
  const montag = new Date(datum)
  montag.setDate(datum.getDate() + differenz)
  montag.setHours(0, 0, 0, 0)
  return montag
}

function datumKurz(datum: Date): string {
  const tag = String(datum.getDate()).padStart(2, '0')
  const monat = String(datum.getMonth() + 1).padStart(2, '0')
  return `${tag}.${monat}.`
}

function istHeute(datum: Date): boolean {
  const heute = new Date()
  return (
    datum.getFullYear() === heute.getFullYear() &&
    datum.getMonth() === heute.getMonth() &&
    datum.getDate() === heute.getDate()
  )
}

function istWochenende(datum: Date): boolean {
  const tag = datum.getDay()
  return tag === 0 || tag === 6
}

function zeitKurz(zeit: string | null): string {
  return zeit ? zeit.slice(0, 5) : ''
}

function schichtDauerMinuten(beginn: string, ende: string, pauseMinuten: number): number {
  const [bh, bm] = beginn.split(':').map(Number)
  const [eh, em] = ende.split(':').map(Number)
  const start = bh * 60 + bm
  let end = eh * 60 + em
  if (end <= start) end += 24 * 60
  return end - start - pauseMinuten
}

function minutenAlsText(minuten: number): string {
  const stunden = Math.floor(minuten / 60)
  const rest = minuten % 60
  return `${stunden}:${String(rest).padStart(2, '0')}`
}

function initialen(name: string): string {
  const teile = name.trim().split(/\s+/)
  if (teile.length === 1) return teile[0].slice(0, 2).toUpperCase()
  return (teile[0][0] + teile[teile.length - 1][0]).toUpperCase()
}

function farbeFuerAvatar(name: string): string {
  const palette = ['#14325c', '#2c4a73', '#0e7490', '#7c3aed', '#be185d', '#a16207', '#15803d']
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return palette[Math.abs(hash) % palette.length]
}

export default function Dienstplan() {
  const [wochenStart, setWochenStart] = useState(() => montagDerWoche(new Date()))
  const [mitarbeiterListe, setMitarbeiterListe] = useState<Mitarbeiter[]>([])
  const [vorlagen, setVorlagen] = useState<Schichtvorlage[]>([])
  const [eintraege, setEintraege] = useState<DienstplanEintrag[]>([])
  const [urlaube, setUrlaube] = useState<UrlaubsBlock[]>([])
  const [ladeVorgang, setLadeVorgang] = useState(true)

  const [ausgewaehlteZelle, setAusgewaehlteZelle] = useState<{ mitarbeiterId: string; datum: string } | null>(null)
  const [gezogeneVorlage, setGezogeneVorlage] = useState<{ vorlageId: string; tagDatum: string } | null>(null)
  const [gezogenerEintrag, setGezogenerEintrag] = useState<{ mitarbeiterId: string; datum: string } | null>(null)
  const [hoverZiel, setHoverZiel] = useState<string | null>(null)
  const [gewaehlteVorlage, setGewaehlteVorlage] = useState('')
  const [spotFormularOffen, setSpotFormularOffen] = useState(false)
  const [spotDaten, setSpotDaten] = useState({
    name: '',
    beginn_zeit: '06:00',
    ende_zeit: '18:00',
    pause_minuten: 0,
    dienstort: '',
    farbe: '#8b1a1a',
  })

  const tage = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(wochenStart)
    d.setDate(wochenStart.getDate() + i)
    return d
  })

  async function laden() {
    setLadeVorgang(true)
    const wochenEnde = tage[6]
    const startIso = datumZuISO(wochenStart)
    const endeIso = datumZuISO(wochenEnde)

    const [{ data: mitarbeiterData }, { data: vorlagenData }, { data: eintraegeData }, { data: urlaubeData }] =
      await Promise.all([
        supabase.from('mitarbeiter').select('id, name, kategorie').order('name'),
        supabase.from('schichtvorlagen').select('*').eq('aktiv', true).order('name'),
        supabase
          .from('dienstplan_eintraege')
          .select('*')
          .gte('datum', startIso)
          .lte('datum', endeIso),
        supabase
          .from('urlaubsantraege')
          .select('mitarbeiter_id, erster_tag, letzter_tag')
          .eq('status', 'genehmigt')
          .lte('erster_tag', endeIso)
          .gte('letzter_tag', startIso),
      ])

    const sortierteMitarbeiter = [...(mitarbeiterData ?? [])].sort((a, b) => {
      const rangA = a.kategorie ? KATEGORIEN.indexOf(a.kategorie) : 999
      const rangB = b.kategorie ? KATEGORIEN.indexOf(b.kategorie) : 999
      const bereinigtA = rangA === -1 ? 998 : rangA
      const bereinigtB = rangB === -1 ? 998 : rangB
      if (bereinigtA !== bereinigtB) return bereinigtA - bereinigtB
      return a.name.localeCompare(b.name)
    })
    setMitarbeiterListe(sortierteMitarbeiter)
    setVorlagen(vorlagenData ?? [])
    setEintraege(eintraegeData ?? [])
    setUrlaube((urlaubeData ?? []).filter((u) => u.mitarbeiter_id))
    setLadeVorgang(false)
  }

  useEffect(() => {
    laden()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wochenStart])

  function istUrlaub(mitarbeiterId: string, datumIso: string): boolean {
    return urlaube.some(
      (u) => u.mitarbeiter_id === mitarbeiterId && datumIso >= u.erster_tag && datumIso <= u.letzter_tag
    )
  }

  function eintragFuer(mitarbeiterId: string, datumIso: string): DienstplanEintrag | undefined {
    return eintraege.find((e) => e.mitarbeiter_id === mitarbeiterId && e.datum === datumIso)
  }

  function zelleOeffnen(mitarbeiterId: string, datumIso: string) {
    setAusgewaehlteZelle({ mitarbeiterId, datum: datumIso })
    setGewaehlteVorlage('')
    setSpotFormularOffen(false)
  }

  async function schichtDirektZuweisen(vorlageId: string, mitarbeiterId: string, datumIso: string) {
    const bestehend = eintragFuer(mitarbeiterId, datumIso)
    if (bestehend) {
      const bestaetigt = window.confirm(
        'Für diesen Tag ist bereits ein Eintrag vorhanden. Überschreiben?'
      )
      if (!bestaetigt) return
    }
    await supabase.from('dienstplan_eintraege').upsert(
      {
        mitarbeiter_id: mitarbeiterId,
        datum: datumIso,
        schichtvorlage_id: vorlageId,
        ist_spotschicht: false,
        status: null,
      },
      { onConflict: 'mitarbeiter_id,datum' }
    )
    await laden()
  }

  async function eintragVerschieben(
    quelle: { mitarbeiterId: string; datum: string },
    zielMitarbeiterId: string,
    zielDatumIso: string
  ) {
    if (quelle.mitarbeiterId === zielMitarbeiterId && quelle.datum === zielDatumIso) return
    const quellEintrag = eintragFuer(quelle.mitarbeiterId, quelle.datum)
    if (!quellEintrag) return

    const zielBestehend = eintragFuer(zielMitarbeiterId, zielDatumIso)
    if (zielBestehend) {
      const bestaetigt = window.confirm('Der Zieltag hat bereits einen Eintrag. Überschreiben?')
      if (!bestaetigt) return
    }

    await supabase
      .from('dienstplan_eintraege')
      .delete()
      .eq('mitarbeiter_id', quelle.mitarbeiterId)
      .eq('datum', quelle.datum)

    await supabase.from('dienstplan_eintraege').upsert(
      {
        mitarbeiter_id: zielMitarbeiterId,
        datum: zielDatumIso,
        schichtvorlage_id: quellEintrag.schichtvorlage_id,
        ist_spotschicht: quellEintrag.ist_spotschicht,
        spot_name: quellEintrag.spot_name,
        spot_beginn_zeit: quellEintrag.spot_beginn_zeit,
        spot_ende_zeit: quellEintrag.spot_ende_zeit,
        spot_pause_minuten: quellEintrag.spot_pause_minuten,
        spot_dienstort: quellEintrag.spot_dienstort,
        spot_farbe: quellEintrag.spot_farbe,
        status: quellEintrag.status,
      },
      { onConflict: 'mitarbeiter_id,datum' }
    )
    await laden()
  }

  async function vorlageZuweisen() {
    if (!ausgewaehlteZelle || !gewaehlteVorlage) return
    await supabase.from('dienstplan_eintraege').upsert(
      {
        mitarbeiter_id: ausgewaehlteZelle.mitarbeiterId,
        datum: ausgewaehlteZelle.datum,
        schichtvorlage_id: gewaehlteVorlage,
        ist_spotschicht: false,
        status: null,
      },
      { onConflict: 'mitarbeiter_id,datum' }
    )
    setAusgewaehlteZelle(null)
    await laden()
  }

  async function spotschichtAnlegen() {
    if (!ausgewaehlteZelle || !spotDaten.name.trim()) return
    await supabase.from('dienstplan_eintraege').upsert(
      {
        mitarbeiter_id: ausgewaehlteZelle.mitarbeiterId,
        datum: ausgewaehlteZelle.datum,
        schichtvorlage_id: null,
        ist_spotschicht: true,
        spot_name: spotDaten.name,
        spot_beginn_zeit: spotDaten.beginn_zeit,
        spot_ende_zeit: spotDaten.ende_zeit,
        spot_pause_minuten: spotDaten.pause_minuten,
        spot_dienstort: spotDaten.dienstort,
        spot_farbe: spotDaten.farbe,
        status: null,
      },
      { onConflict: 'mitarbeiter_id,datum' }
    )
    setAusgewaehlteZelle(null)
    setSpotDaten({ name: '', beginn_zeit: '06:00', ende_zeit: '18:00', pause_minuten: 0, dienstort: '', farbe: '#8b1a1a' })
    await laden()
  }

  async function statusSetzen(status: 'ruhe' | 'frei') {
    if (!ausgewaehlteZelle) return
    await supabase.from('dienstplan_eintraege').upsert(
      {
        mitarbeiter_id: ausgewaehlteZelle.mitarbeiterId,
        datum: ausgewaehlteZelle.datum,
        schichtvorlage_id: null,
        ist_spotschicht: false,
        status,
      },
      { onConflict: 'mitarbeiter_id,datum' }
    )
    setAusgewaehlteZelle(null)
    await laden()
  }

  async function eintragLoeschen() {
    if (!ausgewaehlteZelle) return
    await supabase
      .from('dienstplan_eintraege')
      .delete()
      .eq('mitarbeiter_id', ausgewaehlteZelle.mitarbeiterId)
      .eq('datum', ausgewaehlteZelle.datum)
    setAusgewaehlteZelle(null)
    await laden()
  }

  async function eintragLoeschenExtern(ziel: { mitarbeiterId: string; datum: string }) {
    await supabase
      .from('dienstplan_eintraege')
      .delete()
      .eq('mitarbeiter_id', ziel.mitarbeiterId)
      .eq('datum', ziel.datum)
    await laden()
  }

  function wochenArbeitszeit(mitarbeiterId: string): string {
    let summe = 0
    for (const tag of tage) {
      const datumIso = datumZuISO(tag)
      const eintrag = eintragFuer(mitarbeiterId, datumIso)
      if (!eintrag || eintrag.status) continue
      if (eintrag.ist_spotschicht && eintrag.spot_beginn_zeit && eintrag.spot_ende_zeit) {
        summe += schichtDauerMinuten(
          eintrag.spot_beginn_zeit,
          eintrag.spot_ende_zeit,
          eintrag.spot_pause_minuten ?? 0
        )
      } else if (eintrag.schichtvorlage_id) {
        const vorlage = vorlagen.find((v) => v.id === eintrag.schichtvorlage_id)
        if (vorlage) {
          summe += schichtDauerMinuten(vorlage.beginn_zeit, vorlage.ende_zeit, vorlage.pause_minuten ?? 0)
        }
      }
    }
    return minutenAlsText(summe)
  }

  function offeneVorlagenFuerTag(datumIso: string, wochentag: number): Schichtvorlage[] {
    return vorlagen.filter((v) => {
      const benoetigt = (v.benoetigte_wochentage ?? [0, 1, 2, 3, 4, 5, 6]).includes(wochentag)
      if (!benoetigt) return false
      const bereitsVergeben = eintraege.some((e) => e.schichtvorlage_id === v.id && e.datum === datumIso)
      return !bereitsVergeben
    })
  }

  if (ladeVorgang) {
    return <p style={{ color: 'var(--text-muted)' }}>Lade Dienstplan...</p>
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <button
          onClick={() => setWochenStart(new Date(wochenStart.getTime() - 7 * 86400000))}
          style={navigationsKnopfStil}
        >
          ← Vorherige Woche
        </button>
        <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--navy)' }}>
          {datumKurz(tage[0])} – {datumKurz(tage[6])} {tage[0].getFullYear()}
        </div>
        <button
          onClick={() => setWochenStart(new Date(wochenStart.getTime() + 7 * 86400000))}
          style={navigationsKnopfStil}
        >
          Nächste Woche →
        </button>
      </div>

      <div
        style={{
          border: '1px solid var(--border)',
          borderRadius: 12,
          overflow: 'hidden',
          boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
        }}
      >
        <table style={{ borderCollapse: 'collapse', width: '100%', tableLayout: 'fixed', fontSize: 12 }}>
          <colgroup>
            <col style={{ width: 170 }} />
            {tage.map((_, i) => (
              <col key={i} />
            ))}
            <col style={{ width: 64 }} />
          </colgroup>
          <thead>
            <tr>
              <th style={{ ...kopfZelleStil, textAlign: 'left', paddingLeft: 16 }}>Mitarbeiter</th>
              {tage.map((tag, i) => (
                <th
                  key={i}
                  style={{
                    ...kopfZelleStil,
                    background: istHeute(tag) ? '#dbe6f5' : istWochenende(tag) ? '#eef1f5' : '#f8fafc',
                    color: istHeute(tag) ? 'var(--navy)' : '#475569',
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 700 }}>{WOCHENTAGE_KURZ[i]}</div>
                  <div style={{ fontSize: 10, fontWeight: 400 }}>{datumKurz(tag)}</div>
                </th>
              ))}
              <th style={{ ...kopfZelleStil, background: '#f8fafc', color: '#475569' }}>Std.</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td
                style={{
                  ...zellBasisStil,
                  padding: '6px 16px',
                  background: '#fff7ed',
                  fontWeight: 700,
                  fontSize: 11,
                  color: '#9a3412',
                }}
              >
                Offene Schichten
              </td>
              {tage.map((tag) => {
                const datumIso = datumZuISO(tag)
                const offene = offeneVorlagenFuerTag(datumIso, tag.getDay())
                const zielSchluessel = `offen-${datumIso}`
                return (
                  <td
                    key={datumIso}
                    onDragOver={(e) => {
                      e.preventDefault()
                      setHoverZiel(zielSchluessel)
                    }}
                    onDragLeave={() => setHoverZiel((z) => (z === zielSchluessel ? null : z))}
                    onDrop={(e) => {
                      e.preventDefault()
                      setHoverZiel(null)
                      // Zurueck in den Offen-Pool: bereits zugewiesene Schicht wieder freigeben
                      if (gezogenerEintrag) {
                        eintragLoeschenExtern(gezogenerEintrag)
                        setGezogenerEintrag(null)
                      }
                    }}
                    style={{
                      ...zellBasisStil,
                      background: hoverZiel === zielSchluessel ? '#ffedd5' : '#fff7ed',
                      padding: 5,
                    }}
                  >
                    {offene.length === 0 ? (
                      <div style={{ textAlign: 'center', fontSize: 10, color: 'var(--success)' }}>
                        ✓ besetzt
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {offene.map((vorlage) => (
                          <div
                            key={vorlage.id}
                            draggable
                            onDragStart={() => setGezogeneVorlage({ vorlageId: vorlage.id, tagDatum: datumIso })}
                            onDragEnd={() => setGezogeneVorlage(null)}
                            title="Nach unten auf die Person ziehen"
                            style={{
                              background: vorlage.farbe,
                              color: '#ffffff',
                              borderRadius: 6,
                              padding: '4px 6px',
                              cursor: 'grab',
                              fontSize: 10,
                              fontWeight: 600,
                            }}
                          >
                            <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {vorlage.name}
                            </div>
                            <div style={{ fontSize: 9, opacity: 0.85, fontWeight: 400 }}>
                              {zeitKurz(vorlage.beginn_zeit)}–{zeitKurz(vorlage.ende_zeit)}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                )
              })}
              <td style={{ ...zellBasisStil, background: '#fff7ed' }} />
            </tr>
            {mitarbeiterListe.map((mitarbeiter, zeilenIndex) => {
              const vorherigeKategorie = zeilenIndex > 0 ? mitarbeiterListe[zeilenIndex - 1].kategorie : null
              const neueGruppe = mitarbeiter.kategorie !== vorherigeKategorie
              return (
                <Fragment key={mitarbeiter.id}>
                  {neueGruppe && (
                    <tr key={`gruppe-${mitarbeiter.kategorie ?? 'ohne'}`}>
                      <td
                        colSpan={9}
                        style={{
                          background: '#eef2f7',
                          color: 'var(--navy)',
                          fontWeight: 700,
                          fontSize: 11,
                          padding: '6px 16px',
                          textTransform: 'uppercase',
                          letterSpacing: 0.4,
                          borderBottom: '1px solid var(--border)',
                          borderTop: zeilenIndex > 0 ? '1px solid var(--border)' : undefined,
                        }}
                      >
                        {mitarbeiter.kategorie ?? 'Ohne Qualifikation'}
                      </td>
                    </tr>
                  )}
                  <tr key={mitarbeiter.id} style={{ background: zeilenIndex % 2 === 0 ? '#ffffff' : '#fafbfc' }}>
                <td style={{ ...zellBasisStil, padding: '8px 16px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: '50%',
                        background: farbeFuerAvatar(mitarbeiter.name),
                        color: '#ffffff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 10,
                        fontWeight: 700,
                        flexShrink: 0,
                      }}
                    >
                      {initialen(mitarbeiter.name)}
                    </div>
                    <span style={{ fontWeight: 500, color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {mitarbeiter.name}
                    </span>
                  </div>
                </td>
                {tage.map((tag) => {
                  const datumIso = datumZuISO(tag)
                  const urlaub = istUrlaub(mitarbeiter.id, datumIso)
                  const eintrag = eintragFuer(mitarbeiter.id, datumIso)
                  const ausgewaehlt =
                    ausgewaehlteZelle?.mitarbeiterId === mitarbeiter.id && ausgewaehlteZelle?.datum === datumIso
                  const spalteBetont = istHeute(tag) || istWochenende(tag)

                  let karte: React.ReactNode = null

                  if (urlaub) {
                    karte = <SchichtKarte farbe="#db2777" titel="Urlaub" umrandet />
                  } else if (eintrag?.status === 'ruhe') {
                    karte = <SchichtKarte farbe="#0e7490" titel="Ruhe" umrandet />
                  } else if (eintrag?.status === 'frei') {
                    karte = <SchichtKarte farbe="#64748b" titel="Frei" umrandet />
                  } else if (eintrag?.ist_spotschicht) {
                    karte = (
                      <SchichtKarte
                        farbe={eintrag.spot_farbe ?? '#8b1a1a'}
                        titel={eintrag.spot_name ?? ''}
                        zeile2={`${zeitKurz(eintrag.spot_beginn_zeit)}–${zeitKurz(eintrag.spot_ende_zeit)}`}
                        zeile3={eintrag.spot_dienstort ?? undefined}
                      />
                    )
                  } else if (eintrag?.schichtvorlage_id) {
                    const vorlage = vorlagen.find((v) => v.id === eintrag.schichtvorlage_id)
                    if (vorlage) {
                      karte = (
                        <SchichtKarte
                          farbe={vorlage.farbe}
                          titel={vorlage.name}
                          zeile2={`${zeitKurz(vorlage.beginn_zeit)}–${zeitKurz(vorlage.ende_zeit)}`}
                          zeile3={vorlage.dienstort ?? undefined}
                        />
                      )
                    }
                  }

                  const zielSchluessel = `${mitarbeiter.id}-${datumIso}`
                  const falscherTagBeimZiehen = !!gezogeneVorlage && gezogeneVorlage.tagDatum !== datumIso

                  return (
                    <td
                      key={datumIso}
                      onClick={() => !urlaub && zelleOeffnen(mitarbeiter.id, datumIso)}
                      onDragOver={(e) => {
                        if (urlaub || falscherTagBeimZiehen) return
                        e.preventDefault()
                        setHoverZiel(zielSchluessel)
                      }}
                      onDragLeave={() => setHoverZiel((z) => (z === zielSchluessel ? null : z))}
                      onDrop={(e) => {
                        e.preventDefault()
                        setHoverZiel(null)
                        if (urlaub) return
                        if (gezogeneVorlage && gezogeneVorlage.tagDatum === datumIso) {
                          schichtDirektZuweisen(gezogeneVorlage.vorlageId, mitarbeiter.id, datumIso)
                          setGezogeneVorlage(null)
                        } else if (gezogenerEintrag) {
                          eintragVerschieben(gezogenerEintrag, mitarbeiter.id, datumIso)
                          setGezogenerEintrag(null)
                        }
                      }}
                      style={{
                        ...zellBasisStil,
                        opacity: falscherTagBeimZiehen ? 0.5 : 1,
                        background:
                          hoverZiel === zielSchluessel
                            ? '#e0f2fe'
                            : spalteBetont
                            ? istHeute(tag)
                              ? '#f3f7fd'
                              : '#fafbfc'
                            : undefined,
                        cursor: urlaub ? 'default' : 'pointer',
                        boxShadow: ausgewaehlt ? 'inset 0 0 0 2px var(--navy)' : undefined,
                        padding: 5,
                      }}
                    >
                      {karte && eintrag && !urlaub && !eintrag.status ? (
                        <div
                          draggable
                          onDragStart={(e) => {
                            e.stopPropagation()
                            setGezogenerEintrag({ mitarbeiterId: mitarbeiter.id, datum: datumIso })
                          }}
                          onDragEnd={() => setGezogenerEintrag(null)}
                          style={{ cursor: 'grab' }}
                        >
                          {karte}
                        </div>
                      ) : (
                        karte
                      )}
                      {!karte && (
                        <div
                          className="dienstplan-leerzelle"
                          style={{
                            height: 44,
                            borderRadius: 8,
                            border: '1.5px dashed #e2e8f0',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#cbd5e1',
                            fontSize: 16,
                          }}
                        >
                          +
                        </div>
                      )}
                    </td>
                  )
                })}
                <td style={{ ...zellBasisStil, textAlign: 'center' }}>
                  <div style={{ fontWeight: 700, color: 'var(--navy)', fontSize: 13 }}>
                    {wochenArbeitszeit(mitarbeiter.id)}
                  </div>
                </td>
              </tr>
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      <style>{`.dienstplan-leerzelle:hover { border-color: var(--navy) !important; color: var(--navy) !important; }`}</style>

      {ausgewaehlteZelle && (
        <div
          onClick={() => setAusgewaehlteZelle(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15, 23, 42, 0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 20,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: '#ffffff',
              borderRadius: 12,
              padding: 20,
              width: 480,
              maxWidth: '100%',
              maxHeight: '85vh',
              overflowY: 'auto',
              boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--navy)' }}>
                  {mitarbeiterListe.find((m) => m.id === ausgewaehlteZelle.mitarbeiterId)?.name}
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{ausgewaehlteZelle.datum}</div>
              </div>
              <button
                onClick={() => setAusgewaehlteZelle(null)}
                style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)', lineHeight: 1 }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
              <select
                value={gewaehlteVorlage}
                onChange={(e) => setGewaehlteVorlage(e.target.value)}
                style={{ ...eingabeStil, width: '100%' }}
              >
                <option value="">Bestandsschicht wählen...</option>
                {(() => {
                  const wochentagDerZelle = new Date(ausgewaehlteZelle.datum).getDay()
                  const passend = vorlagen.filter((v) =>
                    (v.benoetigte_wochentage ?? [0, 1, 2, 3, 4, 5, 6]).includes(wochentagDerZelle)
                  )
                  const unpassend = vorlagen.filter(
                    (v) => !(v.benoetigte_wochentage ?? [0, 1, 2, 3, 4, 5, 6]).includes(wochentagDerZelle)
                  )
                  return (
                    <>
                      {passend.length > 0 && (
                        <optgroup label="Für diesen Wochentag vorgesehen">
                          {passend.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.name}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      {unpassend.length > 0 && (
                        <optgroup label="⚠ Normalerweise nicht an diesem Tag">
                          {unpassend.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.name}
                            </option>
                          ))}
                        </optgroup>
                      )}
                    </>
                  )
                })()}
              </select>
              <button onClick={vorlageZuweisen} disabled={!gewaehlteVorlage} style={{ ...primaerKnopfStil, width: '100%' }}>
                Zuweisen
              </button>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              <button onClick={() => setSpotFormularOffen(!spotFormularOffen)} style={sekundaerKnopfStil}>
                {spotFormularOffen ? 'Spotschicht abbrechen' : '+ Spotschicht anlegen'}
              </button>
              <button onClick={() => statusSetzen('ruhe')} style={sekundaerKnopfStil}>
                Ruhe
              </button>
              <button onClick={() => statusSetzen('frei')} style={sekundaerKnopfStil}>
                Frei
              </button>
              <button onClick={eintragLoeschen} style={loeschenKnopfStil}>
                Eintrag leeren
              </button>
            </div>

            {spotFormularOffen && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                  gap: 10,
                  padding: 12,
                  background: '#f8fafc',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                }}
              >
                <label style={beschriftungStil}>
                  Name
                  <input
                    value={spotDaten.name}
                    onChange={(e) => setSpotDaten({ ...spotDaten, name: e.target.value })}
                    style={eingabeStil}
                    placeholder="z.B. Kessel Dienstantritt NRH"
                  />
                </label>
                <label style={beschriftungStil}>
                  Beginn
                  <input
                    type="time"
                    value={spotDaten.beginn_zeit}
                    onChange={(e) => setSpotDaten({ ...spotDaten, beginn_zeit: e.target.value })}
                    style={eingabeStil}
                  />
                </label>
                <label style={beschriftungStil}>
                  Ende
                  <input
                    type="time"
                    value={spotDaten.ende_zeit}
                    onChange={(e) => setSpotDaten({ ...spotDaten, ende_zeit: e.target.value })}
                    style={eingabeStil}
                  />
                </label>
                <label style={beschriftungStil}>
                  Pause (Min.)
                  <input
                    type="number"
                    value={spotDaten.pause_minuten}
                    onChange={(e) => setSpotDaten({ ...spotDaten, pause_minuten: Number(e.target.value) })}
                    style={eingabeStil}
                  />
                </label>
                <label style={beschriftungStil}>
                  Dienstort
                  <input
                    value={spotDaten.dienstort}
                    onChange={(e) => setSpotDaten({ ...spotDaten, dienstort: e.target.value })}
                    style={eingabeStil}
                  />
                </label>
                <label style={beschriftungStil}>
                  Farbe
                  <input
                    type="color"
                    value={spotDaten.farbe}
                    onChange={(e) => setSpotDaten({ ...spotDaten, farbe: e.target.value })}
                    style={{ ...eingabeStil, padding: 2, height: 36 }}
                  />
                </label>
                <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                  <button onClick={spotschichtAnlegen} style={primaerKnopfStil}>
                    Anlegen
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function SchichtKarte({
  farbe,
  titel,
  zeile2,
  zeile3,
  umrandet,
}: {
  farbe: string
  titel: string
  zeile2?: string
  zeile3?: string
  umrandet?: boolean
}) {
  if (umrandet) {
    return (
      <div
        style={{
          height: 44,
          borderRadius: 8,
          border: `1.5px solid ${farbe}`,
          background: `${farbe}15`,
          color: farbe,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontWeight: 700,
          fontSize: 12,
        }}
      >
        {titel}
      </div>
    )
  }

  return (
    <div
      style={{
        minHeight: 44,
        borderRadius: 8,
        background: farbe,
        color: '#ffffff',
        padding: '5px 7px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 1,
      }}
    >
      <div
        style={{
          fontWeight: 700,
          fontSize: 11,
          lineHeight: 1.25,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
        title={titel}
      >
        {titel}
      </div>
      {zeile2 && <div style={{ fontSize: 10, opacity: 0.9 }}>{zeile2}</div>}
      {zeile3 && (
        <div style={{ fontSize: 9, opacity: 0.8, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {zeile3}
        </div>
      )}
    </div>
  )
}

const navigationsKnopfStil: React.CSSProperties = {
  background: 'none',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '6px 14px',
  cursor: 'pointer',
  fontSize: 13,
  color: 'var(--navy)',
  fontWeight: 500,
}

const kopfZelleStil: React.CSSProperties = {
  padding: '10px 6px',
  borderBottom: '1px solid var(--border)',
  textAlign: 'center',
  fontWeight: 600,
}

const zellBasisStil: React.CSSProperties = {
  borderBottom: '1px solid #f1f5f9',
  padding: 5,
  verticalAlign: 'middle',
}

const eingabeStil: React.CSSProperties = {
  padding: '6px 8px',
  border: '1px solid var(--border)',
  borderRadius: 4,
  fontSize: 13,
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

const sekundaerKnopfStil: React.CSSProperties = {
  background: 'none',
  border: '1px solid var(--navy)',
  color: 'var(--navy)',
  borderRadius: 6,
  padding: '8px 14px',
  fontSize: 13,
  cursor: 'pointer',
}

const loeschenKnopfStil: React.CSSProperties = {
  background: 'none',
  border: '1px solid var(--danger)',
  color: 'var(--danger)',
  borderRadius: 6,
  padding: '8px 14px',
  fontSize: 13,
  cursor: 'pointer',
}
