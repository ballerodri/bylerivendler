"use client"

import { useEffect, useRef, useState, useCallback } from "react"

type NewBooking = {
  id: string
  clientName: string
  serviceName: string
  startsAt: string
}

type Toast = {
  key: string
  booking: NewBooking
}

const TZ = "America/Argentina/Buenos_Aires"

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString("es-AR", {
    weekday: "short", day: "numeric", month: "short",
    hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ,
  })
}

export default function AdminNotifications() {
  const [toasts, setToasts] = useState<Toast[]>([])
  const [todayPending, setTodayPending] = useState(0)
  const sinceRef = useRef(new Date().toISOString())

  const dismissToast = useCallback((key: string) => {
    setToasts((prev) => prev.filter((t) => t.key !== key))
  }, [])

  const poll = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/notifications?since=${encodeURIComponent(sinceRef.current)}`)
      if (!res.ok) return
      const { newBookings, todayPending: tp } = await res.json()

      setTodayPending(tp)

      if (newBookings.length > 0) {
        sinceRef.current = new Date().toISOString()

        setToasts((prev) => {
          const existingKeys = new Set(prev.map((t) => t.key))
          const fresh = (newBookings as NewBooking[]).filter((b) => !existingKeys.has(b.id))
          return [...prev, ...fresh.map((b) => ({ key: b.id, booking: b }))]
        })

        // Browser notification for each new booking
        if (Notification.permission === "granted") {
          for (const b of newBookings as NewBooking[]) {
            new Notification("Nueva reserva · By Leri Vendler", {
              body: `${b.clientName} · ${b.serviceName} · ${fmtDateTime(b.startsAt)}`,
              icon: "/assets/logo-oauth.png",
              tag: b.id,
            })
          }
        }
      }
    } catch {
      // silently ignore network errors
    }
  }, [])

  useEffect(() => {
    // Request browser notification permission once
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission()
    }

    poll()
    const interval = setInterval(poll, 5 * 60_000)
    return () => clearInterval(interval)
  }, [poll])

  // Update document title with pending count
  useEffect(() => {
    const base = "Admin · By Leri Vendler"
    document.title = todayPending > 0 ? `(${todayPending}) ${base}` : base
  }, [todayPending])

  // Auto-dismiss toasts after 8 seconds
  useEffect(() => {
    if (toasts.length === 0) return
    const latest = toasts[toasts.length - 1]
    const timer = setTimeout(() => dismissToast(latest.key), 8_000)
    return () => clearTimeout(timer)
  }, [toasts, dismissToast])

  return (
    <>
      {/* Toast stack — top right */}
      {toasts.length > 0 && (
        <div style={{
          position: "fixed", top: 20, right: 20, zIndex: 9999,
          display: "flex", flexDirection: "column", gap: 10,
          maxWidth: 320, width: "calc(100vw - 40px)",
        }}>
          {toasts.map((t) => (
            <div
              key={t.key}
              style={{
                background: "#2b2623",
                color: "#f2ede6",
                borderRadius: 14,
                padding: "16px 18px",
                boxShadow: "0 8px 32px rgba(0,0,0,0.25)",
                display: "flex",
                flexDirection: "column",
                gap: 4,
                animation: "admNotifIn 0.3s ease",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                <span style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "#b68a5f", fontFamily: "Helvetica,Arial,sans-serif" }}>
                  Nueva reserva
                </span>
                <button
                  onClick={() => dismissToast(t.key)}
                  style={{ background: "none", border: "none", color: "#7a6e64", fontSize: 18, lineHeight: 1, cursor: "pointer", padding: 0, flexShrink: 0 }}
                  aria-label="Cerrar"
                >
                  ×
                </button>
              </div>
              <div style={{ fontFamily: "Georgia,serif", fontSize: 15, fontWeight: 500 }}>
                {t.booking.clientName}
              </div>
              <div style={{ fontSize: 13, color: "#b6a898", fontFamily: "Helvetica,Arial,sans-serif" }}>
                {t.booking.serviceName}
              </div>
              <div style={{ fontSize: 12, color: "#7a6e64", fontFamily: "Helvetica,Arial,sans-serif" }}>
                {fmtDateTime(t.booking.startsAt)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* WhatsApp reminder badge — bottom right */}
      {todayPending > 0 && (
        <div style={{
          position: "fixed", bottom: 24, right: 24, zIndex: 9998,
          background: "#25D366", color: "#fff",
          borderRadius: 14, padding: "12px 18px",
          boxShadow: "0 4px 20px rgba(37,211,102,0.35)",
          display: "flex", alignItems: "center", gap: 10,
          fontSize: 13, fontFamily: "Helvetica,Arial,sans-serif", fontWeight: 500,
          cursor: "default",
        }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
          </svg>
          {todayPending} turno{todayPending !== 1 ? "s" : ""} hoy · recordá enviar WA
        </div>
      )}

      <style>{`
        @keyframes admNotifIn {
          from { opacity: 0; transform: translateY(-10px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0)     scale(1);    }
        }
      `}</style>
    </>
  )
}
