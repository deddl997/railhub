import type { ReactNode } from 'react'

// Einfache Linien-Symbole für Menü und Kopfleiste
function Svg({ groesse = 20, children }: { groesse?: number; children: ReactNode }) {
  return (
    <svg
      width={groesse}
      height={groesse}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      {children}
    </svg>
  )
}

type P = { groesse?: number }

export const SymbolStart = ({ groesse }: P) => (
  <Svg groesse={groesse}>
    <path d="M3 11l9-8 9 8" />
    <path d="M5 10v10h14V10" />
    <path d="M10 20v-6h4v6" />
  </Svg>
)

export const SymbolKalender = ({ groesse }: P) => (
  <Svg groesse={groesse}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" />
    <path d="M8 14h2M12 14h2M16 14h.01M8 17.5h2M12 17.5h2" />
  </Svg>
)

export const SymbolAuftrag = ({ groesse }: P) => (
  <Svg groesse={groesse}>
    <rect x="5" y="3" width="14" height="18" rx="2" />
    <path d="M9 3h6v3H9zM9 11h6M9 15h6" />
  </Svg>
)

export const SymbolEuro = ({ groesse }: P) => (
  <Svg groesse={groesse}>
    <path d="M17 6.5A6 6 0 1 0 17 17.5" />
    <path d="M5 10h9M5 14h9" />
  </Svg>
)

export const SymbolBlitz = ({ groesse }: P) => (
  <Svg groesse={groesse}>
    <path d="M13 2L5 13h6l-1 9 8-11h-6z" />
  </Svg>
)

export const SymbolPersonen = ({ groesse }: P) => (
  <Svg groesse={groesse}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6" />
    <path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.4c2.2.7 3.5 2.6 3.5 5.6" />
  </Svg>
)

export const SymbolKarte = ({ groesse }: P) => (
  <Svg groesse={groesse}>
    <path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z" />
    <circle cx="12" cy="10" r="2.3" />
  </Svg>
)

export const SymbolAntrag = ({ groesse }: P) => (
  <Svg groesse={groesse}>
    <path d="M6 3h8l5 5v13H6z" />
    <path d="M14 3v5h5M9 13h6M9 17h6" />
  </Svg>
)

export const SymbolListe = ({ groesse }: P) => (
  <Svg groesse={groesse}>
    <path d="M8 6h13M8 12h13M8 18h13" />
    <path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
  </Svg>
)

export const SymbolDiagramm = ({ groesse }: P) => (
  <Svg groesse={groesse}>
    <path d="M4 20V10M10 20V4M16 20v-8M22 20H2" />
  </Svg>
)

export const SymbolSchluessel = ({ groesse }: P) => (
  <Svg groesse={groesse}>
    <circle cx="8" cy="15" r="4" />
    <path d="M11 12l9-9M16 7l3 3M14 9l2 2" />
  </Svg>
)

export const SymbolAbmelden = ({ groesse }: P) => (
  <Svg groesse={groesse}>
    <path d="M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5" />
    <path d="M16 8l4 4-4 4M20 12H9" />
  </Svg>
)

export const SymbolPfeilRunter = ({ groesse }: P) => (
  <Svg groesse={groesse}>
    <path d="M6 9l6 6 6-6" />
  </Svg>
)

export const SymbolSchild = ({ groesse }: P) => (
  <Svg groesse={groesse}>
    <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
    <path d="M9 12l2 2 4-4" />
  </Svg>
)
