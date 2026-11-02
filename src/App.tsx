import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  BatteryCharging,
  Bot,
  Car,
  Cog,
  Gauge,
  Leaf,
  Wrench,
  Mic,
  Moon,
  Pause,
  Play,
  Send,
  Sun,
  Thermometer,
  Trash2,
  Truck,
  Volume2,
  VolumeX,
  Volume,
  Zap,
  ChevronLeft,
  ChevronRight,
  X,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import './App.css'
import { LanguageProvider, useLanguage } from './i18n/LanguageContext'
import { formatHeaderDate, formatHeaderTime } from './i18n/translations'
import type { Language, TranslationKey } from './i18n/translations'
import { TelemetryProvider, useTelemetry } from './telemetry/useTelemetry'
import { useLiveMeter, useTweenedText } from './telemetry/useLiveMeter'
import type { MeterTrend } from './telemetry/useLiveMeter'
import { SPEED_MAX, SPEED_MIN, useSimulatedSpeed } from './telemetry/useSimulatedSpeed'

import { useVoiceAssistant } from './telemetry/useVoiceAssistant'
import { useAssistantChat } from './telemetry/useAssistantChat'
import { cancelSpeech, isVoiceOutputEnabled, speakOnce } from './telemetry/speechController'
import { diag } from './lib/diagnostics'
import { DriverModePanel } from './DriverMode'

type Theme = 'dark' | 'light'

const sparkPath = 'M2 30 L14 25 L24 27 L36 18 L48 22 L60 11 L72 24 L84 18 L96 22 L108 16 L120 19 L132 12 L146 18'

const gaugeTicks = Array.from({ length: 17 }, (_, index) => index)

const recoveryStages = [
  { name: 'EXHAUST GAS OUTLET', color: 'thermal', description: 'Hot exhaust gases enter the energy recovery system here.', purpose: 'Routes the engine exhaust stream into the connected recovery path.', principle: 'Exhaust flow carries heat and pressure away from the engine and into the energy recovery system.', input: 'Hot exhaust gases from the engine', output: 'Hot exhaust gases entering the recovery module', importance: 'Provides the waste energy source used by the recovery system.' },
  { name: 'ENERGY RECOVERY MODULE', color: 'mechanical', description: 'Captures and converts otherwise wasted exhaust energy into usable electrical energy.', purpose: 'Transfers exhaust heat through the connected recovery mechanism and converts recovered energy into electrical power.', principle: 'Thermal energy is captured from the exhaust, converted through the mechanical assembly, and passed to the electrical conversion path.', input: 'Hot exhaust energy from the outlet', output: 'Recovered electrical energy for battery storage', importance: 'Turns exhaust energy that would otherwise be lost into useful vehicle power.' },
  { name: 'BATTERY STORAGE SYSTEM', color: 'stored', description: 'Stores the recovered electrical energy for future use.', purpose: 'Adds recovered electrical energy to the vehicle battery.', principle: 'Controlled charging current stores energy electrochemically in the battery cells.', input: 'Conditioned recovered electrical power', output: 'Stored electrical energy', importance: 'Makes recovered energy available to the vehicle after it has been generated.' },
] as const

const chartTabs = ['rpm', 'temperature', 'pressure', 'recoveredPower', 'batteryCharge'] as const
type ChartTab = (typeof chartTabs)[number]

const chartTabLabels: Record<ChartTab, TranslationKey> = {
  rpm: 'chart.rpm',
  temperature: 'chart.temperature',
  pressure: 'chart.pressure',
  recoveredPower: 'chart.recoveredPower',
  batteryCharge: 'energy.batteryCharge',
}

const assistantChips = ['batteryEta', 'rpm', 'temperature', 'pressure', 'allSystems'] as const
type AssistantChip = (typeof assistantChips)[number]

const assistantChipLabels: Record<AssistantChip, TranslationKey> = {
  batteryEta: 'assistant.batteryEta',
  rpm: 'chart.rpm',
  temperature: 'chart.temperature',
  pressure: 'chart.pressure',
  allSystems: 'assistant.allSystems',
}

const GREETING_EN =
  "Hello! I'm Turbo AI, your intelligent energy assistant. How can I help you today? You can ask me about battery charging time, engine RPM, exhaust temperature, or pressure."
const GREETING_HI =
  'नमस्ते! मैं टर्बो AI हूँ, आपका स्मार्ट ऊर्जा सहायक। मैं आपकी क्या मदद कर सकता हूँ? आप मुझसे बैटरी चार्ज होने के समय, इंजन RPM, एग्जॉस्ट तापमान या दबाव के बारे में पूछ सकते हैं।'

/* ================= Main App ================= */

function App() {
  return (
    <LanguageProvider>
      <TelemetryProvider>
        <Dashboard />
      </TelemetryProvider>
    </LanguageProvider>
  )
}

function Dashboard() {
  const { language } = useLanguage()
  const [theme, setTheme] = useState<Theme>(() => {
    return localStorage.getItem('thermos-theme') === 'light' ? 'light' : 'dark'
  })
  const [volume, setVolume] = useState<number>(() => {
    const saved = localStorage.getItem('thermos-volume')
    const v = saved ? parseInt(saved, 10) : 70
    return Number.isFinite(v) && v >= 0 && v <= 100 ? v : 70
  })
  const [isMute, setIsMute] = useState<boolean>(() => localStorage.getItem('thermos-mute') === 'true')
  const [driverModeOpen, setDriverModeOpen] = useState(false)
  const [isGraphOpen, setIsGraphOpen] = useState(false)
  const [isEcoOpen, setIsEcoOpen] = useState(false)

  useEffect(() => {
    localStorage.setItem('thermos-theme', theme)
  }, [theme])
  useEffect(() => {
    localStorage.setItem('thermos-volume', String(volume))
  }, [volume])
  useEffect(() => {
    localStorage.setItem('thermos-mute', String(isMute))
  }, [isMute])

  const effectiveVolume = isMute ? 0 : volume

  return (
    <main className="dashboard" data-theme={theme} data-lang={language}>
      <TopStatusBar theme={theme} onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')} volume={effectiveVolume} setVolume={setVolume} isMute={isMute} setIsMute={setIsMute} onOpenDriver={() => setDriverModeOpen(true)} onOpenEco={() => setIsEcoOpen(true)} />
      <section className="dashboard-grid">
        <LeftTelemetry />
        <section className="center-stack">
          <EnergyRecoveryPanel />
        </section>
        <AIAssistantPanel volume={effectiveVolume} />
      </section>
      <DiagnosticFooter />
      {isGraphOpen && <TelemetryChart onClose={() => setIsGraphOpen(false)} />}
      {isEcoOpen && <EcoModePanel onClose={() => setIsEcoOpen(false)} />}
      {driverModeOpen && (
        <DriverModePanel onClose={() => setDriverModeOpen(false)} volume={effectiveVolume} />
      )}
    </main>
  )
}

/* ================= Top Status Bar ================= */

function TopStatusBar({ theme, onToggleTheme, volume, setVolume, isMute, setIsMute, onOpenDriver, onOpenEco }: { theme: Theme; onToggleTheme: () => void; volume: number; setVolume: (v: number) => void; isMute: boolean; setIsMute: (m: boolean) => void; onOpenDriver: () => void; onOpenEco: () => void }) {
  const { language, setLanguage, t } = useLanguage()
  const [now, setNow] = useState(() => new Date())
  const [volumeOpen, setVolumeOpen] = useState(false)
  const volumeRef = useRef<HTMLDivElement>(null)

  // Immediately mute current audible output when muted
  useEffect(() => {
    if (isMute) cancelSpeech('muted')
  }, [isMute])

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (volumeRef.current && !volumeRef.current.contains(e.target as Node)) {
        setVolumeOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">
          <Leaf size={35} />
        </div>
        <div>
          <div className="brand-title">
            TURBO <span>AI</span>
          </div>
          <div className="brand-subtitle">
            {t('header.subtitle')} <i />
          </div>
        </div>
      </div>

      <div className="topbar-center">
        <div className="status-pill">
          <span className="status-dot" />
          {t('header.systemOnline')}
        </div>
        <div className="car-window" aria-hidden="true">
          <svg viewBox="0 0 210 64">
            <path className="car-glow" d="M24 45 C57 31, 74 20, 119 19 C150 19, 171 28, 189 43" />
            <path d="M35 43 L55 26 L112 20 L143 29 L167 43 Z" />
            <path d="M67 27 L92 24 L90 40 L49 41 Z" />
            <path d="M99 24 L121 25 L140 39 L96 40 Z" />
            <circle cx="67" cy="45" r="9" />
            <circle cx="151" cy="45" r="9" />
            <path d="M18 49 H195" />
          </svg>
        </div>
        <div className="clock-block">
          <span>{formatHeaderDate(language, now)}</span>
          <strong>{formatHeaderTime(language, now)}</strong>
        </div>
      </div>

      <button className="eco-button" type="button" onClick={onOpenEco} aria-label="ECO Mode" title="ECO Mode">
        <span className="eco-icon" aria-hidden="true">
          <Gauge size={22} />
          <Leaf className="eco-leaf" size={12} />
        </span>
        ECO
      </button>

      <div className="topbar-actions">
        <div className="language-switch">
          <button
            type="button"
            className={language === 'en' ? 'active' : ''}
            aria-pressed={language === 'en'}
            onClick={() => setLanguage('en')}
          >
            EN
          </button>
          <button
            type="button"
            className={language === 'hi' ? 'active' : ''}
            aria-pressed={language === 'hi'}
            onClick={() => setLanguage('hi')}
          >
            हिंदी
          </button>
        </div>
        <div ref={volumeRef} className="volume-control">
          <button
            type="button"
            className="icon-button"
            aria-label={isMute ? (language === 'hi' ? 'अनम्यूट' : 'Unmute') : (language === 'hi' ? 'म्यूट' : 'Mute')}
            title={isMute ? (language === 'hi' ? 'अनम्यूट' : 'Unmute') : (language === 'hi' ? 'म्यूट' : 'Mute')}
            onClick={() => setVolumeOpen(v => !v)}
          >
            {isMute || volume === 0 ? <VolumeX size={22} /> : volume < 30 ? <Volume size={22} /> : <Volume2 size={22} />}
          </button>
          {volumeOpen && (
            <div className="volume-popover">
              <div className="volume-row">
                <span className="volume-label">{isMute || volume === 0 ? (language === 'hi' ? 'म्यूट' : 'Muted') : `${volume}%`}</span>
                <button
                  type="button"
                  className="icon-button small"
                  onClick={() => setIsMute(!isMute)}
                  aria-label={isMute ? (language === 'hi' ? 'अनम्यूट' : 'Unmute') : (language === 'hi' ? 'म्यूट' : 'Mute')}
                >
                  {isMute ? <VolumeX size={16} /> : <Volume2 size={16} />}
                </button>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={volume}
                onChange={(e) => setVolume(parseInt(e.target.value, 10))}
                className="volume-slider"
                aria-label={language === 'hi' ? 'आवाज़' : 'Volume'}
              />
            </div>
          )}
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label={language === 'hi' ? 'डriver मोड' : 'Driver Mode'}
          title={language === 'hi' ? 'डriver मोड' : 'Driver Mode'}
          onClick={onOpenDriver}
          style={{ color: 'var(--amber)' }}
        >
          <Truck size={22} />
        </button>
        <IconButton label={t('header.switchTheme')} onClick={onToggleTheme}>
          {theme === 'dark' ? <Sun size={21} /> : <Moon size={21} />}
        </IconButton>
      </div>
    </header>
  )
}

function IconButton({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode
  label: string
  onClick?: () => void
}) {
  return (
    <button className="icon-button" type="button" aria-label={label} title={label} onClick={onClick}>
      {children}
    </button>
  )
}

/* ================= Left Telemetry ================= */

type MeterZone = 'normal' | 'warning' | 'critical'

/** Zone thresholds: [warning starts, critical starts]; battery is reversed (low is bad). */
function zoneFor(value: number, [warning, critical]: [number, number], reversed = false): MeterZone {
  if (reversed) return value <= critical ? 'critical' : value <= warning ? 'warning' : 'normal'
  return value >= critical ? 'critical' : value >= warning ? 'warning' : 'normal'
}

function LeftTelemetry() {
  const { t } = useLanguage()
  const { telemetry, isPaused } = useTelemetry()
  const [battery, batteryTrend] = useLiveMeter(telemetry.batteryCharge, { jitter: 0.2, min: 0, max: 100, paused: isPaused })
  const [rpm, rpmTrend] = useLiveMeter(telemetry.rpm, { jitter: 90, min: 0, max: 6000, paused: isPaused })
  const [temperature, temperatureTrend] = useLiveMeter(telemetry.temperatureCelsius, { jitter: 3, min: 0, max: 350, paused: isPaused })
  const [pressure, pressureTrend] = useLiveMeter(telemetry.pressureBar, { jitter: 0.05, min: 0, max: 3, paused: isPaused })

  return (
    <aside className="left-column">
      <MeterCard
        icon={<BatteryCharging size={22} />}
        title={t('telemetry.battery')}
        tone="green"
        value={battery}
        decimals={0}
        unit="%"
        max={100}
        scale={['0', '100']}
        zone={zoneFor(battery, [50, 20], true)}
        trend={batteryTrend}
      />
      <MeterCard
        icon={<Cog size={22} />}
        title={t('telemetry.engineRpm')}
        tone="green"
        value={rpm}
        decimals={0}
        unit="RPM"
        max={6000}
        scale={['0', '6K']}
        zone={zoneFor(rpm, [3000, 4500])}
        trend={rpmTrend}
      />
      <MeterCard
        icon={<Thermometer size={22} />}
        title={t('telemetry.exhaustTemperature')}
        tone="amber"
        value={temperature}
        decimals={0}
        unit="°C"
        max={350}
        scale={['0', '350']}
        zone={zoneFor(temperature, [220, 280])}
        trend={temperatureTrend}
      />
      <MeterCard
        icon={<Activity size={22} />}
        title={t('telemetry.exhaustPressure')}
        tone="cyan"
        value={pressure}
        decimals={1}
        unit="bar"
        max={3}
        scale={['0', '3']}
        zone={zoneFor(pressure, [2.2, 2.6])}
        trend={pressureTrend}
      />
    </aside>
  )
}

function MeterCard({
  icon,
  title,
  tone,
  value,
  decimals,
  unit,
  max,
  scale,
  zone,
  trend,
}: {
  icon: React.ReactNode
  title: string
  tone: 'green' | 'amber' | 'cyan'
  value: number
  decimals: number
  unit: string
  max: number
  scale: [string, string]
  zone: MeterZone
  trend: MeterTrend
}) {
  const pct = Math.min(1, Math.max(0, value / max))
  const valueRef = useTweenedText<HTMLElement>(value, decimals)
  return (
    <article className={`panel telemetry telemetry-${tone}`}>
      <div className={`meter-card tone-${tone} zone-${zone} trend-${trend}`}>
        <div className="meter-title">
          <span className="meter-icon">{icon}</span>
          <h2>{title}</h2>
        </div>
        <div className="meter-body">
          <div className="meter-gauge" role="meter" aria-label={title} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Number(value.toFixed(decimals))}>
            <svg viewBox="0 6 200 102" aria-hidden="true">
              <path className="meter-track" d="M20 100 A80 80 0 0 1 180 100" />
              <path className="meter-fill" d="M20 100 A80 80 0 0 1 180 100" pathLength={100} style={{ strokeDasharray: `${pct * 100} 100` }} />
              {gaugeTicks.map((tick) => (
                <line key={tick} className="tick" x1="100" y1="34" x2="100" y2={tick % 4 === 0 ? 44 : 40} transform={`rotate(${-90 + tick * 11.25} 100 100)`} />
              ))}
              <line className="meter-needle" x1="100" y1="100" x2="100" y2="38" style={{ transform: `rotate(${-90 + pct * 180}deg)` }} />
              <circle className="meter-hub" cx="100" cy="100" r="6" />
            </svg>
            <span className="meter-scale min">{scale[0]}</span>
            <span className="meter-scale max">{scale[1]}</span>
          </div>
        </div>
        <div className="meter-value">
          <strong ref={valueRef} />
          <span>{unit}</span>
        </div>
      </div>
    </article>
  )
}

function Sparkline({ tone }: { tone: 'green' | 'cyan' | 'red' }) {
  return (
    <svg className={`sparkline ${tone}`} viewBox="0 0 150 42" preserveAspectRatio="none" aria-hidden="true">
      <path className="spark-grid" d="M0 10 H150 M0 24 H150 M0 38 H150" />
      <path className="spark-path" d={sparkPath} />
    </svg>
  )
}

/* ================= Energy Recovery Panel ================= */

function EnergyRecoveryPanel() {
  const { t } = useLanguage()
  const { telemetry } = useTelemetry()
  return (
    <article className="panel energy-panel">
      <div className="panel-heading">
        <div className="heading-title">
          <Cog size={24} />
          <h2>{t('energy.title')}</h2>
        </div>
        <span className="badge active">
          <span className="status-dot" />
          {t('energy.simulationActive')}
        </span>
      </div>
      <EnergyFlowArt telemetry={telemetry} />
      <div className="metric-row single">
        <MetricCard
          icon={<Zap size={35} />}
          label={t('energy.recoveredPower')}
          value={`${telemetry.recoveredPowerWatts} W`}
          tone="amber"
          spark
        />
      </div>
    </article>
  )
}

function EnergyFlowArt({ telemetry }: { telemetry: import('./telemetry/types').TelemetryData }) {
  const [selectedStage, setSelectedStage] = useState<number | null>(null)
  const flowArtRef = useRef<HTMLDivElement>(null)
  const selected = selectedStage === null ? null : recoveryStages[selectedStage]
  const selectRelative = (direction: -1 | 1) => setSelectedStage((current) => current === null ? (direction === 1 ? 0 : recoveryStages.length - 1) : (current + direction + recoveryStages.length) % recoveryStages.length)
  const hitAreas = [[0, 150], [355, 170], [674, 146]] as const
  // Drive visual effects from telemetry using inline styles / CSS variables
  const heatInt = Math.min(1, telemetry.temperatureCelsius / 350)
  const particleSpeed = Math.min(1, telemetry.recoveredPowerWatts / 800)
  const glow = Math.min(1, telemetry.recoveredPowerWatts / 800)
  const batteryFill = Math.min(1, telemetry.batteryCharge / 100)

  useEffect(() => {
    const art = flowArtRef.current
    const svg = art?.querySelector('svg')
    if (!art || !svg) return

    const updateCallouts = () => {
      const { width, height } = svg.getBoundingClientRect()
      if (!width || !height) return
      const scale = Math.min(width / 820, height / 310)
      const offsetX = (width - 820 * scale) / 2
      const offsetY = (height - 310 * scale) / 2
      const positions = {
        exhaust: { x: 75, y: 92 },
        module: { x: 445, y: 108 },
        battery: { x: 732, y: 92 },
      }
      for (const [name, point] of Object.entries(positions)) {
        art.style.setProperty(`--callout-${name}-x`, `${offsetX + point.x * scale}px`)
        art.style.setProperty(`--callout-${name}-y`, `${offsetY + point.y * scale}px`)
      }
    }

    updateCallouts()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateCallouts)
    observer?.observe(art)
    window.addEventListener('resize', updateCallouts)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', updateCallouts)
    }
  }, [])

  return (
    <div
      ref={flowArtRef}
      className="flow-art"
      style={
        {
          '--heat-intensity': heatInt,
          '--particle-speed': particleSpeed,
          '--electrical-glow': glow,
          '--battery-fill': batteryFill,
        } as React.CSSProperties
      }
    >
      <div className="stage-hotspots" aria-label="Energy recovery components">
        <span className="stage-connector exhaust" aria-hidden="true" />
        <span className="stage-connector module" aria-hidden="true" />
        <span className="stage-connector battery" aria-hidden="true" />
        {recoveryStages.map((stage, index) => <button key={stage.name} type="button" className={`stage-hotspot ${stage.color}${selectedStage === index ? ' active' : ''}`} aria-label={`Component ${String(index + 1).padStart(2, '0')}: ${stage.name}`} aria-pressed={selectedStage === index} onClick={() => setSelectedStage(index)} title={stage.name}>
          <span>{String(index + 1).padStart(2, '0')}</span><strong>{stage.name}</strong>
        </button>)}
      </div>
      <svg viewBox="0 0 820 310" role="group" aria-label="Connected exhaust heat recovery pipeline">
        <defs>
          <linearGradient id="engineMetal" x1="0%" x2="100%">
            <stop offset="0%" stopColor="#182624" />
            <stop offset="45%" stopColor="#6e7d77" />
            <stop offset="100%" stopColor="#15211f" />
          </linearGradient>
          <linearGradient id="heatRibbon" x1="0%" x2="100%">
            <stop offset="0%" stopColor="#ff4b2f" />
            <stop offset="55%" stopColor="#ffb547" />
            <stop offset="100%" stopColor="#22f5a0" />
          </linearGradient>
          <linearGradient id="electricRibbon" x1="0%" x2="100%">
            <stop offset="0%" stopColor="#24d9f2" />
            <stop offset="100%" stopColor="#48ff91" />
          </linearGradient>
          <filter id="energyGlow" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="6" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <g className={`engine${selectedStage === 0 ? ' selected-part' : ''}`}>
          <rect x="18" y="150" width="118" height="58" rx="8" fill="url(#engineMetal)" />
          <rect x="37" y="115" width="78" height="42" rx="8" fill="#0c1715" stroke="#49645f" />
          <path d="M18 182 H0 M45 208 V240 H110 V208 M69 116 V96 H108 V116" stroke="#566b66" strokeWidth="8" fill="none" />
          <g stroke="#17211f" strokeWidth="5">
            <line x1="32" y1="154" x2="32" y2="207" />
            <line x1="58" y1="154" x2="58" y2="207" />
            <line x1="84" y1="154" x2="84" y2="207" />
            <line x1="110" y1="154" x2="110" y2="207" />
          </g>
        </g>

        <g className={`energy-ribbons${selectedStage === 1 ? ' selected-part' : ''}`} filter="url(#energyGlow)">
          <path className="heat heat-one" d="M112 155 C175 101, 245 133, 304 156 C343 171, 377 174, 410 162" />
          <path className="heat heat-two" d="M116 178 C184 142, 248 156, 312 177 C347 188, 382 188, 415 177" />
          <path className="heat heat-three" d="M118 201 C185 189, 255 195, 321 201 C360 205, 387 202, 416 193" />
          <path className="electric" d="M485 170 C560 148, 614 151, 688 166" />
          <path className="electric electric-two" d="M486 192 C560 191, 611 188, 688 178" />
        </g>

        <g className="particles">
          {Array.from({ length: 24 }, (_, index) => (
            <circle
              key={index}
              cx={150 + index * 22}
              cy={122 + (index % 5) * 22}
              r={index % 3 === 0 ? 2.3 : 1.5}
              style={{ animationDuration: `${2 + index * 0.15}s` }}
            />
          ))}
        </g>

        <g className={`module${selectedStage === 1 ? ' selected-part' : ''}`}>
          <ellipse cx="445" cy="176" rx="61" ry="69" fill="#081411" stroke="#4b6b62" strokeWidth="4" />
          <rect x="386" y="112" width="116" height="126" rx="22" fill="url(#engineMetal)" stroke="#1c6c5a" strokeWidth="4" />
          <rect x="404" y="126" width="78" height="98" rx="13" fill="#12211e" stroke="#758b82" />
          <g stroke="#ffb547" strokeWidth="2">
            <circle cx="420" cy="150" r="5" />
            <circle cx="465" cy="150" r="5" />
            <circle cx="420" cy="199" r="5" />
            <circle cx="465" cy="199" r="5" />
          </g>
          <path d="M505 175 H560" stroke="#24d9f2" strokeWidth="8" />
        </g>

        <g className={`battery-art${selectedStage === 2 ? ' selected-part' : ''}`}>
          <rect x="676" y="113" width="112" height="126" rx="14" fill="#0a1b18" stroke="#2effa7" strokeWidth="4" />
          <rect x="704" y="96" width="56" height="18" rx="5" fill="#0a1b18" stroke="#2effa7" strokeWidth="4" />
          <rect x="696" y="134" width="18" height="84" rx="4" />
          <rect x="725" y="134" width="18" height="84" rx="4" />
          <rect x="754" y="134" width="18" height={`${84 * (telemetry.batteryCharge / 100)}`} rx="4" />
          <path d="M646 175 H677" stroke="#48ff91" strokeWidth="10" />
        </g>

        <g className="stage-hitboxes">
          {recoveryStages.map((stage, index) => <rect key={stage.name} x={hitAreas[index][0]} y="86" width={hitAreas[index][1]} height="166" className={`svg-stage-hit${selectedStage === index ? ' active' : ''}`} aria-hidden="true" onClick={() => setSelectedStage(index)} />)}
        </g>
      </svg>
      {selected && selectedStage !== null && <div className="stage-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedStage(null) }}>
        <section className="stage-dialog" role="dialog" aria-modal="true" aria-labelledby="stage-dialog-title">
          <header className="stage-dialog-header"><div className={`stage-dialog-icon ${selected.color}`}>{String(selectedStage + 1).padStart(2, '0')}</div><div><span>COMPONENT {String(selectedStage + 1).padStart(2, '0')} / {String(recoveryStages.length).padStart(2, '0')}</span><h3 id="stage-dialog-title">{selected.name}</h3></div><button type="button" aria-label="Close information panel" className="stage-close" onClick={() => setSelectedStage(null)}><X size={19} /></button></header>
          <p className="stage-description">{selected.description}</p><div className="stage-facts">
            <div><span>MAIN PURPOSE</span><p>{selected.purpose}</p></div><div><span>WORKING PRINCIPLE</span><p>{selected.principle}</p></div><div><span>INPUT</span><p>{selected.input}</p></div><div><span>OUTPUT</span><p>{selected.output}</p></div><div className="stage-importance"><span>WHY IT MATTERS</span><p>{selected.importance}</p></div>
          </div><footer className="stage-dialog-footer"><button type="button" onClick={() => selectRelative(-1)}><ChevronLeft size={17} />Previous</button><span>COMPONENT {String(selectedStage + 1).padStart(2, '0')} / {String(recoveryStages.length).padStart(2, '0')}</span><button type="button" onClick={() => selectRelative(1)}>Next<ChevronRight size={17} /></button></footer>
        </section>
      </div>}
    </div>
  )
}

export function MetricCard({
  icon,
  label,
  value,
  tone,
  spark,
  progress,
  progressValue,
}: {
  icon: React.ReactNode
  label: string
  value: string
  tone: 'green' | 'cyan' | 'amber'
  spark?: boolean
  progress?: boolean
  progressValue?: number
}) {
  return (
    <div className={`metric-card ${tone}`}>
      <div className="metric-icon">{icon}</div>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        {spark && <Sparkline tone={tone === 'amber' ? 'green' : 'cyan'} />}
        {progress && (
          <div className="bar">
            <i style={{ width: `${Math.min(100, Math.max(0, progressValue ?? 68))}%` }} />
          </div>
        )}
      </div>
    </div>
  )
}

/* ================= Telemetry Chart ================= */

/* ================= ECO Mode ================= */

type SpeedZone = 'low' | 'eco' | 'high'

// rate = how fast the maintenance clock runs in this zone, relative to real time
const speedZones: { zone: SpeedZone; label: string; range: string; from: number; to: number; preset: number; rate: number }[] = [
  { zone: 'low', label: 'LOW', range: '30–59 km/h', from: 30, to: 60, preset: 45, rate: 0.5 },
  { zone: 'eco', label: 'ECO', range: '60–100 km/h', from: 60, to: 100, preset: 80, rate: 1 },
  { zone: 'high', label: 'HIGH', range: '101–180 km/h', from: 100, to: 180, preset: 150, rate: 2 },
]
const zoneRate = (zone: SpeedZone) => speedZones.find((z) => z.zone === zone)?.rate ?? 1
const formatRate = (rate: number) => `${rate === 0.5 ? '½' : rate}×`

function speedZoneFor(speed: number): SpeedZone {
  const s = Math.round(speed)
  return s < 60 ? 'low' : s <= 100 ? 'eco' : 'high'
}

// Dial geometry: 270° sweep from -135° (30 km/h) to +135° (180 km/h), angles clockwise from 12 o'clock
const DIAL_CX = 150
const DIAL_CY = 150
const dialAngle = (speed: number) => -135 + ((speed - SPEED_MIN) / (SPEED_MAX - SPEED_MIN)) * 270
const dialPoint = (angle: number, r: number) => {
  const rad = (angle * Math.PI) / 180
  return [DIAL_CX + r * Math.sin(rad), DIAL_CY - r * Math.cos(rad)] as const
}
const dialArc = (from: number, to: number, r: number) => {
  const [x0, y0] = dialPoint(dialAngle(from), r)
  const [x1, y1] = dialPoint(dialAngle(to), r)
  const large = dialAngle(to) - dialAngle(from) > 180 ? 1 : 0
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`
}
const speedTicks = Array.from({ length: (SPEED_MAX - SPEED_MIN) / 10 + 1 }, (_, i) => SPEED_MIN + i * 10)

// Service interval: 3500 hours of service time, shown as days. Service time advances at the
// speed zone's rate (½× below 60 km/h, 1× at 60–100, 2× above 100). Progress is saved in the
// browser with a timestamp; time that passes while ECO mode is closed counts at 1×.
const SERVICE_INTERVAL_HOURS = 3500
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const SERVICE_INTERVAL_MS = SERVICE_INTERVAL_HOURS * HOUR_MS
const SERVICE_CLOCK_KEY = 'thermos-service-clock'
const SERVICE_TICK_MS = 250

function loadServiceElapsed(): number {
  try {
    const saved = JSON.parse(localStorage.getItem(SERVICE_CLOCK_KEY) ?? 'null') as { elapsed?: number; savedAt?: number } | null
    if (saved && Number.isFinite(saved.elapsed) && Number.isFinite(saved.savedAt)) {
      const away = Math.max(0, Date.now() - (saved.savedAt as number))
      return Math.min(SERVICE_INTERVAL_MS, Math.max(0, (saved.elapsed as number) + away))
    }
  } catch {
    // Storage unavailable or corrupt: start a fresh interval
  }
  return 0
}

function saveServiceElapsed(elapsed: number) {
  try {
    localStorage.setItem(SERVICE_CLOCK_KEY, JSON.stringify({ elapsed, savedAt: Date.now() }))
  } catch {
    // Storage unavailable: the clock still runs for this session
  }
}

/** Service time used so far (ms), advancing at `rate` × real time, plus when it was last updated. */
function useServiceClock(rate: number): { elapsed: number; at: number } {
  const [clock, setClock] = useState(() => ({ elapsed: loadServiceElapsed(), at: Date.now() }))
  const elapsedRef = useRef(clock.elapsed)
  const rateRef = useRef(rate)

  useEffect(() => {
    rateRef.current = rate
  }, [rate])

  useEffect(() => {
    let last = Date.now()
    const id = setInterval(() => {
      const now = Date.now()
      elapsedRef.current = Math.min(SERVICE_INTERVAL_MS, elapsedRef.current + (now - last) * rateRef.current)
      last = now
      setClock({ elapsed: elapsedRef.current, at: now })
      saveServiceElapsed(elapsedRef.current)
    }, SERVICE_TICK_MS)
    return () => clearInterval(id)
  }, [])

  return clock
}

function Speedometer({ speed }: { speed: number }) {
  const zone = speedZoneFor(speed)
  const pct = (speed - SPEED_MIN) / (SPEED_MAX - SPEED_MIN)
  const valueRef = useTweenedText<HTMLElement>(speed, 0)
  return (
    <div className="speedo" data-zone={zone} role="meter" aria-label="Current speed" aria-valuemin={SPEED_MIN} aria-valuemax={SPEED_MAX} aria-valuenow={Math.round(speed)} aria-valuetext={`${Math.round(speed)} km/h`}>
      <svg viewBox="0 10 300 280" aria-hidden="true">
        <circle className="speedo-bezel" cx={DIAL_CX} cy={DIAL_CY} r="136" />
        <path className="speedo-track" d={dialArc(SPEED_MIN, SPEED_MAX, 118)} />
        <path className="speedo-fill" d={dialArc(SPEED_MIN, SPEED_MAX, 118)} pathLength={100} style={{ strokeDasharray: `${pct * 100} 100` }} />
        {speedZones.map((z) => <path key={z.zone} className={`speedo-band ${z.zone}`} d={dialArc(z.from, z.to, 101)} />)}
        {speedTicks.map((v) => {
          const major = (v - SPEED_MIN) % 30 === 0
          const [x1, y1] = dialPoint(dialAngle(v), major ? 80 : 86)
          const [x2, y2] = dialPoint(dialAngle(v), 94)
          return <line key={v} className={`speedo-tick${major ? ' major' : ''}`} x1={x1} y1={y1} x2={x2} y2={y2} />
        })}
        {speedTicks.filter((v) => (v - SPEED_MIN) % 30 === 0).map((v) => {
          const [x, y] = dialPoint(dialAngle(v), 64)
          const limit = v === SPEED_MIN || v === SPEED_MAX
          return <text key={v} className={`speedo-label${limit ? ' limit' : ''}`} x={x} y={y} textAnchor="middle" dominantBaseline="middle">{v}</text>
        })}
        <line className="speedo-needle" x1={DIAL_CX} y1={DIAL_CY} x2={DIAL_CX} y2={DIAL_CY - 98} style={{ transform: `rotate(${dialAngle(speed)}deg)` }} />
        <circle className="speedo-hub" cx={DIAL_CX} cy={DIAL_CY} r="9" />
      </svg>
      <div className="speedo-readout">
        <strong ref={valueRef} />
        <span>km/h</span>
      </div>
    </div>
  )
}

function MaintenanceTimer({ zone }: { zone: SpeedZone }) {
  const rate = zoneRate(zone)
  const { elapsed, at } = useServiceClock(rate)
  const remaining = SERVICE_INTERVAL_MS - elapsed
  const due = remaining <= 0
  // 3500 hrs shown as days: starts at 145 days 20 hrs
  const parts = [
    { label: 'DAYS', value: String(Math.floor(remaining / DAY_MS)).padStart(3, '0') },
    { label: 'HRS', value: String(Math.floor(remaining / HOUR_MS) % 24).padStart(2, '0') },
    { label: 'MIN', value: String(Math.floor(remaining / 60_000) % 60).padStart(2, '0') },
    { label: 'SEC', value: String(Math.floor(remaining / 1000) % 60).padStart(2, '0') },
  ]
  const used = elapsed / SERVICE_INTERVAL_MS
  const fmtDate = (ms: number) => new Date(ms).toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' })

  return (
    <div className="maint-body" data-due={due}>
      <div className="maint-status">
        <span className="maint-eyebrow">{due ? 'MAINTENANCE DUE NOW' : 'NEXT SERVICE IN'}</span>
        <span className="maint-rate" data-zone={zone} aria-label={`Maintenance clock running at ${rate}x`}>
          <i aria-hidden="true" />{formatRate(rate)} SPEED
        </span>
      </div>
      <div className="maint-timer" role="timer" aria-label="Time until next service">
        {parts.map((p) => (
          <div key={p.label}>
            <strong>{p.value}</strong>
            <span>{p.label}</span>
          </div>
        ))}
      </div>
      <div className="maint-progress">
        <div>
          <span>SERVICE INTERVAL USED</span>
          <span>{(used * 100).toFixed(2)}%</span>
        </div>
        <div className="bar" aria-hidden="true">
          <i style={{ width: `${used * 100}%` }} />
        </div>
      </div>
      <div className="maint-facts">
        <div><span>SERVICE INTERVAL</span><strong>{SERVICE_INTERVAL_HOURS} hrs = {Math.floor(SERVICE_INTERVAL_MS / DAY_MS)} days {Math.round((SERVICE_INTERVAL_MS % DAY_MS) / HOUR_MS)} hrs</strong></div>
        <div><span>DAYS USED</span><strong>{(elapsed / DAY_MS).toFixed(2)} days</strong></div>
        <div><span>DUE ON (AT {formatRate(rate)})</span><strong>{fmtDate(at + remaining / rate)}</strong></div>
      </div>
    </div>
  )
}

function EcoModePanel({ onClose }: { onClose: () => void }) {
  const { isPaused } = useTelemetry()
  const [auto, setAuto] = useState(false)
  const [manualSpeed, setManualSpeed] = useState(80)
  const autoSpeed = useSimulatedSpeed(isPaused || !auto)
  const speed = auto ? autoSpeed : manualSpeed
  const zone = speedZoneFor(speed)

  const setSpeed = (value: number) => {
    setAuto(false)
    setManualSpeed(Math.min(SPEED_MAX, Math.max(SPEED_MIN, Math.round(value))))
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div className="analytics-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="analytics-panel eco-panel" role="dialog" aria-modal="true" aria-labelledby="eco-title">
        <header className="analytics-heading">
          <div>
            <span className="analytics-eyebrow"><i />LIVE SIMULATION</span>
            <h2 id="eco-title">ECO MODE</h2>
          </div>
          <button className="analytics-close" type="button" onClick={onClose} aria-label="Close ECO Mode"><X size={19} /></button>
        </header>
        <div className="eco-grid">
          <article className="eco-card" aria-labelledby="eco-speed-title">
            <div className="eco-card-title">
              <Gauge size={20} aria-hidden="true" />
              <h3 id="eco-speed-title">REQUIRED SPEED PARAMETER</h3>
            </div>
            <Speedometer speed={speed} />
            <div className="speed-control">
              <label htmlFor="eco-speed-input">SET SPEED</label>
              <input
                id="eco-speed-input"
                type="range"
                min={SPEED_MIN}
                max={SPEED_MAX}
                step={1}
                value={Math.round(speed)}
                data-zone={zone}
                onChange={(event) => setSpeed(Number(event.target.value))}
                aria-label="Set speed in km/h"
              />
              <button type="button" className={`speed-auto${auto ? ' active' : ''}`} aria-pressed={auto} onClick={() => { if (auto) setManualSpeed(Math.round(autoSpeed)); setAuto(!auto) }}>
                AUTO
              </button>
            </div>
            <div className="speed-zones" role="group" aria-label="Quick set speed zone">
              {speedZones.map((z) => (
                <button
                  key={z.zone}
                  type="button"
                  className={`${z.zone}${zone === z.zone ? ' active' : ''}`}
                  aria-pressed={zone === z.zone}
                  aria-label={`Set ${z.label} speed ${z.preset} km/h`}
                  onClick={() => setSpeed(z.preset)}
                >
                  <strong>{z.label} · {formatRate(z.rate)}</strong>
                  {z.range}
                </button>
              ))}
            </div>
          </article>
          <article className="eco-card" aria-labelledby="eco-maint-title">
            <div className="eco-card-title">
              <Wrench size={20} aria-hidden="true" />
              <h3 id="eco-maint-title">MAINTENANCE REQUIRED</h3>
            </div>
            <MaintenanceTimer zone={zone} />
          </article>
        </div>
      </section>
    </div>
  )
}

function TelemetryChart({ onClose }: { onClose: () => void }) {
  const { t } = useLanguage()
  const { history, telemetry } = useTelemetry()
  const [activeTab, setActiveTab] = useState<ChartTab>('rpm')
  const [range, setRange] = useState('1M')
  const ranges = ['1M', '5M', '15M']

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const filteredHistory = useMemo(() => {
    const count = range === '1M' ? 20 : range === '5M' ? 50 : 100
    return history.slice(-count)
  }, [history, range])

  const chartData = useMemo(() => {
    return filteredHistory.map((d) => {
      if (activeTab === 'rpm') return { time: d.timeLabel, value: d.rpm }
      if (activeTab === 'temperature') return { time: d.timeLabel, value: d.temperatureCelsius }
      if (activeTab === 'pressure') return { time: d.timeLabel, value: d.pressureBar }
      if (activeTab === 'recoveredPower') return { time: d.timeLabel, value: d.recoveredPowerWatts }
      return { time: d.timeLabel, value: d.batteryCharge }
    })
  }, [filteredHistory, activeTab])

  const currentValue = useMemo(() => {
    const last = filteredHistory[filteredHistory.length - 1]
    if (!last) return 0
    if (activeTab === 'rpm') return last.rpm
    if (activeTab === 'temperature') return last.temperatureCelsius
    if (activeTab === 'pressure') return last.pressureBar
    if (activeTab === 'recoveredPower') return last.recoveredPowerWatts
    return last.batteryCharge
  }, [filteredHistory, activeTab])

  const unit = activeTab === 'rpm' ? 'RPM' : activeTab === 'temperature' ? '°C' : activeTab === 'pressure' ? 'bar' : activeTab === 'batteryCharge' ? '%' : 'W'

  const yAxisConfig = useMemo(() => {
    if (activeTab === 'rpm') return { domain: [0, 8000], ticks: [0, 2000, 4000, 6000, 8000], fmt: (v: number) => (v === 0 ? '0' : `${v / 1000}K`) }
    if (activeTab === 'temperature') return { domain: [0, 350], ticks: [0, 100, 200, 300, 350], fmt: (v: number) => `${v}°C` }
    if (activeTab === 'pressure') return { domain: [0, 3.5], ticks: [0, 1, 2, 3], fmt: (v: number) => `${v} bar` }
    if (activeTab === 'batteryCharge') return { domain: [0, 100], ticks: [0, 25, 50, 75, 100], fmt: (v: number) => `${v}%` }
    if (activeTab === 'recoveredPower') return { domain: [0, 800], ticks: [0, 200, 400, 600, 800], fmt: (v: number) => `${v} W` }
    return { domain: [0, 8000], ticks: [0, 2000, 4000, 6000, 8000], fmt: (v: number) => `${v} RPM` }
  }, [activeTab])

  // Gradient id unique per tab to avoid conflicts
  const gradientId = `fill-${activeTab}`

  const fixedLabel = useMemo(() => {
    if (activeTab === 'rpm') return `${currentValue.toLocaleString()} RPM`
    if (activeTab === 'temperature') return `${currentValue}°C`
    if (activeTab === 'pressure') return `${currentValue.toFixed(1)} bar`
    if (activeTab === 'recoveredPower') return `${currentValue} W`
    if (activeTab === 'batteryCharge') return `${Math.round(currentValue)}%`
    return `${currentValue.toLocaleString()} RPM`
  }, [currentValue, activeTab])

  return (
    <div className="analytics-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="analytics-panel" role="dialog" aria-modal="true" aria-labelledby="analytics-title">
        <header className="analytics-heading">
          <div>
            <span className="analytics-eyebrow"><i />LIVE SIMULATION</span>
            <h2 id="analytics-title">PERFORMANCE ANALYTICS</h2>
          </div>
          <button className="analytics-close" type="button" onClick={onClose} aria-label="Close Performance Analytics"><X size={19} /></button>
        </header>
        <div className="analytics-metrics" aria-label="Current vehicle metrics">
          <div><span>ENGINE RPM</span><strong>{telemetry.rpm.toLocaleString()} <small>RPM</small></strong></div>
          <div><span>EXHAUST TEMPERATURE</span><strong>{Math.round(telemetry.temperatureCelsius)}<small>°C</small></strong></div>
          <div><span>EXHAUST PRESSURE</span><strong>{telemetry.pressureBar.toFixed(1)} <small>bar</small></strong></div>
          <div><span>RECOVERED POWER</span><strong>{Math.round(telemetry.recoveredPowerWatts)} <small>W</small></strong></div>
          <div><span>BATTERY CHARGE</span><strong>{Math.round(telemetry.batteryCharge)}<small>%</small></strong></div>
        </div>
        <div className="analytics-controls">
          <label htmlFor="performance-metric">METRIC</label>
          <select id="performance-metric" aria-label="Performance metric" value={activeTab} onChange={(event) => setActiveTab(event.target.value as ChartTab)}>
            {chartTabs.map((tab) => <option key={tab} value={tab}>{t(chartTabLabels[tab])}</option>)}
          </select>
          <div className="ranges analytics-ranges" aria-label="Chart time range">
            {ranges.map((item) => (
              <button aria-pressed={range === item} aria-label={`Chart range ${item}`} className={range === item ? 'active' : ''} key={item} type="button" onClick={() => setRange(item)}>
                {item}
              </button>
            ))}
          </div>
        </div>
        <div className="analytics-chart-heading"><strong>{activeTab === 'batteryCharge' ? 'BATTERY CHARGE' : t(chartTabLabels[activeTab])}</strong><span>{fixedLabel}</span></div>
        <div className="analytics-chart-wrap">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 8, right: 14, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--green)" stopOpacity={0.42} />
                  <stop offset="90%" stopColor="var(--green)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--grid-line)" vertical horizontal />
              <XAxis dataKey="time" stroke="var(--muted)" tickLine={false} axisLine={false} tickMargin={8} />
              <YAxis stroke="var(--muted)" tickLine={false} axisLine={false} domain={yAxisConfig.domain as [number, number]} ticks={yAxisConfig.ticks} tickFormatter={yAxisConfig.fmt} />
              <Tooltip content={<ChartTooltip unit={unit} />} cursor={{ stroke: 'var(--green)', strokeDasharray: '3 4' }} />
              <Area type="monotone" dataKey="value" stroke="var(--green-bright)" strokeWidth={3} fill={`url(#${gradientId})`} dot={false} activeDot={{ r: 4, fill: 'var(--green-bright)' }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  )
}

function ChartTooltip({ active, payload, unit }: { active?: boolean; payload?: Array<{ value: number; payload?: { time?: string } }>; unit: string }) {
  if (!active || !payload?.length) {
    return null
  }
  const val = payload[0].value
  const text = unit === '%' ? `${Math.round(val)}%` : unit === 'W' ? `${val} W` : unit === 'RPM' ? `${val.toLocaleString()} RPM` : unit === '°C' ? `${val}°C` : `${val} bar`
  return (
    <div className="chart-tooltip">
      <strong>{text}</strong>
      {payload[0].payload?.time && <small>{payload[0].payload.time}</small>}
    </div>
  )
}

/* ================= AI Assistant ================= */

function AIAssistantPanel({ volume = 70 }: { volume?: number }) {
  const { t, language } = useLanguage()
  const { telemetry } = useTelemetry()
  const [chip, setChip] = useState<AssistantChip>('batteryEta')
  const [input, setInput] = useState('')

  const greeting = language === 'hi' ? GREETING_HI : GREETING_EN
  const volumeLevel = (volume ?? 70) / 100

  const voice = useVoiceAssistant(language, volumeLevel)
  const { messages, loading, notice, retryText, agentPaused, ask, retry, interrupt, togglePause, clearChat } =
    useAssistantChat({ language, voice, greeting })

  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const spokenLangRef = useRef<Language | null>(null)

  // Greeting waits while a question or an answer is in flight so it can never
  // interrupt a user-requested answer.
  const greetingBusy = loading || voice.state === 'processing' || voice.state === 'speaking'

  useEffect(() => {
    if (spokenLangRef.current === language) return
    if (greetingBusy) return
    if (!isVoiceOutputEnabled()) {
      spokenLangRef.current = language
      diag('greeting', 'skipped-muted', { lang: language })
      return
    }
    spokenLangRef.current = language
    diag('greeting', 'play', { lang: language })
    void speakOnce(greeting, language === 'hi' ? 'hi' : 'en').then((outcome) => {
      diag('greeting', 'outcome', { outcome })
    })
  }, [language, greeting, greetingBusy])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const statusText = useMemo(() => {
    if (voice.state === 'processing') return t('voice.processing')
    if (voice.state === 'speaking') return t('voice.speaking')
    if (voice.state === 'paused') return t('voice.paused')
    if (voice.message) return voice.message
    if (voice.state === 'listening') return t('voice.listening')
    if (voice.state === 'error') return t('voice.error')
    return voice.voiceActive ? t('voice.active') : t('assistant.tapToSpeak')
  }, [voice.state, voice.message, voice.voiceActive, t])

  const handleSend = () => {
    const text = input.trim()
    if (!text) return
    setInput('')
    ask(text)
  }

  return (
    <aside className="panel assistant-panel">
      <div className="assistant-header">
        <div className="heading-title">
          <Bot size={25} />
          <div>
            <h2>TURBO AI</h2>
            <span>{t('assistant.energyCopilot')}</span>
          </div>
        </div>
      </div>

      <div className="assistant-intro">
        <VoiceOrb />
        <div className="ready-card">
          <strong>
            <span className="status-dot" />
            {t('assistant.ready')}
          </strong>
          <p>{t('assistant.intro')}</p>
        </div>
      </div>

      <div className="chips">
        {assistantChips.map((item) => (
          <button className={chip === item ? 'active' : ''} key={item} type="button" onClick={() => setChip(item)}>
            {t(assistantChipLabels[item])}
          </button>
        ))}
      </div>

      <div className="chat-window">
        {messages.map((msg, i) => (
          <div key={i} className={`message ${msg.role}`}>
            {msg.role === 'assistant' && (
              <div className="assistant-avatar">
                <Leaf size={26} />
              </div>
            )}
            <div className={msg.role === 'assistant' ? 'message-bubble' : undefined}>
              <p>{msg.text}</p>
              <time>{msg.time}</time>
              {msg.role === 'assistant' && i === messages.length - 1 && (
                <div className="mini-card">
                  <BatteryCharging size={30} />
                  <div>
                    <strong>{telemetry.chargingEtaMinutes} min</strong>
                    <span>{t('assistant.estimatedTimeRemaining')}</span>
                  </div>
                  <div className="mini-charge">
                    <span>{t('assistant.charge')}</span>
                    <strong>{Math.round(telemetry.batteryCharge)}%</strong>
                    <div className="bar">
                      <i style={{ width: `${Math.round(telemetry.batteryCharge)}%` }} />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="message assistant">
            <div className="assistant-avatar">
              <Leaf size={26} />
            </div>
            <div className="message-bubble">
              <p style={{ color: 'var(--muted)' }}>{language === 'hi' ? 'सोच रहा हूँ...' : 'Thinking...'}</p>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="voice-control">
        <WaveBars />
        <button
          type="button"
          aria-label={voice.voiceActive ? t('assistant.stopVoice') : t('assistant.tapToSpeak')}
          title={voice.voiceActive ? t('assistant.stopVoice') : t('assistant.tapToSpeak')}
          onClick={() => {
            if (voice.voiceActive) {
              voice.stopListening()
            } else if (voice.state === 'speaking') {
              voice.interruptSpeech()
            } else {
              voice.startListening(ask)
            }
          }}
          style={
            voice.voiceActive
              ? { borderColor: 'var(--amber)', boxShadow: '0 0 22px var(--amber)' }
              : voice.state === 'speaking'
                ? { borderColor: 'var(--cyan)' }
                : undefined
          }
        >
          <Mic size={38} />
        </button>
        <WaveBars reverse />
        <span>{statusText}</span>
      </div>
      {!voice.isSupported && (
        <div style={{ padding: '0 14px 8px', fontSize: 12, color: 'var(--muted)' }}>
          {t('voice.unsupported')}
        </div>
      )}

      <div className="chat-input">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder={t('assistant.placeholder')}
        />
        <button type="button" aria-label={t('assistant.send')} title={t('assistant.send')} onClick={handleSend}>
          <Send size={23} />
        </button>
      </div>
      {notice && (
        <div className="chat-notice" role="alert">
          <span>{notice}</span>
          {retryText && (
            <button
              type="button"
              className="icon-button"
              style={{ marginLeft: 10, fontSize: 11 }}
              onClick={retry}
              aria-label={t('assistant.retry')}
            >
              {t('assistant.retry')}
            </button>
          )}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, padding: '0 14px 8px' }}>
        <button
          type="button"
          className="icon-button"
          aria-label={t('assistant.interrupt')}
          title={t('assistant.interrupt')}
          onClick={interrupt}
        >
          <Pause size={16} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label={agentPaused ? t('assistant.resumeAgent') : t('assistant.pauseAgent')}
          title={agentPaused ? t('assistant.resumeAgent') : t('assistant.pauseAgent')}
          onClick={togglePause}
        >
          {agentPaused ? <Play size={16} /> : <Pause size={16} />}
        </button>
        <button
          onClick={clearChat}
          className="icon-button"
          title={t('assistant.clearChat')}
          aria-label={t('assistant.clearChat')}
        >
          <Trash2 size={16} />
        </button>
      </div>
    </aside>
  )
}

function VoiceOrb() {
  return (
    <div className="voice-orb" aria-hidden="true">
      <span />
      <svg viewBox="0 0 110 110">
        <circle cx="55" cy="55" r="42" />
        <circle cx="55" cy="55" r="24" />
        <path d="M19 56 H36 L40 47 L45 65 L51 37 L58 75 L64 44 L70 62 L75 52 L91 52" />
      </svg>
    </div>
  )
}

function WaveBars({ reverse }: { reverse?: boolean }) {
  const bars = [14, 23, 32, 40, 29, 20, 14]
  return (
    <div className={`wave-bars ${reverse ? 'reverse' : ''}`} aria-hidden="true">
      {bars.map((height, index) => (
        <i key={index} style={{ height }} />
      ))}
    </div>
  )
}

/* ================= Diagnostic Footer ================= */

function DiagnosticFooter() {
  const { language, t } = useLanguage()
  const { telemetry, isPaused, togglePause } = useTelemetry()

  // Format last update using telemetry timestamp
  const lastTime = new Date(telemetry.timestamp)
  const lastStr = lastTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })

  return (
    <footer className="diagnostic-footer">
      <div className="footer-left">
        <Car size={25} />
        <span>
          {t('footer.dataSourceLabel')} <strong>{t('footer.dataSourceValue')}</strong>
        </span>
        <i />
        <span>
          {t('footer.recoveryStatusLabel')} <strong>{isPaused ? 'PAUSED' : t('footer.recoveryStatusValue')}</strong>
        </span>
        <i />
        <span>
          {t('footer.lastUpdateLabel')} <strong>{language === 'hi' ? lastStr.toUpperCase() : lastStr}</strong>
        </span>
      </div>
      <button type="button" className="pause-button" onClick={togglePause} aria-label={isPaused ? 'Resume' : 'Pause'}>
        {isPaused ? <Play size={19} /> : <Pause size={19} />}
        {isPaused ? 'RESUME SIMULATION' : t('footer.pauseSimulation')}
      </button>
    </footer>
  )
}

export default App
