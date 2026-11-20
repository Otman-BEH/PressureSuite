import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { toolStorage } from './storage'
import { Button, LABEL, NumberField, Segmented, Switch } from './ui'

/*
 * Bench timer in the top bar, shared by every tab. A countdown (for holds) or a stopwatch.
 * Times are kept as wall-clock instants, not ticks, so the timer stays right when the browser throttles a
 * background tab and survives a reload. When a countdown ends it beeps three times and the screen edge flashes,
 * repeating until dismissed.
 */

type TimerMode = 'countdown' | 'stopwatch'

interface TimerState {
  mode: TimerMode
  /** Countdown length set by the user [s]. */
  durationS: number
  /** Running countdown: the instant it ends [ms since epoch]. */
  endAt: number | null
  /** Running stopwatch: the instant it would have started had it never paused [ms since epoch]. */
  startAt: number | null
  /** Paused: seconds left (countdown) or elapsed (stopwatch). */
  pausedS: number | null
  ringing: boolean
  sound: boolean
  setMode: (mode: TimerMode) => void
  setDuration: (s: number) => void
  start: () => void
  pause: () => void
  reset: () => void
  ring: () => void
  dismiss: () => void
  setSound: (sound: boolean) => void
}

const IDLE = { endAt: null, startAt: null, pausedS: null, ringing: false }
const PRESETS_MIN = [1, 5, 10, 15, 30]
/** Seconds between alarm repeats while nobody has dismissed it. */
const REPEAT_S = 10

export const useTimer = create<TimerState>()(
  persist(
    (set, get) => ({
      mode: 'countdown',
      durationS: 5 * 60,
      ...IDLE,
      sound: true,
      setMode: (mode) => set({ mode, ...IDLE }),
      setDuration: (durationS) => set({ durationS: Math.max(1, Math.round(durationS)), ...IDLE }),
      start: () => {
        const { mode, durationS, pausedS } = get()
        const now = Date.now()
        if (mode === 'countdown') set({ endAt: now + (pausedS ?? durationS) * 1000, startAt: null, pausedS: null, ringing: false })
        else set({ startAt: now - (pausedS ?? 0) * 1000, endAt: null, pausedS: null })
      },
      pause: () => {
        const { endAt, startAt } = get()
        const now = Date.now()
        if (endAt !== null) set({ endAt: null, pausedS: Math.max(0, (endAt - now) / 1000) })
        else if (startAt !== null) set({ startAt: null, pausedS: (now - startAt) / 1000 })
      },
      reset: () => set(IDLE),
      ring: () => set({ ...IDLE, ringing: true }),
      dismiss: () => set(IDLE),
      setSound: (sound) => set({ sound }),
    }),
    {
      name: 'pressuresuite:ui:timer',
      storage: toolStorage(),
      partialize: ({ mode, durationS, endAt, startAt, pausedS, ringing, sound }) => ({ mode, durationS, endAt, startAt, pausedS, ringing, sound }),
    },
  ),
)

/** Seconds shown on the display: left for a countdown, elapsed for a stopwatch. */
function shownSeconds(s: TimerState, now: number): number {
  if (s.mode === 'countdown') {
    if (s.ringing) return 0
    if (s.endAt !== null) return Math.max(0, (s.endAt - now) / 1000)
    return s.pausedS ?? s.durationS
  }
  if (s.startAt !== null) return (now - s.startAt) / 1000
  return s.pausedS ?? 0
}

/** 4:05, 12:00, 1:02:03. Countdowns round up so "0:00" only shows at the end. */
function clock(seconds: number, roundUp: boolean): string {
  const total = roundUp ? Math.ceil(seconds - 1e-6) : Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const sec = String(total % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

// One AudioContext for the page. Browsers only allow sound after a click, so it is created on Start.
let audio: AudioContext | null = null
function unlockAudio() {
  try {
    audio ??= new AudioContext()
    if (audio.state === 'suspended') void audio.resume()
  } catch {
    audio = null
  }
}

/** Three short beeps, generated in the browser (no sound files, works offline). */
function beepThrice() {
  unlockAudio()
  if (!audio) return
  const t0 = audio.currentTime + 0.05
  for (let i = 0; i < 3; i++) {
    const t = t0 + i * 0.3
    const osc = audio.createOscillator()
    const gain = audio.createGain()
    osc.type = 'square'
    osc.frequency.value = 1000
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(0.25, t + 0.01)
    gain.gain.setValueAtTime(0.25, t + 0.16)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18)
    osc.connect(gain).connect(audio.destination)
    osc.start(t)
    osc.stop(t + 0.2)
  }
}

function ClockIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="8" cy="9" r="5.5" />
      <path d="M8 6v3l2 1.5M6.5 1.5h3" />
    </svg>
  )
}

function PlayPauseIcon({ running }: { running: boolean }) {
  return running ? (
    <svg viewBox="0 0 16 16" className="size-3.5" fill="currentColor" aria-hidden="true">
      <rect x="4" y="3" width="3" height="10" />
      <rect x="9" y="3" width="3" height="10" />
    </svg>
  ) : (
    <svg viewBox="0 0 16 16" className="size-3.5" fill="currentColor" aria-hidden="true">
      <path d="M5 3l8 5-8 5z" />
    </svg>
  )
}

/** The set-up panel under the top-bar display. */
function TimerPanel({ onClose }: { onClose: () => void }) {
  const t = useTimer()
  const running = t.endAt !== null || t.startAt !== null
  const minutes = Math.floor(t.durationS / 60)
  const seconds = t.durationS % 60

  return (
    <div
      role="dialog"
      aria-label="Timer"
      className="absolute top-full right-0 z-50 mt-1 flex w-72 flex-col gap-3 border border-rule-strong bg-surface p-3 shadow-raised"
    >
      <div className="flex items-center justify-between">
        <span className={LABEL}>Timer</span>
        <button type="button" onClick={onClose} className="text-small text-muted hover:text-ink" aria-label="Close timer settings">
          Close
        </button>
      </div>
      <Segmented<TimerMode>
        label="Timer mode"
        value={t.mode}
        onChange={t.setMode}
        options={[
          { value: 'countdown', label: 'Countdown', title: 'Counts down and sounds an alarm at zero' },
          { value: 'stopwatch', label: 'Stopwatch', title: 'Counts up from Start' },
        ]}
      />
      {t.mode === 'countdown' && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <NumberField label="Minutes" value={minutes} onChange={(m) => t.setDuration(m * 60 + seconds)} min={0} max={24 * 60} digits={0} unit="min" />
            <NumberField label="Seconds" value={seconds} onChange={(s) => t.setDuration(minutes * 60 + s)} min={0} max={59} digits={0} unit="s" />
          </div>
          <div className="flex flex-wrap gap-1">
            {PRESETS_MIN.map((m) => (
              <Button key={m} variant={t.durationS === m * 60 ? 'primary' : 'secondary'} onClick={() => t.setDuration(m * 60)} className="px-2">
                {m} min
              </Button>
            ))}
          </div>
        </>
      )}
      <div className="flex items-center gap-2">
        <Button
          variant="primary"
          onClick={() => {
            if (running) t.pause()
            else {
              unlockAudio()
              t.start()
            }
          }}
        >
          {running ? 'Pause' : t.pausedS !== null ? 'Resume' : 'Start'}
        </Button>
        <Button onClick={t.reset}>Reset</Button>
        {t.mode === 'countdown' && (
          <label className="ml-auto flex items-center gap-2 text-small text-muted">
            Sound
            <Switch checked={t.sound} onChange={t.setSound} label="Alarm sound" />
          </label>
        )}
      </div>
      {t.mode === 'countdown' && (
        <p className="text-small text-muted">At zero: three beeps and a flashing screen edge, repeated every {REPEAT_S} s until you dismiss it.</p>
      )}
    </div>
  )
}

/**
 * Top-bar timer: the display (click to set up), a start/pause button, and the alarm while a countdown has ended.
 * It also owns the page title, so the time left shows on the browser tab.
 */
export function TopBarTimer({ title }: { title: string }) {
  const t = useTimer()
  const running = t.endAt !== null || t.startAt !== null
  const [now, setNow] = useState(Date.now)
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  // Tick while running; a countdown that passes its end (also while the page was closed) starts ringing.
  useEffect(() => {
    if (!running) return
    const tick = () => {
      const n = Date.now()
      setNow(n)
      const s = useTimer.getState()
      if (s.endAt !== null && n >= s.endAt) s.ring()
    }
    tick()
    const id = setInterval(tick, 250)
    return () => clearInterval(id)
  }, [running])

  // Alarm: three beeps now and every REPEAT_S seconds until dismissed.
  useEffect(() => {
    if (!t.ringing || !t.sound) return
    beepThrice()
    const id = setInterval(beepThrice, REPEAT_S * 1000)
    return () => clearInterval(id)
  }, [t.ringing, t.sound])

  // Close the panel on an outside click or Escape; Escape also dismisses a ringing alarm.
  useEffect(() => {
    const onDown = (e: PointerEvent) => open && box.current && !box.current.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setOpen(false)
      if (useTimer.getState().ringing) useTimer.getState().dismiss()
    }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const seconds = shownSeconds(t, now)
  const display = clock(seconds, t.mode === 'countdown')
  const active = running || t.pausedS !== null

  useEffect(() => {
    document.title = t.ringing ? `TIME UP · ${title}` : running ? `${display} · ${title}` : title
  }, [t.ringing, running, display, title])

  return (
    <div ref={box} className="relative ml-auto flex items-center gap-1">
      {t.ringing && <div className="timer-flash pointer-events-none fixed inset-0 z-40 border-8 border-crit" aria-hidden="true" />}
      {t.ringing ? (
        <div role="alert" className="timer-flash-bg flex h-7 items-center gap-2 rounded-control bg-crit px-2 text-on-accent">
          <ClockIcon className="size-4" />
          <span className="font-mono text-body font-semibold">Time up</span>
          <button
            type="button"
            onClick={t.dismiss}
            className="rounded-control border border-on-accent px-2 text-small font-medium hover:bg-crit-ink"
          >
            Dismiss
          </button>
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-expanded={open}
            title={t.mode === 'countdown' ? 'Countdown timer: click to set the time' : 'Stopwatch: click for options'}
            className={`flex h-7 items-center gap-1.5 rounded-control border px-2 hover:border-accent ${
              active ? 'border-rule-strong bg-inset text-ink' : 'border-rule bg-surface text-muted'
            }`}
          >
            <ClockIcon className="size-4" />
            <span className="min-w-[3.5em] text-right font-mono text-body tabular-nums">{display}</span>
            {t.mode === 'stopwatch' && <span className="text-label text-muted uppercase">SW</span>}
          </button>
          <button
            type="button"
            onClick={() => {
              if (running) t.pause()
              else {
                unlockAudio()
                t.start()
              }
            }}
            aria-label={running ? 'Pause timer' : 'Start timer'}
            title={running ? 'Pause' : 'Start'}
            className={`grid size-7 place-items-center rounded-control border ${
              running ? 'border-rule-strong bg-inset text-ink hover:border-accent' : 'border-accent bg-accent text-on-accent hover:bg-accent-hover'
            }`}
          >
            <PlayPauseIcon running={running} />
          </button>
        </>
      )}
      {open && !t.ringing && <TimerPanel onClose={() => setOpen(false)} />}
    </div>
  )
}
