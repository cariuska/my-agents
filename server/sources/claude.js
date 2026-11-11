// Fonte: Claude Code. Lê ~/.claude/sessions (um .json por processo aberto)
// e os transcripts em ~/.claude/projects, incluindo os subagentes.
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { clip, makeTracker, pushEvent } from '../tail.js'

export const id = 'claude'
export const label = 'Claude Code'
export const dir = process.env.CLAUDE_DIR || path.join(os.homedir(), '.claude')

const SESSIONS_DIR = path.join(dir, 'sessions')
const PROJECTS_DIR = path.join(dir, 'projects')
const SUBAGENT_QUIET_MS = 5 * 60 * 1000 // sem escrever há mais que isso = parado

function describeTool(name, input = {}) {
  if (name.startsWith('mcp__')) name = name.split('__').pop() // mcp__servidor__ferramenta -> ferramenta
  const detail =
    input.description ||
    (input.file_path && path.basename(input.file_path)) ||
    input.pattern || input.command || input.query || input.url || input.skill || input.prompt || ''
  return detail ? `${name}: ${clip(detail, 90)}` : name
}

function ingest(st, line) {
  if (line.startsWith('{"type":"api-request')) return // blobs grandes, sem uso aqui
  const o = JSON.parse(line)
  if (o.timestamp) {
    st.lastTs = o.timestamp
    if (!st.firstTs) st.firstTs = o.timestamp
  }
  if (o.cwd) st.cwd = o.cwd
  if (o.entrypoint) st.entrypoint = o.entrypoint
  if (o.version) st.version = o.version
  if (o.gitBranch && o.gitBranch !== 'HEAD') st.branch = o.gitBranch

  if (o.type === 'ai-title') st.title = o.aiTitle
  else if (o.type === 'last-prompt') st.lastPrompt = o.lastPrompt
  else if (o.type === 'user') {
    const c = o.message?.content
    let text = null
    if (typeof c === 'string') text = c
    else if (Array.isArray(c) && !c.some((b) => b.type === 'tool_result')) {
      text = c.filter((b) => b.type === 'text').map((b) => b.text).join(' ')
    }
    if (text && /<agent-message|^Another Claude session sent a message/.test(text.trimStart())) {
      pushEvent(st, o.timestamp, 'handback', 'Recebeu o relatório de um subagente')
    } else if (text && !text.trimStart().startsWith('<')) {
      st.lastStop = null
      pushEvent(st, o.timestamp, 'prompt', clip(text, 140))
    }
  } else if (o.type === 'assistant') {
    const m = o.message || {}
    const synthetic = m.model === '<synthetic>' // avisos gerados localmente, sem uso real de tokens
    if (m.model && !synthetic) st.model = m.model
    const u = m.usage
    if (u && !synthetic) {
      st.ctxTokens = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0)
      const out = u.output_tokens || 0
      // a mesma mensagem pode aparecer em várias linhas (uma por bloco)
      if (m.id && m.id === st.lastMsgId) st.outTokens += out - st.lastMsgOut
      else st.outTokens += out
      st.lastMsgId = m.id
      st.lastMsgOut = out
    }
    for (const b of Array.isArray(m.content) ? m.content : []) {
      if (b.type === 'tool_use') {
        st.handedBack = b.name === 'SubagentHandback' // entregou o relatório final à sessão
        st.steps++
        st.action = describeTool(b.name, b.input)
        pushEvent(st, o.timestamp, 'tool', st.action)
      } else if (b.type === 'text' && b.text?.trim()) {
        st.action = clip(b.text, 110)
        if (m.stop_reason === 'end_turn') pushEvent(st, o.timestamp, 'text', clip(b.text, 140))
      }
    }
    st.lastStop = synthetic ? 'halted' : m.stop_reason || null // aviso sintético = parou por erro/limite
  }
}

const track = makeTracker(
  () => ({ lastMsgId: null, lastMsgOut: 0, lastStop: null, handedBack: false, firstTs: null, cwd: null, entrypoint: null, version: null }),
  ingest,
)

// Sessões em devcontainer: o PID delas é do container, então não dá para
// testar se estão vivas daqui, e a limpeza do Claude no Mac apaga o .json de
// registro delas. Elas são reconhecidas pelo transcript, em pastas de projeto
// fora do home do Mac (ex.: cwd /casl-api -> ~/.claude/projects/-casl-api).
const HOST_PREFIX = os.homedir().replace(/[^a-zA-Z0-9]/g, '-')
const FOREIGN_WINDOW_MS = 20 * 60 * 1000 // sem escrever há mais que isso = sessão fechada
const FOREIGN_BUSY_MS = 10 * 60 * 1000

function isForeignDomain(s) {
  return !!s.pidDomain && s.pidDomain !== process.platform
}

// Último momento em que o transcript ou algum subagente dele foi escrito.
function lastWrite(transcript) {
  let t = 0
  try { t = fs.statSync(transcript).mtimeMs } catch { return 0 }
  const subDir = path.join(transcript.replace(/\.jsonl$/, ''), 'subagents')
  let names = []
  try { names = fs.readdirSync(subDir) } catch { return t }
  for (const n of names) {
    if (!n.endsWith('.jsonl')) continue
    try { t = Math.max(t, fs.statSync(path.join(subDir, n)).mtimeMs) } catch {}
  }
  return t
}

function foreignStatus(st, now) {
  if (st.lastStop === 'end_turn' || st.lastStop === 'halted') return 'idle'
  return now - st.mtime < FOREIGN_BUSY_MS ? 'busy' : 'idle'
}

function isAlive(pid) {
  try { process.kill(pid, 0); return true } catch (e) { return e.code === 'EPERM' }
}

const transcriptPaths = new Map() // sessionId -> caminho do .jsonl
function findTranscript(sessionId) {
  const hit = transcriptPaths.get(sessionId)
  if (hit && fs.existsSync(hit)) return hit
  let dirs = []
  try { dirs = fs.readdirSync(PROJECTS_DIR) } catch { return null }
  for (const d of dirs) {
    const p = path.join(PROJECTS_DIR, d, `${sessionId}.jsonl`)
    if (fs.existsSync(p)) { transcriptPaths.set(sessionId, p); return p }
  }
  return null
}

const metaCache = new Map()
function readMeta(file) {
  if (metaCache.has(file)) return metaCache.get(file)
  try {
    const meta = JSON.parse(fs.readFileSync(file, 'utf8'))
    metaCache.set(file, meta)
    return meta
  } catch { return {} }
}

function readSubagents(transcript, now) {
  const subDir = path.join(transcript.replace(/\.jsonl$/, ''), 'subagents')
  let names = []
  try { names = fs.readdirSync(subDir) } catch { return [] }
  return names
    .filter((n) => n.endsWith('.jsonl'))
    .map((n) => {
      const st = track(path.join(subDir, n))
      const meta = readMeta(path.join(subDir, n.replace(/\.jsonl$/, '.meta.json')))
      const status =
        st.lastStop === 'end_turn' || st.handedBack ? 'done'
        : st.lastStop === 'halted' ? 'stopped'
        : now - st.mtime < SUBAGENT_QUIET_MS ? 'running'
        : 'stopped'
      return {
        id: n.replace(/^agent-|\.jsonl$/g, ''),
        description: meta.description || meta.agentType || 'subagente',
        agentType: meta.agentType || null,
        model: st.model || meta.pickedEffortModel || null,
        status,
        action: st.action,
        steps: st.steps,
        outTokens: st.outTokens,
        lastTs: st.lastTs,
        events: st.events,
      }
    })
    .sort((a, b) => String(b.lastTs).localeCompare(String(a.lastTs)))
}

// Devolve as sessões abertas no formato comum, cada uma com os eventos e subagentes.
export function collect(now) {
  let files = []
  try { files = fs.readdirSync(SESSIONS_DIR).filter((f) => /^\d+\.json$/.test(f)) } catch { return [] }

  const out = []
  const seen = new Set()
  for (const f of files) {
    let s
    try { s = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, f), 'utf8')) } catch { continue }
    const foreign = isForeignDomain(s)
    if (!s.pid || (!foreign && !isAlive(s.pid))) continue

    const transcript = s.sessionId && findTranscript(s.sessionId)
    if (foreign && (!transcript || now - lastWrite(transcript) > FOREIGN_WINDOW_MS)) continue
    const st = transcript ? track(transcript) : null
    const subagents = transcript ? readSubagents(transcript, now) : []
    const status = s.status || (st && now - st.mtime < 30_000 ? 'busy' : 'idle')
    seen.add(s.sessionId)

    out.push({
      container: foreign,
      pid: foreign ? null : s.pid,
      sessionId: s.sessionId,
      name: s.name || path.basename(s.cwd || '') || `pid ${s.pid}`,
      cwd: s.cwd,
      status, // busy | idle | waiting
      waitingFor: s.waitingFor || null,
      startedAt: s.startedAt || null,
      statusUpdatedAt: s.statusUpdatedAt || s.updatedAt || null,
      app: s.entrypoint || null,
      version: s.version || null,
      title: st?.title || null,
      lastPrompt: st?.lastPrompt || null,
      model: st?.model || null,
      branch: st?.branch || null,
      action: st?.action || null,
      steps: st?.steps || 0,
      outTokens: st?.outTokens || 0,
      ctxTokens: st?.ctxTokens || 0,
      lastTs: st?.lastTs || null,
      events: st?.events || [],
      subagents,
    })
  }
  out.push(...collectForeign(now, seen))
  return out
}

// Sessões de devcontainer cujo registro sumiu: acha pelos transcripts recentes.
function collectForeign(now, seen) {
  let dirs = []
  try { dirs = fs.readdirSync(PROJECTS_DIR) } catch { return [] }
  const out = []
  for (const d of dirs) {
    if (d.startsWith(HOST_PREFIX)) continue // sessões do Mac vêm do registro
    const projDir = path.join(PROJECTS_DIR, d)
    let names = []
    try { names = fs.readdirSync(projDir) } catch { continue }
    for (const n of names) {
      if (!n.endsWith('.jsonl')) continue
      const sessionId = n.slice(0, -'.jsonl'.length)
      if (seen.has(sessionId)) continue
      const transcript = path.join(projDir, n)
      const written = lastWrite(transcript)
      if (now - written > FOREIGN_WINDOW_MS) continue

      const st = track(transcript)
      if (!st.cwd) continue // transcript sem conversa (ex.: só metadados)
      const subagents = readSubagents(transcript, now)
      const status = subagents.some((a) => a.status === 'running') ? 'busy' : foreignStatus(st, now)
      out.push({
        container: true,
        pid: null,
        sessionId,
        name: path.basename(st.cwd),
        cwd: st.cwd,
        status,
        waitingFor: null,
        startedAt: st.firstTs ? Date.parse(st.firstTs) : null,
        statusUpdatedAt: written || null,
        app: st.entrypoint,
        version: st.version,
        title: st.title,
        lastPrompt: st.lastPrompt,
        model: st.model,
        branch: st.branch,
        action: st.action,
        steps: st.steps,
        outTokens: st.outTokens,
        ctxTokens: st.ctxTokens,
        lastTs: st.lastTs,
        events: st.events,
        subagents,
      })
    }
  }
  return out
}
