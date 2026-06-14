# 逐杆实时建议增强 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让打球页的逐杆实时建议(`liveSuggest`)用真实历史距离选杆、结合本轮手感、给更具体的打法指引,而不只是按球包标称距离选杆。

**Architecture:** 纯前端单文件改动。新增 3 个读全局状态的纯函数(`pickClubByHistory`、`thisRoundSignal`、`playStyleTips`),再重写 `liveSuggest` 把它们按降级链整合。返回对象字段契约(`{club, clubYd, detail, rem, advice}`)保持不变,渲染层 `shotEditorHTML` 一行不改。静态 18 洞策略卡 `computePlan`、数据结构、后端、CSS 全不碰。

**Tech Stack:** 纯 JS(无构建步骤),`public/index.html` 单文件;验证用 Claude Preview 的 `preview_eval` 在浏览器 console 跑函数断言 + 真实 UI 场景截图。无 test runner。

---

## 测试说明(本项目特殊性)

项目无单元测试框架。每个纯函数任务用 `preview_eval` 在 console 里**桩入全局数据 → 调用函数 → 断言返回值 → 还原**的方式验证。桩入/还原模板(每个验证步骤复用):

```js
// 桩入前先备份
window.__bak = {rounds: window.rounds, R: window.R, bag: window.bag, statsFilter: window.statsFilter};
// ...（各任务设置 bag/rounds/R/statsFilter 后调用函数）...
// 验证完还原:
Object.assign(window, window.__bak); delete window.__bak;
```

> 注:`rounds`、`R`、`bag`、`statsFilter`、`S` 都是 `<script>` 顶层 `let`/`const` 变量,在页面全局作用域内,console 里可直接读写(`bag` 是 `let`,可重新赋值)。

---

## File Structure

| 文件 | 责任 | 改动 |
|------|------|------|
| `public/index.html` | App 全部逻辑 | 新增 3 函数 + 重写 `liveSuggest`(public/index.html:743-754) |
| `public/sw.js` | PWA 缓存 | bump `CACHE` 版本号 v5→v6,否则手机端拿不到新版 |

新增 3 函数插入位置:紧挨现有 `liveSuggest`(第 743 行)之前,使它们在 `liveSuggest` 调用前已定义(函数声明会提升,但就近放置便于阅读)。

---

## Task 1: `pickClubByHistory(rem)` — 历史真实距离选杆

**Files:**
- Modify: `public/index.html`(在第 743 行 `function liveSuggest` 之前插入)

**契约:** 输入剩余码数 `rem`。若该距离段存在任一支累计 ≥3 杆的球杆,返回结果优先(上果岭率高)的那支 `{club, clubYd, n, onN}`(`clubYd` 为历史实测均距,`onN` 为上果岭次数);否则返回 `null`(交由调用方回退标称选杆)。

- [ ] **Step 1: 插入函数**

在 `public/index.html` 第 743 行 `function liveSuggest(i,j){` 之前插入:

```javascript
/* 历史真实距离选杆:某距离段有 ≥3 杆样本时,按上果岭率(green+fringe*0.5)优先,并列看次数 */
function pickClubByHistory(rem){
  if(!rem||rem<=0)return null;
  const hist=clubHistoryAt(rem);            // [{club,n,avg,res}], 已按 n 降序
  const enough=hist.filter(h=>h.n>=3);
  if(!enough.length)return null;
  const scored=enough.map(h=>{
    const g=(h.res.green||0)+(h.res.fringe||0)*0.5;
    return {club:h.club, clubYd:h.avg, n:h.n, onN:(h.res.green||0)+(h.res.fringe||0), rate:g/h.n};
  }).sort((a,b)=>b.rate-a.rate||b.n-a.n);
  return scored[0];
}
```

- [ ] **Step 2: 启动 Preview 并验证函数命中历史**

先确保 Preview 在跑(`preview_start`,launch 配置 `caddie`,端口 8080),然后 `preview_eval`:

```js
(()=>{
  window.__bak={rounds:window.rounds,R:window.R,bag:window.bag,statsFilter:window.statsFilter};
  window.rounds=[{holes:[{no:1,par:4,shots:[
    {club:"P",dist:118,result:"green",dir:["on"]},
    {club:"P",dist:122,result:"green",dir:[]},
    {club:"P",dist:119,result:"fringe",dir:[]},
    {club:"9i",dist:120,result:"rough",dir:["right"]}
  ]}]}];
  window.R=null; window.statsFilter="all";
  const r=pickClubByHistory(120);
  Object.assign(window,window.__bak); delete window.__bak;
  return JSON.stringify(r);
})()
```

Expected: `{"club":"P","clubYd":~120,"n":3,"onN":3,...}` —— P 有 3 杆(≥3)、3 次上果岭(2 green +1 fringe),胜过 9i(只 1 杆,被过滤)。

- [ ] **Step 3: 验证样本不足时回退(返回 null)**

`preview_eval`:

```js
(()=>{
  window.__bak={rounds:window.rounds,R:window.R,bag:window.bag,statsFilter:window.statsFilter};
  window.rounds=[{holes:[{no:1,par:4,shots:[{club:"P",dist:118,result:"green"}]}]}];
  window.R=null; window.statsFilter="all";
  const r=pickClubByHistory(120);       // 只 1 杆 <3
  const r2=pickClubByHistory(0);        // 非法 rem
  Object.assign(window,window.__bak); delete window.__bak;
  return JSON.stringify([r,r2]);
})()
```

Expected: `[null,null]`

---

## Task 2: `thisRoundSignal(club)` — 本轮手感信号

**Files:**
- Modify: `public/index.html`(紧接 Task 1 函数之后)

**契约:** 只看当前一轮 `R` 已记录的该球杆击球。某方向/长短 ≥2 次且占多数时返回一句修正文案(可多条用 `;` 连接);不足 2 次返回 `null`。

- [ ] **Step 1: 插入函数**

```javascript
/* 本轮手感:只看当前 R 里这支杆的击球,≥2 次同向/同偏才报,1 次偶发不报 */
function thisRoundSignal(club){
  if(!R||!club)return null;
  const shots=[];
  (R.holes||[]).forEach(h=>(h.shots||[]).forEach(s=>{if(s.club===club)shots.push(s);}));
  if(shots.length<2)return null;
  const cnt=t=>shots.filter(s=>nd(s.dir).includes(t)).length;
  const left=cnt("left")+cnt("fl"), right=cnt("right")+cnt("fr");
  const shortN=cnt("short"), longN=cnt("long");
  const bits=[];
  if(left>=2&&left>right)bits.push("这支老左曲,瞄右一点");
  else if(right>=2&&right>left)bits.push("这支老右曲,瞄左一点");
  if(longN>=2&&longN>shortN)bits.push("偏长,收半号");
  else if(shortN>=2&&shortN>longN)bits.push("偏短,宁可大半号");
  return bits.length?bits.join(";"):null;
}
```

- [ ] **Step 2: 验证 2 次同向触发**

`preview_eval`:

```js
(()=>{
  window.__bak={R:window.R};
  window.R={holes:[
    {shots:[{club:"Driver",dir:["right"]},{club:"7i",dir:[]}]},
    {shots:[{club:"Driver",dir:["fr"]}]}
  ]};
  const a=thisRoundSignal("Driver");   // right+fr = 2 → 右
  const b=thisRoundSignal("7i");       // 1 杆 → null
  Object.assign(window,window.__bak); delete window.__bak;
  return JSON.stringify([a,b]);
})()
```

Expected: `["这支老右曲,瞄左一点",null]`

- [ ] **Step 3: 验证偏短**

`preview_eval`:

```js
(()=>{
  window.__bak={R:window.R};
  window.R={holes:[{shots:[
    {club:"P",dir:["short"]},{club:"P",dir:["short","on"]}
  ]}]};
  const a=thisRoundSignal("P");
  Object.assign(window,window.__bak); delete window.__bak;
  return a;
})()
```

Expected: `"偏短,宁可大半号"`

---

## Task 3: `playStyleTips(rem,pin,firm,maxTotal,minTotal,spread)` — 具体打法指引

**Files:**
- Modify: `public/index.html`(紧接 Task 2 函数之后)

**契约:** 不依赖历史,纯按剩余距离 + 旗位 + 果岭软硬 + 球杆离散给取舍文案数组(新用户也能给)。

- [ ] **Step 1: 插入函数**

```javascript
/* 打法指引:旗位/果岭软硬/距离边界/球杆离散 → 取舍文案,不依赖历史 */
function playStyleTips(rem,pin,firm,maxTotal,minTotal,spread){
  const t=[];
  if(maxTotal&&rem>maxTotal)t.push("够不到果岭,放到剩 ~90 码留个顺手距离");
  else if(minTotal&&rem<=minTotal)t.push("很近,留上坡推,别打过旗");
  if(pin==="front")t.push("前旗别冲,瞄果岭中部,落球后旗更安全");
  else if(pin==="back")t.push("后旗可加半号,但别长");
  if(spread&&spread>=8)t.push("这支飘,打中心别冲边旗");
  if(firm==="firm")t.push("果岭硬,落短半号让球滚上去");
  return t;
}
```

- [ ] **Step 2: 验证够不着 + 前旗**

`preview_eval`:

```js
JSON.stringify(playStyleTips(240,"front","med",230,90,3))
```

Expected: 含 `"够不到果岭,放到剩 ~90 码留个顺手距离"` 和 `"前旗别冲,瞄果岭中部,落球后旗更安全"`,共 2 条。

- [ ] **Step 3: 验证很近 + 离散大 + 硬果岭**

`preview_eval`:

```js
JSON.stringify(playStyleTips(70,"mid","firm",230,90,10))
```

Expected: `["很近,留上坡推,别打过旗","这支飘,打中心别冲边旗","果岭硬,落短半号让球滚上去"]`

---

## Task 4: 重写 `liveSuggest(i,j)` — 整合三增强 + 降级链

**Files:**
- Modify: `public/index.html:743-754`(替换整个 `liveSuggest` 函数体)

**契约不变:** 返回 `{club, clubYd, detail, rem, advice}` 或 `null`。`detail` 是 HTML 字符串(可多行 `<br>`);`advice` 是 `;` 连接的修正文案字符串(可空)。渲染层 [public/index.html:815](public/index.html:815) 外层已渲染「🎯 按实际剩 X码 → club(clubYd码)」头,故 `detail` 不重复该头,只放历史依据 + 打法细节。

- [ ] **Step 1: 替换函数**

把 `public/index.html` 现有的 `liveSuggest`(743-754 行整段)替换为:

```javascript
function liveSuggest(i,j){
  if(j<1||!R||!R.holes[i])return null;
  const sh=R.holes[i].shots,prev=sh[j-1];if(!prev||prev.rem==null||prev.rem<=0)return null;
  const b=sb();if(b.length<1)return null;
  const rem=prev.rem,pin=S.holePin[i]||"mid",firm=S.firm||"med",wt=S.holeWind[i]||"none",mph=S.windMph;
  // —— 选杆:增强① 历史优先,不足回退标称 ——
  const hp=pickClubByHistory(rem);
  let club,clubYd;const detailLines=[];
  if(hp){
    club=hp.club;clubYd=hp.clubYd;
    detailLines.push(`你这距离 ${club} 打过 ${hp.n} 次,其中 ${hp.onN} 次上果岭(实测均 <b>${clubYd}码</b>)`);
  }else{
    const a=approachShot(j+1,"实时",b,rem,pin,firm,wt,mph);
    club=a.clubName;clubYd=a.clubYd;detailLines.push(a.detail);
  }
  // —— 增强③ 打法细节(不依赖历史) ——
  const maxTotal=b[0].total,minTotal=b[b.length-1].total,spread=clubTendency(club).spread;
  playStyleTips(rem,pin,firm,maxTotal,minTotal,spread).forEach(t=>detailLines.push(t));
  // —— 修正:球位 → 增强② 本场优先,退历史 ——
  const adv=[];
  const lieMap={rough:"上一杆在长草,力量打折,宁可大半号",trees:"树下,先低弹道打出来回球道,别强求距离",fbunker:"球道沙坑,先稳出来",gbunker:"沙坑,先上果岭",ob:"刚罚杆,这杆求稳",water:"刚罚杆,这杆求稳",fringe:"果岭边缘,可推或切滚"};
  if(lieMap[prev.result])adv.push(lieMap[prev.result]);
  const rt=thisRoundSignal(club);
  if(rt)adv.push("【本场】"+rt);
  else{const tn=tendencyNote(club,R.holes[i].par,pin);if(tn)adv.push("【历史】"+tn.replace(/^📈\s*/,""));}
  const dir=nd(prev.dir);
  if(!rt&&(dir.includes("left")||dir.includes("fl")))adv.push("上杆偏左,瞄右一点");
  if(!rt&&(dir.includes("right")||dir.includes("fr")))adv.push("上杆偏右,瞄左一点");
  return {club:club,clubYd:clubYd,detail:detailLines.join("<br>"),rem:rem,advice:adv.join(";")};
}
```

- [ ] **Step 2: 验证历史命中路径(端到端,返回对象)**

`preview_eval`(桩入历史 + 当前洞 + 上一杆剩余):

```js
(()=>{
  window.__bak={rounds:window.rounds,R:window.R,bag:window.bag,statsFilter:window.statsFilter};
  window.bag=[{name:"Driver",total:230,carry:210},{name:"7i",total:150,carry:145},{name:"P",total:120,carry:115}];
  window.statsFilter="all";
  window.rounds=[{holes:[{no:1,par:4,shots:[
    {club:"P",dist:118,result:"green"},{club:"P",dist:121,result:"green"},{club:"P",dist:119,result:"fringe"}
  ]}]}];
  S.holePin=S.holePin||{}; S.holePin[0]="mid"; S.holeWind=S.holeWind||{}; S.holeWind[0]="none";
  window.R={holes:[{no:1,par:4,shots:[
    {club:"Driver",dist:210,result:"fairway",dir:[],rem:120},
    {club:"P",dir:[]}
  ]}]};
  const r=liveSuggest(0,1);
  Object.assign(window,window.__bak); delete window.__bak;
  return JSON.stringify(r);
})()
```

Expected: 返回对象 `club:"P"`、`clubYd≈119`、`detail` 含「你这距离 P 打过 3 次,其中 3 次上果岭」、`rem:120`。

- [ ] **Step 3: 验证零历史回退路径(新用户不报错)**

`preview_eval`:

```js
(()=>{
  window.__bak={rounds:window.rounds,R:window.R,bag:window.bag,statsFilter:window.statsFilter};
  window.bag=[{name:"Driver",total:230,carry:210},{name:"7i",total:150,carry:145},{name:"P",total:120,carry:115}];
  window.rounds=[]; window.statsFilter="all";
  S.holePin=S.holePin||{}; S.holePin[0]="front"; S.holeWind=S.holeWind||{}; S.holeWind[0]="none";
  window.R={holes:[{no:1,par:4,shots:[
    {club:"Driver",dist:205,result:"rough",dir:["right"],rem:130},
    {club:"7i",dir:[]}
  ]}]};
  const r=liveSuggest(0,1);
  Object.assign(window,window.__bak); delete window.__bak;
  return JSON.stringify(r);
})()
```

Expected: 不报错,返回对象;`detail` 含 approachShot 标称文案 + 前旗打法提示;`advice` 含「上一杆在长草…」(球位)。验证回退链与边界不崩。

- [ ] **Step 4: 真实 UI 场景验证(截图)**

`preview_eval` 还原任何桩数据后 `window.location.reload()`,然后在 UI 里:开球后给上一杆填「距旗」→ 展开第 2 杆 → 用 `preview_screenshot` 确认实时建议块显示了新的多行 detail + 修正文案。

---

## Task 5: bump SW 缓存版本 + 收尾

**Files:**
- Modify: `public/sw.js:1`

- [ ] **Step 1: bump 版本号**

把 `public/sw.js` 第 1 行 `const CACHE = "caddie-v5";` 改为 `const CACHE = "caddie-v6";`(改了 index.html 必须 bump,否则手机端 PWA 拿不到新版)。

- [ ] **Step 2: 最终回归截图**

Preview reload 后跑一遍:扫码/选球场 → 生成策略 → 进打球 → 记一杆 + 填距旗 → 看第 2 杆实时建议。`preview_screenshot` 留证。确认控制台无红色报错(`preview_console_logs`)。

- [ ] **Step 3: 提交与部署(⛔ 需用户明确授权)**

不自动执行。完成验证后告知用户改动文件(`public/index.html`、`public/sw.js`),由用户决定是否 `git push origin main`(会触发 GitHub Actions 部署到 Cloud Run)。部署后按 CLAUDE.md 实际访问生产 URL 验证。

---

## Self-Review

**Spec 覆盖:**
- 增强① 真实距离选杆 → Task 1 + Task 4 Step 1(`pickClubByHistory` 接入)✓
- 增强② 本轮手感 → Task 2 + Task 4(`thisRoundSignal`,【本场】优先)✓
- 增强③ 具体打法指引 → Task 3 + Task 4(`playStyleTips`)✓
- 降级链(本场→历史→不报;历史选杆→标称回退)→ Task 4 Step 1 逻辑 + Step 2/3 双路径验证 ✓
- 边界(零历史/无 rem/开球第1杆/离群值)→ Task 4 Step 3 + 函数内 guard ✓
- 触发条件不变、字段契约不变、不动 shotEditorHTML → Task 4 契约说明 ✓
- bump sw.js → Task 5 ✓

**占位符扫描:** 无 TBD/TODO,每个代码步骤含完整代码 ✓

**类型/命名一致性:**
- `pickClubByHistory` 返回 `{club,clubYd,n,onN,rate}`,Task 4 用 `hp.club/hp.clubYd/hp.n/hp.onN` ✓
- `thisRoundSignal` 返回 string|null,Task 4 用 `rt` 判空 ✓
- `playStyleTips(rem,pin,firm,maxTotal,minTotal,spread)` 6 参,Task 4 调用同序 6 参 ✓
- `liveSuggest` 返回字段 `{club,clubYd,detail,rem,advice}` 与渲染层 815 行用到的 `ls.club/ls.clubYd/ls.detail/ls.rem/ls.advice` 一致 ✓
- `clubHistoryAt` 返回 `res` 以 result key(green/fringe)计数,`pickClubByHistory` 读 `h.res.green/h.res.fringe` ✓
