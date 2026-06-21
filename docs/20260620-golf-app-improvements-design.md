# 高尔夫 App 改进设计（2026-06-20）

App 是单文件 `public/index.html`（纯前端，无构建）。本次 10 项改动，均在该文件内完成。
改完同步 bump `public/sw.js` 的 CACHE 版本号。

## 数据来源（风/地形对距离方向的依据）

风速（Trackman 实测，巡回赛 7 号铁 166 码 carry）:
- 逆风 10mph → −17 码（≈ −10.2% → **~1.0%/mph**）
- 顺风 10mph → +13 码（≈ +7.8% → **~0.78%/mph**）
- 逆风伤害 ≈ 顺风帮助的 1.3~1.5 倍，非线性，强风更狠。
- 来源: golfdigest.com「wind tool」、andrewricegolf.com wind formula、peterfieldgolf.co.uk。

长草: 中度 rough carry 损失 ~10~20%，方向变差，可能 flyer。
坡度/站姿（右手球员）:
- 上坡 uphill: 弹道高、距离短 → 加杆；偏左。
- 下坡 downhill: 弹道低、稍远但难控/易薄 → 求稳；偏右。
- 球高于脚 above feet: 球向左 → 瞄右；距离略减。
- 球低于脚 below feet: 球向右 → 瞄左；易薄、距离略减。

## 改动清单

1. **继续上一轮入口**: 打球 setup 页置顶醒目入口；洞号按 R 实际进度算；`S.current` 持久化（存 `golf:cur` 或并入 curRound 读取时定位）。
2. **打球界面内「结束本轮」**: playMode 底部加「✅ 存档本轮」主按钮 +「放弃本轮」小号链接。
3. **风向多选**: `holeWind[i]` 由 string → 数组；逆/顺互斥、侧风可叠加；`setWind` 改 toggle；UI on 态按数组判断。
4. **风速模型**: `windAdj` 改百分比模型，逆 1.0%/mph、顺 0.78%/mph，作用 carry；支持多选风向（逆/顺取其一 + 侧风）；>20mph 提示。
5. **开球策略「近距离优先 + 风险刹车」**: 重写 `pickTee` 打分——奖励剩余距离短（强权重），driver 离散大/有水/OB/窄口时惩罚冒进。
6. **落点新增「果岭边长草」**: RESULTS 加 `{k:"grough",t:"果岭边长草",g:"meh"}`；lieMap 加切击提示。
7. **GPS 精度**: 算法不变；`acc` 大（>8m）时显示⚠️低精度，文案说明误差来自手机定位。
8. **果岭九宫格**: 落点 = green 时显示 3×3 方位（过/短/左/右/中/左短/右短/左长/右长），写入 `sh.greenPos`，不依赖 GPS。
9. **长草距离量化**: `liveSuggest` 中 prev.result ∈ {rough, grough} 时按 ~12% 折扣补偿选杆 + flyer 提示。
10. **坡度/站姿**: 每杆记录加 `sh.lie`（数组，多选：uphill/downhill/above/below）；编辑器「方向」下加「站姿(可多选)」行；`liveSuggest` 据 prev.lie 纠正选杆（距离）与瞄准（左右）。

## 分层原则
- 风/旗位 → 赛前策略 `computePlan`。
- 长草/坡度/站姿 → 实际打出才知，仅在实时建议 `liveSuggest`（记录时「🎯按实际剩X码」）纠正下一杆。

## 验证
- `node --check` 不适用（HTML）；用 Claude Preview（caddie 配置）跑前端，先清 service worker。
- 重点验证：风向多选切换、策略洞号显示、果岭九宫格、坡度建议文案、继续上一轮跳转洞号正确。
