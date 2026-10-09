# Implementation and release evidence

本文记录已交付功能、固定提交的验证证据和已知局限。稳定的产品与架构契约见
[PROJECT_PLAN.md](PROJECT_PLAN.md)，工作约定见 [AGENTS.md](../AGENTS.md)，
构建、部署和回滚流程见 [RELEASE_RUNBOOK.md](RELEASE_RUNBOOK.md)。

## 当前公开产品

更新日期：2026-10-09。公开站点为 <https://0mn1si2i5.github.io/mundus/>。
裸地址进入中立展厅；地球另一端、姓氏观察和城市邻近性是主要观察，日照线位于“更多观察”。
网站随受保护的 `main` 更新，正式版本快照单独记录在
[GitHub Releases](https://github.com/0mn1si2i5/mundus/releases)。

| 已交付部分     | 公开行为与契约                                                                                              |
| -------------- | ----------------------------------------------------------------------------------------------------------- |
| 展厅与共用地球 | 单一 Canvas、模式间保留地点与相机、双语、键盘与无 WebGL 降级、分享和关于；模式目录为纯元数据                |
| 地球另一端     | 对跖点、GeoNames 双语主要城市搜索和双侧城市关系、可拖拽剖面、位置分享提示                                   |
| 姓氏观察       | 241 个国家条目、288 条记录；195 个主权国家有记录；当地文字、拉丁转写和经审阅中文形式、来源和缺失标签        |
| 城市邻近性     | GHSL 2025 年城市中心、可调 α、竞争城市和排名、距离阶梯、按 d/R 加权的全球陆地分区；内部 id 保留 `isolation` |
| 日照线         | 本地太阳近似计算、昼夜与晨昏带、实时/固定时间、播放和地点日出日落状态                                       |
| 数据与许可     | 固定源和不可变离线输入、manifest 哈希、Natural Earth 矢量地球、各来源署名及构建时软件许可声明               |

姓氏数据契约见 [NAMING_OBSERVATION_RESEARCH.md](NAMING_OBSERVATION_RESEARCH.md)。
2026-10-07，所有者批准 70 条人工整理记录按现状上线；结果逐条标注“人工整理记录 · 未逐条核实”。
城市指标、分区和命名契约见 [URBAN_ISOLATION.md](URBAN_ISOLATION.md)，
GHSL 原定义与人口估计局限见 [数据方法](data/ghsl-ucdb-r2024a.md)。

## 已核实的部署基线

固定提交：`a7fd01f7d3094569a9c506f4b1135e6796998d1e`（PR #33，合并时间 2026-10-08 UTC）。
以下结果只证明该提交，不自动证明后续提交：

- [CI](https://github.com/0mn1si2i5/mundus/actions/runs/37827800444)：源码质量、固定数据、单元测试、完整矢量资产检查和浏览器冒烟通过。
- [Pages](https://github.com/0mn1si2i5/mundus/actions/runs/37827800564)：同一构建产物的桌面 Chromium 与 Pixel 7 浏览器套件、产物校验、部署和线上冒烟通过。
- [PR #31](https://github.com/0mn1si2i5/mundus/pull/31)：城市邻近性、所有者审定名字、全球分区和主要观察入口已合并。

线上冒烟确认托管和展厅渲染；完整浏览器套件验证交互。它们均不代表新版本的人工验收、
实体设备性能或完整 WCAG 审计。历史实体设备采样保留在 `docs/performance/`，各报告已注明适用版本；
中档 Android 实体设备和当前 50m 地球的性能采样仍缺证据，不用 Pixel 7 模拟或无头帧率替代。

## 发布与退役历史

- 2026-07-20：首次正式版本 [v1.0.0](https://github.com/0mn1si2i5/mundus/releases/tag/v1.0.0)，
  tag 和 Release 固定在 `a5ff99bc60fb7cd2e6e14f4d3bc4f54e5abfb4a1`。
- 2026-08-02：羊皮纸展览视觉、GeoNames 城市关系与矢量地球部署。
  当时使用的“V1.1.0 Parchment Atlas”是产品阶段名称，不是已创建的正式 tag/Release。
- 2026-09 至 10：姓氏观察和字标布局逐步交付，最终来源与名字形式按固定快照审阅。
- 2026-10：仓库和 Pages 路径统一为小写 `mundus`；旧历史证据中的 `/Mundus/` 保留原始形式。
- 2026-10-07：[PR #28](https://github.com/0mn1si2i5/mundus/pull/28) 下线 Development, Unpacked，
  移除模式、UNDP 数据、构建脚本与署名；任意版本的 `mode=development` 旧链接回到展厅并提示下线。
- 2026-10-08：城市邻近性及全球分区上线，随后两次浏览器测试修复收敛到上述部署基线。

旧 Mode Atlas、精选轨道、Development 实现切片和阶段测试数字不再作为当前状态。
完整旧实施记录保留在
[固定 Git 历史](https://github.com/0mn1si2i5/mundus/blob/a7fd01f7d3094569a9c506f4b1135e6796998d1e/docs/IMPLEMENTATION.md)，
原始性能报告继续保留，便于追溯而不扩大当前契约。
