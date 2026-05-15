# server

## 本地运行（开发）

在项目根目录执行：

```bash
npm install
cp packages/server/.env.example packages/server/.env
npm run db:migrate
npm run db:seed
npm run dev
```

服务端默认端口：`http://localhost:8787`

