import { useEffect, useState } from 'react'
import Office from './Office.jsx'
import { SOURCES, clip, clock, dur, shortModel, sourceOf, statusOf, tokens } from './format.js'
import { agentKey, useNames } from './names.js'

const POLL_MS = 2000

function useAgents() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => {
    let stop = false
    const load = async () => {
      try {
        const r = await fetch('/api/state')
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const json = await r.json()
        if (!stop) { setData(json); setError(null) }
      } catch (e) {
        if (!stop) setError(e.message)
      }
    }
    load()
    const t = setInterval(load, POLL_MS)
    return () => { stop = true; clearInterval(t) }
  }, [])
  return { data, error }
}

// Anel do cabeçalho: quantos agentes (sessões + subagentes) estão trabalhando agora.
function Ring({ value, total }) {
  const C = 2 * Math.PI * 22
  const frac = total ? value / total : 0
  return (
    <svg className="ring" viewBox="0 0 64 64" role="img" aria-label={`${value} de ${total} agentes trabalhando`}>
      <circle className="ring-spin" cx="32" cy="32" r="29" fill="none" stroke="var(--cyan)" strokeWidth="1" strokeDasharray="3 7" opacity="0.6" />
      <circle cx="32" cy="32" r="22" fill="none" stroke="var(--line)" strokeWidth="4" />
      <circle cx="32" cy="32" r="22" fill="none" stroke="var(--cyan)" strokeWidth="4" strokeDasharray={`${C * frac} ${C}`} transform="rotate(-90 32 32)" />
      <text x="32" y="38" textAnchor="middle">{value}</text>
    </svg>
  )
}

function Dot({ status }) {
  return <span className="dot" style={{ background: statusOf(status).color }} />
}

// Selo com a origem do agente (Claude, Codex, Copilot…).
function SourceTag({ id }) {
  const src = sourceOf(id)
  return <span className="src" style={{ color: src.color, borderColor: src.color }}>{src.label}</span>
}

function Panel({ title, tone, children }) {
  return (
    <section className={`panel${tone ? ' panel-' + tone : ''}`}>
      <h2>{title}</h2>
      {children}
    </section>
  )
}

function Detail({ s, now, nameOf }) {
  const running = s.subagents.filter((a) => a.status === 'running')
  const st = statusOf(s.status)
  return (
    <section className="panel detail">
      <header>
        <h1><SourceTag id={s.source} /> <span className="tag">{nameOf(agentKey(s.sessionId)).name}</span> {s.title || s.project}</h1>
        <span className="meta">{s.container ? 'devcontainer · ' : ''}{s.app ? `${s.app} · ` : ''}{s.name} · {s.startedAt ? `${dur(now - s.startedAt)} · ` : ''}{shortModel(s.model)}</span>
      </header>
      <p className="statusline" style={{ color: st.color }}>
        {s.status === 'idle' ? 'No café' : st.label}{s.statusUpdatedAt ? ` há ${dur(now - s.statusUpdatedAt)}` : ''}
        {s.status === 'waiting' && s.waitingFor ? ` — ${s.waitingFor}` : ''}
      </p>
      <dl className="stats">
        <div><dt>passos</dt><dd>{s.steps}</dd></div>
        <div><dt>contexto</dt><dd>{tokens(s.ctxTokens)}</dd></div>
        <div><dt>tokens gerados</dt><dd>{tokens(s.outTokens)}</dd></div>
        {s.source === 'claude' && <div><dt>subagentes</dt><dd>{running.length}<small> de {s.subagents.length}</small></dd></div>}
      </dl>
      {s.action && <p className="line"><b>{s.status === 'busy' ? 'Agora' : 'Última ação'}:</b> {s.action}</p>}
      {s.lastPrompt && <p className="line muted"><b>Seu pedido:</b> {clip(s.lastPrompt, 260)}</p>}
      <p className="line muted path">{s.cwd || 'sem pasta'}{s.branch ? ` · ${s.branch}` : ''}{s.pid ? ` · pid ${s.pid}` : ''}</p>
      {s.subagents.length > 0 && (
        <ul className="subs">
          {s.subagents.map((a) => (
            <li key={a.id}>
              <Dot status={a.status} />
              <span className="sub-name"><b>{nameOf(agentKey(s.sessionId, a.id)).name}</b> {a.description}</span>
              <span className="sub-action">{a.status === 'running' ? a.action || '…' : statusOf(a.status).label}</span>
              <span className="sub-steps">{a.steps} passos</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default function App() {
  const { data, error } = useAgents()
  const nameOf = useNames(data?.sessions || [])
  const [selectedId, setSelectedId] = useState(null)
  const [only, setOnly] = useState('all') // filtro por origem
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  if (!data) {
    return (
      <main className="empty">
        <h1>Meus agentes</h1>
        <p>{error ? 'O servidor local não respondeu. Inicie com “npm run dev” nesta pasta.' : 'Abrindo o escritório…'}</p>
      </main>
    )
  }

  const sources = data.sources || []
  const pick = (x) => only === 'all' || x.source === only
  const sessions = data.sessions.filter(pick)
  const activity = data.activity.filter(pick)
  const selected =
    sessions.find((s) => s.sessionId === selectedId) ||
    sessions.find((s) => s.status === 'waiting') ||
    sessions.find((s) => s.status === 'busy') ||
    sessions[0]
  const needsYou = sessions.filter((s) => s.status === 'waiting')
  const allSubs = sessions.flatMap((s) => s.subagents.map((a) => ({ ...a, session: s.name, sessionId: s.sessionId })))
  const runningSubs = allSubs.filter((a) => a.status === 'running')
  const totals = {
    busy: sessions.filter((s) => s.status === 'busy').length,
    steps: sessions.reduce((n, s) => n + s.steps, 0) + allSubs.reduce((n, a) => n + a.steps, 0),
    out: sessions.reduce((n, s) => n + (s.outTokens || 0), 0) + allSubs.reduce((n, a) => n + (a.outTokens || 0), 0),
  }

  return (
    <main className="layout">
      <header className="hud">
        <Ring value={totals.busy + runningSubs.length} total={sessions.length + runningSubs.length} />
        <div className="hud-title">
          <h1>Central de agentes</h1>
          <p>{sessions.length} {sessions.length === 1 ? 'sessão' : 'sessões'} · {runningSubs.length} {runningSubs.length === 1 ? 'subagente' : 'subagentes'}</p>
        </div>
        <nav className="sources" aria-label="Filtrar por origem">
          <button className={`src-filter${only === 'all' ? ' on' : ''}`} aria-pressed={only === 'all'} onClick={() => setOnly('all')}>
            Todos <b>{data.sessions.length}</b>
          </button>
          {sources.map((src) => (
            <button
              key={src.id}
              className={`src-filter${only === src.id ? ' on' : ''}${src.found ? '' : ' off'}`}
              style={{ '--src': sourceOf(src.id).color }}
              aria-pressed={only === src.id}
              title={src.error ? `Erro ao ler: ${src.error}` : src.found ? src.dir : `${src.label} não encontrado nesta máquina`}
              onClick={() => setOnly(only === src.id ? 'all' : src.id)}
            >
              {sourceOf(src.id).label} <b>{src.sessions}</b>
            </button>
          ))}
        </nav>
        <div className={`hud-state${needsYou.length ? ' hud-alert' : ''}`}>
          {needsYou.length ? `${needsYou.length} esperando por você` : error ? 'sem sinal' : 'sistemas online'}
        </div>
        <time className="hud-clock">{clock(now)}</time>
      </header>
      <div className="main">
        <div className="scene">
          <Office sessions={sessions} selectedId={selected?.sessionId} onSelect={setSelectedId} now={now} nameOf={nameOf} />
        </div>

        {error && <p className="warn">Sem resposta do servidor local — mostrando o último estado conhecido.</p>}

        {selected ? <Detail s={selected} now={now} nameOf={nameOf} /> : (
          <section className="panel"><p className="muted">Nenhum agente em execução. Abra uma sessão do Claude Code, Codex ou Copilot e ela aparece aqui numa mesa.</p></section>
        )}

        <ul className="legend">
          <li><Dot status="busy" /> Trabalhando</li>
          <li><span className="dot" style={{ background: 'var(--amber)' }} /> Livre (no café)</li>
          <li><Dot status="waiting" /> Precisa de você</li>
          <li><Dot status="running" /> Subagente</li>
          {Object.entries(SOURCES).map(([id, src]) => (
            <li key={id}><span className="dot" style={{ background: src.color }} /> {src.label}</li>
          ))}
          <li className="legend-note">O nome da origem aparece em cada mesa. A faixa colorida mostra a que sessão o subagente pertence.</li>
        </ul>

        <Panel title="Atividade">
          {activity.length === 0 && <p className="muted">Nada ainda.</p>}
          <ol className="activity">
            {activity.map((e, i) => (
              <li key={i} className={`ev ev-${e.kind}`}>
                <time>{clock(e.ts)}</time>
                <SourceTag id={e.source} />
                <button className="tag link" onClick={() => setSelectedId(e.sessionId)}>{e.session}</button>
                <span className="who">{e.kind === 'prompt' ? 'Você' : nameOf(agentKey(e.sessionId, e.agentId)).name}:</span>
                <span className="what">{e.text}</span>
              </li>
            ))}
          </ol>
        </Panel>
      </div>

      <aside className="side">
        <Panel title="Precisa de você" tone="pink">
          {needsYou.length === 0 && <p className="muted">Ninguém esperando por você.</p>}
          {needsYou.map((s) => (
            <button key={s.sessionId} className="row" onClick={() => setSelectedId(s.sessionId)}>
              <span className="tag"><SourceTag id={s.source} /> {nameOf(agentKey(s.sessionId)).name}</span>
              <span className="row-text">{s.title || s.project}</span>
              <span className="row-aside">{s.waitingFor || 'responder'}</span>
            </button>
          ))}
        </Panel>

        <Panel title="Agentes">
          {sessions.length === 0 && <p className="muted">Nenhuma sessão aberta.</p>}
          {sessions.map((s) => (
            <button key={s.sessionId} className={`row${s.sessionId === selected?.sessionId ? ' row-on' : ''}`} onClick={() => setSelectedId(s.sessionId)}>
              <span className="tag"><SourceTag id={s.source} /> {nameOf(agentKey(s.sessionId)).name}</span>
              <span className="row-text">{s.name} · {s.title || s.project}</span>
              {s.status === 'idle'
                ? <span className="chip" style={{ color: 'var(--amber)', borderColor: 'var(--amber)' }}>no café</span>
                : <span className="chip" style={{ color: statusOf(s.status).color, borderColor: statusOf(s.status).color }}>{statusOf(s.status).label.toLowerCase()}</span>}
            </button>
          ))}
        </Panel>

        <Panel title="Subagentes rodando">
          {runningSubs.length === 0 && <p className="muted">Nenhum subagente rodando.</p>}
          {runningSubs.map((a) => (
            <button key={a.sessionId + a.id} className="row row-sub" onClick={() => setSelectedId(a.sessionId)}>
              <span className="row-text"><Dot status="running" /> <span className="tag">{nameOf(agentKey(a.sessionId, a.id)).name}</span> {a.description}</span>
              <span className="row-aside">{a.session}</span>
              <span className="row-note">{a.action || '…'}</span>
            </button>
          ))}
        </Panel>

        <Panel title="Agora">
          <dl className="stats stats-side">
            <div><dt>agentes trabalhando</dt><dd>{totals.busy}<small> de {sessions.length}</small></dd></div>
            <div><dt>subagentes rodando</dt><dd>{runningSubs.length}</dd></div>
            <div><dt>passos nas sessões</dt><dd>{totals.steps}</dd></div>
            <div><dt>tokens gerados</dt><dd>{tokens(totals.out)}</dd></div>
          </dl>
          <p className="muted small">Passos são as chamadas de ferramenta das sessões abertas, somando os subagentes. Os números zeram quando a sessão fecha. O Copilot não informa tokens.</p>
        </Panel>
      </aside>
    </main>
  )
}
