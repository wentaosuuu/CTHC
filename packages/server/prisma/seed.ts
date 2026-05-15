import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { upsertAssetSnapshot } from '../src/services/assetSync.js'

const prisma = new PrismaClient()

function makeDemoAssets() {
  const demoQr = (label: string) =>
    `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(`企业微信·${label}（演示扫码）`)}`
  const stores = [
    { externalId: 'S001', name: '南宁市-江南区', wecomQrUrl: demoQr('江南区店长') },
    { externalId: 'S002', name: '南宁市-青秀区', wecomQrUrl: demoQr('青秀区店长') },
    { externalId: 'S003', name: '南宁市-兴宁区', wecomQrUrl: demoQr('兴宁区店长') },
    { externalId: 'S004', name: '南宁市-西乡塘区', wecomQrUrl: demoQr('西乡塘区店长') },
    { externalId: 'S005', name: '南宁市-邕宁区', wecomQrUrl: demoQr('邕宁区店长') },
    { externalId: 'S006', name: '南宁市-武鸣区', wecomQrUrl: demoQr('武鸣区店长') },
    { externalId: 'S007', name: '南宁市-良庆区', wecomQrUrl: demoQr('良庆区店长') },
  ]

  const apartments = [
    { externalId: 'A001', storeExternalId: 'S001', name: '江南·梧桐公寓' },
    { externalId: 'A002', storeExternalId: 'S002', name: '青秀·江景公寓' },
    { externalId: 'A003', storeExternalId: 'S003', name: '兴宁·里弄公寓' },
    { externalId: 'A004', storeExternalId: 'S004', name: '西乡塘·青年社区' },
    { externalId: 'A005', storeExternalId: 'S005', name: '邕宁·花园公寓' },
    { externalId: 'A006', storeExternalId: 'S006', name: '武鸣·精装公寓' },
    { externalId: 'A007', storeExternalId: 'S007', name: '良庆·悦居公寓' },
  ] as const

  const houseTypes = ['开间', '一室一厅', '两室一厅', '三室一厅', 'Loft'] as const

  // 62 条房源：前 50 套对应演示合同；后 12 套各门店空置，专供换房演示目标房
  const houseSpecs: Array<{ aptIndex: number; typeIndex: number; area: number; rent: number; no: string }> = []
  const aptCount = apartments.length
  const typeCount = houseTypes.length
  for (let i = 0; i < 50; i++) {
    const aptIndex = i % aptCount
    const typeIndex = i % typeCount
    const area = 28 + (typeIndex * 12) + (i % 8) // 开间约 28–38，Loft 约 68–78
    const rentBase = [4200, 5500, 7200, 9000, 6800][typeIndex]
    const rent = rentBase + (i % 5) * 200
    const no = `${1 + (i % 9)}${String(10 + (i % 90)).slice(-2)}`
    houseSpecs.push({ aptIndex, typeIndex, area, rent, no })
  }
  // 各门店额外空置房：供「换房演示」选目标房，不参与首批 50 条合同占用
  for (let j = 0; j < 12; j++) {
    const aptIndex = j % aptCount
    const typeIndex = j % typeCount
    const area = 30 + (typeIndex * 10) + (j % 6)
    const rentBase = [4300, 5600, 7300, 9100, 6900][typeIndex]
    const rent = rentBase + (j % 4) * 150
    const no = `D${j + 1}${String(80 + j).slice(-2)}`
    houseSpecs.push({ aptIndex, typeIndex, area, rent, no })
  }

  const houses = houseSpecs.map((spec, i) => {
    const apt = apartments[spec.aptIndex]
    const houseType = houseTypes[spec.typeIndex]
    return {
      externalId: `H${String(i + 1).padStart(3, '0')}`,
      apartmentExternalId: apt.externalId,
      houseNo: spec.no,
      houseType,
      area: spec.area,
      rentMonthly: spec.rent,
      deposit: spec.rent,
      status: 'VACANT' as const,
    }
  })

  return { stores, apartments: apartments as any, houses }
}

function houseDetailImages(externalId: string): string[] {
  // 用于演示房源轮播：这里直接用 Picsum 的稳定 seed URL
  return [
    `https://picsum.photos/seed/${externalId}-1/800/600`,
    `https://picsum.photos/seed/${externalId}-2/800/600`,
    `https://picsum.photos/seed/${externalId}-3/800/600`,
  ]
}

async function seedDepartmentsAndStoreLinks() {
  const hq = await prisma.department.upsert({
    where: { code: 'DEPT_HQ' },
    create: { name: '总部', code: 'DEPT_HQ', parentId: null, remark: '示例：集团总部' },
    update: { name: '总部', remark: '示例：集团总部' },
  })
  const region = await prisma.department.upsert({
    where: { code: 'DEPT_NN_REGION' },
    create: { name: '南宁区域', code: 'DEPT_NN_REGION', parentId: hq.id, remark: '与门店、角色做关联' },
    update: { name: '南宁区域', remark: '与门店、角色做关联', parentId: hq.id },
  })
  const stores = await prisma.store.findMany({ orderBy: { externalId: 'asc' } })
  for (let i = 0; i < stores.length; i += 1) {
    const s = stores[i]
    const ext = s.externalId ?? `ID${s.id.slice(0, 8)}`
    const code = `DEPT_STORE_${ext}`
    const dept = await prisma.department.upsert({
      where: { code },
      create: {
        name: `${s.name}（门店）`,
        code,
        parentId: region.id,
        remark: '门店预约看房电话与二维码在此维护',
        contactPhone: `0771-530${String(1000 + i).padStart(4, '0')}`,
        wecomQrUrl: s.wecomQrUrl,
      },
      update: {
        name: `${s.name}（门店）`,
        parentId: region.id,
        remark: '门店预约看房电话与二维码在此维护',
        wecomQrUrl: s.wecomQrUrl,
      },
    })
    await prisma.store.update({
      where: { id: s.id },
      data: { departmentId: dept.id },
    })
  }
}

async function main() {
  // Seed demo assets
  await upsertAssetSnapshot(prisma, makeDemoAssets())
  await seedDepartmentsAndStoreLinks()

  // 演示：部分房源未配置图片/租金，因此不可「发布/上架」（H5 只展示已发布房源）
  const houses = await prisma.house.findMany({
    where: { externalId: { not: null } },
    orderBy: { externalId: 'asc' },
  })

  for (const h of houses) {
    // externalId: H001 / H002...
    const idx = h.externalId ? parseInt(h.externalId.slice(1), 10) - 1 : 0
    const hasImages = idx % 3 !== 0 // 约 2/3 有图片
    const rentConfigured = idx < 50 ? true : idx % 2 === 1 // 后 12 套：一半没填租金

    const images = hasImages ? houseDetailImages(h.externalId!) : []
    const rentMonthly = rentConfigured ? h.rentMonthly : 0
    const deposit = rentConfigured ? h.deposit : 0
    const isPublished = rentConfigured && images.length > 0

    await prisma.house.update({
      where: { id: h.id },
      data: {
        rentMonthly,
        deposit,
        houseImagesJson: JSON.stringify(images),
        isPublished,
      },
    })
  }

  const adminPassword = await bcrypt.hash('admin123', 10)
  const managerPassword = await bcrypt.hash('manager123', 10)

  const systemAdmin = await prisma.admin.upsert({
    where: { email: 'admin@example.com' },
    create: {
      email: 'admin@example.com',
      name: '系统管理员',
      passwordHash: adminPassword,
      roleCode: 'SYSTEM_ADMIN',
    },
    update: {},
  })

  const manager = await prisma.admin.upsert({
    where: { email: 'manager@example.com' },
    create: {
      email: 'manager@example.com',
      name: '店长A',
      passwordHash: managerPassword,
      roleCode: 'STORE_MANAGER',
    },
    update: {},
  })

  const firstStore = await prisma.store.findFirst({ where: { name: '南宁市-江南区' } })
  if (firstStore) {
    await prisma.adminStore.upsert({
      where: { adminId_storeId: { adminId: manager.id, storeId: firstStore.id } },
      create: { adminId: manager.id, storeId: firstStore.id },
      update: {},
    })
  }

  // 合同管理演示：先补足到 44 条，再执行 6 次「换房」生成 6 条新合同（旧合同变已终止）→ 列表共 50 条且含换房关联
  const CHANGE_HOUSE_SEED_COUNT = 6
  const CONTRACT_TARGET_BEFORE_CH = 50 - CHANGE_HOUSE_SEED_COUNT
  const contractStatuses: Array<'WAIT_TENANT_SIGN' | 'WAIT_STAMP' | 'PENDING_PAYMENT' | 'ACTIVE' | 'VOID' | 'TERMINATED'> = [
    'WAIT_TENANT_SIGN', 'WAIT_STAMP', 'PENDING_PAYMENT', 'ACTIVE', 'VOID', 'TERMINATED',
  ]
  const reportStatuses: Array<null | 'PENDING' | 'SUCCESS' | 'FAILED'> = [null, 'PENDING', 'SUCCESS', 'FAILED']
  const firstNames = [
    '张', '李', '王', '赵', '刘', '陈', '杨', '黄', '周', '吴', '徐', '孙', '马', '朱', '胡', '郭', '何', '林', '高', '罗',
    '郑', '梁', '谢', '宋', '唐', '许', '韩', '冯', '邓', '曹', '彭', '曾', '肖', '田', '董', '袁', '潘', '于', '蒋', '蔡',
    '余', '杜', '叶', '程', '魏', '苏', '吕', '丁', '任', '沈',
  ]

  const existingCount = await prisma.contract.count()
  const needToCreate = Math.max(0, CONTRACT_TARGET_BEFORE_CH - existingCount)

  if (needToCreate > 0) {
    const usedHouseIds = (await prisma.contract.findMany({ select: { houseId: true } })).map((c) => c.houseId)
    const freeHouses = await prisma.house.findMany({
      where: usedHouseIds.length > 0 ? { id: { notIn: usedHouseIds } } : undefined,
      orderBy: { externalId: 'asc' },
      take: needToCreate,
    })

    if (freeHouses.length < needToCreate) {
      // eslint-disable-next-line no-console
      console.log(
        `Only ${freeHouses.length} free houses, cannot reach ${CONTRACT_TARGET_BEFORE_CH} base contracts. Created ${existingCount + freeHouses.length} total.`,
      )
    }

    const year = new Date().getFullYear()
    const baseTime = Date.now()
    const createdBillIds: string[] = []

    for (let i = 0; i < freeHouses.length; i += 1) {
      const house = freeHouses[i]
      const globalIndex = existingCount + i

      const tenant = await prisma.tenant.create({
        data: {
          name: `${firstNames[globalIndex % firstNames.length]}${globalIndex < 10 ? '零' : ''}${['一', '二', '三', '四', '五', '六', '七', '八', '九', '九'][globalIndex % 10]}`,
          idNumber: `310101${year}0101${String(1000 + globalIndex).padStart(4, '0')}`,
          phone: `138${String(10000000 + globalIndex).padStart(8, '0')}`,
        },
      })

      const moveInDate = new Date(year, globalIndex % 12, 1)
      const order = await prisma.order.create({
        data: {
          houseId: house.id,
          tenantId: tenant.id,
          leaseMonths: 12,
          moveInDate,
          status: 'APPROVED',
        },
      })

      const contractNo = `C${year}${String(baseTime + globalIndex).slice(-9)}`
      const startDate = moveInDate
      const endDate = new Date(moveInDate)
      endDate.setMonth(endDate.getMonth() + 12)

      const contractStatus = contractStatuses[globalIndex % contractStatuses.length]
      const contract = await prisma.contract.create({
        data: {
          contractNo,
          houseId: house.id,
          tenantId: tenant.id,
          orderId: order.id,
          status: contractStatus,
          startDate,
          endDate,
          rentMonthly: house.rentMonthly,
          deposit: house.deposit,
        },
      })

      const reportStatus = reportStatuses[globalIndex % reportStatuses.length]
      if (reportStatus !== null) {
        await prisma.housingReport.create({
          data: {
            contractId: contract.id,
            status: reportStatus,
            ...(reportStatus === 'SUCCESS' ? { reportedAt: new Date(), receiptPdfPath: `receipt-${contractNo}.pdf` } : {}),
            ...(reportStatus === 'FAILED' ? { lastError: '模拟报备失败' } : {}),
          },
        })
      }

      const periodStr = `${year}-${String(startDate.getMonth() + 1).padStart(2, '0')}`
      const totalAmount = house.rentMonthly
      const bill = await prisma.bill.create({
        data: {
          contractId: contract.id,
          period: periodStr,
          dueDate: startDate,
          totalAmount,
          status: 'UNPAID',
        },
      })
      createdBillIds.push(bill.id)
      // 为 demo 生成合理收费明细（水电网等有金额，租金=总额-其余）
      const water = 35 + (globalIndex % 45)
      const elec = 80 + (globalIndex % 120)
      const prop = 50 + (globalIndex % 70)
      const garbage = 15 + (globalIndex % 25)
      const shared = 20 + (globalIndex % 30)
      const gas = globalIndex % 3 === 0 ? 0 : 30 + (globalIndex % 40)
      const network = globalIndex % 4 === 0 ? 0 : 50 + (globalIndex % 40)
      const late = 0
      const otherSum = water + elec + prop + garbage + shared + gas + network + late
      const rent = Math.max(0, totalAmount - otherSum)
      const items = [
        { name: '租金', amount: rent },
        { name: '水费', amount: water },
        { name: '电费', amount: elec },
        { name: '物业费', amount: prop },
        { name: '垃圾处理费', amount: garbage },
        { name: '公摊电费', amount: shared },
        { name: '燃气费', amount: gas },
        { name: '网络费', amount: network },
        { name: '滞纳金', amount: late },
      ]
      for (const it of items) {
        if (it.amount <= 0) continue
        await prisma.billItem.create({
          data: { billId: bill.id, name: it.name, amount: it.amount },
        })
      }
    }

    const now = new Date()
    const pastDate = new Date(now.getFullYear(), now.getMonth() - 1, 15)
    for (let i = 0; i < createdBillIds.length; i += 1) {
      if (i % 3 === 1) {
        await prisma.bill.update({
          where: { id: createdBillIds[i] },
          data: { status: 'PAID', paidAt: new Date(now.getTime() - 86400000 * (i + 1)) },
        })
      } else if (i % 3 === 2) {
        await prisma.bill.update({
          where: { id: createdBillIds[i] },
          data: { status: 'OVERDUE', dueDate: pastDate },
        })
      }
    }

    const totalAfter = await prisma.contract.count()
    // eslint-disable-next-line no-console
    console.log(
      `Demo contracts: ${existingCount} -> ${totalAfter} (added ${totalAfter - existingCount}). Target ${CONTRACT_TARGET_BEFORE_CH} before 换房演示.`,
    )
  }

  // 确保列表里一定有足够的「已生效」合同，方便演示：续租/换房/退租按钮都只在 ACTIVE 显示
  const MIN_ACTIVE_FOR_DEMO = 18
  const activeCountNow = await prisma.contract.count({ where: { status: 'ACTIVE' } })
  if (activeCountNow < MIN_ACTIVE_FOR_DEMO) {
    const needActive = MIN_ACTIVE_FOR_DEMO - activeCountNow
    const candidates = await prisma.contract.findMany({
      where: {
        status: { in: ['WAIT_TENANT_SIGN', 'WAIT_STAMP', 'PENDING_PAYMENT'] },
        changeHouseFromId: null,
        renewedFromId: null,
      },
      orderBy: { createdAt: 'asc' },
      take: needActive,
      select: { id: true },
    })
    for (const c of candidates) {
      await prisma.contract.update({
        where: { id: c.id },
        data: {
          status: 'ACTIVE',
          confirmedAt: new Date(),
          signedAt: new Date(),
          stampedAt: new Date(),
        },
      })
    }
    if (candidates.length > 0) {
      // eslint-disable-next-line no-console
      console.log(`Demo: 额外将 ${candidates.length} 条合同置为「已生效」，便于演示续租/换房/退租操作。`)
    }
  }

  // Demo：若干条合同为「租客申请驳回」状态，用于展示「修改配置合同信息」按钮
  const activeOrWaitContracts = await prisma.contract.findMany({
    where: {
      status: { in: ['ACTIVE', 'WAIT_TENANT_SIGN', 'WAIT_STAMP', 'PENDING_PAYMENT'] },
      modificationRejectedAt: null,
      modificationRequestedAt: null,
    },
    take: 5,
    orderBy: { createdAt: 'desc' },
  })
  const rejectDemoCount = Math.min(3, activeOrWaitContracts.length)
  const rejectedAt = new Date()
  rejectedAt.setDate(rejectedAt.getDate() - 2)
  for (let i = 0; i < rejectDemoCount; i += 1) {
    await prisma.contract.update({
      where: { id: activeOrWaitContracts[i].id },
      data: { modificationRejectedAt: rejectedAt },
    })
  }

  // 可续签 DEMO：多条「已生效」合同，账单全部标记已付清，便于点「续签」走通流程
  const activeForRenew = await prisma.contract.findMany({
    where: { status: 'ACTIVE' },
    take: 10,
    select: { id: true },
  })
  for (const c of activeForRenew) {
    await prisma.bill.updateMany({
      where: { contractId: c.id },
      data: { status: 'PAID', paidAt: new Date() },
    })
  }
  if (activeForRenew.length > 0) {
    // eslint-disable-next-line no-console
    console.log(`Demo: ${activeForRenew.length} 条已生效合同已设为「账单全结清」，可直接续签。`)
  }

  // 换房演示：旧合同→已终止 + 新合同（待签字）且 changeHouseFromId 关联，列表「来源」列可见
  function addMonths(d: Date, n: number) {
    const x = new Date(d)
    x.setMonth(x.getMonth() + n)
    return x
  }
  function startOfMonth(d: Date) {
    return new Date(d.getFullYear(), d.getMonth(), 1)
  }
  function fmtBillPeriod(d: Date) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }

  const wantChangeHouseDemos = CHANGE_HOUSE_SEED_COUNT
  const existingCh = await prisma.contract.count({ where: { changeHouseFromId: { not: null } } })
  if (existingCh < wantChangeHouseDemos) {
    const chCandidates = await prisma.contract.findMany({
      where: {
        status: 'ACTIVE',
        changeHouseNew: { none: {} },
      },
      include: {
        house: { include: { apartment: true } },
        bills: true,
      },
      orderBy: { createdAt: 'asc' },
      take: 40,
    })
    let chAdded = 0
    for (const old of chCandidates) {
      if (existingCh + chAdded >= wantChangeHouseDemos) break
      await prisma.bill.updateMany({
        where: { contractId: old.id },
        data: { status: 'PAID', paidAt: new Date() },
      })
      const target = await prisma.house.findFirst({
        where: {
          status: 'VACANT',
          apartment: { storeId: old.house.apartment.storeId },
          id: { not: old.houseId },
        },
      })
      if (!target) continue

      const moveDate = new Date()
      moveDate.setDate(moveDate.getDate() - 12)
      const moveDateStr = moveDate.toISOString().slice(0, 10)
      const newStartStr = new Date().toISOString().slice(0, 10)
      const leaseMonths = 12
      const newRent = old.rentMonthly + 300
      const newDep = old.deposit + 800
      const moveEnd = new Date(`${moveDateStr}T23:59:59.999`)
      const newStart = new Date(newStartStr)
      const newEnd = addMonths(newStart, leaseMonths)
      const y = new Date().getFullYear()
      const contractNo = `C${y}CHDEMO${String(Date.now()).slice(-6)}${chAdded}`
      const depMul = newRent > 0 ? Math.round((newDep / newRent) * 100) / 100 : 1
      const depDiff = newDep - old.deposit

      try {
        await prisma.$transaction(async (tx) => {
          await tx.contract.update({
            where: { id: old.id },
            data: { status: 'TERMINATED', terminatedAt: moveEnd, endDate: moveEnd },
          })
          await tx.house.update({ where: { id: old.houseId }, data: { status: 'VACANT' } })
          await tx.refund.create({
            data: {
              contractId: old.id,
              amount: 0,
              reason: `【演示换房】${moveDateStr} 迁出 → 新合同 ${contractNo}`,
            },
          })
          const newOrder = await tx.order.create({
            data: {
              houseId: target.id,
              tenantId: old.tenantId,
              leaseMonths,
              moveInDate: newStart,
              status: 'APPROVED',
            },
          })
          const nc = await tx.contract.create({
            data: {
              contractNo,
              houseId: target.id,
              tenantId: old.tenantId,
              orderId: newOrder.id,
              status: 'WAIT_TENANT_SIGN',
              startDate: newStart,
              endDate: newEnd,
              rentMonthly: newRent,
              deposit: newDep,
              depositMultiple: depMul,
              rentCycle: old.rentCycle,
              penaltyFormula: old.penaltyFormula,
              latestRentGraceDays: old.latestRentGraceDays,
              latestRentDueDate: null,
              changeHouseFromId: old.id,
            },
          })
          const dueDate = startOfMonth(newStart)
          for (let mi = 0; mi < leaseMonths; mi += 1) {
            const d = addMonths(dueDate, mi)
            await tx.bill.create({
              data: {
                contractId: nc.id,
                period: fmtBillPeriod(d),
                dueDate: d,
                totalAmount: newRent,
                status: 'UNPAID',
              },
            })
          }
          if (depDiff > 0) {
            const sb = await tx.bill.create({
              data: {
                contractId: nc.id,
                period: `换房补差-演示-${chAdded}`,
                dueDate: newStart,
                totalAmount: depDiff,
                status: 'UNPAID',
              },
            })
            await tx.billItem.create({
              data: {
                billId: sb.id,
                name: `换房—押金补足（新¥${newDep} − 旧¥${old.deposit}）`,
                amount: depDiff,
              },
            })
          }
          await tx.house.update({ where: { id: target.id }, data: { status: 'RESERVED' } })
        })
        chAdded += 1
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('换房演示写入跳过一条:', e)
      }
    }
    if (chAdded > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `Demo 换房：已生成 ${chAdded} 组「旧合同已终止 + 新合同待签字」关联，请在合同列表「来源」列查看。`,
      )
    } else if (existingCh === 0) {
      // eslint-disable-next-line no-console
      console.warn(
        '未写入换房演示：请确认已同步 62 套房源种子（含各门店空置目标房），执行 npm run db:seed 后再试。',
      )
    }
  }

  // 续租演示：生成「新合同」并通过 renewedFromId 关联上一份合同（列表「关联来源」可见）
  const RENEW_SEED_COUNT = 6
  const existingRenew = await prisma.contract.count({ where: { renewedFromId: { not: null } } })
  if (existingRenew < RENEW_SEED_COUNT) {
    const renewCandidates = await prisma.contract.findMany({
      where: {
        status: 'ACTIVE',
        renewedTo: { none: {} },
      },
      include: { house: true },
      orderBy: { createdAt: 'asc' },
      take: 30,
    })
    let renewAdded = 0
    for (const old of renewCandidates) {
      if (existingRenew + renewAdded >= RENEW_SEED_COUNT) break

      // 确保旧合同费用已结清，便于你也能点「续签」按钮演示流程
      await prisma.bill.updateMany({
        where: { contractId: old.id },
        data: { status: 'PAID', paidAt: new Date() },
      })

      const start = new Date()
      start.setDate(start.getDate() + 1)
      const end = addMonths(start, 12)
      const y = new Date().getFullYear()
      const contractNo = `C${y}RNDEMO${String(Date.now()).slice(-6)}${renewAdded}`

      try {
        await prisma.$transaction(async (tx) => {
          const newOrder = await tx.order.create({
            data: {
              houseId: old.houseId,
              tenantId: old.tenantId,
              leaseMonths: 12,
              moveInDate: start,
              status: 'APPROVED',
            },
          })
          const nc = await tx.contract.create({
            data: {
              contractNo,
              houseId: old.houseId,
              tenantId: old.tenantId,
              orderId: newOrder.id,
              status: 'WAIT_TENANT_SIGN',
              startDate: start,
              endDate: end,
              rentMonthly: old.rentMonthly,
              deposit: old.deposit,
              depositMultiple: old.depositMultiple,
              rentCycle: old.rentCycle,
              penaltyFormula: old.penaltyFormula,
              latestRentGraceDays: old.latestRentGraceDays,
              latestRentDueDate: null,
              renewedFromId: old.id,
            },
          })
          const dueDate = startOfMonth(start)
          for (let mi = 0; mi < 12; mi += 1) {
            const d = addMonths(dueDate, mi)
            await tx.bill.create({
              data: {
                contractId: nc.id,
                period: fmtBillPeriod(d),
                dueDate: d,
                totalAmount: old.rentMonthly,
                status: 'UNPAID',
              },
            })
          }
        })
        renewAdded += 1
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('续租演示写入跳过一条:', e)
      }
    }
    if (renewAdded > 0) {
      // eslint-disable-next-line no-console
      console.log(`Demo 续租：已生成 ${renewAdded} 组「新合同关联上一份合同」样例，可在列表「关联来源」列查看。`)
    }
  }

  // 退租演示：将若干条已生效合同置为已终止并生成结案退款记录（列表里能看到「已终止」状态）
  const MOVE_OUT_SEED_COUNT = 6
  const existingMoveOutRefunds = await prisma.refund.count({
    where: { reason: { contains: '【演示退租】' } },
  })
  if (existingMoveOutRefunds < MOVE_OUT_SEED_COUNT) {
    const moCandidates = await prisma.contract.findMany({
      where: {
        status: 'ACTIVE',
        terminatedAt: null,
        changeHouseNew: { none: {} }, // 避免把已用于换房的旧合同再退租一次
      },
      include: { house: { include: { apartment: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    let moAdded = 0
    for (const c of moCandidates) {
      if (existingMoveOutRefunds + moAdded >= MOVE_OUT_SEED_COUNT) break

      await prisma.bill.updateMany({
        where: { contractId: c.id },
        data: { status: 'PAID', paidAt: new Date() },
      })

      const moveDate = new Date()
      moveDate.setDate(moveDate.getDate() - (3 + (moAdded % 6)))
      const moveDateStr = moveDate.toISOString().slice(0, 10)
      const endAt = new Date(`${moveDateStr}T23:59:59.999`)

      try {
        await prisma.$transaction(async (tx) => {
          await tx.contract.update({
            where: { id: c.id },
            data: { status: 'TERMINATED', terminatedAt: endAt, endDate: endAt },
          })
          await tx.house.update({ where: { id: c.houseId }, data: { status: 'VACANT' } })
          await tx.refund.create({
            data: {
              contractId: c.id,
              amount: 0,
              reason: `【演示退租】${moveDateStr} 退租结案：${c.house.apartment.name} ${c.house.houseNo}`,
            },
          })
        })
        moAdded += 1
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('退租演示写入跳过一条:', e)
      }
    }
    if (moAdded > 0) {
      // eslint-disable-next-line no-console
      console.log(`Demo 退租：已生成 ${moAdded} 条「已终止 + 结案退款」样例，可在列表直接看到。`)
    }
  }

  if (rejectDemoCount > 0) {
    // eslint-disable-next-line no-console
    console.log(`Demo: ${rejectDemoCount} 条合同已设为「租客申请驳回」，合同管理页将显示「修改配置合同信息」按钮。`)
  }

  // 为所有没有收费明细的账单补充 demo 明细（水费、电费等不全为 0）
  const allBills = await prisma.bill.findMany({
    include: { _count: { select: { items: true } } },
    take: 500,
  })
  const billsWithoutItems = allBills.filter((b) => b._count.items === 0)
  for (let i = 0; i < billsWithoutItems.length; i += 1) {
    const bill = billsWithoutItems[i]
    const totalAmount = bill.totalAmount
    const water = 35 + (i % 45)
    const elec = 80 + (i % 120)
    const prop = 50 + (i % 70)
    const garbage = 15 + (i % 25)
    const shared = 20 + (i % 30)
    const gas = i % 3 === 0 ? 0 : 30 + (i % 40)
    const network = i % 4 === 0 ? 0 : 50 + (i % 40)
    const late = 0
    const otherSum = water + elec + prop + garbage + shared + gas + network + late
    const rent = Math.max(0, totalAmount - otherSum)
    const itemList = [
      { name: '租金', amount: rent },
      { name: '水费', amount: water },
      { name: '电费', amount: elec },
      { name: '物业费', amount: prop },
      { name: '垃圾处理费', amount: garbage },
      { name: '公摊电费', amount: shared },
      { name: '燃气费', amount: gas },
      { name: '网络费', amount: network },
      { name: '滞纳金', amount: late },
    ]
    for (const it of itemList) {
      if (it.amount <= 0) continue
      await prisma.billItem.create({
        data: { billId: bill.id, name: it.name, amount: it.amount },
      })
    }
  }
  if (billsWithoutItems.length > 0) {
    // eslint-disable-next-line no-console
    console.log(`补充了 ${billsWithoutItems.length} 条账单的收费明细（水费、电费等）。`)
  }

  // ---------------- 催租记录 DEMO：补齐 30 条 ----------------
  const REMINDER_TARGET = 30
  const reminderCount = await prisma.rentReminder.count()
  if (reminderCount < REMINDER_TARGET) {
    const need = REMINDER_TARGET - reminderCount
    const now = new Date()

    // 优先使用欠费/逾期账单作为“催租对象”，不够再用任意账单补齐
    const overdueBills = await prisma.bill.findMany({
      where: { status: { in: ['UNPAID', 'OVERDUE'] } },
      include: {
        contract: {
          include: {
            tenant: true,
            house: { include: { apartment: { include: { store: true } } } },
          },
        },
      },
      orderBy: { dueDate: 'asc' },
      take: Math.max(need, 60),
    })
    const extraBills =
      overdueBills.length >= need
        ? []
        : await prisma.bill.findMany({
            include: {
              contract: {
                include: {
                  tenant: true,
                  house: { include: { apartment: { include: { store: true } } } },
                },
              },
            },
            orderBy: { createdAt: 'desc' },
            take: 200,
          })
    const pool = [...overdueBills, ...extraBills]

    const pick: typeof pool = []
    const used = new Set<string>()
    for (const b of pool) {
      if (pick.length >= need) break
      if (used.has(b.id)) continue
      used.add(b.id)
      pick.push(b)
    }

    const admins = await prisma.admin.findMany({ orderBy: { createdAt: 'asc' }, take: 5 })
    const adminId = admins[0]?.id ?? null

    const templates = [
      '【公寓租赁】{name}您好，账期{period}账单已逾期{days}天，应缴合计¥{total}（账单¥{bill}+滞纳金¥{penalty}）。请尽快缴费，如已支付请忽略。',
      '【温馨提醒】{name}，合同{contract}的{period}账单已到期{days}天未缴，应缴¥{total}。如遇困难请及时联系门店，谢谢配合。',
      '【催缴通知】{name}，您{period}房租/费用账单尚未结清，应缴¥{total}。请于今日内完成缴费，避免产生更多滞纳金。',
    ]

    const created: string[] = []
    for (let i = 0; i < pick.length; i += 1) {
      const b = pick[i]
      const days = 1 + ((i * 7) % 120)
      const penalty = Math.max(0, Math.round((b.totalAmount * 0.001 * days) / 10) * 10) // 约 0.1%/天，取整到 10 元
      const totalDue = b.totalAmount + penalty
      const sentAt = new Date(now.getTime() - (i + 1) * 6 * 3600 * 1000) // 每 6 小时一条，向过去铺开

      const contractNo = b.contract.contractNo
      const msgTpl = templates[i % templates.length]
      const message = msgTpl
        .replace('{name}', b.contract.tenant.name)
        .replace('{period}', b.period)
        .replace('{days}', String(days))
        .replace('{total}', String(totalDue))
        .replace('{bill}', String(b.totalAmount))
        .replace('{penalty}', String(penalty))
        .replace('{contract}', contractNo)

      const rr = await prisma.rentReminder.create({
        data: {
          billId: b.id,
          contractId: b.contractId,
          period: b.period,
          dueDate: b.dueDate,
          billAmount: b.totalAmount,
          penalty,
          totalDue,
          tenantName: b.contract.tenant.name,
          tenantPhone: b.contract.tenant.phone,
          storeName: b.contract.house.apartment.store.name,
          apartmentName: b.contract.house.apartment.name,
          houseNo: b.contract.house.houseNo,
          message,
          sentAt,
          sentByAdminId: adminId,
        },
      })
      created.push(rr.id)
    }

    // eslint-disable-next-line no-console
    console.log(`Demo: 已补齐催租记录 ${created.length} 条（目标 ${REMINDER_TARGET} 条）。`)
  }

  // ---------------- 合同「到期提醒」列表 DEMO（与后台 toYmd UTC 日历 + 前端 calcDaysTo 一致）----------------
  // 按「最近创建」顺序取前 N 条，第 k 条（k 从 1 起）写入 endDate 偏移：
  // - k=1..31：还有 30…1 天到期 + 当天到期
  // - k=32..61：已过期 1…30 天
  // - k>61：已过期超 30 天 / 更远到期（列表不展示该列）
  const clock = new Date()
  const y0 = clock.getUTCFullYear()
  const m0 = clock.getUTCMonth()
  const d0 = clock.getUTCDate()
  const contractsForExpiryDemo = await prisma.contract.findMany({
    orderBy: { createdAt: 'desc' },
    take: 70,
    select: { id: true },
  })

  const tailOffsets = [-38, -42, -55, 45, 52, 60, 70, -33, 48]

  for (let i = 0; i < contractsForExpiryDemo.length; i += 1) {
    const c = contractsForExpiryDemo[i]
    const k = i + 1
    let offsetDays: number
    if (k <= 31) {
      offsetDays = 31 - k
    } else if (k <= 61) {
      offsetDays = -(k - 31)
    } else {
      offsetDays = tailOffsets[(k - 62) % tailOffsets.length]!
    }
    const endDate = new Date(Date.UTC(y0, m0, d0 + offsetDays, 12, 0, 0))
    await prisma.contract.update({ where: { id: c.id }, data: { endDate } })
  }

  // eslint-disable-next-line no-console
  console.log(`Demo: 已更新 ${contractsForExpiryDemo.length} 条合同 endDate 用于「到期提醒」列表展示。`)

  const totalContracts = await prisma.contract.count()
  // eslint-disable-next-line no-console
  console.log(
    `Seed done. 当前合同共 ${totalContracts} 条（换房演示 ${CHANGE_HOUSE_SEED_COUNT} 组；新合同在列表「关联来源」列会标明上一份旧合同号）。`,
  )
  // eslint-disable-next-line no-console
  console.log('Admin login: admin@example.com / admin123')
  // eslint-disable-next-line no-console
  console.log('Manager login: manager@example.com / manager123')
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

