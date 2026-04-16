# 发布稳定性护栏方案 v2

## 目标

给当前收敛后的主线产品补齐最小工程护栏，确保上线前至少具备：

- 可重复构建
- 可重复测试
- 最小 CI
- 最小恢复能力
- 最小部署文档

## 范围

本轮覆盖：

- npm scripts
- typecheck / lint / test 入口
- GitHub Actions 最小 CI
- 关键链路最小测试
- 错误恢复与重连
- README quick start

不覆盖：

- 全量观测平台升级
- 多环境复杂发布流水线
- K8s 或云原生编排

## 必须满足

- 仓库必须有统一的 `lint`、`typecheck`、`test`、`build`
- 必须存在 CI 入口
- 至少覆盖任务状态机、executor 调用、decision 流
- websocket 断开必须有自动重连
- executor 超时必须 fail，不允许静默卡死
- server 重启后至少支持任务 attach 或任务状态恢复
- README 必须提供 3 步内跑起来的 quick start

## 发布门禁

至少需要通过：

1. `npm run lint`
2. `npm run typecheck`
3. `npm run test`
4. `npm run build`

如仓库保留拆分测试入口，也必须有统一别名汇总。

## 验收标准

- 新同事可以按 README 在短时间内跑起项目
- PR 具备自动化基础校验
- 关键运行链路失败时，用户不会无提示卡死
