# DEV-PLAN · 球场 → 比赛策略 / 训练计划（双引擎模式）

> 本计划由 Claude Code 生成。读取的产品输入：用户提供的 `isabella-3week-plan-v6.html`（训练计划样板）+ 现有 App 源码（`public/index.html`、`server.js`、`DESIGN.md`）。

## 0. 目标

把现有"输入球场 → 生成比赛策略"扩展成一种**可复用模式**：输入球场信息后，既能生成**比赛策略**，也能生成**训练计划**；训练计划基于已记录的表现数据，可随数据累积重新生成、自动调整，不只服务单场比赛。

## 1. 已确认决策

| 项 | 决定 |
|---|---|
| 训练计划生成 | AI（复用现有 `GEMINI_API_KEY`，与 `/api/scan` 同一 key） |
| 时间模式 | 备赛（倒计时周期化）+ 日常（滚动周计划），两者都做 |
| 输入粒度 | 极简：训练偏好首次填一次记住；之后只填目标分数 +（备赛）比赛日期 |
| 渲染 | AI 返回结构化 JSON，App 用现有纸质风格原生渲染 |
| 比赛策略 | 保留规则逐杆引擎不动，**新增** AI「整场博弈层」（洞分类 + 目标分数路径），洞分类同时供训练计划使用 |

## 2. 关键事实 / 风险

- **生效文件是 `public/index.html`（597 行）**，根目录 `index.html`（438 行）已分叉、陈旧 —— 本次只改 `public/index.html`；根目录副本作为已知遗留问题记录到 DEV-REPORT，不动。
- `server.js` 已有 Gemini 代理（`/api/scan`）与 kv 存储模式，新增端点复用同一基础设施与错误处理写法。
- `schema.sql` **不改**：kv 表本就存任意 key。
- 鉴权姿态与现有 `/api/scan` 一致（无 DB 写、单用户、靠 IAP/共享口令，见 README 第四节），不额外加层。
- AI 非确定性 / 离线 / 无 key：博弈层退回纯规则策略；训练计划给出"需联网+key"提示；JSON 解析失败回传原文（同 `/api/scan`）。

## 3. 数据模型 / kv 新增 key

- `golf:trainPrefs` — `{daysPerWeek, hoursPerDay, facilities:[range|green|course], focusNote}`
- `golf:gameplan:<courseKey>` — 最近一次博弈层 JSON
- `golf:trainPlan:<courseKey>` — 最近一次训练计划 JSON
- 球场对象（`golf:course2`）扩展可选字段：`rating`、`slope`、`target`

`courseKey()` 沿用现有 `(name|tee)`。

### JSON Schema

**gameplan**
```
{ target, summary, path:[{icon,text,delta}],
  holes:[{no,par,yards,klass:"score"|"adv"|"hard",tee_club,plan,note}],
  notes:[string] }
```

**trainPlan**
```
{ mode:"prep"|"ongoing", title, target, subtitle, weeksToEvent,
  analysis:{hardest:[{label,detail}], easiest:[{label,detail}], insight},
  focus:[{rank,title,detail,pct}], skip:[string], path:[{icon,text,delta}],
  weeks:[{n,title,summary,goal,
    days:[{label,title,time,rest,restNote,
      sessions:[{icon,name,dur,drills:[{text,note,tag}]}], focus}]}] }
```

## 4. 后端改动（`server.js`）

- 新增 `POST /api/coach`，body=`{kind:"gameplan"|"trainplan", payload}`。
- `buildCoachPrompt(kind,payload)`：拼装中文教练 prompt，内嵌对应 schema 与"只输出 JSON"约束。
- 调 Gemini 用 `generationConfig.response_mime_type="application/json"`；解析失败用正则抠 JSON 兜底（同 `/api/scan`）。
- 错误统一 `res.status(500).json({error})`。

## 5. 前端改动（`public/index.html`）

按开发顺序：

1. **CSS**：在 `</style>` 前追加训练视图 + 博弈面板样式（周 tab、日卡片、session/drill、focus box、得分路径、洞分类条、训练重点排名行）。
2. **DOM**：tabbar 加「🏋️ 训练」；新增 `#trainView`；overlay 文案改成可变 `#overlayMsg`。
3. **State/存储**：`S.gameplan`/`S.trainPlan`、`trainPrefs`；`loadCoach()`；在 `loadAll`、tee 变更、生成后调用。
4. **`buildStatsDigest()`**：从 `rounds(+R)` 聚合 FIR/GIR/救球/沙坑/推杆/罚杆 + 最弱/最强洞（对标准杆均值）+ 各杆 avg/spread/偏向。冷启动返回 `{hasData:false}`。
5. **`callCoach(kind,extra)`**：组 payload（course/bag/digest/prefs/mode/target/eventDate/weeksToEvent）→ POST `/api/coach` → 存 kv → 重渲染；带 spinner 与错误提示。
6. **比赛策略整合**：球场卡片加「🎯 生成整场博弈」「🏋️ 去训练计划」按钮 + 可选 rating/slope/目标分；setup 视图渲染博弈面板（路径 + 洞分类条 + 逐洞表）；play 模式逐洞卡片叠加洞分类徽章 + AI 定位行。
7. **训练视图**：无计划→生成面板（模式切换、备赛填日期、目标分、可折叠偏好带默认）；有计划→原生渲染（头部/分析/重点/周 tab/日卡片）+ 重新生成 + 改偏好。

## 6. 验证清单

- `node -c server.js` 语法通过；本地 `npm start` 起服务（离线 localStorage 亦可）。
- 预置 Spring Valley：生成博弈层 + 训练计划，检查渲染与样式一致性。
- 加一轮记录后重新生成训练计划，确认重点随数据变化（数据闭环）。
- 断网/无 key：博弈层退回规则策略、训练计划给提示，不白屏。
- 现有功能（拍卡、打球模式、记录、数据、球包）无回归。

## 7. 不在本次范围

- 训练计划"每日打勾记录依从度"（schema 预留结构，后续可加）。
- 根目录陈旧 `index.html` 的清理 / 合并。
- `/api/scan` 改 Vertex AI 免 key。
