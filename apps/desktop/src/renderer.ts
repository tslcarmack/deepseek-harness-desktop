import { AppWebEntry } from '@deepseek-ai/dsh-client-web'

declare global {
  var dshDesktop: {
    loadBundle(url: string): Promise<string>
  } | undefined
}

const el = document.getElementById('root')
if (el === null) throw new Error('desktop app: missing #root')
const desktop = globalThis.dshDesktop
if (desktop === undefined) throw new Error('desktop app: missing dshDesktop preload bridge')

void new AppWebEntry(el, {
  loadBundle: async (url) => {
    const source = await desktop.loadBundle(url)
    const blob = new Blob([source], { type: 'text/javascript' })
    const blobUrl = URL.createObjectURL(blob)
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script')
      script.src = blobUrl
      script.addEventListener('load', () => { script.remove(); URL.revokeObjectURL(blobUrl); resolve() }, { once: true })
      script.addEventListener('error', () => { script.remove(); URL.revokeObjectURL(blobUrl); reject(new Error(`desktop: bundle ${url} failed`)) }, { once: true })
      document.head.append(script)
    })
  },
}).run()
