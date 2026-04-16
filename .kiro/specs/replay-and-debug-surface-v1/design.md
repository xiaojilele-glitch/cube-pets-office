# 回放与调试面收口方案 v1 设计

## 现状问题

当前低频能力分散在普通导航和独立页面中：

- lineage
- audit
- permission
- config
- 其他实验性能力

这些能力虽然有价值，但不应该继续与主线任务入口并列。

## 目标结构

### 回放页

保留 `/replay/:missionId`，作为任务完成后的附属高价值能力。
回放页重点展示：

- 计划
- 执行步骤
- 决策点
- 日志结果
- 产物结果

### Debug 面

新增或预留 `/debug`，承接低频内部能力：

- lineage
- audit
- permission
- config
- 其他调试面

这个页面默认不出现在普通导航。

## 迁移策略

- `/lineage` 不必立即物理删除
- 可以先迁到 `/debug#lineage` 或 debug tabs
- 审计、权限、配置弹层也应逐步往 debug 收口

## 代码落点

- `App.tsx`
- `Toolbar.tsx`
- 回放相关组件
- lineage / audit / permission / config 的入口层

## 风险

- 不能因为做 debug 面而重新造一个新的“多入口平台”
- debug 面应该是隐藏归口，不是新的主导航中心
