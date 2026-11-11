// Servidor local: junta as sessões de vários agentes de código (Claude Code,
// Codex, GitHub Copilot) e expõe em /api/state. Escuta só em 127.0.0.1 — os
// transcripts não saem da máquina.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as claude from './sources/claude.js'
import * as codex from './sources/codex.js'
import * as copilot from './sources/copilot.js'

const SOURCES = [claude, codex, copilot]
const PORT = Number(process.env.PORT || 4317)
const DIST = process.env.MY_AGENTS_DIST || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist')

function buildState() {
  const now = Date.now()
  const sessions = []
  const activity = []
  const sources = []
  for (const src of SOURCES) {
    let list = []
    let error = null
    try { list = src.collect(now) } catch (e) { error = String(e?.message || e) } // uma fonte quebrada não derruba as outras
    sources.push({ id: src.id, label: src.label, dir: src.dir, found: !!src.dir && fs.existsSync(src.dir), sessions: list.length, error })

    for (const { events, subagents, ...s } of list) {
      const session = { ...s, source: src.id, project: path.basename(s.cwd || ''), subagents: subagents.map(({ events, ...rest }) => rest) }
      sessions.push(session)
      const base = { session: s.name, sessionId: s.sessionId, source: src.id }
      for (const e of events) activity.push({ ...e, ...base, agent: null })
      for (const sub of subagents) {
        for (const e of sub.events) {
          if (e.kind !== 'prompt') activity.push({ ...e, ...base, agent: sub.description, agentId: sub.id })
        }
      }
    }
  }

  sessions.sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0))
  activity.sort((a, b) => String(b.ts).localeCompare(String(a.ts)))
  return { now, sources, sessions, activity: activity.slice(0, 80) }
}

// ---------- http ----------

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml', '.json': 'application/json' }

function serveStatic(req, res) {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  let file = path.join(DIST, rel)
  if (!file.startsWith(DIST)) { res.writeHead(403).end(); return }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html')
  if (!fs.existsSync(file)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Interface não compilada. Rode "npm run dev" ou "npm start".')
    return
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
}

export function startServer({ port = PORT, host = '127.0.0.1' } = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.url.startsWith('/api/state')) {
        try {
          const body = JSON.stringify(buildState())
          res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
          res.end(body)
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: String(e?.message || e) }))
        }
        return
      }
      serveStatic(req, res)
    })
    server.once('error', reject)
    server.listen(port, host, () => {
      const url = `http://${host}:${server.address().port}`
      for (const src of SOURCES) console.log(`my-agents: ${src.label} → ${src.dir || 'não encontrado'}`)
      console.log(`my-agents: ${url}`)
      resolve({ server, url })
    })
  })
}

// Rodando direto com `node server/index.js` (modo navegador).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startServer()
}
