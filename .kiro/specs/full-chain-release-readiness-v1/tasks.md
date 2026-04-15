# 执行任务

## 执行序列

- [x] 1. 新建 `full-chain-release-readiness-v1` specs 并写入流程清单
- [x] 2. 建立发布门禁脚本与生产 smoke 入口
- [x] 3. 收口 TypeScript 基线与共享接口漂移
- [x] 4. 修复前端可达链路中的真实运行问题
- [x] 5. 修复执行器与回调链路中的真实阻塞问题
- [x] 6. 跑通 `check / build / test:client / test:server / test:executor / smoke:prod`
- [ ] 7. 对 Feishu、Knowledge/RAG、Replay、Lineage、Permission、A2A 做分组冒烟验证
- [ ] 8. 完成 Linux 生产启动与全链路手测留痕

## 当前完成情况

- 第 6 项已于本轮完成，`npm run test:release` 已通过。
- 第 7 项仍待人工按 `manual-verification.md` 分组执行，尤其是 Feishu、Knowledge/RAG、Replay、Lineage、Permission、A2A 的页面/API 联调。
- 第 8 项仍待在目标 Linux 机器上按生产环境实际变量启动，并补齐手测留痕。

## 本轮落地边界

- 只修上线阻塞，不扩展新功能。
- 不重做 FRP、域名、公网入口拓扑。
- 不覆盖旧部署文档，只新增版本化总规留档。

## 当前修复包

- 基线包：发布脚本、TypeScript target、生产 smoke、release 门禁。
- 前端运行包：浏览器存储安全、公共行为测试、现行文案断言、首页与任务链路可达性。
- 执行链路包：A2A 契约、callback canonical wire shape、cancel 非阻塞返回、executor 测试收口。
- 测试稳定性包：知识图谱持久化污染隔离、属性测试断言修正、server 测试内存上限收口。
