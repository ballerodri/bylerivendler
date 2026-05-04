"use client"

import type { SVGProps } from "react"

export const Icon = {
  Arrow: (p: SVGProps<SVGSVGElement>) => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" {...p}>
      <path d="M3 8h10m0 0L9 4m4 4l-4 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  Close: (p: SVGProps<SVGSVGElement>) => (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" {...p}>
      <path d="M4 4l8 8m0-8l-8 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  ),
  ChevL: (p: SVGProps<SVGSVGElement>) => (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" {...p}>
      <path d="M11 4L6 9l5 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  ChevR: (p: SVGProps<SVGSVGElement>) => (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" {...p}>
      <path d="M7 4l5 5-5 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  Clock: (p: SVGProps<SVGSVGElement>) => (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" {...p}>
      <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1" />
      <path d="M6 3.5V6l1.7 1" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  ),
  Info: (p: SVGProps<SVGSVGElement>) => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" {...p}>
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1" />
      <path d="M7 6v3.5M7 4.2v.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  ),
  Cal: (p: SVGProps<SVGSVGElement>) => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" {...p}>
      <rect x="1.5" y="2.5" width="11" height="10" rx="1.5" stroke="currentColor" strokeWidth="1" />
      <path d="M4 1v3M10 1v3M1.5 5.5h11" stroke="currentColor" strokeWidth="1" strokeLinecap="round" />
    </svg>
  ),
  Apple: (p: SVGProps<SVGSVGElement>) => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" {...p}>
      <path d="M9.4 7.3c0-1.4 1.2-2.1 1.2-2.1-.7-1-1.7-1.1-2.1-1.1-.9-.1-1.7.5-2.2.5s-1.2-.5-2-.5c-1 0-2 .6-2.5 1.6-1.1 1.9-.3 4.6.8 6.1.5.7 1.1 1.5 2 1.5.8 0 1.1-.5 2.1-.5s1.3.5 2.1.5c.9 0 1.5-.8 2-1.5.4-.6.6-1.1.7-1.5-1.1-.4-2.1-1.4-2.1-3zM7.8 3c.4-.5.7-1.2.6-1.9-.6 0-1.3.4-1.8.9-.4.5-.7 1.2-.7 1.8.7.1 1.4-.3 1.9-.8z" fill="currentColor" />
    </svg>
  ),
  Google: (p: SVGProps<SVGSVGElement>) => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" {...p}>
      <path d="M13.4 7.1c0-.4 0-.9-.1-1.3H7v2.5h3.6c-.2.8-.6 1.5-1.3 2v1.6h2.1c1.3-1.1 2-2.8 2-4.8z" fill="#4285F4" />
      <path d="M7 13.5c1.8 0 3.3-.6 4.4-1.6L9.3 10.3c-.6.4-1.4.6-2.3.6-1.7 0-3.2-1.2-3.7-2.7H1.1v1.7c1.1 2.2 3.4 3.6 5.9 3.6z" fill="#34A853" />
      <path d="M3.3 8.2c-.2-.7-.2-1.5 0-2.2V4.3H1.1c-.9 1.7-.9 3.7 0 5.4l2.2-1.5z" fill="#FBBC04" />
      <path d="M7 3.3c1 0 1.9.3 2.6 1l1.9-1.9C10.3 1.3 8.7.5 7 .5 4.5.5 2.2 2 1.1 4.3l2.2 1.7C3.8 4.5 5.3 3.3 7 3.3z" fill="#EA4335" />
    </svg>
  ),
  CheckInk: (p: SVGProps<SVGSVGElement>) => (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" {...p}>
      <path d="M2.4 5.6L4.6 7.8L8.6 3" stroke="#F2EDE6" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  CheckSmall: (p: SVGProps<SVGSVGElement>) => (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" {...p}>
      <path d="M2 5.2L4.2 7.4L8.2 2.6" stroke="#F2EDE6" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
}

export function Wordmark() {
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="topbar__logo" src="/assets/logo-crop.png" alt="By Leri Vendler" />
}

export function Progress({ step, total = 6 }: { step: number; total?: number }) {
  return (
    <div className="progress">
      <span className="progress__label">
        Paso {String(step).padStart(2, "0")} / {String(total).padStart(2, "0")}
      </span>
      <div className="progress__bar">
        <div className="progress__fill" style={{ width: `${(step / total) * 100}%` }} />
      </div>
    </div>
  )
}

export function TopBar({
  onBack,
  onClose,
  showBack = true,
}: {
  onBack?: () => void
  onClose?: () => void
  showBack?: boolean
}) {
  return (
    <div className="topbar">
      {showBack && onBack ? (
        <button className="topbar__back" onClick={onBack} aria-label="Volver">
          <Icon.ChevL />
        </button>
      ) : (
        <div style={{ width: 40 }} />
      )}
      <Wordmark />
      {onClose ? (
        <button className="topbar__close" onClick={onClose} aria-label="Cerrar">
          <Icon.Close />
        </button>
      ) : (
        <div style={{ width: 40 }} />
      )}
    </div>
  )
}

export function Check({
  checked,
  onChange,
  children,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  children: React.ReactNode
}) {
  return (
    <label className="check">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="check__box">
        <Icon.CheckInk />
      </span>
      <span className="check__label">{children}</span>
    </label>
  )
}

export function DesktopSteps({
  steps,
  current,
  onGo,
}: {
  steps: readonly string[]
  current: number
  onGo?: (i: number) => void
}) {
  return (
    <div className="dsteps">
      {steps.map((s, i) => (
        <button
          key={i}
          className={`dstep ${i === current ? "is-active" : i < current ? "is-done" : ""}`}
          onClick={() => onGo && i <= current && onGo(i)}
        >
          <span className="dstep__n">
            {i < current ? <Icon.CheckInk /> : String(i + 1).padStart(2, "0")}
          </span>
          <span className="dstep__label">{s}</span>
        </button>
      ))}
    </div>
  )
}
