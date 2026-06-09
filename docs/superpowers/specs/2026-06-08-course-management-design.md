# 球场管理 — 设计 spec

日期：2026-06-08
状态：已与用户确认，进入实现

## 背景 / 痛点

现有「常打球场库」（`golf:courses`）只藏在「打球」设置页里，能存/选/删，但：
1. 没有集中入口，球场和「当前打球设置」混在一起。
2. 改已存球场要走「切成它 → 改 → 覆盖存」的绕流程（修 OCR 识别错的洞码尤其麻烦）。
3. 成绩（`rounds`）和球场没有关联视图，看不到「在这个球场打过几轮、平均多少」。

## 目标

一个**全屏球场管理页**，从「打球」页按钮进入，集中：
- 列出所有常打球场（卡片）
- 就地编辑任一球场（名字 / 18 洞 Par / 码数 / 评级 / 坡度 / 目标）
- 每个球场看历史成绩（按 `round.courseName` 聚合 + 逐轮详情）
- 删除 / 「用这个打球」
- 当前球场未入库时，顶部一键归档

不做（YAGNI，用户未选）：Tee 增删、复制球场。

## 入口

「打球」设置页球场区，加 `⚙️ 管理球场` 按钮 → 全屏页（复用 `body.play-mode` + `.pm-header`/`.pm-scroll` 壳）。`← 返回` 回到设置页。

## 状态

`S` 新增：`coursePage:false`（是否在管理页）、`editCourse:null`（正在编辑的球场名）、`histCourse:null`（展开历史的球场名）。复用既有 `S.openRound`（逐轮详情展开）。

## 渲染

`renderPlay()` 顶部加早退分支：`if(S.coursePage){body.play-mode; w.innerHTML=renderCoursePage(); return;}`。

- `renderCoursePage()` — header + 滚动区：当前未入库横幅 + 球场卡片列表（空库给引导）。
- `courseCardHTML(c,i)` — 摘要态：名（当前球场打「当前」标）/ `18 洞·Par X·Y 码(tee)` / `打过 N 轮·平均 S·平均 ±D·最弱 H 号`；操作：✏️编辑 / 📊历史 / 🗑删除 / ▶用这个打球。编辑/历史就地展开。
- `editCourseFormHTML(c,tee)` — 名输入 + `sc-table`（Par/码，仅改首个 tee 的码，Par 各台共用）+ 评级/坡度/目标 + 💾保存。
- `courseHistHTML(name)` — 该球场轮次列表（含进行中的 R），点行复用 `roundDetailHTML` 展开逐洞。

## 数据 / 函数

- `courseAgg(name)` — 从 `rounds`(+R) 按 `courseName===name` 聚合：轮数 `n`、平均总杆、平均对标准杆、最弱洞（按各洞平均 `score-par`）。复用 `holeStats`（兼容快速记分 `h.quick`）。
- `openCoursePage()` / `closeCoursePage()`
- `editCourseToggle(i)` / `histCourseToggle(i)` / `toggleCourseRound(id)`
- `saveEditedCourse(i)` — 读表单写回 `courses[i]`，`saveCoursesLib()`；若改的是当前球场则同步 `S.course` + 清 `S.plans` + `saveCourse()`；同名校验。
- `deleteSavedCourseByName(i)` / `useCourseFromManager(i)`（= `loadSavedCourse` + 回打球页）/ `archiveCurrentToLib()`。

onclick 一律传 `courses` 索引，避免球场名里特殊字符破坏属性字符串。

## 复用 / 不重造

`holeStats`、`roundDetailHTML`、`sc-table` 样式、`loadSavedCourse`、`play-mode` 全屏壳。

## 范围

纯前端单文件 `public/index.html`；`sw.js` 缓存版本 v2 → v3。无后端 / schema 改动。

## 边界

- 编辑当前球场的码数不回溯改已存档的 `R`/`rounds`（历史成绩按当时快照，保持完整性）。
- 名字为空 / 同名 → 拦截并提示。
- 删除球场不影响已记录成绩。
