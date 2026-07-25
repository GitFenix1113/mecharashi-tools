// ── GCP service account → Firestore access token ──────────────────────────────
// Cloudflare Workers 是 V8 isolate，不能跑 Node 的 firebase-admin（依賴 gRPC / Node API）。
// 改用「自簽 JWT + OAuth2 token 交換」：用 service account 的私鑰簽一個 JWT，
// 打 Google OAuth2 token endpoint 換一個 access token，再拿它呼叫 Firestore REST。
// 簽章走 Web Crypto（Workers 原生支援 RS256 / RSASSA-PKCS1-v1_5）。

export interface ServiceAccount {
  client_email: string
  private_key: string
  token_uri: string
  project_id: string
}

/** 解析存在 CF Secret（或本機 .dev.vars）裡的 service account JSON 字串。 */
export function parseServiceAccount(raw: string): ServiceAccount {
  const sa = JSON.parse(raw) as Partial<ServiceAccount>
  if (!sa.client_email || !sa.private_key || !sa.project_id) {
    throw new Error('service account JSON 缺少必要欄位（client_email / private_key / project_id）')
  }
  return {
    client_email: sa.client_email,
    private_key: sa.private_key,
    token_uri: sa.token_uri ?? 'https://oauth2.googleapis.com/token',
    project_id: sa.project_id,
  }
}

// base64url（JWT 用，不含 padding、+/ 換成 -_）
function base64url(input: ArrayBuffer | string): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// PEM（private_key）→ ArrayBuffer（PKCS8 DER），供 Web Crypto importKey
function pemToArrayBuffer(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '')
  const bin = atob(body)
  const buf = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
  return buf.buffer
}

async function signJwt(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const claim = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/datastore', // Firestore 讀寫
    aud: sa.token_uri,
    iat: now,
    exp: now + 3600,
  }
  const unsigned = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claim))}`

  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToArrayBuffer(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned))
  return `${unsigned}.${base64url(sig)}`
}

// ── access token 快取（module scope，同一 isolate 復用，避免每個請求都換票）──────
interface CachedToken { token: string; expiresAt: number }
let cached: CachedToken | null = null

/**
 * 取得 Firestore access token（帶快取）。
 * token 有效期 ~1h，這裡提前 60s 過期以策安全；同一 Worker isolate 內復用。
 */
export async function getAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Date.now()
  if (cached && cached.expiresAt > now + 60_000) return cached.token

  const jwt = await signJwt(sa)
  const res = await fetch(sa.token_uri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`OAuth2 token 交換失敗 ${res.status}: ${text.slice(0, 200)}`)
  }
  const data = (await res.json()) as { access_token: string; expires_in: number }
  cached = { token: data.access_token, expiresAt: now + data.expires_in * 1000 }
  return data.access_token
}
