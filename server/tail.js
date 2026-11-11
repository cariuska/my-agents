// Leitura incremental de arquivos .jsonl: a cada chamada lê só o que foi
// acrescentado desde a última vez e entrega linha a linha para `ingest`.
import fs from 'node:fs'
import { StringDecoder } from 'node:string_decoder'

export const MAX_EVENTS = 40

export function clip(s, n) {
  s = String(s ?? '').replace(/\s+/g, ' ').trim()
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

export function pushEvent(st, ts, kind, text) {
  st.events.push({ ts, kind, text })
  if (st.events.length > MAX_EVENTS) st.events.shift()
}

// Campos comuns a todas as fontes; cada fonte acrescenta os seus em `extra()`.
export function baseState() {
  return {
    offset: 0, rest: '', decoder: new StringDecoder('utf8'), mtime: 0,
    title: null, lastPrompt: null, model: null, action: null, branch: null,
    steps: 0, outTokens: 0, ctxTokens: 0, lastTs: null, events: [],
  }
}

export function makeTracker(extra, ingest) {
  const tracked = new Map() // arquivo -> estado acumulado
  const fresh = () => Object.assign(baseState(), extra())

  function track(file) {
    let st = tracked.get(file)
    if (!st) tracked.set(file, (st = fresh()))
    let stat
    try { stat = fs.statSync(file) } catch { return st }
    st.mtime = stat.mtimeMs
    if (stat.size < st.offset) { // arquivo foi reescrito: recomeça
      tracked.set(file, (st = fresh()))
      st.mtime = stat.mtimeMs
    }
    if (stat.size === st.offset) return st

    let fd
    try {
      fd = fs.openSync(file, 'r')
      const buf = Buffer.allocUnsafe(1 << 20)
      while (st.offset < stat.size) {
        const n = fs.readSync(fd, buf, 0, Math.min(buf.length, stat.size - st.offset), st.offset)
        if (n <= 0) break
        st.offset += n
        const parts = (st.rest + st.decoder.write(buf.subarray(0, n))).split('\n')
        st.rest = parts.pop()
        for (const line of parts) {
          if (!line) continue
          try { ingest(st, line) } catch { /* linha num formato inesperado: ignora */ }
        }
      }
    } catch { /* arquivo sumiu no meio da leitura: tenta de novo no próximo ciclo */ }
    finally { if (fd !== undefined) fs.closeSync(fd) }
    return st
  }

  // esquece arquivos que saíram da lista (sessões antigas), para não acumular memória
  track.forget = (keep) => { for (const f of tracked.keys()) if (!keep.has(f)) tracked.delete(f) }
  return track
}
