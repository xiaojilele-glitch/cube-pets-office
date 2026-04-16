# 发布稳定性护栏方案 v2 任务拆解

## Tasks

- [ ] 1. 收口仓库脚本
  - [ ] 1.1 统一 `lint`
  - [ ] 1.2 统一 `typecheck`
  - [ ] 1.3 统一 `test`
  - [ ] 1.4 统一 `build`

- [ ] 2. 建立最小 CI
  - [ ] 2.1 新增 GitHub Actions
  - [ ] 2.2 串联 install / lint / typecheck / test / build

- [ ] 3. 补齐关键链路测试
  - [ ] 3.1 任务状态机测试
  - [ ] 3.2 executor 成功 / 超时 / 失败测试
  - [ ] 3.3 decision approve / reject / modify 测试

- [ ] 4. 补齐错误恢复
  - [ ] 4.1 websocket 自动重连
  - [ ] 4.2 executor 超时 fail
  - [ ] 4.3 任务重新 attach
  - [ ] 4.4 server 重启后最小状态恢复

- [ ] 5. 补齐 README
  - [ ] 5.1 Quick Start
  - [ ] 5.2 环境变量说明
  - [ ] 5.3 可选 executor 启动说明
  - [ ] 5.4 常见问题

- [ ] 6. 发布门禁回归
  - [ ] 6.1 本地跑通 lint
  - [ ] 6.2 本地跑通 typecheck
  - [ ] 6.3 本地跑通 test
  - [ ] 6.4 本地跑通 build
