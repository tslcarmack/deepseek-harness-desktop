/** Preload-invoke fetch for Session-log ZIP bytes when `window.dshDesktop` is present. */

type DesktopInvoke = (request: {
  url: string
  method: string
  headers: Record<string, string>
  body: string | null
}) => Promise<{
  status: number
  headers: Record<string, string>
  body: string
  bodyEncoding?: 'utf8' | 'base64'
}>

/**
 * Read `window.dshDesktop.invoke` when the desktop preload bridge is present.
 * @returns the invoke function, or `undefined` on Web.
 */
export function readDesktopInvoke(): DesktopInvoke | undefined {
  const candidate = (globalThis as { dshDesktop?: { invoke?: unknown } }).dshDesktop
  if (candidate === null || typeof candidate !== 'object' || typeof candidate.invoke !== 'function') {
    return undefined
  }
  return (candidate.invoke as DesktopInvoke).bind(candidate)
}

/**
 * Unary `/api` fetch through the desktop preload invoke.
 * @param input - request URL; main rewrites it onto loopback.
 * @param init - method; Session export sends no request body.
 * @returns HTTP-shaped Response, with ZIP bodies decoded from base64.
 */
export async function desktopDoFetch(input: string | URL, init?: RequestInit): Promise<Response> {
  const invoke = readDesktopInvoke()
  if (invoke === undefined) throw new Error('desktop-app: desktop invoke missing')
  const url = input instanceof URL ? input : new URL(String(input))
  const reply = await invoke({
    url: url.href,
    method: init?.method ?? 'GET',
    headers: {},
    body: null,
  })
  if (reply.bodyEncoding !== 'base64') {
    return new Response(reply.body, { status: reply.status, headers: reply.headers })
  }
  return new Response(Uint8Array.from(atob(reply.body), char => char.charCodeAt(0)), {
    status: reply.status,
    headers: reply.headers,
  })
}
