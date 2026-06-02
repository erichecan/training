# 袋中球童 — 部署到 Cloud Run + Neon

一个 Cloud Run 服务同时做两件事：发 PWA 静态文件 + 提供 `/api` 接口存取 Neon。
**只有拍记分卡的 OCR 需要外部 key；其它全是纯前端 + 你自己的 DB。**

```
pwa-deploy/
├── server.js          Express：静态托管 + /api/kv（存 Neon）+ /api/scan（OCR 代理）
├── package.json
├── Dockerfile         可选；gcloud run deploy --source 也能自动构建
├── schema.sql         在 Neon 里跑一次
└── public/
    ├── index.html     ← 把 golf-caddie-v3.html 改名放这里，再打两个补丁（见下）
    ├── manifest.json
    ├── sw.js
    ├── icon-192.png   ← 自备图标
    └── icon-512.png
```

## 一、Neon
1. 建库，在 SQL 编辑器跑 `schema.sql`。
2. 复制**带 `-pooler` 的连接串**（Cloud Run 会多实例，必须用连接池端点），形如
   `postgres://user:pass@ep-xxx-pooler.region.aws.neon.tech/db?sslmode=require`

## 二、index.html 的两个补丁（**已应用**）
`public/index.html` 已经把下面四处改好了（store 走 /api/kv、OCR 走 /api/scan、引 manifest、注册 sw），
**直接部署即可**。以下保留只是说明改了什么，便于你日后维护。把 `golf-caddie-v3.html` 复制成 `public/index.html`，改两处：

**(1) `<head>` 里加一行：**
```html
<link rel="manifest" href="/manifest.json">
```

**(2) 把文件里现有的 `const store = {…}` 整段替换为下面这版**（API 优先，离线退回本地缓存）：
```js
const store = {
  async get(k) {
    try {
      const r = await fetch(`/api/kv/${encodeURIComponent(k)}`);
      const j = await r.json();
      if (j) localStorage.setItem(k, j.value);
      return j;
    } catch {
      const v = localStorage.getItem(k);
      return v == null ? null : { value: v };
    }
  },
  async set(k, v) {
    try { localStorage.setItem(k, v); } catch {}
    try {
      await fetch(`/api/kv/${encodeURIComponent(k)}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: v }),
      });
    } catch {}
  },
};
```

**(3) OCR 改走自己的代理。** 找到 `handleScan` 里那段 `fetch("https://api.anthropic.com/...")`，
整段替换为：
```js
const resp = await fetch("/api/scan", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ image: b64, media_type: f.type || "image/jpeg" }),
});
const J = await resp.json();           // 服务端已返回 { t, h }
const tees = J.t && J.t.length ? J.t : ["默认"];
S.course = { name: "", tees, holes: J.h.map(row => {
  const y = {}; tees.forEach((tn, k) => y[tn] = row[2 + k] ?? null);
  return { no: row[0], par: row[1] || 4, yards: y };
}) };
S.tee = tees[0]; S.plans = []; saveCourse(); renderPlay();
```

**(4) 文件末尾 `loadAll();` 之后加：**
```js
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js");
```

## 三、部署
```bash
cd pwa-deploy

# 密钥放进 Secret Manager（不要写进代码）
printf '%s' 'postgres://...-pooler...sslmode=require' | gcloud secrets create DATABASE_URL --data-file=-
printf '%s' 'sk-ant-...' | gcloud secrets create ANTHROPIC_API_KEY --data-file=-

# 一条命令构建 + 部署（Cloud Run 自动用 Dockerfile 或 buildpack）
gcloud run deploy yardage-caddie \
  --source . \
  --region us-central1 \
  --set-secrets DATABASE_URL=DATABASE_URL:latest,ANTHROPIC_API_KEY=ANTHROPIC_API_KEY:latest \
  --allow-unauthenticated
```

部署完拿到 `https://yardage-caddie-xxxx.run.app`，手机浏览器打开 → 「添加到主屏幕」，
就有图标、全屏、离线可用，跟原生 App 一样。

## 四、只有你自己用 → 锁起来
`--allow-unauthenticated` 是对公网开放的。个人用建议二选一：
- **Cloud Run + IAP**：用 Identity-Aware Proxy 限定只有你的 Google 账号能访问（最干净）。
- 懒人版：在 `server.js` 加一个共享口令校验（请求头带一个长随机 token）。

## 五、想彻底不要 API key（GCP 原生）
把 `/api/scan` 换成 **Vertex AI / Gemini**：`npm i @google-cloud/vertexai`，
给 Cloud Run 的服务账号加 **Vertex AI User** 角色，用 ADC 自动鉴权读图——
没有任何 key 进代码或 Secret Manager。这条最贴合你的 GCP 栈。
