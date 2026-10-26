import { useEffect, useRef } from 'react'
import { supabase } from './lib/supabase'

/**
 * Laedt Daten selbststaendig neu, sobald sich in einer der Tabellen etwas aendert
 * (Supabase Realtime). Zusaetzlich beim Zurueckkehren in die App und alle 3 Minuten
 * als Absicherung, falls die Live-Verbindung am Handy eingeschlafen ist.
 */
export function useLiveAktualisierung(tabellen: string[], neuLaden: () => void, aktiv = true) {
  const neuLadenRef = useRef(neuLaden)
  neuLadenRef.current = neuLaden
  const schluessel = tabellen.join(',')

  useEffect(() => {
    if (!aktiv) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const ausloesen = () => {
      if (timer) clearTimeout(timer)
      // kurz warten, damit mehrere Aenderungen hintereinander nur ein Neuladen ausloesen
      timer = setTimeout(() => neuLadenRef.current(), 1200)
    }

    const kanal = supabase.channel('live-' + schluessel.replace(/,/g, '-') + '-' + Math.random().toString(36).slice(2, 8))
    for (const tabelle of schluessel.split(',')) {
      kanal.on('postgres_changes', { event: '*', schema: 'public', table: tabelle }, ausloesen)
    }
    kanal.subscribe()

    const beiSichtbar = () => {
      if (!document.hidden) ausloesen()
    }
    document.addEventListener('visibilitychange', beiSichtbar)
    window.addEventListener('online', ausloesen)
    const absicherung = setInterval(() => {
      if (!document.hidden) neuLadenRef.current()
    }, 180000)

    return () => {
      if (timer) clearTimeout(timer)
      clearInterval(absicherung)
      document.removeEventListener('visibilitychange', beiSichtbar)
      window.removeEventListener('online', ausloesen)
      supabase.removeChannel(kanal)
    }
  }, [schluessel, aktiv])
}
