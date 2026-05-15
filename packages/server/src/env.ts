import { z } from 'zod'

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(8).default('dev-secret-change-me'),
  PORT: z.coerce.number().default(8787),
  ASSET_SYNC_TOKEN: z.string().min(1).default('asset-sync-token'),
})

export const env = EnvSchema.parse({
  DATABASE_URL: process.env.DATABASE_URL,
  JWT_SECRET: process.env.JWT_SECRET,
  PORT: process.env.PORT,
  ASSET_SYNC_TOKEN: process.env.ASSET_SYNC_TOKEN,
})

