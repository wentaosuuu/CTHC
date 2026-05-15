import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import morgan from 'morgan'
import { PrismaClient } from '@prisma/client'
import { registerRoutes } from './routes.js'
import { startSchedulers } from './schedulers.js'

const app = express()
const prisma = new PrismaClient()

app.use(cors({ origin: true, credentials: true }))
app.use(express.json({ limit: '1mb' }))
app.use(morgan('dev'))

app.get('/health', (_req, res) => res.json({ ok: true }))

registerRoutes(app, prisma)
startSchedulers(prisma)

const port = Number(process.env.PORT ?? 8787)
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`[server] listening on http://localhost:${port}`)
})

