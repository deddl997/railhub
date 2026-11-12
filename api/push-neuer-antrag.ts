// @ts-nocheck
// Meldet den Admins per Push, dass ein Mitarbeiter gerade einen Urlaubsantrag eingereicht hat.
// Darf jeder angemeldete Mitarbeiter ausloesen; die Datenbank liefert die Admin-Geraete nur,
// wenn der Aufrufer in den letzten Minuten selbst einen offenen Antrag angelegt hat.
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
    return res.status(500).json({ fehler: 'Push ist auf dem Server nicht vollständig eingerichtet.' })
  }

  const authKopf = req.headers.authorization || ''
  if (!authKopf.startsWith('Bearer ')) {
    return res.status(401).json({ fehler: 'Nicht angemeldet' })
  }

  const client = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authKopf } },
    auth: { persistSession: false },
  })

  const { data, error } = await client.rpc('push_abos_fuer_neuen_antrag')
  if (error) {
    return res.status(500).json({ fehler: 'Abos konnten nicht geladen werden: ' + error.message })
  }
  const abos = data || []
  if (abos.length === 0) return res.status(200).json({ gesendet: 0, abos: 0 })

  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate)
  const nachricht = JSON.stringify({
    titel: 'Neuer Urlaubsantrag',
    text: `${abos[0].antragsteller || 'Ein Mitarbeiter'} hat Urlaub beantragt.`,
    url: '/',
  })

  let gesendet = 0
  for (const abo of abos) {
    try {
      await webpush.sendNotification(
        { endpoint: abo.ep, keys: { p256dh: abo.schluessel_p256dh, auth: abo.schluessel_auth } },
        nachricht
      )
      gesendet++
    } catch (e) {
      // abgelaufene Geraete raeumt der normale Push-Versand der Planer spaeter auf
    }
  }
  return res.status(200).json({ gesendet, abos: abos.length })
}
