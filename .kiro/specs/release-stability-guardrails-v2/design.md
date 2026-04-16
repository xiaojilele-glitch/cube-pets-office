# 发布稳定性护栏方案 v2 设计

## 现状问题

当前项目已有较多脚本与测试，但仍存在几个明显短板：

- 入口脚本命名不够统一
- CI 护栏不稳定或不完整
- 关键主线的测试覆盖仍不足
- 运行时错误恢复不够强
- 新人启动成本偏高

## 护栏分层

### 1. 基线层

- `lint`
- `typecheck`
- `test`
- `build`

这一层负责保证仓库具备最小工程可维护性。

### 2. 关键链路测试层

只围绕 MVP 主线补测试：

- 任务状态机
- executor 成功 / 超时 / 失败
- decision approve / reject / modify

### 3. 运行恢复层

最少要保证：

- websocket 自动重连
- executor 超时 fail
- 可重新 attach 当前任务
- server 重启后任务不会完全丢失上下文

### 4. 文档层

README 至少具备：

- quick start
- 环境变量说明
- executor 启动方式
- 常见问题

## CI 设计

推荐最小 GitHub Actions：

- checkout
- setup-node
- install
- lint
- typecheck
- test
- build

不在本轮引入复杂矩阵。

## 代码落点

- `package.json`
- README
- GitHub Actions
- websocket / runtime 恢复逻辑
- executor 调用与超时处理
- 关键 vitest 用例

## 风险

- 不建议一口气全仓库补覆盖率
- 只需要守住主链路，不要把低频实验模块一起拖进门禁
