export default function Kopfzeile({
  angemeldeterName,
  onAbmelden,
}: {
  angemeldeterName?: string | null
  onAbmelden: () => void
}) {
  return (
    <header
      style={{
        background: 'var(--navy)',
        padding: '16px 24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
          <path d="M2 19L9 6L13 13L16 8L22 19H2Z" fill="#ffffff" />
        </svg>
        <div>
          <div style={{ color: '#ffffff', fontWeight: 600, fontSize: 16, lineHeight: 1.2 }}>
            Rail Bavaria Logistik
          </div>
          <div style={{ color: '#a8bcd8', fontSize: 12 }}>Urlaubsplan</div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {angemeldeterName && (
          <span style={{ color: '#dbe6f5', fontSize: 13 }}>{angemeldeterName}</span>
        )}
        <button
          onClick={onAbmelden}
          style={{
            background: 'rgba(255,255,255,0.1)',
            border: '1px solid rgba(255,255,255,0.3)',
            color: '#ffffff',
            borderRadius: 6,
            padding: '6px 12px',
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          Abmelden
        </button>
      </div>
    </header>
  )
}
