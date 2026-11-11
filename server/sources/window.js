// Codex e Copilot não registram se a sessão ainda está aberta. Para eles, uma
// sessão aparece no painel enquanto tiver escrito no disco nos últimos N minutos.
export const ACTIVE_MS = Number(process.env.MY_AGENTS_ACTIVE_MIN || 30) * 60 * 1000
