export default function Kopfzeile() {
  return (
    <header
      style={{
        background: 'var(--navy)',
        padding: '16px 24px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}
    >
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
        <path d="M2 19L9 6L13 13L16 8L22 19H2Z" fill="#ffffff" />
      </svg>
      <div>
        <div style={{ color: '#ffffff', fontWeight: 600, fontSize: 16, lineHeight: 1.2 }}>
          Rail Bavaria Logistik
        </div>
        <div style={{ color: '#a8bcd8', fontSize: 12 }}>Urlaubsplan</div>
      </div>
    </header>
  )
}