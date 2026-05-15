# cthc

这个项目是一个“公寓租赁管理系统”Demo（MVP），包含：

- `packages/mobile`：H5（移动端）
- `packages/admin`：后台管理系统（管理端）
- `packages/server`：后端 API + SQLite 数据库

## 运行方式（首次）

在项目根目录（`cthc`）打开终端，执行：

```bash
npm install
cp packages/server/.env.example packages/server/.env
npm run db:migrate
npm run db:seed
```

## 一键启动（推荐）

```bash
npm run dev
```

启动后地址（本机）：

- H5：默认 `http://localhost:5173`（若端口占用会自动换到下一个可用端口，以控制台输出为准）
- 后台：默认 `http://localhost:5174`（若端口占用会自动换到下一个可用端口，以控制台输出为准）
- 后端：`http://localhost:8787/health`

## 账号（种子数据）

- 系统管理员：admin@example.com / admin123
- 店长：manager@example.com / manager123（只能看到自己门店的数据）

## 业务说明（后台房源）

上架前须配置：月租、房源图片与**公寓地址**（缺一不可）。

合同管理列表中的「到期提醒」：从「还有 30 天到期」起倒计时至「当天到期」；已到期则「已过期 N 天」（N≤30）或「已过期超过30天」。列表按 **UTC 日历日** 与接口返回的 `endDate`（`toYmd`）对齐计算，避免东八区等时区误判；种子数据对最近一批合同按序写入 `endDate`。

## 版本与回退

当前稳定基线：**`baseline-2026-05-15`**。修改功能前已记录版本信息与数据库快照，详见根目录 [`VERSION.md`](./VERSION.md)。若需回退，告诉助手该版本号即可。

