# 赛前球场侦察(Course Recon · 「🛰 赛前看图」)设计

> 日期:2026-06-21 · 项目:袋中球童 Yardage Caddie(单文件 PWA `public/index.html`)

## 1. 目标 / 场景

要去打一个**新球场**的比赛,人还没到现场(没有任何实战 GPS 打点)。希望:

1. 给球场填一个**地址**,卫星图自动定位到球场;
2. **逐洞**在卫星图上研究地形(球道形状、沙坑、水、拐点);
3. 在图上**量距离**、**标记关键点**,数据存住,赛前一次做完功课,以后打开还在。

## 2. 现状(已有,直接复用)

- 球场数据结构:`course = {name, tees:[], holes:[{no, par, yards:{tee:数}, teeGps:{tee:pos}}]}`,存于常打库 `golf:courses`。
- 球场录入:打球页「拍记分卡 OCR」/「手动输入 18 洞」(`manualCourse()`);「⚙️管理球场」=全屏球场管理页(`openCoursePage`/`renderCoursePage`)。
- 卫星图底座:`loadLeaflet()`(CDN 按需加载 Leaflet)+ `mapTileLayer()`(Mapbox satellite 高清,token 在 `config.js`;无 token 回退免费 Esri World Imagery)。**目前只用于赛后轨迹复盘**(`drawTrack`,需已有 GPS 打点)。
- 距离函数:`ydBetween(posA, posB)`(Haversine,返回码),实战 GPS 测距已在用。

**缺口**:① 球场无 `address` 字段、无地址定位;② 没有"赛前、无 GPS 打点"时的卫星图入口与逐洞标记。

## 3. 入口(两处都放)

新增函数 `openRecon(course)`,进入全屏赛前看图视图(`S.reconPage=true`,在 `renderPlay()` 内分支渲染)。两个入口调用它:

- **球场管理页**:每张球场卡片加按钮 `🛰 赛前看图`。
- **打球页当前球场区**:在「💾存为常打 / ⚙️管理球场」旁加 `🛰 赛前看图`(对当前 `S.course`,刚录入未存也能进)。

## 4. 数据模型扩展

球场级新增:

```js
course.address = "<用户填的地址文本>"
course.center  = {lat, lng}   // geocoding 结果缓存,进图先飞这里
```

每个洞新增独立的 `recon`(与实战 `teeGps` 完全分开,互不污染):

```js
hole.recon = {
  tee:    {lat,lng} | null,            // 赛前在图上标的发球台(单点,不分 tee)
  green:  {lat,lng} | null,            // 果岭中心
  points: [ {lat,lng, type, note} ],   // 关键点;type: 'bunker'|'water'|'dogleg'|'target'
  view:   {lat,lng, zoom} | null       // 这个洞的地图视角,记住下次飞过去
}
```

写回 `S.course` + 常打库(同名球场)+ `saveCourse()/saveCoursesLib()`,沿用现有持久化与 `golf:` 前缀。

## 5. 地址定位

赛前看图视图顶部:地址输入框 + 「定位」按钮。

- 主用 **Mapbox Geocoding**(复用 `config.js` 的 token;免费额度个人远够):`GET https://api.mapbox.com/search/geocode/v6/forward?q=<地址>&access_token=<TK>` → 取首个结果经纬度。
- 无 token 或失败 → 回退 **Nominatim**(免费,OpenStreetMap):`GET https://nominatim.openstreetmap.org/search?q=<地址>&format=json&limit=1`。
- 成功:存 `course.address` + `course.center`,地图 `flyTo` 球场中心(zoom ~15)。
- 失败:提示"没定位到,手动拖动地图找到球场"。地址只能到**球场级**,到不了具体洞(已与用户确认前提)。

## 6. 逐洞认洞 + 标记 + 量距(核心交互)

全屏 Leaflet 卫星地图,顶部沿用现有圆形洞导航(1–18)。选中第 N 洞:

- 有 `recon.view` → `flyTo` 该视角;否则停在 `course.center`,提示"拖动找到第 N 洞"。
- 地图任意拖动/缩放后,自动把当前视角写入 `hole.recon.view`(记住认洞结果)。

工具栏按钮(点按钮进入"点图放置"模式,再点地图落点):

| 按钮 | 行为 |
|------|------|
| 📍 标发球台 | 落点存 `recon.tee` |
| ⛳ 标果岭 | 落点存 `recon.green` |
| ⚠️ 加关键点 | 落点存入 `recon.points`,选类型:沙坑/水/拐点/理想落点 |
| 📏 量距离 | 点两点,显示直线码数(自由量,不入库) |

派生显示(用 `ydBetween` 实时算):

- 标好发球台+果岭 → 顶部显示**看图全长 X 码**,可与手填官方码数对照。
- 每个关键点旁显示**距发球台 A 码 / 距果岭 B 码**——赛前定"几号杆开球、打哪"的依据。

标记可点击删除/改类型。全部即时持久化。

## 7. 替用户定的默认(YAGNI)

- 发球台**只标一个点**(这次比赛要打的台),不按 USGA/蓝 tee 分开标。
- 复用现有 Leaflet + Mapbox/Esri 瓦片 + `ydBetween`,**不引新库**。
- **纯前端**:不动 `server.js`、不动数据库;数据走现有 `store`(`golf:courses` / `golf:course2`)。
- 距离单位沿用**码**(与全 app 一致);暂不双显米。

## 8. 非目标(本期不做)

- 不接厂商付费逐洞坐标数据库(免费做不到自动排洞)。
- 不做果岭前/后缘深度(等用户用过再加)。
- 不做坡度/海拔/等高线。
- 不改赛后轨迹复盘 `drawTrack` 的行为(共享地图底座,但各自入口)。

## 9. 复用与改动范围

- 全部改动落在 `public/index.html` 单文件,约 +300 行(新视图 + 标记交互 + geocoding + 持久化)。
- 复用:`loadLeaflet`、`mapTileLayer`、`ydBetween`、`store`、`renderPlay` 分支、洞导航与卡片样式。
- 改 `index.html` 后按项目规矩 **bump `public/sw.js` CACHE 版本号**,否则手机端拿不到新版。

## 10. 验证

- 本地预览(Claude Preview `caddie` 配置,需先清 service worker)。
- 用例:填一个真实球场地址 → 定位成功 → 进第 1 洞拖图标发球台+果岭 → 看图全长合理 → 加一个沙坑点显示到台/果岭距离 → 切到第 2 洞再切回,第 1 洞标记与视角仍在 → 退出重进(走 store),数据仍在。
- 无 token 时回退 Esri + Nominatim 仍可用。
