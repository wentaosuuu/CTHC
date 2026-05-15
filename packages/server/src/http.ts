import type { Request } from 'express'

export function getBearerToken(req: Request) {
  const h = req.header('authorization')
  if (!h) return null
  const m = h.match(/^Bearer\s+(.+)$/i)
  return m?.[1] ?? null
}

