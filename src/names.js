import { useEffect, useRef } from 'react'
import { hash } from './format.js'

// Nome de pessoa para cada agente. `f` = 1 desenha cabelo comprido no boneco.
const NAMES = [
  ['Ana', 1], ['Bruno', 0], ['Camila', 1], ['Diego', 0], ['Fernanda', 1], ['Gustavo', 0],
  ['Helena', 1], ['Igor', 0], ['Juliana', 1], ['Lucas', 0], ['Mariana', 1], ['Mateus', 0],
  ['Natália', 1], ['Otávio', 0], ['Patrícia', 1], ['Pedro', 0], ['Rafaela', 1], ['Rodrigo', 0],
  ['Sofia', 1], ['Thiago', 0], ['Beatriz', 1], ['Vinícius', 0], ['Larissa', 1], ['André', 0],
  ['Gabriela', 1], ['Caio', 0], ['Isabela', 1], ['Davi', 0], ['Luana', 1], ['Eduardo', 0],
  ['Bianca', 1], ['Felipe', 0], ['Carla', 1], ['Henrique', 0], ['Elisa', 1], ['João', 0],
  ['Lívia', 1], ['Leonardo', 0], ['Marina', 1], ['Marcelo', 0], ['Paula', 1], ['Nicolas', 0],
  ['Vitória', 1], ['Fábio', 0], ['Tatiane', 1], ['Carlos', 0], ['Daniela', 1], ['Rafael', 0],
].map(([name, f]) => ({ name, f }))

const STORE = 'my-agents:names'
const KEEP = 400 // quantos agentes lembrar no navegador

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) || '[]')
    return new Map(Array.isArray(raw) ? raw : [])
  } catch {
    return new Map()
  }
}

// Chave de cada agente: sessionId para sessões, `sessionId:agentId` para subagentes.
export const agentKey = (sessionId, subId) => (subId ? `${sessionId}:${subId}` : sessionId)

// Dá um nome a cada agente vivo, sem repetir entre os que estão na tela,
// e mantém o mesmo nome entre recarregamentos da página.
export function useNames(sessions) {
  const memo = useRef(null)
  if (!memo.current) memo.current = load()
  const map = memo.current

  const keys = []
  for (const s of sessions) {
    keys.push(agentKey(s.sessionId))
    for (const a of s.subagents) keys.push(agentKey(s.sessionId, a.id))
  }
  const inUse = new Set(keys.filter((k) => map.has(k)).map((k) => map.get(k)))
  let changed = false
  for (const k of keys) {
    if (map.has(k)) continue
    const start = hash(k) % NAMES.length
    let pick = NAMES[start].name
    for (let i = 0; i < NAMES.length; i++) {
      const cand = NAMES[(start + i) % NAMES.length].name
      if (!inUse.has(cand)) { pick = cand; break }
    }
    map.set(k, pick)
    inUse.add(pick)
    changed = true
  }

  useEffect(() => {
    if (!changed) return
    try {
      const entries = [...map.entries()].slice(-KEEP)
      localStorage.setItem(STORE, JSON.stringify(entries))
    } catch { /* sem armazenamento: os nomes valem só nesta aba */ }
  })

  return (key) => {
    const name = map.get(key) || '—'
    return { name, f: NAMES.find((n) => n.name === name)?.f ?? 0 }
  }
}
