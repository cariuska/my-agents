// Fonte: GitHub Copilot Chat no VS Code (inclui o agent mode). Cada conversa
// fica em <User>/workspaceStorage/<hash>/chatSessions/<id>.jsonl, gravada como
// um log de alterações: kind 0 = estado inicial, 1 = troca um valor no
// caminho `k`, 2 = acrescenta itens a uma lista (cortando antes em `i`, se vier).
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { clip, makeTracker, pushEvent } from '../tail.js'
import { ACTIVE_MS } from './window.js'

export const id = 'copilot'
export const label = 'GitHub Copilot'

const STALE_MS = 10 * 60 * 1000 // pedido "em andamento" sem escrever há mais que isso = VS Code fechou no meio
const RESCAN_MS = 10 * 1000

function userDirs() {
  if (process.env.VSCODE_USER_DIR) return [{ dir: process.env.VSCODE_USER_DIR, app: 'VS Code' }]
  const base =
    process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support')
    : process.platform === 'win32' ? process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
    : process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
  return [['Code', 'VS Code'], ['Code - Insiders', 'VS Code Insiders']]
    .map(([d, app]) => ({ dir: path.join(base, d, 'User'), app }))
    .filter((u) => fs.existsSync(u.dir))
}

export const dir = userDirs()[0]?.dir || null

// Estados de resposta do VS Code: 0 em andamento, 1 concluída, 2 cancelada, 3 falhou, 4 precisa de você.
const PENDING = 0
const NEEDS_INPUT = 4

function mdText(v) {
  const s = typeof v === 'string' ? v : v?.value || ''
  return s
    .replace(/\[([^\]]*)\]\(file:\/\/([^)]+)\)/g, (_, t, p) => t || path.basename(decodeURIComponent(p.split('#')[0])))
    .replace(/\\(.)/g, '$1').replace(/`/g, '')
}

function partSummary(p) {
  if (p.kind === 'toolInvocationSerialized' || p.kind === 'toolInvocation') {
    const msg = mdText(p.isComplete && p.pastTenseMessage ? p.pastTenseMessage : p.invocationMessage)
    return { tool: true, id: p.toolCallId, text: clip(msg.replace(/^Running\s+/, '') || p.toolId || 'ferramenta', 110) }
  }
  if (p.kind === 'textEditGroup' && p.uri) {
    return { tool: true, id: `edit:${p.uri.path || p.uri.fsPath}`, text: `editar: ${path.basename(p.uri.path || p.uri.fsPath || '')}` }
  }
  if (p.kind === 'markdownContent' || (!p.kind && p.value)) {
    const t = mdText(p.content || p.value)
    return t.trim() ? { tool: false, text: t } : null
  }
  return null
}

function addParts(st, req, parts, at) {
  if (typeof at === 'number') req.parts.length = Math.min(req.parts.length, at)
  for (const p of parts || []) {
    const s = partSummary(p)
    if (!s) continue
    req.parts.push(s)
    if (s.tool && s.id && !st.seen.has(s.id)) {
      st.seen.add(s.id)
      pushEvent(st, new Date(st.mtime).toISOString(), 'tool', s.text)
    }
  }
}

function addRequests(st, list, at) {
  if (typeof at === 'number') st.reqs.length = Math.min(st.reqs.length, at)
  for (const r of list || []) {
    const req = {
      text: r.message?.text || '',
      ts: r.timestamp || st.mtime,
      model: r.modelId || r.agent?.id || null,
      state: r.modelState?.value ?? (r.result ? 1 : PENDING),
      parts: [],
    }
    st.reqs.push(req)
    if (req.text.trim() && !st.seen.has(r.requestId)) {
      st.seen.add(r.requestId)
      pushEvent(st, new Date(req.ts).toISOString(), 'prompt', clip(req.text, 140))
    }
    addParts(st, req, r.response)
  }
}

function finish(st, i) {
  const req = st.reqs[i]
  if (!req || st.seen.has(`done:${i}`)) return
  st.seen.add(`done:${i}`)
  const last = [...req.parts].reverse().find((p) => !p.tool)
  if (last) pushEvent(st, new Date(st.mtime).toISOString(), 'text', clip(last.text, 140))
}

function ingest(st, line) {
  const o = JSON.parse(line)
  const k = o.k || []
  if (o.kind === 0) {
    st.reqs = []
    st.title = o.v?.customTitle || st.title
    st.startedAt = o.v?.creationDate || null
    addRequests(st, o.v?.requests)
    return
  }
  if (k[0] === 'customTitle' && o.kind === 1) { st.title = o.v; return }
  if (k[0] !== 'requests') return
  if (k.length === 1) {
    if (o.kind === 1) addRequests(st, o.v, 0)
    else if (o.kind === 2) addRequests(st, o.v, o.i)
    return
  }
  const req = st.reqs[k[1]]
  if (!req) return
  if (k[2] === 'response') addParts(st, req, o.v, o.kind === 1 ? 0 : o.i)
  else if (k[2] === 'modelState' && o.v) {
    req.state = o.v.value
    if (req.state !== PENDING && req.state !== NEEDS_INPUT) finish(st, k[1])
  } else if (k[2] === 'result') {
    if (req.state === PENDING) req.state = 1
    finish(st, k[1])
  }
}

const track = makeTracker(() => ({ reqs: [], seen: new Set(), startedAt: null }), ingest)

// ---------- descoberta dos arquivos ----------

let listed = []
let listedAt = 0
const workspaces = new Map() // pasta workspaceStorage/<hash> -> caminho do projeto

function workspaceFolder(wsDir) {
  if (workspaces.has(wsDir)) return workspaces.get(wsDir)
  let folder = null
  try {
    const w = JSON.parse(fs.readFileSync(path.join(wsDir, 'workspace.json'), 'utf8'))
    const uri = w.folder || w.workspace
    if (uri?.startsWith('file:')) folder = fileURLToPath(uri).replace(/\.code-workspace$/, '')
  } catch { /* janela sem pasta */ }
  workspaces.set(wsDir, folder)
  return folder
}

function listFiles(now) {
  if (now - listedAt < RESCAN_MS) return listed
  listedAt = now
  listed = []
  for (const u of userDirs()) {
    const dirs = []
    const ws = path.join(u.dir, 'workspaceStorage')
    try { for (const h of fs.readdirSync(ws)) dirs.push({ chat: path.join(ws, h, 'chatSessions'), ws: path.join(ws, h) }) } catch { /* sem workspaces */ }
    dirs.push({ chat: path.join(u.dir, 'globalStorage', 'emptyWindowChatSessions'), ws: null })
    for (const d of dirs) {
      let names
      try { names = fs.readdirSync(d.chat) } catch { continue }
      for (const n of names) if (n.endsWith('.jsonl')) listed.push({ file: path.join(d.chat, n), ws: d.ws, app: u.app })
    }
  }
  return listed
}

export function collect(now) {
  const active = listFiles(now).filter((f) => {
    try { return now - fs.statSync(f.file).mtimeMs < ACTIVE_MS } catch { return false }
  })
  track.forget(new Set(active.map((f) => f.file)))

  const out = []
  for (const f of active) {
    const st = track(f.file)
    const last = st.reqs[st.reqs.length - 1]
    if (!last) continue // conversa aberta mas ainda sem pedido
    const cwd = f.ws ? workspaceFolder(f.ws) : null
    const stale = now - st.mtime > STALE_MS
    const status = last.state === NEEDS_INPUT ? 'waiting' : last.state === PENDING && !stale ? 'busy' : 'idle'
    const lastPart = last.parts[last.parts.length - 1]
    const model = [...st.reqs].reverse().find((r) => r.model)?.model
    out.push({
      pid: null,
      sessionId: `copilot:${path.basename(f.file, '.jsonl')}`,
      name: cwd ? path.basename(cwd) : 'copilot',
      cwd,
      status,
      waitingFor: status === 'waiting' ? 'confirmar ação' : null,
      startedAt: st.startedAt || st.reqs[0]?.ts || null,
      statusUpdatedAt: st.mtime,
      app: f.app,
      version: null,
      title: st.title,
      lastPrompt: last.text || null,
      model: model ? model.replace(/^copilot\//, '') : null,
      branch: null,
      action: lastPart ? clip(lastPart.text, 110) : null,
      steps: st.reqs.reduce((n, r) => n + r.parts.filter((p) => p.tool).length, 0),
      outTokens: null, // o Copilot não grava uso de tokens
      ctxTokens: null,
      lastTs: new Date(st.mtime).toISOString(),
      events: st.events,
      subagents: [],
    })
  }
  return out
}
