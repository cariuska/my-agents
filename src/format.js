export const STATUS = {
  busy: { label: 'Trabalhando', color: 'var(--green)' },
  waiting: { label: 'Precisa de você', color: 'var(--pink)' },
  idle: { label: 'Livre', color: 'var(--grey)' },
  running: { label: 'Rodando', color: 'var(--blue)' },
  done: { label: 'Concluído', color: 'var(--grey)' },
  stopped: { label: 'Parado', color: 'var(--amber)' },
}

export const statusOf = (s) => STATUS[s] || { label: s || '—', color: 'var(--grey)' }

// De onde vem cada agente. A cor aparece no selo e na mesa do escritório.
export const SOURCES = {
  claude: { label: 'Claude', color: '#ff8a5c' },
  codex: { label: 'Codex', color: '#e8f4f8' },
  copilot: { label: 'Copilot', color: '#c58cff' },
}

export const sourceOf = (id) => SOURCES[id] || { label: id || '?', color: 'var(--grey)' }

export function dur(ms) {
  if (!ms || ms < 0) return '0s'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

export function tokens(n) {
  if (n == null) return '—' // a fonte não informa tokens
  if (!n) return '0'
  if (n < 1000) return String(n)
  if (n < 1e6) return `${(n / 1000).toFixed(n < 10000 ? 1 : 0)}k`
  return `${(n / 1e6).toFixed(1)}M`
}

export function clock(ts) {
  if (!ts) return ''
  return new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

export const shortModel = (m) => (m || '').replace(/^(claude-|copilot\/)/, '') || '—'

export function clip(s, n) {
  s = String(s ?? '')
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

export function hash(str) {
  let h = 2166136261
  for (let i = 0; i < String(str).length; i++) h = Math.imul(h ^ String(str).charCodeAt(i), 16777619)
  return h >>> 0
}
