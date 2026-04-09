# 实施计划：execution-language-refresh

## 概述

本任务通过文案盘点、术语映射和 i18n 收口，降低产品的“方案感”，增强“执行协作感”。

## Tasks

- [ ] 1. 盘点任务相关核心文案
  - [ ] 1.1 搜集 `WorkflowPanel`、`TasksPage`、`TaskDetailView`、`TaskDetailPage`、`messages.ts` 中的相关文案
  - [ ] 1.2 标记硬编码与 i18n 文案来源
  - [ ] 1.3 形成术语替换清单
    - _Requirements: 1.1.1, 4.1.1_

- [ ] 2. 建立统一术语映射
  - [ ] 2.1 在 spec 或注释中整理中英文映射表
  - [ ] 2.2 优先确定任务、执行、协作、交付、阻塞、下一步等高频术语
    - _Requirements: 1.1.2, 1.1.3, 5.1.1, 5.1.2_

- [ ] 3. 更新 i18n 文案
  - [ ] 3.1 修改 `client/src/i18n/messages.ts`
    - Workflow 相关标题
    - Task 页相关标题
    - 按钮文案
    - 空态 / 错误态
    - _Requirements: 4.1.1, 4.1.2, 4.1.3_

- [ ] 4. 替换关键页面硬编码文案
  - [ ] 4.1 更新 `WorkflowPanel.tsx`
    - sectionDescription
    - modeNote
    - stepsTitle
    - step labels / copy
    - _Requirements: 2.1.1, 2.1.2, 2.1.3_

  - [ ] 4.2 更新任务相关页面
    - `TasksPage.tsx`
    - `TaskDetailPage.tsx`
    - `TaskDetailView.tsx`
    - _Requirements: 3.1.1, 3.1.2, 3.1.3_

- [ ] 5. 回归与验证
  - [ ] 5.1 编写或更新快照/文本测试
  - [ ] 5.2 检查中英文语义一致性
  - [ ] 5.3 手动验证核心页面第一感知是否已从“方案叙事”转为“执行协作”

## Notes

- 文案替换不能只做字面替换，必须结合页面层级
- 与 `task-detail-operations-first` 同步落地时效果最好
