# Implementation status

本文只记录当前实施切片；稳定的产品与架构决策仍以 [PROJECT_PLAN.md](PROJECT_PLAN.md) 为准。

部署状态必须与 tag/Release 状态分开理解：**V1.1.0 Parchment Atlas**
已在 2026-08-02 通过受保护 `main`、Pages、线上冒烟和桌面/移动人工验收公开。
Natural Earth 矢量球、GeoNames 双语搜索、双侧城市关系、拖拽剖面和羊皮纸视觉
属于当前公开产品。`v1.0.0` tag 与现有 GitHub Release 仍固定在
`a5ff99bc60fb7cd2e6e14f4d3bc4f54e5abfb4a1`；尚未创建 V1.1 tag 或 Release。

当前工作约定、门槛与发布边界见仓库根目录的 [AGENTS.md](../AGENTS.md)。
2026-10 起仓库更名为小写 `0mn1si2i5/mundus`，线上地址为
<https://0mn1si2i5.github.io/mundus/>；下文历史证据中的 `/Mundus/` 地址保持原样。

2026-10 起“发展的不同侧面（Development, Unpacked）”已下线：模式代码、UNDP
快照、构建脚本与署名全部移除，`mode=development` 旧链接回到展厅并显示“已下线”
提示。下文涉及 Development 的条目只作为历史记录。

## Exhibit Shell V2：中立展厅壳层

已通过 PR #9 与 PR #11 合并到受保护 `main` 并公开部署。

- [x] `activeMode: ModeId | null` 与 `previewMode` 状态；`null` 代表中立展厅
- [x] 裸地址与硬刷新进入展厅；历史无版本与 `v=1` 链接保持 Other Side/V1 语义；`v=2` 活动模式始终显式携带 `mode`
- [x] 纯元数据目录（curation lifecycle、maturity、tags、featuredRank、双语 sourceScope）与纯 selector
- [x] 桌面精选轨道与移动水平展签带共享同一语义列表；reduced motion 下完全静止
- [x] ModePreview 仅读取目录元数据，显式进入前不加载任何模式 chunk 或数据
- [x] Mode Atlas 支持 Featured/New/All/Archived、搜索、多标签过滤与 archive notice
- [x] 返回展厅保留点位与同一 Canvas 相机上下文；unknown V2 mode 回退展厅并给出可关闭说明
- [x] 三个现有模式（Other Side/Development/Sunline）科学、数据与交互语义保持不变

## Surname Atlas：姓氏观察

已通过 PR #22 合并到受保护 `main`。数据契约与来源决策见
[NAMING_OBSERVATION_RESEARCH.md](NAMING_OBSERVATION_RESEARCH.md)，来源与许可见
[DATA_SOURCES.md](../DATA_SOURCES.md)。

- [x] 241 个国家条目、288 条记录；195 个主权国家均有记录（71 rank-one、54 来源列出、70 人工整理）
- [x] 70 条人工整理记录经产品所有者 2026-10-07 批准按现状上线，结果面板逐条标注“人工整理记录 · 未逐条核实”
- [x] 中文仅限 5 个人工审阅形式、汉字来源形式与通行译名表；其余显示缺失，不再逐字合成音译
- [x] 结果面板以折叠的“来源与许可”展示来源快照、覆盖说明、许可证与逐国来源链接
- [x] 字标槽位 schema 7：中心按密集长包络拟合排序并爬山优化；狭长国家（主轴伸长 ≥ 2）在主轴 ±35° 内提供直线旋转字标；数字统一保留 9 位有效数字以便字节级复现
- [x] 字标遵循画质档：桌面 50m 可显示小岛国家；110m 仅在字标中心落在已渲染本国陆地时绘制
- [x] 50m 几何与槽位表仅在进入姓氏观察时按需加载；常驻 `geo` chunk 由 891 kB 降至 135 kB
- [x] `GlobeViewport` 拆分为 `GlobeScene`、`SurnameMapLabelLayer`、`SunlineLayer`、`Marker`、`AntipodeCrossSection` 与 `viewportDiagnostics`
- [ ] 线上部署、线上冒烟与桌面/移动人工验收：合并后补记

## Natural Earth 完整矢量球面

- [x] 110m/50m 固定源文件、SHA-256、许可与可复现离线转换
- [x] 单一合并国家表面、单一海岸线、单一内部共享边界与稳定国家调色板索引
- [x] low 懒加载 110m，medium/high 懒加载 50m；加载/失败保留原栅格球面
- [x] Development 指标/年份只更新 RGBA 调色板，不重建几何
- [x] CPU 国家拾取、Other Side 拖拽剖面、Sunline 遮罩、标记、弧线、经纬网与 context restore 保持原路径
- [x] 50m 产物 1,346,186 bytes gzip，实测上传属性与固定 905×4 调色板 GPU 8,950,732 bytes；低档 110m 为 793,168 bytes
- [x] 四点面内采样、传输量化回读与边界自适应细分将全局丢弃候选面积限制为 110m 0.00417%、50m 0.000149%
- [x] 独立源面积门槛识别并修复 50m 南极环顺序问题：南极由 0.00473 sr 恢复到约 0.30196 sr；50m 总源/输出面积差由 8.22% 降为 0.000149%
- [x] 拖拽时海洋壳提供统一 0.76 有效透明度，陆地填色不再叠加 alpha；海岸线/国界降透明度保留定位线索
- [x] Sunline 使用同一合并表面增加夜幕之上的所选国家高亮 pass；常态矢量层实测 4 draw，Sunline 所选国家时 5 draw
- [x] 解码前严格校验版本、完整 stream schema、国家/调色板索引、文件与解码预算；生成集通过同目录 staging/backup 与 manifest-last 回滚发布

正式转换契约、正确性夹具和资源预算见 [DATA_SOURCES.md](../DATA_SOURCES.md)、
`scripts/build-natural-earth-vector-globe.test.mjs` 与对应 manifest。无头帧间隔不代表
实体设备性能；本次没有可用实体硬件，medium/high 50m 的实体手机/桌面采样仍是
后续发布验证项。

## V1.0.0 发布：完成并线上验证

- [x] 阶段 1–4 私有基线完成三方审阅、纠错复验与远端 CI 同步
- [x] 一次性首次操作提示与 Mode Atlas
- [x] 右上 Mode Atlas 与三模式底部直达导航
- [x] Development 全球中位数、相对中位数与历史变化
- [x] Development 同年相近 HDI 的结构对照叙事
- [x] V1 产品收口分支通过审阅并由 PR #1 合并到 `main`
- [x] 最小公开发布文档、安全策略、数据来源与许可证清单由 PR #2 合并
- [x] GitHub Pages 构建、产物验证、部署与线上冒烟路径已在 PR #3 实现并通过远端演练
- [x] PR #3 通过发布审阅并合并到 `main`
- [x] 仓库已公开，Pages、`main` 保护和私密漏洞报告已启用
- [x] 首次 Pages 部署和桌面/移动自动线上冒烟通过
- [x] 最终证据 PR #4 合并；最终 `main`、Pages、`v1.0.0` 标签和 GitHub Release 均指向 `a5ff99bc60fb7cd2e6e14f4d3bc4f54e5abfb4a1`

2026-07-20 合并前历史检查点：私有 `main` 位于 `fc0ce78`；当前分支
`codex/v1-pages-release` 位于 `5c8fb25`。PR #3 可合并，远端 `quality`、
`browser-smoke` 与 `pages-artifact` 均通过，PR 上的部署和线上冒烟按设计
跳过。当时仓库尚未启用 Pages，`main` 尚未保护，也尚无 V1 标签或 Release；
该状态已经由下方首次公开部署证据取代。
本地复验为 66 个单元测试通过；完整 Playwright 为 45 项通过、3 项按设计
跳过；Pages 产物为 22 个文件、0 个 source map。

2026-07-20 首次公开部署证据：PR #3 合并提交为
`40c4ab2fdc7ff570924ff5f5c9ed6b024b7a1a77`。该提交的
[CI](https://github.com/0mn1si2i5/Mundus/actions/runs/29722665105) 与
[Pages](https://github.com/0mn1si2i5/Mundus/actions/runs/29722665114) 均通过；
`pages-artifact`、`deploy-pages` 和桌面/移动 `live-smoke` 完整成功。线上地址
为 <https://0mn1si2i5.github.io/Mundus/>，HTTPS 请求返回 200 和预期文档
标题。该首次部署随后由最终证据提交的同 SHA 部署、标签与 Release 闭环取代。

零上下文执行线程必须先阅读仓库根目录的 [AGENTS.md](../AGENTS.md)。V1 发布
已完成，不得重复创建 V1.0.0。

基线检查点为私有 `main` 的 `1d627e6`：本地 57 个单元测试、31 个浏览器测试通过（1 个桌面专属生命周期用例在移动项目按设计跳过），远端 quality 与 browser-smoke 均通过。公开发布仍以执行计划中的产品、安全、许可和部署门槛为准。

2026-07-15 的产品收口停止检查点已经由后续 PR #1 和 PR #2 取代；保留其
测试数字仅作为历史证据，不再作为当前执行状态。

## 阶段 1：完成，保留一项非阻塞验证

- [x] 工程、设计令牌、双语、CI 与基础 WebGL 地球
- [x] Natural Earth 110m 数据清单、国家纹理与稳定 `countryId`
- [x] 国家 hover、选择和海洋降级
- [x] URL 模式/坐标往返与非法参数回退
- [x] WebGL context loss 状态、恢复与 GPU 资源释放
- [x] 桌面、移动端浏览器冒烟与构建体积基线
- [x] 桌面 45–60fps 真实硬件采样（60.0fps，p95 17.5ms）
- [x] 实体手机 `low` 画质采样（iPhone 17：60.0fps，p95 17.0ms）
- [ ] 中档手机 30fps 的真实硬件采样（无可用设备，保留计划，不阻塞后续开发）

当前构建基线：App Shell 约 18 kB gzip；完整首屏模块约 375 kB gzip。Three.js、R3F 和地理数据各自独立缓存。真实 FPS 不使用无头浏览器结果代替，需在目标设备上采样后关闭阶段门槛。

采样证据见 [桌面报告](performance/2026-07-14-desktop.md)、[iPhone 17 报告](performance/2026-07-14-iphone-17.md)。

## 阶段 2 · Other Side：完成

- [x] 版本化模式契约和编译期注册
- [x] 地球点击、坐标输入、GeoNames 双语主要城市搜索、精选示例与主动定位
- [x] GeoNames 2026-08-01 固定快照、CC BY 4.0 署名、可离线重建的不可变归一化输入、OpenCC 构建期繁转简与懒加载索引
- [x] 对跖计算、地心连线、镜头翻转、地心/表面距离
- [x] 起点和对跖点国家/海洋结果
- [x] 单一规范精度分享 URL、位置隐私提示与既有整度链接兼容
- [x] GeoNames 双侧最近符合条件主要城市关系、端点距离、短测地线与形状标记；旧 Natural Earth populated-places 管线已完整移除
- [x] 键盘地球旋转/缩放/选择、对话框焦点管理和移动端抽屉语义
- [x] 阶段 2 性能回归与桌面/移动发布级视觉验收

## 阶段 3 · Development, Unpacked：完成

- [x] UNDP HDR 2025 固定版本获取、校验、转换与数据质量检查
- [x] 1990–2023 HDI/健康/教育/收入规范化快照与 Natural Earth 显式连接
- [x] 国家着色、指标切换、时间轴、图例与结果卡
- [x] 同步排序表格、来源和方法界面
- [x] 阶段 3 性能回归与发布级视觉验收

数据方法说明随该模式下线一并移除，可在 Git 历史中查阅。

## 阶段 4 · Sunline 与整体收口：完成

- [x] NOAA / Meeus 太阳赤纬、均时差、直射点和太阳高度纯计算
- [x] 2000–2099 分钟级 UTC 时间状态、实时/固定语义与版本化分享 URL
- [x] 独立昼夜 shader、0° 至 -6° 晨昏带、太阳方向光与直射点
- [x] 赤道、南北回归线和南北极圈辅助线
- [x] 日期、24 小时时间轴、1440× 播放/暂停和回到此刻
- [x] 地点太阳高度、昼夜状态、近似日出日落与极昼极夜结果
- [x] 双语方法说明、移动端折叠抽屉、减少动态效果与模式转场
- [x] 固定时间视觉回归、连续模式切换和桌面/移动发布回归

太阳计算只用于教育互动展示，不作为法律、航海或工程时间服务。中档手机真实硬件采样仍按阶段 1 的非阻塞验证计划保留。

## 阶段 5 · Urban Proximity：实现，待产品所有者审阅

- [x] GHSL UCDB R2024A 数据门禁、不可变输入、紧凑派生资产与 CC BY 4.0 署名
- [x] 层级邻近距离、α URL 状态、Top 10、阶梯图、双语结果卡与懒加载数据
- [x] 地球焦点城市、人口门槛环、竞争城市大圆弧线与诊断属性
- [ ] 完整浏览器验收与产品所有者审阅
