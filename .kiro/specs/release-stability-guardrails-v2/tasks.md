# 发布稳定性护栏方案 v2 任务拆解

## Tasks

- [x] 1. 收口仓库脚本
  - [x] 1.1 统一 `lint`
  - [x] 1.2 统一 `typecheck`
  - [x] 1.3 统一 `test`
  - [x] 1.4 统一 `build`

- [x] 2. 建立最小 CI
  - [x] 2.1 新增 GitHub Actions
  - [x] 2.2 串联 install / lint / typecheck / test / build

- [x] 3. 补齐关键链路测试
  - [x] 3.1 任务状态机测试
  - [x] 3.2 executor 成功 / 超时 / 失败测试
  - [x] 3.3 decision approve / reject / modify 测试

- [x] 4. 补齐错误恢复
  - [x] 4.1 websocket 自动重连
  - [x] 4.2 executor 超时 fail
  - [x] 4.3 任务重新 attach
  - [x] 4.4 server 重启后最小状态恢复

- [x] 5. 补齐 README
  - [x] 5.1 Quick Start
  - [x] 5.2 环境变量说明
  - [x] 5.3 可选 executor 启动说明
  - [x] 5.4 常见问题

- [x] 6. 发布门禁回归
  - [x] 6.1 本地跑通 lint
  - [x] 6.2 本地跑通 typecheck
  - [x] 6.3 本地跑通 test
  - [x] 6.4 本地跑通 build
