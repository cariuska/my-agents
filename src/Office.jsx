import { useEffect, useRef, useState } from 'react'
import { clip, dur, hash, sourceOf } from './format.js'
import { agentKey } from './names.js'

// Sala de comando holográfica. Cada agente (sessão ou subagente) tem a sua
// estação; quem está livre levanta e vai para o café. Unidades lógicas; o SVG escala.
const COLS = 4
const CELL_W = 128
const CELL_H = 92
const W = COLS * CELL_W
const WALL = 72
const TOP = 22
const MIN_DESKS = 8
const CAFE_H = 96
const DOOR = { x: 470, y: 50 }
const SEAT = { x: 75, y: 19 } // posição da pessoa dentro da célula
const CHAR = 0.55 // largura de um caractere da Share Tech Mono, em em

const CYAN = '#35e0ff'
const AMBER = '#ffb347'
const SKIN = ['#f2c9a0', '#e0a878', '#b97a50', '#8a5a3a', '#f7d9bc']
const HAIR = ['#2b1d16', '#5a3a22', '#c98a3a', '#1c1c2a', '#8a3a2a', '#d8d2c4']
const SHIRT = ['#e06a5a', '#5a8ae0', '#5ac08a', '#e0b04a', '#a06ae0', '#4ab8c8', '#e07ab0']
const TEAM = ['#ffb347', '#b58cff', '#3dffb0', '#ff7ab8', '#ffe45c', '#7fb2ff', '#ff8a5c']
const STATUS_COLOR = { busy: '#3dffb0', waiting: '#ff4d6d', idle: '#5b8ea3', running: '#4d9bff' }

// Lugares do café, relativos ao topo da área: mesas, sofá e balcão (em pé).
const TABLES = [210, 300, 390]
const CAFE_SPOTS = [
  ...TABLES.flatMap((cx) => [{ x: cx - 30, y: 38, pose: 'sit' }, { x: cx + 18, y: 38, pose: 'sit' }]),
  { x: 442, y: 36, pose: 'sit' }, { x: 459, y: 36, pose: 'sit' }, { x: 476, y: 36, pose: 'sit' },
  ...[22, 42, 62, 82, 102, 122].map((x) => ({ x, y: 50, pose: 'stand' })),
]

const look = (seed) => {
  const h = hash(seed)
  return { skin: SKIN[h % SKIN.length], hair: HAIR[(h >> 4) % HAIR.length], shirt: SHIRT[(h >> 9) % SHIRT.length] }
}

function Person({ seed, long = false, legs = false, cap = null, cup = false }) {
  const c = look(seed)
  return (
    <g shapeRendering="crispEdges">
      {legs && <><rect x="2" y="16" width="3" height="4" fill="#1b3a52" /><rect x="7" y="16" width="3" height="4" fill="#1b3a52" /></>}
      <rect x="0" y="9" width="12" height="8" fill={c.shirt} />
      {long && <><rect x="0" y="1" width="2" height="10" fill={c.hair} /><rect x="10" y="1" width="2" height="10" fill={c.hair} /></>}
      <rect x="1" y="2" width="10" height="8" fill={c.skin} />
      <rect x="1" y="0" width="10" height="3" fill={cap || c.hair} />
      {cap && <rect x="0" y="2" width="12" height="1" fill={cap} />}
      {!cap && !long && <><rect x="1" y="3" width="1" height="3" fill={c.hair} /><rect x="10" y="3" width="1" height="3" fill={c.hair} /></>}
      <rect x="3" y="5" width="1" height="2" fill="#0a1420" />
      <rect x="8" y="5" width="1" height="2" fill="#0a1420" />
      {cup && <><rect x="11" y="10" width="4" height="4" fill="#f3f1ea" /><rect x="15" y="11" width="1" height="2" fill="#f3f1ea" /><rect x="12" y="7" width="1" height="2" fill="#c9f6ff" className="steam" /></>}
    </g>
  )
}

function Bubble({ x, y, text, tone }) {
  const t = clip(text, 30)
  const w = Math.ceil(t.length * 7 * CHAR) + 9
  const bx = Math.max(2, Math.min(W - w - 2, x - w / 2))
  const color = tone === 'alert' ? '#ff4d6d' : tone === 'cafe' ? AMBER : CYAN
  return (
    <g className="bubble" pointerEvents="none">
      <path d={`M${bx + 3} ${y}H${bx + w}V${y + 8}L${bx + w - 3} ${y + 11}H${bx}V${y + 3}Z`} fill="#04141f" fillOpacity="0.92" stroke={color} strokeWidth="0.6" />
      <line x1={x} y1={y + 11} x2={x} y2={y + 15} stroke={color} strokeWidth="0.6" />
      <text x={bx + 4.5} y={y + 8} fontSize="7" fill={tone === 'alert' ? '#ffc2cd' : tone === 'cafe' ? '#ffe2b8' : '#c9f6ff'}>{t}</text>
    </g>
  )
}

function Wall({ counts, agentDots, now }) {
  const d = new Date(now)
  const pad = (n) => String(n).padStart(2, '0')
  const cols = [
    { n: counts.busy, c: STATUS_COLOR.busy, k: 'ATIVOS' },
    { n: counts.subs, c: STATUS_COLOR.running, k: 'SUBAG.' },
    { n: counts.idle, c: AMBER, k: 'NO CAFÉ' },
    { n: counts.waiting, c: STATUS_COLOR.waiting, k: 'ALERTA' },
  ]
  return (
    <g>
      <rect width={W} height={WALL} fill="#051422" />
      <line x1="0" y1={WALL} x2={W} y2={WALL} stroke={CYAN} strokeWidth="0.6" opacity="0.7" />
      {/* radar: um ponto por agente vivo */}
      <g transform="translate(46 36)">
        {[26, 18, 10].map((r) => <circle key={r} r={r} fill="none" stroke={CYAN} strokeWidth="0.5" opacity="0.45" />)}
        <line x1="-28" y1="0" x2="28" y2="0" stroke={CYAN} strokeWidth="0.4" opacity="0.35" />
        <line x1="0" y1="-28" x2="0" y2="28" stroke={CYAN} strokeWidth="0.4" opacity="0.35" />
        <g className="sweep"><path d="M0 0L26 0A26 26 0 0 0 22.5 -13Z" fill={CYAN} opacity="0.22" /><line x1="0" y1="0" x2="26" y2="0" stroke={CYAN} strokeWidth="0.8" /></g>
        {agentDots.map((a, i) => {
          const ang = ((hash(a.key) % 360) * Math.PI) / 180
          const r = 6 + (hash(a.key + 'r') % 18)
          return <circle key={i} cx={Math.cos(ang) * r} cy={Math.sin(ang) * r} r={a.kind === 'session' ? 1.6 : 1} fill={a.color} />
        })}
      </g>
      {/* painel de estado */}
      <g transform="translate(96 10)">
        <path d="M6 0H250L256 6V46L250 52H6L0 46V6Z" fill="#07202f" fillOpacity="0.8" stroke={CYAN} strokeWidth="0.6" opacity="0.9" />
        {cols.map((col, i) => {
          const x = 10 + i * 61
          return (
            <g key={i}>
              {i > 0 && <line x1={x - 5} y1="8" x2={x - 5} y2="44" stroke={CYAN} strokeWidth="0.4" opacity="0.4" />}
              <text x={x} y="14" fontSize="6" fill="#6fb6cc" letterSpacing="0.8">{col.k}</text>
              <text x={x} y="34" fontSize="18" fill={col.c} className="num">{pad(col.n)}</text>
              {Array.from({ length: 10 }).map((_, k) => (
                <rect key={k} x={x + k * 5} y="40" width="3.5" height="3" fill={col.c} opacity={k < col.n ? 1 : 0.15} />
              ))}
            </g>
          )
        })}
      </g>
      {/* relógio */}
      <g transform="translate(400 36)">
        <circle className="spin-slow" r="24" fill="none" stroke={CYAN} strokeWidth="0.6" strokeDasharray="2 5" opacity="0.7" />
        <circle r="19" fill="none" stroke={CYAN} strokeWidth="1.6" strokeDasharray={`${(d.getSeconds() / 60) * 119.4} 119.4`} transform="rotate(-90)" />
        <text y="3.5" fontSize="10" textAnchor="middle" fill="#c9f6ff" className="num">{pad(d.getHours())}:{pad(d.getMinutes())}</text>
      </g>
      {/* portal: por onde os subagentes entram e saem */}
      <g transform="translate(454 8)">
        <rect x="0" y="6" width="44" height="58" fill="url(#portal)" stroke={CYAN} strokeWidth="0.8" />
        {[18, 30, 42, 54].map((y) => <line key={y} x1="4" y1={y} x2="40" y2={y} stroke={CYAN} strokeWidth="0.4" opacity="0.5" className="scan" />)}
        <text x="22" y="3" fontSize="6" textAnchor="middle" fill={CYAN} letterSpacing="1">PORTAL</text>
      </g>
    </g>
  )
}

function Floor({ H }) {
  const lines = []
  for (let x = 0; x <= W; x += 16) lines.push(<line key={`v${x}`} x1={x} y1={WALL} x2={x} y2={H} />)
  for (let y = WALL + 16; y < H; y += 16) lines.push(<line key={`h${y}`} x1="0" y1={y} x2={W} y2={y} />)
  return (
    <g>
      <rect y={WALL} width={W} height={H - WALL} fill="#03101a" />
      <rect y={WALL} width={W} height={H - WALL} fill="url(#floorGlow)" />
      <g stroke={CYAN} strokeWidth="0.4" opacity="0.13">{lines}</g>
    </g>
  )
}

// Área do café: balcão com máquina, mesas e sofá.
function Cafe({ y }) {
  return (
    <g transform={`translate(0 ${y})`}>
      <rect width={W} height={CAFE_H} fill="url(#cafeGlow)" />
      <line x1="0" y1="0" x2={W} y2="0" stroke={AMBER} strokeWidth="0.7" strokeDasharray="6 3" opacity="0.8" />
      <text x="16" y="12" fontSize="8" fill={AMBER} letterSpacing="2" className="num">CAFÉ</text>
      {/* balcão */}
      <rect x="14" y="30" width="128" height="4" fill="#3a2a1c" stroke={AMBER} strokeWidth="0.5" />
      <rect x="16" y="34" width="124" height="14" fill="#1e140c" stroke={AMBER} strokeWidth="0.5" opacity="0.9" />
      {/* máquina de café */}
      <rect x="20" y="12" width="20" height="18" fill="#2a3640" stroke={CYAN} strokeWidth="0.5" />
      <rect x="23" y="15" width="8" height="3" fill={CYAN} opacity="0.7" />
      <rect x="34" y="15" width="3" height="3" fill="#ff4d6d" />
      <rect x="27" y="21" width="6" height="2" fill="#0a1420" />
      <rect x="28" y="25" width="4" height="5" fill="#f3f1ea" />
      <g className="steam" fill="#c9f6ff" opacity="0.8">
        <rect x="29" y="5" width="1" height="3" /><rect x="31" y="3" width="1" height="3" /><rect x="33" y="6" width="1" height="2" />
      </g>
      {/* xícaras e doces no balcão */}
      {[52, 60, 68].map((x) => <g key={x}><rect x={x} y="25" width="5" height="5" fill="#f3f1ea" /><rect x={x + 5} y="26" width="1" height="2" fill="#f3f1ea" /></g>)}
      <rect x="84" y="26" width="22" height="4" fill="#4a3a2a" />
      {[86, 92, 98].map((x, i) => <rect key={x} x={x} y="23" width="5" height="3" fill={['#e0a060', '#f2c94c', '#c87a4a'][i]} />)}
      <rect x="116" y="18" width="18" height="12" fill="#0a1a24" stroke={AMBER} strokeWidth="0.5" />
      <text x="125" y="26.5" fontSize="5" textAnchor="middle" fill={AMBER}>MENU</text>
      {/* mesas */}
      {TABLES.map((cx) => (
        <g key={cx}>
          {[cx - 29, cx + 19].map((sx) => <rect key={sx} x={sx} y="55" width="10" height="3" fill="#3a2a1c" />)}
          <rect x={cx - 1.5} y="58" width="3" height="14" fill="#2a3640" />
          <ellipse cx={cx} cy="72" rx="7" ry="2" fill="#2a3640" />
          <ellipse cx={cx} cy="56" rx="15" ry="5" fill="#0a2a3a" stroke={AMBER} strokeWidth="0.6" />
          <rect x={cx - 3} y="52" width="4" height="3" fill="#f3f1ea" />
        </g>
      ))}
      {/* sofá */}
      <rect x="436" y="32" width="58" height="14" fill="#2b3f6b" stroke={CYAN} strokeWidth="0.4" />
      <rect x="436" y="46" width="58" height="10" fill="#34508a" />
      <rect x="432" y="40" width="6" height="18" fill="#2b3f6b" />
      <rect x="492" y="40" width="6" height="18" fill="#2b3f6b" />
      {/* planta */}
      <g transform="translate(418 50)">
        <rect x="3" y="0" width="3" height="12" fill="#3fae5a" /><rect x="0" y="4" width="3" height="8" fill="#2f9048" /><rect x="6" y="2" width="3" height="10" fill="#58c972" />
        <rect x="0" y="12" width="9" height="8" fill="#b0563a" />
      </g>
    </g>
  )
}

// Estação com computador. `who` descreve o dono; `present` diz se ele está sentado nela.
function Desk({ x, y, who, onSelect }) {
  if (!who) {
    return (
      <g transform={`translate(${x} ${y})`} opacity="0.4">
        <rect x="27" y="14" width="30" height="19" fill="none" stroke={CYAN} strokeWidth="0.5" strokeDasharray="2 2" />
        <path d="M22 37H106L110 41V58L106 62H22L18 58V41Z" fill="#06202e" fillOpacity="0.5" stroke={CYAN} strokeWidth="0.5" />
        <ellipse cx="81" cy="36" rx="10" ry="2.5" fill="none" stroke={CYAN} strokeWidth="0.5" />
      </g>
    )
  }
  const working = who.status === 'busy' || who.status === 'running'
  const waiting = who.status === 'waiting'
  const away = who.status === 'idle'
  const sc = STATUS_COLOR[who.status] || STATUS_COLOR.idle
  return (
    <g
      transform={`translate(${x} ${y})`}
      className="desk"
      role="button"
      tabIndex={0}
      aria-label={`${who.name}, ${who.label}: ${who.status}`}
      aria-pressed={who.selected}
      onClick={() => onSelect(who.sessionId)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(who.sessionId) } }}
    >
      <title>{who.tooltip}</title>
      <rect className="hit" x="10" y="6" width={CELL_W - 20} height="62" fill="transparent" />
      {who.selected && (
        <g stroke="#c9f6ff" strokeWidth="0.8" fill="none">
          <path d="M10 13V6H17" /><path d="M111 6H118V13" /><path d="M118 61V68H111" /><path d="M17 68H10V61" />
        </g>
      )}
      {/* tela holográfica */}
      <rect x="27" y="14" width="30" height="19" fill={waiting ? '#ff4d6d' : CYAN} fillOpacity={working ? 0.16 : 0.06} stroke={waiting ? '#ff4d6d' : CYAN} strokeWidth="0.7" opacity={working || waiting ? 1 : 0.55} />
      {working && (
        <g className="code">
          <rect x="30" y="17.5" width="13" height="1.4" fill="#c9f6ff" />
          <rect x="30" y="21" width="20" height="1.4" fill={CYAN} />
          <rect x="30" y="24.5" width="9" height="1.4" fill="#3dffb0" />
          <rect x="41" y="24.5" width="8" height="1.4" fill="#ffb347" />
          <rect x="30" y="28" width="16" height="1.4" fill={CYAN} />
        </g>
      )}
      {away && (
        <g fill={AMBER} opacity="0.85">
          <rect x="38" y="20" width="6" height="6" /><rect x="44" y="21" width="2" height="3" />
          <rect x="39" y="17" width="1" height="2" className="steam" /><rect x="42" y="16" width="1" height="2" className="steam" />
        </g>
      )}
      <path d="M36 37L42 33L48 37Z" fill={CYAN} opacity="0.25" />
      {/* anel de estado sob o assento */}
      <ellipse className={working ? 'pulse' : undefined} cx="81" cy="36" rx="11" ry="3" fill={sc} fillOpacity="0.18" stroke={sc} strokeWidth="0.7" />
      {waiting && <g className="alert" fill="#ff4d6d"><path d="M98 10H102L101 21H99Z" /><rect x="98.5" y="23" width="3" height="3" /></g>}
      {/* bancada; a faixa colorida identifica a sessão dona da equipe */}
      <path d="M22 37H106L110 41V58L106 62H22L18 58V41Z" fill="#06202e" fillOpacity="0.92" stroke={CYAN} strokeWidth="0.7" />
      <rect x="22" y="39.5" width="84" height="1.6" fill={who.team} />
      <rect x="26" y="45.5" width="3.5" height="3.5" fill={away ? AMBER : sc} />
      <text x="33" y="50" fontSize="8" fill="#eafcff">{clip(who.name, 15)}</text>
      {/* origem do agente (Claude, Codex, Copilot) antes do rótulo */}
      <text x="26" y="58" fontSize="6" fill="#6fb6cc">
        <tspan fill={who.src.color} fontWeight="700">{who.src.label.toUpperCase()}</tspan> {clip(who.label, 22 - who.src.label.length)}
      </text>
    </g>
  )
}

// Pessoa que anda pela sala: entra pelo portal, vai à estação, ao café, e sai.
function Mover({ m, onSelect }) {
  const [pos, setPos] = useState(m.from)
  const [ms, setMs] = useState(0)
  const [walking, setWalking] = useState(false)
  const last = useRef(m.from)
  useEffect(() => {
    const d = Math.hypot(m.target.x - last.current.x, m.target.y - last.current.y)
    if (d < 0.5) return
    const time = Math.round(Math.min(4500, Math.max(1200, d * 13)))
    last.current = m.target
    setMs(time)
    setWalking(true)
    let raf = requestAnimationFrame(() => { raf = requestAnimationFrame(() => setPos(m.target)) })
    const t = setTimeout(() => setWalking(false), time)
    return () => { cancelAnimationFrame(raf); clearTimeout(t) }
  }, [m.target.x, m.target.y])

  const atDesk = m.pose === 'desk'
  const legs = walking || m.leaving || m.pose === 'stand'
  return (
    <g
      className="mover"
      style={{ transform: `translate(${pos.x}px, ${pos.y}px)`, transitionDuration: `${ms}ms` }}
      onClick={() => onSelect(m.sessionId)}
    >
      <title>{m.tooltip}</title>
      {!walking && m.pose === 'sit' && <rect x="1" y="16" width="10" height="3" fill="#3a2a1c" />}
      <g className={walking ? 'bob' : atDesk && m.working ? 'typing' : undefined}>
        <Person seed={m.seed} long={m.long} legs={legs} cap={m.cap} cup={!walking && m.cafe} />
      </g>
    </g>
  )
}

export default function Office({ sessions, selectedId, onSelect, now, nameOf }) {
  const deskSlots = useRef(new Map()) // agente -> estação (estável enquanto ele existir)
  const cafeSlots = useRef(new Map()) // agente livre -> lugar no café
  const movers = useRef(new Map())
  const booted = useRef(false)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 3500)
    return () => clearInterval(t)
  }, [])

  // todos os agentes vivos: cada sessão seguida dos seus subagentes em execução
  const agents = []
  for (const s of sessions) {
    agents.push({ key: agentKey(s.sessionId), kind: 'session', s })
    for (const a of s.subagents) if (a.status === 'running') agents.push({ key: agentKey(s.sessionId, a.id), kind: 'sub', s, a })
  }
  const alive = new Set(agents.map((a) => a.key))

  const claim = (slots, keys) => {
    for (const k of [...slots.keys()]) if (!keys.has(k)) slots.delete(k)
    const taken = new Set(slots.values())
    for (const k of keys) {
      if (slots.has(k)) continue
      let i = 0
      while (taken.has(i)) i++
      slots.set(k, i)
      taken.add(i)
    }
  }
  claim(deskSlots.current, alive)
  claim(cafeSlots.current, new Set(agents.filter((a) => a.kind === 'session' && a.s.status === 'idle').map((a) => a.key)))

  const maxSlot = Math.max(-1, ...deskSlots.current.values())
  const deskCount = Math.max(MIN_DESKS, Math.ceil((maxSlot + 1) / COLS) * COLS)
  const cafeY = WALL + TOP + (deskCount / COLS) * CELL_H - 6
  const H = cafeY + CAFE_H
  const cell = (i) => ({ x: (i % COLS) * CELL_W, y: WALL + TOP + Math.floor(i / COLS) * CELL_H })
  const cafeSpot = (i) => {
    const sp = CAFE_SPOTS[i % CAFE_SPOTS.length]
    const lap = Math.floor(i / CAFE_SPOTS.length) // café lotado: fila extra no balcão
    return { x: sp.x + lap * 8, y: cafeY + sp.y + lap * 4, pose: lap ? 'stand' : sp.pose }
  }

  const desks = Array(deskCount).fill(null)
  const bubbles = []
  const speakers = []
  const agentDots = []
  for (const ag of agents) {
    const c = cell(deskSlots.current.get(ag.key))
    const team = TEAM[sessions.indexOf(ag.s) % TEAM.length]
    const person = nameOf(ag.key)
    const src = sourceOf(ag.s.source)
    const seat = { x: c.x + SEAT.x, y: c.y + SEAT.y }
    let target = seat
    let pose = 'desk'
    let mover
    if (ag.kind === 'session') {
      const s = ag.s
      const idle = s.status === 'idle'
      const label = s.name
      desks[deskSlots.current.get(ag.key)] = { name: person.name, label, src, status: s.status, sessionId: s.sessionId, team, selected: s.sessionId === selectedId, tooltip: `${person.name} (${src.label}) — ${s.name}: ${s.title || s.project}` }
      agentDots.push({ key: ag.key, kind: 'session', color: idle ? AMBER : STATUS_COLOR[s.status] || STATUS_COLOR.idle })
      if (idle) {
        const sp = cafeSpot(cafeSlots.current.get(ag.key))
        target = { x: sp.x, y: sp.y }
        pose = sp.pose
        const since = s.statusUpdatedAt ? ` há ${dur(now - s.statusUpdatedAt)}` : ''
        speakers.push({ x: sp.x + 6, y: sp.y - 16, text: `${person.name}: livre${since}`, tone: 'cafe' })
      } else if (s.status === 'waiting') {
        bubbles.push(<Bubble key={ag.key} x={c.x + 64} y={c.y - 4} tone="alert" text={s.waitingFor ? `${person.name} precisa de você: ${s.waitingFor}` : `${person.name} precisa de você`} />)
      } else if (s.status === 'busy' && s.action) {
        bubbles.push(<Bubble key={ag.key} x={c.x + 64} y={c.y - 4} text={s.action} />)
      }
      mover = { seed: s.sessionId, cap: null, working: s.status === 'busy', cafe: idle, tooltip: `${person.name} (${src.label}) — ${s.name}${idle ? ' (no café)' : ''}` }
    } else {
      const a = ag.a
      desks[deskSlots.current.get(ag.key)] = { name: person.name, label: a.description, src, status: 'running', sessionId: ag.s.sessionId, team, selected: false, tooltip: `${person.name} (${src.label}) — ${a.description} (subagente de ${ag.s.name})${a.action ? ': ' + a.action : ''}` }
      agentDots.push({ key: ag.key, kind: 'sub', color: STATUS_COLOR.running })
      if (a.action) speakers.push({ x: c.x + 64, y: c.y - 4, text: a.action })
      mover = { seed: a.id, cap: '#2f7dff', working: true, cafe: false, tooltip: `${person.name} — ${a.description}` }
    }
    const prev = movers.current.get(ag.key)
    // na primeira carga as sessões já estão no lugar; quem chega depois entra pelo portal
    const from = prev?.from || (ag.kind === 'session' && !booted.current ? target : DOOR)
    movers.current.set(ag.key, { ...mover, key: ag.key, sessionId: ag.s.sessionId, long: !!person.f, from, target, pose, leaving: 0 })
  }
  for (const [key, m] of movers.current) {
    if (alive.has(key)) continue
    if (!m.leaving) movers.current.set(key, { ...m, leaving: now, target: DOOR, pose: 'stand', cafe: false })
    else if (now - m.leaving > 6000) movers.current.delete(key)
  }
  booted.current = true

  const counts = {
    busy: sessions.filter((s) => s.status === 'busy').length,
    idle: sessions.filter((s) => s.status === 'idle').length,
    waiting: sessions.filter((s) => s.status === 'waiting').length,
    subs: agents.filter((a) => a.kind === 'sub').length,
  }
  // um balão extra por vez (subagentes e quem está no café), para não se atropelarem
  const speaker = speakers.length ? speakers[tick % speakers.length] : null
  const people = [...movers.current.values()].sort((a, b) => a.target.y - b.target.y)

  return (
    <svg className="office" viewBox={`0 0 ${W} ${H}`} role="group" aria-label="Sala de comando dos agentes">
      <defs>
        <radialGradient id="floorGlow" cx="50%" cy="0%" r="90%">
          <stop offset="0" stopColor={CYAN} stopOpacity="0.14" />
          <stop offset="1" stopColor={CYAN} stopOpacity="0" />
        </radialGradient>
        <linearGradient id="cafeGlow" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={AMBER} stopOpacity="0.1" />
          <stop offset="1" stopColor={AMBER} stopOpacity="0.02" />
        </linearGradient>
        <linearGradient id="portal" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={CYAN} stopOpacity="0.05" />
          <stop offset="1" stopColor={CYAN} stopOpacity="0.4" />
        </linearGradient>
      </defs>
      <Floor H={H} />
      <Wall counts={counts} agentDots={agentDots} now={now} />
      {desks.map((who, i) => {
        const c = cell(i)
        return <Desk key={i} x={c.x} y={c.y} who={who} onSelect={onSelect} />
      })}
      <Cafe y={cafeY} />
      {people.map((m) => <Mover key={m.key} m={m} onSelect={onSelect} />)}
      {bubbles}
      {speaker && <Bubble key={`sp${tick}`} x={speaker.x} y={speaker.y} text={speaker.text} tone={speaker.tone} />}
    </svg>
  )
}
