import { supabase } from './lib/supabase'

const VAPID_OEFFENTLICH = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

export type PushStatus = 'aktiv' | 'aus' | 'blockiert' | 'nicht-unterstuetzt' | 'nicht-konfiguriert'

function base64ZuBytes(base64: string): Uint8Array {
  const auffuellung = '='.repeat((4 - (base64.length % 4)) % 4)
  const roh = atob((base64 + auffuellung).replace(/-/g, '+').replace(/_/g, '/'))
  const bytes = new Uint8Array(roh.length)
  for (let i = 0; i < roh.length; i++) bytes[i] = roh.charCodeAt(i)
  return bytes
}

export function pushUnterstuetzt(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

export async function pushStatus(): Promise<PushStatus> {
  if (!pushUnterstuetzt()) return 'nicht-unterstuetzt'
  if (!VAPID_OEFFENTLICH) return 'nicht-konfiguriert'
  if (Notification.permission === 'denied') return 'blockiert'
  try {
    const reg = await navigator.serviceWorker.getRegistration('/sw.js')
    const abo = reg ? await reg.pushManager.getSubscription() : null
    return abo && Notification.permission === 'granted' ? 'aktiv' : 'aus'
  } catch {
    return 'aus'
  }
}

// Gibt eine Fehlermeldung zurueck oder null bei Erfolg
export async function pushAktivieren(mitarbeiterId: string): Promise<string | null> {
  if (!pushUnterstuetzt()) return 'Dieses Gerät unterstützt keine Benachrichtigungen. Öffne die App über das Symbol auf dem Home-Bildschirm.'
  if (!VAPID_OEFFENTLICH) return 'Benachrichtigungen sind noch nicht eingerichtet (Schlüssel fehlt).'
  const erlaubnis = await Notification.requestPermission()
  if (erlaubnis !== 'granted') return 'Die Erlaubnis wurde nicht erteilt. Du kannst sie in den iPhone-Einstellungen unter Mitteilungen ändern.'
  try {
    await navigator.serviceWorker.register('/sw.js')
    const reg = await navigator.serviceWorker.ready
    let abo = await reg.pushManager.getSubscription()
    if (!abo) {
      abo = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64ZuBytes(VAPID_OEFFENTLICH) as BufferSource,
      })
    }
    const json = abo.toJSON()
    const { error } = await supabase.from('push_abos').upsert(
      {
        mitarbeiter_id: mitarbeiterId,
        endpoint: abo.endpoint,
        p256dh: json.keys?.p256dh ?? '',
        auth: json.keys?.auth ?? '',
      },
      { onConflict: 'endpoint' }
    )
    if (error) return 'Speichern fehlgeschlagen: ' + error.message
    return null
  } catch (e) {
    return 'Aktivieren fehlgeschlagen: ' + (e instanceof Error ? e.message : String(e))
  }
}

export async function pushDeaktivieren(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker.getRegistration('/sw.js')
    const abo = reg ? await reg.pushManager.getSubscription() : null
    if (abo) {
      await supabase.from('push_abos').delete().eq('endpoint', abo.endpoint)
      await abo.unsubscribe()
    }
  } catch {
    // egal
  }
}

// Nur fuer Planer: Benachrichtigung an Mitarbeiter senden (ohne Liste: an alle mit Abo)
export async function pushSenden(
  titel: string,
  text: string,
  mitarbeiterIds?: string[]
): Promise<{ ok: boolean; meldung: string }> {
  try {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) return { ok: false, meldung: 'Nicht angemeldet' }
    const antwort = await fetch('/api/push-senden', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ titel, text, mitarbeiter_ids: mitarbeiterIds }),
    })
    const ergebnis = await antwort.json().catch(() => ({}))
    if (!antwort.ok) return { ok: false, meldung: ergebnis.fehler ?? `Fehler ${antwort.status}` }
    return {
      ok: true,
      meldung: `Benachrichtigung an ${ergebnis.gesendet} von ${ergebnis.abos} Geräten gesendet.`,
    }
  } catch (e) {
    return { ok: false, meldung: e instanceof Error ? e.message : String(e) }
  }
}
