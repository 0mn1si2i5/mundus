# Urban Hierarchical Isolation — Mundus 模式研究

> 日期：2026-10-06  
> 状态：Research / pre-implementation

## 1. 目标

本模式回答：

> 从一座城市向外扩张，直到第一次遇到一座“足够大”的竞争城市，哪些大城市拥有最大的空间余量？

必须区分：
- **数学/几何孤立**：地球表面的城市间距离；
- **人口等级孤立**：附近是否存在与自身规模可比的城市；
- **交通/经济孤立**：航线、道路、贸易、通勤等网络意义上的可达性。

Mundus 第一版应只声称衡量前两者。

## 2. 推荐核心指标

设城市 i 的人口为 P_i，城市间测地距离为 d(i,j)，定义：

```math
R_i(\alpha)=\min_{j\ne i,\;P_j\ge\alpha P_i} d(i,j),\qquad 0<\alpha\le1
```

R_i(alpha) 称为 **Hierarchical Isolation Radius**。

解释：
- alpha=1：最近的“不小于自己”的城市；
- alpha=0.5：最近的“至少一半规模”的城市；
- alpha=0.1：较宽松的区域竞争尺度。

同时记录竞争城市：

```math
J_i(\alpha)=\arg\min_{j\ne i,\;P_j\ge\alpha P_i}d(i,j)
```

产品中应同时展示“距离”和“撞到谁”。

### 2.1 数学性质

随着 alpha 增大，候选城市集合只会缩小：

```math
\alpha_1<\alpha_2\Rightarrow R_i(\alpha_1)\le R_i(\alpha_2)
```

因此 R_i(alpha) 是单调不减的**阶梯函数**。前端无需存连续曲线，只需存 breakpoints。

### 2.2 综合指标

若需要单一排行榜：

```math
I_i=\frac{1}{1-\alpha_0}\int_{\alpha_0}^{1}R_i(\alpha)d\alpha
```

建议 alpha_0=0.1。因为 R(alpha) 是阶梯函数，该积分可由 breakpoints 精确计算。

面积版本：

```math
A_i=\frac{1}{1-\alpha_0}\int_{\alpha_0}^{1}\pi R_i(\alpha)^2d\alpha
```

面积指标会过度奖励极端远距离，不建议作为默认榜单。

## 3. “圈地”与 Voronoi

普通 Voronoi：

```math
V_i=\{x:d(x,i)\le d(x,j),\forall j\}
```

回答“地球表面哪些位置离城市 i 最近”，与 Isolation Radius 不是同一个问题。

后续可做人口加权场：

```math
S_i(x)=\frac{P_i^\beta}{d(x,i)^\gamma}
```

并令最大 S_i 的城市拥有位置 x。这接近 gravity / Huff-type spatial interaction model。

但 beta、gamma 需要实证校准，否则容易制造虚假的确定性，因此建议延后到 V2。

## 4. 地球几何

Mundus 是全球三维地球，不能直接把经纬度当平面坐标。

MVP 可使用 Haversine / great-circle distance；更严格的数据管线可离线使用 WGS84 ellipsoid geodesic。

实现必须正确处理：
- ±180° 反经线；
- 极区；
- 球面 small circle；
- great-circle connection。

Isolation Radius 是城市到城市的测地距离，海洋自然计入。如果未来计算 territory 面积，应明确区分 global-surface territory 与 land-only territory。

## 5. 城市定义

这是最大的统计风险。

- **city proper**：行政边界人口，全球可比性较差；
- **urban agglomeration / urban centre**：更接近连续城市实体，推荐；
- **metropolitan area**：更接近功能性经济城市，但全球定义不统一。

MVP 应选择一个全球一致的 urban agglomeration / urban centre 数据源，避免混用各国 city proper。

界面始终显示 dataset、reference year、population definition。

## 6. 数据源

### UN World Urbanization Prospects 2025
权威、全球统一，覆盖 237 个国家和地区，并提供超过 12,000 个 5 万人口以上城市的估计/预测。适合作为人口等级分析的重要来源。正式再分发前需确认具体数据文件许可。

### GHSL / GHS-POP / Urban Centre Database
JRC Global Human Settlement Layer 适合建立几何上更统一的城市实体，也是未来从“城市点”升级到城市边界/建成区的优选基础。

### Natural Earth Populated Places
适合显示和原型；人口来源与口径并非完全统一，不建议作为最终科学排名的唯一人口基准。

### WorldPop / GeoNames
适合补充人口栅格、名称、别名和坐标，不建议单独承担最终全球排名人口基准。

## 7. 算法

朴素算法对每个城市、每个 alpha 扫描所有城市，约 O(k n²)。

更好的观察是：对固定城市，把其他城市按距离排序。只有当更远城市的人口足以覆盖此前未覆盖的 alpha 区间时，才产生新的 breakpoint，因此完整 R(alpha) 可压缩为少量“纪录竞争者”。

实现选择：
- BallTree + haversine；
- 球面点转单位 3D 向量 + KD-tree 做候选搜索，再用 geodesic 精算；
- 人口降序增量空间索引；
- 对中等规模数据，构建时 O(n²) 向量化预计算也可作为可靠基线。

MVP **不建议引入 PostGIS 后端**。城市人口并非实时数据，最适合构建时预计算后作为静态资源发布。

## 8. 推荐数据格式

```text
public/data/urban-isolation/
  metadata.json
  cities.json
  isolation.json|bin
```

```ts
interface IsolationCity {
  id: number;
  name: string;
  country: string;
  lat: number;
  lon: number;
  population: number;
}

interface IsolationBreakpoint {
  alpha: number;
  radiusKm: number;
  competitorId: number;
}
```

metadata 必须记录 metric、dataset、referenceYear、populationDefinition、distance model、alphaMin、generatedAt。数据 provenance 应属于数据格式本身。

## 9. Mundus 交互设计

### 默认视图
- Globe 显示达到最低人口门槛的城市；
- 颜色编码当前 R_i(alpha)；
- 侧栏展示 alpha 和 Top N；
- 默认 alpha 建议 0.5。

### 点击城市
选中后：
1. 高亮城市；
2. 绘制 geodesic isolation ring；
3. 高亮当前 competitor；
4. 绘制两城间 great-circle arc；
5. 卡片显示 population、alpha、competitor、distance、rank/percentile。

### Alpha slider
核心控件范围 0.1–1.0。拖动时 ring、competitor、great-circle arc、ranking 和 R(alpha) 图同步变化。

阶梯式跳变是数学结构本身，不应人为平滑。

### R(alpha) 图
详情卡显示阶梯曲线，当前 alpha 以游标标记。它是解释综合 isolation score 的最佳方式。

### 三维视觉
推荐：
- 普通城市低亮度；
- selected city 主强调色；
- competitor 第二强调色；
- isolation boundary 为细、半透明 geodesic ring；
- 两城之间用球面 arc。

不建议默认填充巨大的半透明圆面，以免遮挡地球。

## 10. MVP 范围

### 第一版应实现
- R_i(alpha)；
- alpha slider 0.1–1.0，默认 0.5；
- minimum population filter；
- city points；
- selected city；
- geodesic ring；
- competitor city；
- great-circle connection；
- current-alpha global ranking；
- alpha=1 nearest-larger ranking；
- integrated isolation score；
- R(alpha) step chart；
- 全部离线预计算。

### 延后到 V2
- weighted Voronoi；
- gravity/Huff fields；
- PostGIS backend；
- 实时人口 API；
- 航空/道路/经济可达性；
- land/ocean territory；
- 可调 beta/gamma。

## 11. 测试策略

### 数学正确性
构造小型人工城市集，验证：
- R(alpha) 单调不减；
- competitor 满足人口阈值；
- competitor 确为最近合格城市；
- breakpoint 积分等于密集 alpha 网格数值积分。

### 地理边界
测试：
- 反经线两侧；
- 极区；
- 几乎同坐标城市；
- antipodal / near-antipodal；
- 最大城市在 alpha=1 时没有更大竞争者的处理。

### 数据
检查：
- 重复城市；
- population <= 0；
- 经纬度非法；
- reference year 混用；
- 城市合并/别名。

### 前端
测试 slider breakpoint 切换、arc/ring 更新、选中状态、移动端、WebGL context 恢复与视觉回归。

## 12. 产品命名

推荐英文：
- **Urban Isolation**
- 指标：**Hierarchical Isolation Radius**
- 综合指标：**Integrated Isolation Score**

中文：
- **城市孤立度**
- **层级孤立半径**
- **综合孤立指数**

“Urban Fields / 城市场”可留给未来 Voronoi / gravity 模式。

## 13. 结论

Mundus 第一版应以 R_i(alpha) 为唯一核心数学定义。

它的优势是：
1. 与原始直觉高度一致；
2. 参数 alpha 有明确语义；
3. 数学性质简单；
4. 可高效离线预计算；
5. 与三维 globe 的 ring + great-circle arc 表现天然契合；
6. 允许用户看到“世界最孤立的大城市”为什么没有唯一答案。

最重要的产品原则是：**不要替用户偷偷固定“什么叫大城市”。让 alpha 成为可见、可操作的问题定义本身。**

---

## 14. 研究来源与后续验证

本研究参考了 UN World Urbanization Prospects、JRC GHSL、Natural Earth、H3、Voronoi / weighted Voronoi 与 gravity/Huff 类空间交互模型资料。

正式实现前应：
1. 固定人口数据集与许可；
2. 用真实全球数据生成排名，而不是使用候选城市的经验判断；
3. 对不同人口口径做敏感性分析；
4. 在 UI 中暴露数据年份和定义；
5. 将所有发布排名视为“给定数据集 + 给定 alpha 下”的结果，而非无条件事实。

研究阶段曾讨论 Perth、Honolulu、Auckland、Ulaanbaatar、Reykjavik 等候选城市，但在正式数据计算完成前，不应把任何一个宣称为绝对冠军。
