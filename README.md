# Meus agentes

Painel desktop para acompanhar, em tempo real, os agentes de código que estão trabalhando na sua máquina: [Claude Code](https://claude.com/claude-code), [Codex](https://github.com/openai/codex) e [GitHub Copilot](https://github.com/features/copilot) (agent mode do VS Code).

Cada agente traz um selo com a origem (**Claude**, **Codex** ou **Copilot**), na mesa, nas listas e na linha do tempo. Os selos no topo também servem de filtro.

Cada sessão aparece como uma pessoa sentada numa mesa de um escritório. Quem está trabalhando fica na mesa, quem está livre vai para o café, e quem precisa de você ganha destaque. Os subagentes ocupam mesas próprias, com uma faixa colorida que mostra a que sessão pertencem.

## O que o painel mostra

- **Escritório**: uma mesa por agente vivo (sessões e subagentes em execução), com balões contando o que cada um está fazendo.
- **Precisa de você**: sessões paradas esperando uma resposta ou permissão sua.
- **Agentes**: todas as sessões abertas e o status de cada uma (trabalhando, no café, esperando).
- **Subagentes rodando**: descrição, sessão de origem e última ação de cada subagente ativo.
- **Detalhes da sessão**: título, último prompt, modelo, branch do git, passos e tokens.
- **Atividade**: linha do tempo com prompts, chamadas de ferramenta, respostas e relatórios de subagentes.
- **Agora**: totais de agentes trabalhando, subagentes rodando, passos e tokens gerados.

A interface consulta o servidor local a cada 2 segundos.

## Como funciona

```
Claude Code ── ~/.claude/sessions + projects/**.jsonl ──┐
Codex ──────── ~/.codex/sessions/AAAA/MM/DD/*.jsonl ────┼──▶ server/index.js ──▶ /api/state ──▶ interface React
Copilot ────── <VS Code>/User/workspaceStorage/*/        │     (127.0.0.1)
               chatSessions/*.jsonl ────────────────────┘
```

- **[server/index.js](server/index.js)**: servidor HTTP em Node, sem dependências. Junta as sessões de todas as fontes, marca cada uma com `source` e devolve o estado agregado em `GET /api/state`. Também serve a interface compilada em `dist/`.
- **[server/sources/](server/sources/)**: uma fonte por agente. Cada uma exporta `id`, `label`, `dir` e `collect(now)`, que devolve as sessões num formato comum.
  - [claude.js](server/sources/claude.js): sessões cujo processo ainda está vivo (pelo pid), mais os subagentes.
  - [codex.js](server/sources/codex.js): arquivos `rollout-*.jsonl`. A sessão está trabalhando entre `task_started` e `task_complete`.
  - [copilot.js](server/sources/copilot.js): conversas do Copilot Chat. O arquivo é um log de alterações, que o servidor reaplica para saber o estado de cada pedido.
- **[server/tail.js](server/tail.js)**: leitura incremental dos `.jsonl` (só o trecho novo a cada consulta), usada por todas as fontes.
- **[electron/main.js](electron/main.js)**: sobe o servidor dentro do próprio app e abre a interface numa janela nativa.
- **[src/](src/)**: interface em React + Vite. [App.jsx](src/App.jsx) monta o painel, [Office.jsx](src/Office.jsx) desenha o escritório em SVG e [names.js](src/names.js) dá um nome fixo a cada agente (guardado no `localStorage`).

### Privacidade

O servidor escuta só em `127.0.0.1`. Ele apenas lê os arquivos locais dos agentes e nada sai da sua máquina.

### Adicionar outro agente

Crie um arquivo em `server/sources/` com os mesmos exports das outras fontes, inclua-o em `SOURCES` no [server/index.js](server/index.js) e adicione o rótulo e a cor em `SOURCES`, no [src/format.js](src/format.js).

## Requisitos

- Node.js 20 ou mais recente
- Pelo menos um dos agentes (Claude Code, Codex ou Copilot no VS Code) instalado. Fontes que não existem na máquina aparecem apagadas no filtro.

## Instalação

```bash
npm install
```

## Uso

| Comando | O que faz |
| --- | --- |
| `npm run dev` | Abre o app Electron em modo de desenvolvimento, com hot reload pelo Vite |
| `npm run dev:web` | Roda servidor e interface no navegador, em <http://127.0.0.1:5173> |
| `npm start` | Compila a interface e serve tudo em <http://127.0.0.1:4317> |
| `npm run app` | Compila a interface e abre o app Electron |
| `npm run build` | Só compila a interface para `dist/` |
| `npm run dist` | Gera os instaladores em `release/` (`.dmg`/`.zip` no macOS, NSIS no Windows, AppImage no Linux) |

### Variáveis de ambiente

| Variável | Padrão | Uso |
| --- | --- | --- |
| `CLAUDE_DIR` | `~/.claude` | Pasta de dados do Claude Code |
| `CODEX_HOME` | `~/.codex` | Pasta de dados do Codex |
| `VSCODE_USER_DIR` | pasta `User` do VS Code e do VS Code Insiders | Onde procurar as conversas do Copilot |
| `MY_AGENTS_ACTIVE_MIN` | `30` | Por quantos minutos uma sessão do Codex ou do Copilot continua no painel depois da última escrita |
| `PORT` | `4317` | Porta do servidor no modo navegador |
| `MY_AGENTS_DIST` | `./dist` | Pasta com a interface compilada |

Exemplo:

```bash
CLAUDE_DIR=/outro/caminho/.claude npm start
```

## Status dos agentes

| Status | Significado |
| --- | --- |
| Trabalhando | A sessão está processando um pedido |
| No café | A sessão está aberta, mas ociosa |
| Precisa de você | A sessão está esperando sua resposta ou permissão |
| Subagente rodando | O subagente escreveu no transcript nos últimos 5 minutos e ainda não terminou |

Passos e tokens valem só para as sessões abertas e zeram quando a sessão fecha. O Copilot não grava uso de tokens, então ali aparece `—`.

## Observações

- O build de macOS não é assinado (`identity: null`). Na primeira vez, abra o app com clique direito → **Abrir** para passar pelo Gatekeeper.
- Codex e Copilot não registram se a conversa ainda está aberta. Por isso, uma sessão deles fica no painel por `MY_AGENTS_ACTIVE_MIN` minutos depois da última atividade.
- Subagentes só aparecem para o Claude Code.
- O painel depende do formato interno dos arquivos de cada agente, que pode mudar entre versões.

## Licença

[MIT](LICENSE) © 2026 Thiago Cariuska
