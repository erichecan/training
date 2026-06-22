# 赛前球场侦察(Course Recon)Implementation Plan

> **For agentic workers:** 本项目为单文件纯前端 PWA,无测试框架。按用户全局 CLAUDE.md,验证用「node --check 语法 + 本地 Claude Preview 手动用例」,不套 pytest/TDD。逐任务实现,每任务以一个可手动验证的交付物结束。

**Goal:** 给球场加地址定位 + 逐洞卫星图,赛前无 GPS 也能侦察地形、量距离、标关键点并存住。

**Architecture:** 全部落在 `public/index.html` 单文件。采用与现有 `openTrackMap/drawTrack` 一致的**全屏 overlay box**(`position:fixed;inset:0;z-index:9999`,append 到 body,独立于 `renderPlay`)。复用 `loadLeaflet()`、`mapTileLayer()`、`ydBetween()`、`getMapboxToken()`、`showOverlay/hideOverlay`、`esc()`。数据就地写入传入的 course 对象,经 `saveCourse()`(当前球场)/`saveCoursesLib()`(常打库)持久化。

**Tech Stack:** vanilla JS、Leaflet 1.9.4(CDN 按需)、Mapbox satellite 瓦片 + Esri 回退、Mapbox Geocoding v6 + Nominatim 回退。

## Global Constraints

- 改动只在 `public/index.html`,纯前端,不动 `server.js`/数据库。
- 距离单位:**码**(用 `ydBetween`,返回码)。
- 球场数据 key 沿用 `golf:` 前缀(`golf:course2` / `golf:courses`)。
- 发球台赛前**只标一个点**(不分 tee)。`recon` 数据与实战 `teeGps` 完全分开。
- 改完 `index.html` **必须 bump `public/sw.js` 的 CACHE 版本号**。
- 不引新依赖库。

---

### Task 1: 入口按钮 + 全屏 overlay 骨架 + 地图初始化

**Files:** Modify `public/index.html`

**Interfaces:**
- Produces: `openRecon(course)`、`closeRecon()`、全局 `_recon`(`{box,map,course,hole,mode,measureA,layers}`)。

- [ ] **Step 1: 加全局状态**,在 `_trackState` 声明附近加:`let _recon=null;`
- [ ] **Step 2: 写 openRecon/closeRecon**(放在 `closeTrackMap` 之后)。骨架:

```js
async function openRecon(course){
  if(!course){alert("先选/建一个球场再看图。");return;}
  showOverlay("加载卫星地图…");
  try{await loadLeaflet();}catch(e){hideOverlay();alert(e.message);return;}
  hideOverlay();
  let box=document.getElementById("reconMap");
  if(!box){box=document.createElement("div");box.id="reconMap";box.style.cssText="position:fixed;inset:0;z-index:9999;background:#000;";document.body.appendChild(box);}
  _recon={box,map:null,course,hole:0,mode:null,measureA:null,layers:[]};
  box.innerHTML=reconChromeHTML(course);
  const map=L.map("reconMapCanvas",{zoomControl:true,attributionControl:true});
  mapTileLayer().addTo(map);
  _recon.map=map;
  const c=course.center||{lat:39.8,lng:-98.6};
  map.setView([c.lat,c.lng],course.center?15:4);
  map.on("moveend",reconRememberView);
  map.on("click",reconMapClick);
  selectReconHole(0);
}
function closeRecon(){if(_recon){if(_recon.map)_recon.map.remove();if(_recon.box)_recon.box.remove();_recon=null;}}
```

- [ ] **Step 3: 写 reconChromeHTML(course)**:顶栏(返回、球场名、换高清 token)+ 地址行(input#reconAddr + 定位按钮)+ 洞导航(1-18 圆按钮,`onclick="selectReconHole(n)"`)+ 工具行(📍发球台/⛳果岭/⚠️关键点/📏量距,`onclick="reconSetMode('tee'…)"`)+ `#reconInfo`(派生信息条)+ `#reconMapCanvas`(`position:absolute;inset:0` 但顶部留出 chrome 高度)。沿用 drawTrack 顶栏的深色半透明样式。占位的 `selectReconHole/reconSetMode/reconLocate/reconRememberView/reconMapClick` 先写空函数,后续任务填。
- [ ] **Step 4: 两处入口按钮**
  - 球场管理页卡片 `courseCardHTML`(约 562-565 行按钮区)加:`<button class="mini" onclick="openRecon(courses[${i}])">🛰 赛前看图</button>`
  - 打球页当前球场区(约 1431-1435,`管理球场` 按钮旁)加:`<button class="mini" onclick="openRecon(S.course)">🛰 赛前看图</button>`
- [ ] **Step 5: 验证** `node --check`(对提取的 script 块或整体语法心算);本地预览:两处按钮都能打开全屏卫星图、洞导航可见、← 返回可关闭。

---

### Task 2: 地址定位(geocode)

**Files:** Modify `public/index.html`

**Interfaces:**
- Consumes: `_recon.course`、`getMapboxToken()`、`DEFAULT_MAPBOX_TOKEN`。
- Produces: `geocodeAddress(q)`(async→`{lat,lng}|null`)、`reconLocate()`、`reconSave()`。

- [ ] **Step 1: 写 reconSave()**(持久化就地改过的 course):

```js
function reconSave(){
  const c=_recon&&_recon.course;if(!c)return;
  if(courses.includes(c))saveCoursesLib();
  if(c===S.course)saveCourse();
  // 同名但非同一对象时同步常打库
  const li=courses.findIndex(x=>x.name===c.name);
  if(li>=0&&courses[li]!==c){courses[li]=JSON.parse(JSON.stringify(c));saveCoursesLib();}
}
```

- [ ] **Step 2: 写 geocodeAddress(q)**:先 Mapbox v6 forward(`https://api.mapbox.com/search/geocode/v6/forward?q=&limit=1&access_token=`,token 用 `getMapboxToken()||DEFAULT_MAPBOX_TOKEN`),解析 `features[0].geometry.coordinates=[lng,lat]`;无 token 或抛错或空 → Nominatim(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=`,解析 `[0].lat/lon`)。全部 try/catch,失败返回 null。
- [ ] **Step 3: 写 reconLocate()**:读 `#reconAddr` 值→空则 alert→`showOverlay("定位球场…")`→`geocodeAddress`→`hideOverlay`→成功:`_recon.course.address=q; _recon.course.center={lat,lng}; reconSave(); _recon.map.flyTo([lat,lng],15);`→失败:`alert("没定位到「"+q+"」,可手动拖动地图找到球场。")`
- [ ] **Step 4: reconChromeHTML 地址 input 预填** `value="${esc(course.address||"")}"`,定位按钮 `onclick="reconLocate()"`。
- [ ] **Step 5: 验证**:填一个真实球场地址(如 "Spring Valley Country Club, Columbia, SC")→定位→地图飞到球场;退出重进地址仍在(已落 store)。

---

### Task 3: 逐洞切换 + 视角记忆 + 渲染已有标记

**Files:** Modify `public/index.html`

**Interfaces:**
- Produces: `ensureRecon(hole)`、`selectReconHole(n)`、`reconRememberView()`、`reconRenderMarkers()`、`reconClearLayers()`。

- [ ] **Step 1: ensureRecon(hole)**:`if(!hole.recon)hole.recon={tee:null,green:null,points:[],view:null};return hole.recon;`
- [ ] **Step 2: selectReconHole(n)**:`_recon.hole=n;` 高亮洞导航按钮;取 `h=_recon.course.holes[n]`,`r=ensureRecon(h)`;若 `r.view` → `map.setView([r.view.lat,r.view.lng],r.view.zoom)`,否则若 `course.center` → `setView(center,15)`;调用 `reconRenderMarkers()` 与 `reconUpdateInfo()`(Task5,先留空)。
- [ ] **Step 3: reconRememberView()**(map moveend):`if(!_recon)return;const h=_recon.course.holes[_recon.hole];if(!h)return;const c=_recon.map.getCenter();ensureRecon(h).view={lat:c.lat,lng:c.lng,zoom:_recon.map.getZoom()};reconSave();`(注意:flyTo/setView 也会触发 moveend——可接受,view 会被同点覆盖)。
- [ ] **Step 4: reconClearLayers()**:`(_recon.layers||[]).forEach(l=>_recon.map.removeLayer(l));_recon.layers=[];`
- [ ] **Step 5: reconRenderMarkers()**:清旧 layer;取当前洞 recon;`r.tee` 画绿色 circleMarker(发球台),`r.green` 画旗 circleMarker,`r.points` 按 type 画(沙坑🟫/水🟦/拐点🟨/落点🎯 —— 用不同 fillColor circleMarker + bindPopup)。每个加入 `_recon.layers`。popup 内容与删除按钮在 Task4 完善。
- [ ] **Step 6: 验证**:标记函数尚未接入,但切洞不报错;手动在 console 给某洞塞 `recon.view` 后切洞能飞过去。

---

### Task 4: 标记交互(发球台/果岭/关键点/删除)

**Files:** Modify `public/index.html`

**Interfaces:**
- Produces: `reconSetMode(m)`、`reconMapClick(e)`、`reconDelPoint(idx)`、`reconClearTeeGreen(which)`。

- [ ] **Step 1: reconSetMode(m)**:`_recon.mode=(_recon.mode===m?null:m);` 高亮对应工具按钮;若进入 measure 重置 `_recon.measureA=null`;更新 `#reconInfo` 提示(如"点地图放置发球台")。
- [ ] **Step 2: reconMapClick(e)**:按 `_recon.mode` 分流。`tee`→`ensureRecon(h).tee={lat:e.latlng.lat,lng:e.latlng.lng}`;`green`→`.green=…`;`point`→选类型后 push 到 `.points`(类型用轻量菜单:`const t=prompt("类型:1沙坑 2水 3拐点 4落点","4")` 映射 `['bunker','water','dogleg','target']`,或做成 4 个并排小按钮——优先小按钮,prompt 兜底);measure 在 Task5。每次放置后 `reconSave();reconRenderMarkers();reconUpdateInfo();` 放完单点标记后 `_recon.mode=null`(关键点保持连续放置)。
- [ ] **Step 3: 标记 popup 加删除**:发球台/果岭 popup 加 `onclick="reconClearTeeGreen('tee')"`;关键点 popup 加 `onclick="reconDelPoint(${idx})"`。`reconDelPoint(idx)`:`splice`→save→render→updateInfo。`reconClearTeeGreen(which)`:置 null→save→render→updateInfo。
- [ ] **Step 4: 验证**:进某洞标发球台、果岭、加 1 个沙坑;退出重进,标记仍在;删除标记生效。

---

### Task 5: 量距离 + 派生信息条

**Files:** Modify `public/index.html`

**Interfaces:**
- Produces: `reconUpdateInfo()`、measure 分支(在 `reconMapClick` 内)。

- [ ] **Step 1: measure 分支**(reconMapClick 内 `mode==='measure'`):首点存 `_recon.measureA=e.latlng` 并画临时 marker;次点→`ydBetween(measureA, e.latlng)` 得码数→画 polyline + 中点 tooltip 显示 `${yd} 码`→`measureA=null`(线加入 `_recon.layers`,切洞时随 clear 消失)。
- [ ] **Step 2: reconUpdateInfo()**:取当前洞 recon,组装 `#reconInfo` 文本:
  - 有 tee+green → `看图全长 ${ydBetween(tee,green)} 码`(可与 `h.yards[第一个tee]` 官方码数并列对照)。
  - 关键点列表:每个显示 `${typeLabel} · 距台 ${ydBetween(tee,p)} 码 · 距果岭 ${ydBetween(green,p)} 码`(tee/green 缺则该项省略)。
- [ ] **Step 3: 接入调用**:`selectReconHole`、放置/删除标记后都调用 `reconUpdateInfo()`。
- [ ] **Step 4: 验证**:标台+果岭看到全长;加沙坑看到到台/到果岭距离;📏量任意两点得码数;数值与地图比例尺大致吻合。

---

### Task 6: sw 缓存版本 bump + 最终验证

**Files:** Modify `public/sw.js`

- [ ] **Step 1: bump CACHE 版本号**(`public/sw.js` 里 `CACHE='...vN'` → `vN+1`)。
- [ ] **Step 2: 语法检查**:提取 `<script>` 块跑 `node --check` 或整页在浏览器 console 无红错。
- [ ] **Step 3: 完整用例**(本地 Preview,先清 service worker):录入/选一个球场→赛前看图→填地址定位→第1洞拖图标台+果岭→看图全长合理→加沙坑显示到台/果岭→📏量两点→切第2洞再切回第1洞,标记与视角都在→← 返回→再次进入,数据仍在(走 store)。
- [ ] **Step 4: 无 token 回退**:临时清 Mapbox token,确认回退 Esri 瓦片 + Nominatim geocode 仍可用。

---

## Self-Review

- **Spec coverage:** 入口两处(T1)✓ 地址定位 Mapbox+Nominatim(T2)✓ 逐洞认洞+视角记忆(T3)✓ 标发球台/果岭/关键点+删除(T4)✓ 量距离+到台/果岭派生(T5)✓ recon 与 teeGps 分开(T3 数据结构)✓ 持久化 golf:库(T2 reconSave)✓ 复用 Leaflet/瓦片/ydBetween ✓ sw bump(T6)✓ 纯前端 ✓
- **实现偏离 spec 处(合理细化):** 用 overlay box 代替 spec 第3节"renderPlay 分支"——与现有 drawTrack 一致,已在 Architecture 注明。
- **类型一致:** `_recon`(box,map,course,hole,mode,measureA,layers)全任务统一;`recon`(tee,green,points[],view)全任务统一;`reconSave/reconRenderMarkers/reconUpdateInfo/reconClearLayers` 命名前后一致。
- **Placeholder 扫描:** 关键点类型菜单给了具体实现(小按钮优先,prompt 兜底);无 TBD。
