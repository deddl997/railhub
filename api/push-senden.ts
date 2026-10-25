// @ts-nocheck
// Sendet Push-Benachrichtigungen an Mitarbeiter. Nur fuer angemeldete Planer (Admins).
import webpush from 'web-push'
import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ fehler: 'Nur POST erlaubt' })
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
  const vapidPublic = process.env.VITE_VAPID_PUBLIC_KEY || process.env.VAPID_PUBLIC_KEY
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY
  const vapidSubject = process.env.VAPID_SUBJECT || 'https://urlaubsplan-pink.vercel.app'

  if (!supabaseUrl || !anonKey || !vapidPublic || !vapidPrivate) {
    return res.status(500).json({
      fehler:
        'Push ist auf dem Server nicht vollständig eingerichtet (Umgebungsvariablen VITE_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY fehlen).',
    })
  }

  const authKopf = req.headers.authorization || ''
  if (!authKopf.startsWith('Bearer ')) {
    return res.status(401).json({ fehler: 'Nicht angemeldet' })
  }

  // Mit dem Token des Aufrufers arbeiten: die Datenbank-Regeln (RLS) gelten weiterhin
  const client = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authKopf } },
    auth: { persistSession: false },
  })

  const { data: istAdmin, error: adminFehler } = await client.rpc('is_admin')
  if (adminFehler || istAdmin !== true) {
    return res.status(403).json({ fehler: 'Nur Planer dürfen Benachrichtigungen senden' })
  }

  const { titel, text, mitarbeiter_ids } = req.body || {}
  if (!titel) {
    return res.status(400).json({ fehler: 'Titel fehlt' })
  }

  let abfrage = client.from('push_abos').select('id, mitarbeiter_id, endpoint, p256dh, auth')
  if (Array.isArray(mitarbeiter_ids)) {
    if (mitarbeiter_ids.length === 0) return res.status(200).json({ gesendet: 0, entfernt: 0, abos: 0 })
    abfrage = abfrage.in('mitarbeiter_id', mitarbeiter_ids)
  }
  const { data: abos, error: aboFehler } = await abfrage
  if (aboFehler) {
    return res.status(500).json({ fehler: 'Abos konnten nicht geladen werden: ' + aboFehler.message })
  }

  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate)

  let gesendet = 0
  const abgelaufen = []
  const nachricht = JSON.stringify({ titel, text: text || '', url: '/' })

  for (const abo of abos || []) {
    try {
      await webpush.sendNotification({ endpoint: abo.endpoint, keys: { p256dh: abo.p256dh, auth: abo.auth } }, nachricht)
      gesendet++
    } catch (e) {
      if (e && (e.statusCode === 404 || e.statusCode === 410)) abgelaufen.push(abo.id)
    }
  }

  if (abgelaufen.length > 0) {
    await client.from('push_abos').delete().in('id', abgelaufen)
  }

  return res.status(200).json({ gesendet, entfernt: abgelaufen.length, abos: (abos || []).length })
}
