# GPS 打点击球距离 + 落库可靠性 — 设计规格

- 日期:2026-06-07
- 状态:已与用户确认,待拆实现计划
- 影响文件:`public/index.html`(单文件 PWA;新增纯函数 + 数据结构 + UI)

## 背景:四个原始问题

1. 拍计分卡导入后,生产环境查不到数据 → 经核查 `rounds/curRound/bag2/course2/trainPrefs/checkins` 在 Neon 全为 `null`,但测试 key 能正常读回 → **KV 后端正常,是用户数据从未同步上云**(数据只在设备本地 localStorage)。
2. 落点想增加"偏左/偏右"。
3. 过旗现在靠填负数;往左/右偏 X 码时击球距离怎么算。
4. 击球距离按"洞总码 − 距旗"反推,狗腿洞/打偏会虚高(昨天 driver 出现 286 码)。

### 根因
当前 `本杆距离 = 上次距旗 − 这次距旗`(`setShotRem`,index.html:514-520)。第一杆的"上次距旗"用记分卡**洞总码(沿球道、含狗腿)**,而距旗是测距仪打的**直线**,基准不一致 → 开球杆虚高。横向偏移完全不参与距离。落库失败被静默吞掉(`store.set` 的 `catch(e){}`,index.html:301)。

## 决策(已确认)

| 项 | 决策 |
|---|---|
| 击球距离来源 | **GPS 打点**:每杆球位记坐标,距离 = 相邻两点直线距离(对标 Arccos/Shot Scope) |
| 发球台起点 | 每洞**开球前点一下「📍发球台」** |
| 距旗 | 测距仪手输**保留**,仅用于"剩余/策略",不再反推击球距离 |
| 过旗/横向偏移 | **不再手填**;GPS 两点直线天然包含横向分量、天然处理过旗 |
| 方向(左右) | 保留现有定性按钮(左/短/准/长/右),仅用于离散/瞄准统计;**不加"偏 X 码"数字** |
| 落库 | 修复:同步状态可见 + 失败重试 + 手动「立即同步」 |
| 范围 | 全部一次做齐 |

## A. 记录流程(球场上)

1. 每洞开球前 → 点「📍发球台」(存 `hole.tee`)。
2. 每打完一杆走到球边 → 点「📍球位」(存 `shot.pos`)。
3. 照旧:选球杆、落点结果、方向、测距仪距旗(算剩余)。
4. 上果岭后只记推杆,不打点。

> 第 N 杆击球距离 = (第 N-1 个点 → 第 N 个点) 的 GPS 直线距离。
> 开球杆 = `hole.tee → shots[0].pos`。狗腿/打偏/过旗自动正确。

## B. 数据结构(向后兼容)

```js
hole.tee  = { lat, lng, acc, t }   // 发球台坐标,可空
shot.pos  = { lat, lng, acc, t }   // 该杆落点坐标,可空
shot.dist                          // 击球距离(码):优先 GPS 算,其次手输/回退
shot.distManual                    // true=用户手动覆盖了距离
shot.skipDist                      // true=短杆不计入码数统计
shot.rem                           // 距旗(测距仪),保留,算剩余/策略
```

旧轮次数据没有 `pos/tee` → 距离回退用现有 `rem` 反推逻辑,历史记录不破坏。

## C. 距离计算(纯函数,可测)

等距圆柱(equirectangular)平面近似,几百码内误差可忽略:

```js
function ydBetween(a, b){
  if(!a || !b) return null;
  const R = 6371000; // 地球半径 m
  const rad = Math.PI/180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const latM = (a.lat + b.lat)/2 * rad;
  const x = dLng * Math.cos(latM), y = dLat;
  const m = Math.sqrt(x*x + y*y) * R;
  return Math.round(m / 0.9144); // m → yd
}
```

`shotDist(hole, shots, j)`:
- `prev = j===0 ? hole.tee : shots[j-1].pos`
- 若 `prev && shots[j].pos` → `ydBetween(prev, shots[j].pos)`(GPS)
- 否则 → 回退现有 `rem` 反推;再否则 → 手输值。

GPS 取点:

```js
function markPos(cb){
  if(!navigator.geolocation){ cb(null, 'no-gps'); return; }
  navigator.geolocation.getCurrentPosition(
    p => cb({ lat:p.coords.latitude, lng:p.coords.longitude,
              acc:Math.round(p.coords.accuracy), t:Date.now() }),
    e => cb(null, e.message),
    { enableHighAccuracy:true, timeout:10000, maximumAge:0 });
}
```

## D. 边界与回退

- 拒绝定位 / 无信号 / 超时 → 回退手输距旗反推,UI 提示一次。
- 显示 GPS 精度;`acc > 10m` 给小提示,可重新打点。
- 推杆不打点;30 码内短杆默认可勾「不计入码数统计」(`skipDist`)。
- 旧数据无坐标 → 自动走回退路径。

## E. 落库可靠性(修问题 1)

现状:`store.set` 的云端 PUT 失败被 `catch(e){}` 静默吞掉。

改造:
- `store.set` 成功标 `syncState[k]='cloud'`;失败标 `'local'` 并把 key 推入 `pendingSync`(持久化到 localStorage)。
- `flushPending()`:遍历 `pendingSync` 重试 PUT;页面加载时、网络恢复(`online` 事件)时、用户点「立即同步」时触发。
- 顶部加同步徽标:全部已上云 / `N` 项待同步;徽标可点 → 立即同步。

## F. 方向(问题 2)

现有「左/短/准/长/右」按钮保留并在 UI 上更醒目(落点区)。不加数字偏移。

## 工程评估(大改)

- **架构**:三块解耦 —— GPS 取点 `markPos`、距离 `ydBetween/shotDist`、同步 `store + flushPending`。均为小而纯的单元。
- **质量**:距离/距离选择是纯函数,可单测;DRY 复用现有回退逻辑。
- **性能**:坐标数据量极小,无 N+1;`flushPending` 批量重试。

## 验证清单

- [ ] `ydBetween` 对已知坐标对(约 100 码)结果正确。
- [ ] GPS 正常:开球台点 + 落点 → driver 距离合理(狗腿洞不再 286)。
- [ ] 拒绝定位 → 回退手输,提示出现。
- [ ] 旧轮次(无坐标)仍正常显示距离。
- [ ] 断网时 `store.set` → 进 `pendingSync`;恢复 + 点同步 → Neon 落库成功(`select k from kv` 有数据)。
- [ ] 推杆不打点;短杆 `skipDist` 不进 `clubTendency` 统计。
