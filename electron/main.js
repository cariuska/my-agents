// Processo principal do Electron: sobe o servidor local (que lê ~/.claude)
// dentro do próprio app e abre a interface React numa janela nativa.
import { app, BrowserWindow, shell } from 'electron'
import { startServer } from '../server/index.js'

const DEV_URL = process.env.VITE_DEV_SERVER_URL // definido pelo `npm run dev`

let win = null
let appUrl = null

async function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    title: 'Meus agentes',
    backgroundColor: '#020a12',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })

  // Links externos abrem no navegador padrão, não dentro do app.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    shell.openExternal(target)
    return { action: 'deny' }
  })

  await win.loadURL(appUrl)
  win.on('closed', () => { win = null })
}

app.whenReady().then(async () => {
  // Em dev o Vite faz proxy de /api para a porta 4317; empacotado, usa qualquer porta livre.
  const { url } = await startServer({ port: DEV_URL ? 4317 : 0 })
  appUrl = DEV_URL || url
  await createWindow()
})

app.on('activate', () => {
  if (!win && appUrl) createWindow()
})

app.on('window-all-closed', () => app.quit())
