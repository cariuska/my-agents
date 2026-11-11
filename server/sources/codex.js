// Fonte: OpenAI Codex (CLI e extensão do VS Code). Cada conversa é um
// ~/.codex/sessions/AAAA/MM/DD/rollout-*.jsonl. O Codex não registra o pid da
// sessão, então conta como aberta quem escreveu no arquivo há pouco tempo.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { clip, makeTracker, pushEvent } from '../tail.js'
import { ACTIVE_MS } from './window.js'

export const id = 'codex'
export const label = 'Codex'
export const dir = process.env.CODEX_HOME || path.join(os.homedir(), '.codex')

const SESSIONS_DIR = path.join(dir, 'sessions')
const INDEX = path.join(dir, 'session_index.jsonl')

const APPS = { vscode: 'VS Code', codex_vscode: 'VS Code', cli: 'terminal', codex_cli_rs: 'terminal', exec: 'codex exec' }

function unquote(s) {
  try { return JSON.parse(`"${s}"`) } catch { return s }
}

// O Codex chama ferramentas de três jeitos: function_call (JSON), custom_tool_call
// (texto livre, ex.: o `exec` que roda JavaScript) e local_shell_call.
function describeCall(p) {
  let name = p.name || 'shell'
  let detail = ''
  if (p.type === 'local_shell_call') {
    detail = [].concat(p.action?.command || []).join(' ')
  } else if (p.type === 'custom_tool_call') {
    const input = String(p.input || '')
    const file = input.match(/\*\*\* (?:Update|Add|Delete) File: ([^\n\\"]+)/)
    const inner = input.match(/tools\.(\w+)\(/)
    const cmd = input.match(/\bcmd\s*:\s*"((?:\\.|[^"\\])*)"/)
    if (file) { name = 'apply_patch'; detail = path.basename(file[1].trim()) }
    else if (cmd) { name = inner?.[1] || name; detail = unquote(cmd[1]) }
    else if (inner) { name = inner[1]; detail = input.split('\n').find((l) => l.trim()) || '' }
    else detail = input.split('\n').find((l) => l.trim()) || ''
  } else {
    let a = {}
    try { a = JSON.parse(p.arguments || '{}') } catch { /* argumentos não-JSON */ }
    const cmd = a.cmd ?? a.command
    detail = (Array.isArray(cmd) ? cmd.join(' ') : cmd) || (a.path && path.basename(a.path)) || a.query || a.url || ''
  }
  if (name.startsWith('mcp__')) name = name.split('__').pop()
  return detail ? `${name}: ${clip(detail, 90)}` : name
}

function addPrompt(st, ts, text) {
  text = String(text || '')
  // a extensão do VS Code embrulha o pedido com o contexto do editor
  const mark = text.indexOf('## My request for Codex:')
  if (mark >= 0) text = text.slice(mark + '## My request for Codex:'.length)
  text = text.trim()
  if (!text || text.startsWith('<') || text === st.lastPrompt) return
  st.lastPrompt = text
  pushEvent(st, ts, 'prompt', clip(text, 140))
}

function ingest(st, line) {
  const o = JSON.parse(line)
  const p = o.payload || {}
  if (o.timestamp) st.lastTs = o.timestamp

  if (o.type === 'session_meta') {
    st.sessionId = p.id || p.session_id
    st.cwd = p.cwd || st.cwd
    st.startedAt = Date.parse(p.timestamp || o.timestamp) || null
    st.app = APPS[p.originator] || APPS[p.source] || p.originator || null
    st.version = p.cli_version || null
    if (p.git?.branch) st.branch = p.git.branch
  } else if (o.type === 'turn_context') {
    st.cwd = p.cwd || st.cwd
    st.model = p.model || p.collaboration_mode?.model || st.model
  } else if (o.type === 'event_msg') {
    switch (p.type) {
      case 'task_started': st.open = true; st.waitingFor = null; break
      case 'task_complete':
        st.open = false
        st.waitingFor = null
        if (p.last_agent_message) {
          st.action = clip(p.last_agent_message, 110)
          pushEvent(st, o.timestamp, 'text', clip(p.last_agent_message, 140))
        }
        break
      case 'turn_aborted': case 'task_aborted': st.open = false; st.waitingFor = null; break
      case 'thread_settings_applied': st.model = p.thread_settings?.model || st.model; break
      case 'user_message': addPrompt(st, o.timestamp, p.message); break
      case 'item_completed':
        if (p.item?.type === 'UserMessage') {
          addPrompt(st, o.timestamp, (p.item.content || []).filter((c) => c.type === 'text').map((c) => c.text).join(' '))
        }
        break
      case 'token_count':
        st.outTokens = p.info?.total_token_usage?.output_tokens ?? st.outTokens
        st.ctxTokens = p.info?.last_token_usage?.input_tokens ?? st.ctxTokens
        break
      default:
        if (/approval_request$/.test(p.type || '')) {
          const what = [].concat(p.command || []).join(' ') || (p.changes && 'aplicar alterações') || 'ação'
          st.waitingFor = `aprovar ${clip(what, 60)}`
        }
    }
  } else if (o.type === 'response_item') {
    if (['function_call', 'custom_tool_call', 'local_shell_call'].includes(p.type)) {
      st.steps++
      st.waitingFor = null
      st.action = describeCall(p)
      pushEvent(st, o.timestamp, 'tool', st.action)
    } else if (p.type === 'message' && p.role === 'assistant') {
      const text = (p.content || []).filter((c) => c.type === 'output_text').map((c) => c.text).join(' ')
      if (text.trim()) st.action = clip(text, 110)
    }
  }
}

const track = makeTracker(() => ({ sessionId: null, cwd: null, startedAt: null, app: null, version: null, open: false, waitingFor: null }), ingest)

// títulos que o Codex dá às conversas
let titles = new Map()
let titlesMtime = 0
function readTitles() {
  try {
    const m = fs.statSync(INDEX).mtimeMs
    if (m === titlesMtime) return titles
    titlesMtime = m
    titles = new Map()
    for (const line of fs.readFileSync(INDEX, 'utf8').split('\n')) {
      try { const o = JSON.parse(line); if (o.id && o.thread_name) titles.set(o.id, o.thread_name) } catch { /* linha vazia */ }
    }
  } catch { /* sem índice */ }
  return titles
}

const subdirs = (d) => { try { return fs.readdirSync(d).filter((n) => /^\d+$/.test(n)).sort().reverse() } catch { return [] } }

// As pastas são por dia; basta olhar as três mais recentes.
function recentFiles(now) {
  const days = []
  for (const y of subdirs(SESSIONS_DIR)) {
    for (const m of subdirs(path.join(SESSIONS_DIR, y))) {
      for (const d of subdirs(path.join(SESSIONS_DIR, y, m))) {
        days.push(path.join(SESSIONS_DIR, y, m, d))
        if (days.length >= 3) break
      }
      if (days.length >= 3) break
    }
    if (days.length >= 3) break
  }
  const files = []
  for (const d of days) {
    let names = []
    try { names = fs.readdirSync(d) } catch { continue }
    for (const n of names) {
      if (!n.endsWith('.jsonl')) continue
      const f = path.join(d, n)
      try { if (now - fs.statSync(f).mtimeMs < ACTIVE_MS) files.push(f) } catch { /* sumiu */ }
    }
  }
  return files
}

export function collect(now) {
  const files = recentFiles(now)
  track.forget(new Set(files))
  const names = readTitles()
  return files.map((f) => {
    const st = track(f)
    const sid = st.sessionId || path.basename(f, '.jsonl').slice(-36)
    const status = st.open ? (st.waitingFor ? 'waiting' : 'busy') : 'idle'
    return {
      pid: null,
      sessionId: `codex:${sid}`,
      name: path.basename(st.cwd || '') || 'codex',
      cwd: st.cwd,
      status,
      waitingFor: st.waitingFor,
      startedAt: st.startedAt,
      statusUpdatedAt: Date.parse(st.lastTs) || st.mtime,
      app: st.app,
      version: st.version,
      title: names.get(sid) || null,
      lastPrompt: st.lastPrompt,
      model: st.model,
      branch: st.branch,
      action: st.action,
      steps: st.steps,
      outTokens: st.outTokens,
      ctxTokens: st.ctxTokens,
      lastTs: st.lastTs,
      events: st.events,
      subagents: [],
    }
  })
}
