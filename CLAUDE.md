# CLAUDE.md — 给 Claude Code 的项目说明 / 部署 runbook

## 这是什么
个人用的高尔夫策略 + 记录 PWA。设计与决策见 `DESIGN.md`，人读的部署手册见 `README.md`。
App 是单文件 `public/index.html`（纯前端 JS，无构建步骤）。后端是 `server.js`（Express）。

## 目录
- `public/index.html` — App，**已为部署打好补丁**（store 走 /api/kv、OCR 走 /api/scan、注册 sw、引 manifest）。
- `public/manifest.json`, `public/sw.js` — PWA 资源。需补 `icon-192.png` / `icon-512.png`。
- `server.js` — 静态托管 + `/api/kv/:k`(GET/PUT 存 Neon) + `/api/scan`(OCR 代理，持有 Anthropic key)。
- `schema.sql` — 在 Neon 跑一次。
- `package.json` / `Dockerfile`。

## 部署前需要用户先具备（Claude Code 无法代劳的授权部分）
1. 已登录 gcloud：`gcloud auth login` 且 `gcloud config set project <PROJECT_ID>`。
2. 一个 Neon 项目，已建库。
3. 一个 Anthropic API key（仅当用 /api/scan 的 OCR；不用 OCR 可跳过）。

## 部署步骤（Claude Code 可逐条执行）
1. 在 Neon 跑 `schema.sql`（psql 或 Neon SQL 编辑器）。取**带 `-pooler` 的连接串**。
2. 写入 Secret Manager：
   ```bash
   printf '%s' '<NEON_POOLED_URL>' | gcloud secrets create DATABASE_URL --data-file=-
   printf '%s' '<ANTHROPIC_KEY>'  | gcloud secrets create ANTHROPIC_API_KEY --data-file=-
   ```
   （已存在则用 `gcloud secrets versions add ... --data-file=-`）
3. 部署：
   ```bash
   gcloud run deploy yardage-caddie --source . --region us-central1 \
     --set-secrets DATABASE_URL=DATABASE_URL:latest,ANTHROPIC_API_KEY=ANTHROPIC_API_KEY:latest \
     --allow-unauthenticated
   ```
4. 验证：打开返回的 `*.run.app`；存一次球包后查 Neon `select k from kv;` 应有数据。
5. 锁权限（个人用）：用 Cloud Run + IAP 限定本人 Google 账号，或在 server.js 加共享口令。

## 验证 / 本地自测
- `npm install && DATABASE_URL=... ANTHROPIC_API_KEY=... npm start`，访问 http://localhost:8080。
- 没 DB 也能跑前端（离线退回 localStorage），只是不落库。

## 注意
- `index.html` 的补丁已应用；勿再按 README 第二节手动改（那节是给手动场景的参考）。
- 改 OCR 为 Vertex AI 版可免 key，见 DESIGN.md 第 8 节。
