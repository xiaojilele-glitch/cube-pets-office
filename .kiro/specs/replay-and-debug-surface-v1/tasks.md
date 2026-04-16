# 回放与调试面收口方案 v1 任务拆解

## Tasks

- [ ] 1. 盘点低频页面与内部能力
  - [ ] 1.1 记录回放页现有职责
  - [ ] 1.2 记录 lineage / audit / permission / config 入口位置

- [ ] 2. 保持回放页稳定
  - [ ] 2.1 保留 `/replay/:missionId`
  - [ ] 2.2 确认回放页能从任务完成后进入
  - [ ] 2.3 确认回放页显示计划、步骤、结果

- [ ] 3. 建立隐藏 debug 面
  - [ ] 3.1 新增 `/debug`
  - [ ] 3.2 设计 debug tabs 或 debug sections
  - [ ] 3.3 迁入 lineage / audit / permission / config

- [ ] 4. 从主导航移除低频能力
  - [ ] 4.1 移除 lineage 主导航入口
  - [ ] 4.2 减少 audit / permission / config 对主界面的打扰

- [ ] 5. 完成兼容与回归
  - [ ] 5.1 验证旧功能仍可内部访问
  - [ ] 5.2 验证普通用户主流程未受干扰
