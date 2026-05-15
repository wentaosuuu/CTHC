import jwt from 'jsonwebtoken'
import { env } from './env.js'

export type AdminJwtPayload = {
  adminId: string
}

export function signAdminToken(payload: AdminJwtPayload) {
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: '7d' })
}

export function verifyAdminToken(token: string): AdminJwtPayload {
  const decoded = jwt.verify(token, env.JWT_SECRET)
  if (typeof decoded !== 'object' || decoded === null || !('adminId' in decoded)) {
    throw new Error('Invalid token')
  }
  return decoded as AdminJwtPayload
}

