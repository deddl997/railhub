import { useEffect, useState } from 'react'
import { supabase } from './lib/supabase'
import { namensSignatur } from './namensAbgleich'
import { KATEGORIEN, LOK_TYPEN } from './qualifikationen'

interface Jahresdaten {
  id: string
  mitarbeiter_id: string
  urlaubsanspruch: number | null
  resturlaub: number | null
  resturlaub_vorjahr: number | null
}

interface Zeile {
  mitarbeiterId: string
  name: string
  kategorie: string | null
  lokTypen: string[]
  jahresdatenId: string | null
  urlaubsanspruch: number | null
  resturlaub: number | null
  resturlaub_vorjahr: number | null
  tageGenommen: number
}

export default function MitarbeiterVerwaltung({ neuLadenAuslöser }: { neuLadenAuslöser: number }) {
  const [jahr, setJahr] = useState(() => new Date().getFullYear())
  const [verfuegbareJahre, setVerfuegbareJahre] = useState<number[]>([])
  const [zeilen, setZeilen] = useState<Zeile[]>([])
  const [ladeVorgang, setLadeVorgang] = useState(true)
  const [gespeichertId, setGespeichertId] = useState<string | null>(null)
  const [neuerName, setNeuerName] = useState('')
  const [wirdHinzugefuegt, setWirdHinzugefuegt] = useState(false)
  const [offenesLokMenue, setOffenesLokMenue] = useState<string | null>(null)

  async function laden() {
    setLadeVorgang(true)

    const [{ data: mitarbeiterListe }, { data: alleJahresdaten }, { data: genehmigteAntraege }] =
      await Promise.all([
        supabase.from('mitarbeiter').select('id, name, kategorie, lok_typen').order('name'),
        supabase.from('mitarbeiter_jahresdaten').select('jahr'),
        supabase
          .from('urlaubsantraege')
          .select('name, brauchbare_tage, erster_tag')
          .eq('status', 'genehmigt')
          .gte('erster_tag', `${jahr}-01-01`)
          .lte('erster_tag', `${jahr}-12-31`),
      ])

    const { data: jahresdatenDiesesJahr } = await supabase
      .from('mitarbeiter_jahresdaten')
      .select('id, mitarbeiter_id, urlaubsanspruch, resturlaub, resturlaub_vorjahr')
      .eq('jahr', jahr)

    const jahresdatenMap = new Map<string, Jahresdaten>()
    for (const eintrag of jahresdatenDiesesJahr ?? []) {
      jahresdatenMap.set(eintrag.mitarbeiter_id, eintrag)
    }

    const genommenMap = new Map<string, number>()
    for (const antrag of genehmigteAntraege ?? []) {
      if (!antrag.name) continue
      const schluessel = namensSignatur(antrag.name)
      genommenMap.set(schluessel, (genommenMap.get(schluessel) ?? 0) + (antrag.brauchbare_tage ?? 0))
    }

    const neueZeilen: Zeile[] = (mitarbeiterListe ?? []).map((m) => {
      const jd = jahresdatenMap.get(m.id)
      return {
        mitarbeiterId: m.id,
        name: m.name,
        kategorie: m.kategorie,
        lokTypen: m.lok_typen ?? [],
        jahresdatenId: jd?.id ?? null,
        urlaubsanspruch: jd ? jd.urlaubsanspruch : 30,
        resturlaub: jd ? jd.resturlaub : 30,
        resturlaub_vorjahr: jd ? jd.resturlaub_vorjahr : 0,
        tageGenommen: genommenMap.get(namensSignatur(m.name)) ?? 0,
      }
    })
    setZeilen(neueZeilen)

    const jahresSet = new Set<number>([jahr, new Date().getFullYear()])
    for (const eintrag of alleJahresdaten ?? []) {
      jahresSet.add(eintrag.jahr)
    }
    setVerfuegbareJahre(Array.from(jahresSet).sort((a, b) => a - b))

    setLadeVorgang(false)
  }

  useEffect(() => {
    laden()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [neuLadenAuslöser, jahr])

  function feldAendern(
    mitarbeiterId: string,
    feld: 'urlaubsanspruch' | 'resturlaub' | 'resturlaub_vorjahr',
    wert: string
  ) {
    setZeilen((vorher) =>
      vorher.map((z) =>
        z.mitarbeiterId === mitarbeiterId ? { ...z, [feld]: wert === '' ? null : Number(wert) } : z
      )
    )
  }

  async function speichern(zeile: Zeile) {
    if (zeile.jahresdatenId) {
      await supabase
        .from('mitarbeiter_jahresdaten')
        .update({
          urlaubsanspruch: zeile.urlaubsanspruch,
          resturlaub: zeile.resturlaub,
          resturlaub_vorjahr: zeile.resturlaub_vorjahr,
        })
        .eq('id', zeile.jahresdatenId)
    } else {
      const { data } = await supabase
        .from('mitarbeiter_jahresdaten')
        .insert({
          mitarbeiter_id: zeile.mitarbeiterId,
          jahr,
          urlaubsanspruch: zeile.urlaubsanspruch,
          resturlaub: zeile.resturlaub,
          resturlaub_vorjahr: zeile.resturlaub_vorjahr,
        })
        .select('id')
        .single()

      if (data) {
        setZeilen((vorher) =>
          vorher.map((z) =>
            z.mitarbeiterId === zeile.mitarbeiterId ? { ...z, jahresdatenId: data.id } : z
          )
        )
      }
    }

    setGespeichertId(zeile.mitarbeiterId)
    setTimeout(() => setGespeichertId(null), 1200)
  }

  async function kategorieAendern(zeile: Zeile, neueKategorie: string) {
    const wert = neueKategorie === '' ? null : neueKategorie
    setZeilen((vorher) =>
      vorher.map((z) =>
        z.mitarbeiterId === zeile.mitarbeiterId
          ? { ...z, kategorie: wert, lokTypen: wert === 'Lokführer' ? z.lokTypen : [] }
          : z
      )
    )
    await supabase
      .from('mitarbeiter')
      .update({ kategorie: wert, ...(wert !== 'Lokführer' ? { lok_typen: [] } : {}) })
      .eq('id', zeile.mitarbeiterId)
  }

  async function lokTypAendern(zeile: Zeile, lokTyp: string, ausgewaehlt: boolean) {
    const neueTypen = ausgewaehlt
      ? [...zeile.lokTypen, lokTyp]
      : zeile.lokTypen.filter((t) => t !== lokTyp)

    setZeilen((vorher) =>
      vorher.map((z) => (z.mitarbeiterId === zeile.mitarbeiterId ? { ...z, lokTypen: neueTypen } : z))
    )
    await supabase.from('mitarbeiter').update({ lok_typen: neueTypen }).eq('id', zeile.mitarbeiterId)
  }

  async function mitarbeiterHinzufuegen() {
    const name = neuerName.trim()
    if (!name) return
    setWirdHinzugefuegt(true)
    await supabase.from('mitarbeiter').insert({ name })
    setNeuerName('')
    setWirdHinzugefuegt(false)
    await laden()
  }

  function jahrHinzufuegen() {
    const naechstesJahr = Math.max(...verfuegbareJahre, jahr) + 1
    setVerfuegbareJahre((vorher) =>
      Array.from(new Set([...vorher, naechstesJahr])).sort((a, b) => a - b)
    )
    setJahr(naechstesJahr)
  }

  if (ladeVorgang) {
    return <p style={{ color: 'var(--text-muted)' }}>Lade Mitarbeiter...</p>
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        {verfuegbareJahre.map((j) => (
          <button
            key={j}
            onClick={() => setJahr(j)}
            style={{
              background: j === jahr ? 'var(--navy)' : 'none',
              color: j === jahr ? '#ffffff' : 'var(--text-muted)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '6px 14px',
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            {j}
          </button>
        ))}
        <button
          onClick={jahrHinzufuegen}
          title="Weiteres Jahr hinzufügen"
          style={{
            background: 'none',
            border: '1px dashed var(--border)',
            borderRadius: 6,
            padding: '6px 10px',
            fontSize: 13,
            color: 'var(--navy)',
            cursor: 'pointer',
          }}
        >
          + Jahr
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          type="text"
          placeholder="Name des neuen Mitarbeiters"
          value={neuerName}
          onChange={(e) => setNeuerName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && mitarbeiterHinzufuegen()}
          style={{
            flex: 1,
            padding: '8px 10px',
            border: '1px solid var(--border)',
            borderRadius: 6,
            fontSize: 14,
          }}
        />
        <button
          onClick={mitarbeiterHinzufuegen}
          disabled={wirdHinzugefuegt || !neuerName.trim()}
          style={{
            background: 'var(--navy)',
            color: '#ffffff',
            border: 'none',
            borderRadius: 6,
            padding: '8px 16px',
            fontSize: 14,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          + Hinzufügen
        </button>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={kopfZelleStil}>Name</th>
              <th style={kopfZelleStil}>Qualifikation</th>
              <th style={kopfZelleStil}>Lok-Typen</th>
              <th style={kopfZelleStil}>Resturlaub Vorjahr</th>
              <th style={kopfZelleStil}>Urlaubsanspruch</th>
              <th style={kopfZelleStil}>Resturlaub</th>
              <th style={kopfZelleStil}>Gesamt verfügbar</th>
              <th style={kopfZelleStil}>Urlaubstage genommen</th>
              <th style={kopfZelleStil}></th>
            </tr>
          </thead>
          <tbody>
            {zeilen.map((zeile) => (
              <tr key={zeile.mitarbeiterId}>
                <td style={zellStil}>{zeile.name}</td>
                <td style={zellStil}>
                  <select
                    value={zeile.kategorie ?? ''}
                    onChange={(e) => kategorieAendern(zeile, e.target.value)}
                    style={{ ...eingabeStil, width: 140 }}
                  >
                    <option value="">–</option>
                    {KATEGORIEN.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                </td>
                <td style={{ ...zellStil, position: 'relative' }}>
                  {zeile.kategorie === 'Lokführer' ? (
                    <>
                      <button
                        onClick={() =>
                          setOffenesLokMenue(
                            offenesLokMenue === zeile.mitarbeiterId ? null : zeile.mitarbeiterId
                          )
                        }
                        style={{
                          background: 'none',
                          border: '1px solid var(--border)',
                          borderRadius: 4,
                          padding: '4px 8px',
                          fontSize: 12,
                          cursor: 'pointer',
                          minWidth: 120,
                          textAlign: 'left',
                        }}
                      >
                        {zeile.lokTypen.length > 0 ? zeile.lokTypen.join(', ') : 'Auswählen...'}
                      </button>

                      {offenesLokMenue === zeile.mitarbeiterId && (
                        <div
                          style={{
                            position: 'absolute',
                            top: '100%',
                            left: 0,
                            zIndex: 10,
                            background: 'var(--card)',
                            border: '1px solid var(--border)',
                            borderRadius: 6,
                            padding: 8,
                            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                            minWidth: 140,
                          }}
                        >
                          {LOK_TYPEN.map((lokTyp) => (
                            <label
                              key={lokTyp}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 6,
                                fontSize: 12,
                                padding: '3px 0',
                                cursor: 'pointer',
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={zeile.lokTypen.includes(lokTyp)}
                                onChange={(e) => lokTypAendern(zeile, lokTyp, e.target.checked)}
                              />
                              {lokTyp}
                            </label>
                          ))}
                        </div>
                      )}
                    </>
                  ) : (
                    <span style={{ color: 'var(--text-muted)' }}>–</span>
                  )}
                </td>
                <td style={zellStil}>
                  <input
                    type="number"
                    value={zeile.resturlaub_vorjahr ?? ''}
                    onChange={(e) =>
                      feldAendern(zeile.mitarbeiterId, 'resturlaub_vorjahr', e.target.value)
                    }
                    onBlur={() => speichern(zeile)}
                    style={eingabeStil}
                  />
                </td>
                <td style={zellStil}>
                  <input
                    type="number"
                    value={zeile.urlaubsanspruch ?? ''}
                    onChange={(e) =>
                      feldAendern(zeile.mitarbeiterId, 'urlaubsanspruch', e.target.value)
                    }
                    onBlur={() => speichern(zeile)}
                    style={eingabeStil}
                  />
                </td>
                <td style={zellStil}>
                  <input
                    type="number"
                    value={zeile.resturlaub ?? ''}
                    onChange={(e) => feldAendern(zeile.mitarbeiterId, 'resturlaub', e.target.value)}
                    onBlur={() => speichern(zeile)}
                    style={eingabeStil}
                  />
                </td>
                <td style={{ ...zellStil, fontWeight: 600 }}>
                  {(zeile.resturlaub ?? 0) + (zeile.resturlaub_vorjahr ?? 0)}
                </td>
                <td style={zellStil}>{zeile.tageGenommen}</td>
                <td style={{ ...zellStil, color: 'var(--success)', fontSize: 12 }}>
                  {gespeichertId === zeile.mitarbeiterId ? 'Gespeichert' : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
  padding: '4px 10px',
  borderBottom: '1px solid var(--border)',
}

const eingabeStil: React.CSSProperties = {
  width: 80,
  padding: '4px 6px',
  border: '1px solid var(--border)',
  borderRadius: 4,
  fontSize: 13,
}
