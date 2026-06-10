# CLAUDE.md — 给 Claude Code 的项目说明 / 部署 runbook

## 这是什么
个人用的高尔夫策略 + 记录 PWA。设计与决策见 `DESIGN.md`，人读的部署手册见 `README.md`。
App 是单文件 `public/index.html`（纯前端 JS，无构建步骤）。后端是 `server.js`（Express）。

## 目录
- `public/index.html` — App，**已为部署打好补丁**（store 走 /api/kv、OCR 走 /api/scan、注册 sw、引 manifest）。
- `public/manifest.json`, `public/sw.js` — PWA 资源。改了 `index.html` 必须同步 bump `sw.js` 里的 CACHE 版本号，否则手机端拿不到新版。
- `server.js` — 静态托管 + `/api/kv/:k`(GET/PUT 存 Neon) + `/api/scan`(OCR) + `/api/coach`(AI 教练)，**只用 GEMINI_API_KEY**（不用 ANTHROPIC_API_KEY）。
- `schema.sql` — 在 Neon 跑一次。
- `package.json` / `Dockerfile` / `.github/workflows/deploy.yml`。

## 部署事实（已配置完成，勿凭记忆改）
- GCP project：`supply-491510`（号 `549968261036`），region `us-central1`，服务 `yardage-caddie`。
- 生产 URL：https://yardage-caddie-549968261036.us-central1.run.app
- Secrets（Secret Manager）：`DATABASE_URL`（Neon 带 -pooler 连接串）、`GEMINI_API_KEY`。
- KV 存储 key 全部带 `golf:` 前缀（如 `golf:rounds`），查云端数据必须带前缀。

## 部署方式（⛔ 唯一正路：git push 走 GitHub Actions）
```bash
git add <文件> && git commit -m "..." && git push origin main
```
推送后 `.github/workflows/deploy.yml` 自动：build 镜像 → 推到
`us-central1-docker.pkg.dev/supply-491510/yardage-caddie/app:latest` → 部署 Cloud Run
（min=0/max=3/0.5cpu/256Mi，绑两个 secrets）→ curl 验证。

- 凭据：repo secret `GCP_SA_KEY`（SA：`github-actions-deploy@supply-491510.iam.gserviceaccount.com`）。
- 查看结果：`gh run list --repo erichecan/training --limit 3`，失败看 `gh run view <id> --log-failed`。
- 部署后必须实际访问生产 URL 验证（HTTP 200 + 新功能标记），不能只看 Actions 绿了就算完。
- ⛔ 禁止 `gcloud run deploy --source .`（走 Cloud Build 花钱且与 GHA 重复部署）。仅当 GitHub Actions 不可用时作为应急，且需先在对话中说明并获用户确认。
- workflow 有 paths 过滤：只有 `public/**`、`server.js`、`package*.json`、`Dockerfile`、workflow 自身变更才触发；纯文档提交不部署。

## 首次搭建（仅新环境重建时用）
1. 在 Neon 跑 `schema.sql`，取**带 `-pooler` 的连接串**。
2. 写入 Secret Manager：
   ```bash
   printf '%s' '<NEON_POOLED_URL>' | gcloud secrets create DATABASE_URL --data-file=-
   printf '%s' '<GEMINI_KEY>'     | gcloud secrets create GEMINI_API_KEY --data-file=-
   ```
   （已存在则用 `gcloud secrets versions add ... --data-file=-`）
3. 按全局规则第十六节配置 GitHub Actions（SA + GCP_SA_KEY + workflow）。
4. 验证：打开生产 URL；存一次球包后查 Neon `select k from kv;` 应有数据。

## 验证 / 本地自测
- 本地预览用 Claude Preview（`.claude/launch.json` 的 `caddie` 配置，npm start，端口 8080）。
- 没 DB 也能跑前端（离线退回 localStorage），只是不落库；`/api/kv` 返回 503 属正常。
- `npm install && DATABASE_URL=... GEMINI_API_KEY=... npm start` 可全功能本地跑。

## 注意
- `index.html` 的补丁已应用；勿再按 README 第二节手动改（那节是给手动场景的参考）。
- 改 OCR 为 Vertex AI 版可免 key，见 DESIGN.md 第 8 节。
