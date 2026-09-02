import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import { feiertageBayern } from './feiertage'
import { datumZuISO } from './datumUtils'
import { namensSignatur } from './namensAbgleich'

interface KalenderEintrag {
  id: string
  name: string | null
  erster_tag: string
  letzter_tag: string
  status: string
}

interface Mitarbeiter {
  id: string
  name: string
  kategorie: string | null
}

const MONATSNAMEN = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
]

const WOCHENTAGE_KURZ = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa']

const KATEGORIEN = ['Lokführer', 'Dienstleister', 'Wagenmeister', 'Disposition', 'Betriebsleitung']

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

export default function Kalender({ neuLadenAuslöser }: { neuLadenAuslöser: number }) {
  const [monat, setMonat] = useState(() => {
    const heute = new Date()
    return new Date(heute.getFullYear(), heute.getMonth(), 1)
  })
  const [eintraege, setEintraege] = useState<KalenderEintrag[]>([])
  const [mitarbeiterListe, setMitarbeiterListe] = useState<Mitarbeiter[]>([])

  useEffect(() => {
    async function laden() {
      const monatsStart = datumZuISO(new Date(monat.getFullYear(), monat.getMonth(), 1))
      const monatsEnde = datumZuISO(new Date(monat.getFullYear(), monat.getMonth() + 1, 0))

      const [{ data: antraegeData }, { data: mitarbeiterData }] = await Promise.all([
        supabase
          .from('urlaubsantraege')
          .select('id, name, erster_tag, letzter_tag, status')
          .lte('erster_tag', monatsEnde)
          .gte('letzter_tag', monatsStart)
          .in('status', ['offen', 'genehmigt']),
        supabase.from('mitarbeiter').select('id, name, kategorie').order('name'),
      ])

      setEintraege(antraegeData ?? [])
      setMitarbeiterListe(mitarbeiterData ?? [])
    }
    laden()
  }, [monat, neuLadenAuslöser])

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

  // Auslastung pro Qualifikation berechnen
  const kategorienMitBesetzung = KATEGORIEN.map((kategorie) => {
    const mitarbeiterInKategorie = mitarbeiterListe.filter((m) => m.kategorie === kategorie)
    const namenSignaturenInKategorie = new Set(mitarbeiterInKategorie.map((m) => normalisiereName(m.name)))

    const anzahlProTag = tage.map((tag) => {
      if (namenSignaturenInKategorie.size === 0) return { anzahl: 0, anteil: 0 }
      const anzahl = eintraege.filter(
        (e) =>
          e.name &&
          namenSignaturenInKategorie.has(normalisiereName(e.name)) &&
          tagImBereich(tag, e.erster_tag, e.letzter_tag)
      ).length
      return { anzahl, anteil: anzahl / mitarbeiterInKategorie.length }
    })

    return { kategorie, gesamt: mitarbeiterInKategorie.length, anzahlProTag }
  }).filter((k) => k.gesamt > 0)

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
                      title={eintrag ? zeile.name : feiertag ?? undefined}
                      style={{
                        borderBottom: '1px solid var(--border)',
                        background: zellHintergrund(tag, index, eintrag),
                        height: 22,
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

      {kategorienMitBesetzung.length > 0 && (
        <div style={{ marginTop: 28 }}>
          <h4 style={{ marginBottom: 4 }}>Auslastung nach Qualifikation</h4>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 0, marginBottom: 10 }}>
            Zeigt, wie viele Mitarbeiter je Qualifikation gleichzeitig abwesend sind - rot bedeutet
            hohes Ausfallrisiko.
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
                {kategorienMitBesetzung.map((k) => (
                  <tr key={k.kategorie}>
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
                      }}
                    >
                      {k.kategorie}{' '}
                      <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>({k.gesamt})</span>
                    </td>
                    {k.anzahlProTag.map((eintrag, i) => {
                      const farbe = auslastungsFarbe(eintrag.anteil)
                      return (
                        <td
                          key={i}
                          title={eintrag.anzahl > 0 ? `${eintrag.anzahl} von ${k.gesamt} abwesend` : undefined}
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
