# 版本记录

## 当前基线版本

| 字段 | 值 |
|------|-----|
| **版本号** | `baseline-2026-05-15` |
| **记录时间** | 2026-05-15 |
| **项目** | cthc — 公寓租赁管理系统 Demo（MVP） |
| **package 版本** | 根目录与各子包均为 `0.0.0` |
| **Git 标签** | `baseline-2026-05-15` |
| **Git 提交** | 与标签 `baseline-2026-05-15` 相同（查看：`git rev-parse baseline-2026-05-15`） |
| **数据库快照** | `.versions/baseline-2026-05-15/prisma-dev.db` |

> 向 AI 或同事说明回退时，只需提供：**版本号 `baseline-2026-05-15`** 或 **Git 标签 `baseline-2026-05-15`**。

---

## 本版本功能范围（修改前快照）

### 子项目

- **packages/mobile** — H5 移动端（Vite + React 19）
- **packages/admin** — 后台管理端（Vite + React 19 + Recharts）
- **packages/server** — 后端 API（Express 5 + Prisma + SQLite）

### 管理端页面

首页、房源、订单、合同、账单、账单核销、交易流水、租金提醒、逾期、个人资料；系统管理（用户、角色、部门）。

### 移动端页面

地图找房、房源列表/详情、下单、实名认证、合同、账单列表/详情/支付提醒、支付、我的订单/订单详情、个人中心。

### 后端能力（概要）

用户认证（JWT）、房源/订单/合同/账单 CRUD、合同上传、账单导入、违约金与住房上报、资产同步、定时任务（node-cron）。

### 数据库

- 引擎：SQLite（`packages/server/prisma/dev.db`）
- 迁移：`20260311032849`、`20260318020000_add_latest_rent_due_date`、`20260319090000_house_extra_fields`

### 种子账号

- 系统管理员：`admin@example.com` / `admin123`
- 店长：`manager@example.com` / `manager123`

---

## 如何回退到此版本

在项目根目录 `cthc` 执行：

```bash
# 1. 回退全部源代码到本基线（会丢弃未提交的修改）
git checkout baseline-2026-05-15 -- .
git reset --hard baseline-2026-05-15

# 2. 恢复数据库快照（覆盖当前 dev.db）
cp .versions/baseline-2026-05-15/prisma-dev.db packages/server/prisma/dev.db

# 3. 重新生成 Prisma Client（如回退后 API 异常可执行）
npm -w server run prisma:generate
```

回退后重启开发服务：

```bash
npm run dev
```

---

## 版本历史

| 版本号 | 日期 | 说明 |
|--------|------|------|
| `baseline-2026-05-15` | 2026-05-15 | 功能修改前的稳定基线；含代码 Git 标签与数据库快照 |

---

## 给 AI 助手的回退说明

当用户说「回退到 `baseline-2026-05-15`」时：

1. 执行 `git reset --hard baseline-2026-05-15`（或 `git checkout baseline-2026-05-15` 后按需处理工作区）
2. 将 `.versions/baseline-2026-05-15/prisma-dev.db` 复制到 `packages/server/prisma/dev.db`
3. 可选：`npm -w server run prisma:generate`
4. 勿删除 `.versions/` 目录，以便后续再次回退
