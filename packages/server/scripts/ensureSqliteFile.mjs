import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Prisma 首次同步前准备 SQLite 文件；使用排他创建，既有数据库绝不截断。
const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl?.startsWith('file:')) throw new Error('请在本地 .env 中配置 SQLite DATABASE_URL。')
const filename = databaseUrl.slice(5).split('?')[0]
if (filename && filename !== ':memory:') {
  const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const target = path.isAbsolute(filename) ? filename : path.resolve(serverRoot, 'prisma', filename)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  try {
    const fd = fs.openSync(target, 'ax')
    fs.closeSync(fd)
  } catch (error) {
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'EEXIST') throw error
  }
}
