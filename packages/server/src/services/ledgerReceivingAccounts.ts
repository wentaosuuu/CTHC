import type { PrismaClient } from '@prisma/client'

export const DEFAULT_LEDGER_RECEIVING_ACCOUNTS = [
  {
    code: 'cthc_main',
    name: '南宁产投华创基本户',
    bankName: '中国建设银行南宁分行',
    accountNo: '4505012345678900123',
    accountName: '南宁产投华创投资发展集团有限责任公司',
    sortOrder: 1,
  },
  {
    code: 'cthc_rent',
    name: '租金专户',
    bankName: '中国工商银行南宁分行',
    accountNo: '2102001234567890123',
    accountName: '南宁产投华创投资发展集团有限责任公司',
    sortOrder: 2,
  },
  {
    code: 'cthc_deposit',
    name: '押金专户',
    bankName: '中国银行南宁分行',
    accountNo: '6222001234567890123',
    accountName: '南宁产投华创投资发展集团有限责任公司',
    sortOrder: 3,
  },
  {
    code: 'bowan_ops',
    name: '泊湾公寓运营户',
    bankName: '交通银行南宁分行',
    accountNo: '6222601234567890123',
    accountName: '南宁产投华创投资发展集团有限责任公司',
    sortOrder: 4,
  },
] as const

/** 确保演示收款账户存在（按名称幂等） */
export async function ensureLedgerReceivingAccounts(prisma: PrismaClient) {
  const count = await prisma.ledgerReceivingAccount.count()
  if (count > 0) return
  for (const a of DEFAULT_LEDGER_RECEIVING_ACCOUNTS) {
    await prisma.ledgerReceivingAccount.create({
      data: {
        name: a.name,
        bankName: a.bankName,
        accountNo: a.accountNo,
        accountName: a.accountName,
        enabled: true,
        sortOrder: a.sortOrder,
      },
    })
  }
}

export async function listLedgerReceivingAccounts(prisma: PrismaClient) {
  await ensureLedgerReceivingAccounts(prisma)
  return prisma.ledgerReceivingAccount.findMany({
    where: { enabled: true },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  })
}

export type ReceivingAccountSnap = {
  receivingAccountId: string | null
  receivingAccountName: string | null
  receivingBankName: string | null
  receivingAccountNo: string | null
}

/** 按 id 或名称解析收款账户（导入可用账户名称） */
export async function resolveReceivingAccount(
  prisma: PrismaClient,
  input: { id?: string | null; name?: string | null },
): Promise<ReceivingAccountSnap> {
  await ensureLedgerReceivingAccounts(prisma)
  const id = (input.id || '').trim()
  const name = (input.name || '').trim()
  if (!id && !name) {
    return {
      receivingAccountId: null,
      receivingAccountName: null,
      receivingBankName: null,
      receivingAccountNo: null,
    }
  }
  const row = id
    ? await prisma.ledgerReceivingAccount.findFirst({ where: { id, enabled: true } })
    : await prisma.ledgerReceivingAccount.findFirst({
        where: { enabled: true, name },
      })
  if (!row) {
    // 名称未匹配时仍记录名称快照，便于排查
    return {
      receivingAccountId: null,
      receivingAccountName: name || null,
      receivingBankName: null,
      receivingAccountNo: null,
    }
  }
  return {
    receivingAccountId: row.id,
    receivingAccountName: row.name,
    receivingBankName: row.bankName || null,
    receivingAccountNo: row.accountNo || null,
  }
}
