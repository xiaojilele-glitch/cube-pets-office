# 实现计划：Agent Marketplace Platform

## 概述

基于设计文档，将 Agent Marketplace Platform 分解为增量式编码任务。每个任务构建在前一个任务之上，从共享契约层开始，逐步实现服务端业务逻辑、API 路由，最后构建前端界面。测试任务作为子任务嵌入到对应的实现任务中。

## 任务

- [ ] 1. 搭建共享契约层和项目结构
  - [ ] 1.1 创建 `shared/marketplace/contracts.ts`，定义所有核心数据模型类型、常量枚举（DeveloperAccount、AgentPackage、SecurityAudit、AgentListing、Purchase、License、AgentIntegration、DependencyGraph、AgentHealthCheck、AgentVersion、Revenue、UserFeedback、AgentSuite、SecurityPolicy、CompliancePolicy、MarketplaceAnalytics、AuditEntry 等）
    - 包含所有状态常量数组和类型（DEVELOPER_VERIFICATION_LEVELS、LISTING_STATUSES、LICENSE_STATUSES 等）
    - _Requirements: 1.1, 2.1, 3.1, 4.1, 7.1, 8.1, 9.1, 10.1, 11.1, 12.1, 13.1, 14.1, 16.1, 17.1, 18.1_
  - [ ]\* 1.2 编写数据模型序列化往返属性测试
    - **Property 1: 数据模型序列化往返一致性**
    - **Validates: Requirements 1.1, 2.1, 3.1, 4.1, 7.1, 8.1, 9.1, 10.1, 11.1, 12.1, 13.1, 14.1, 16.1, 17.1, 18.1**
  - [ ] 1.3 创建 `shared/marketplace/api.ts`，定义所有 REST API 路由常量和请求/响应类型
    - _Requirements: 全部_
  - [ ] 1.4 创建 `shared/marketplace/socket.ts`，定义 Socket.IO 事件类型
    - _Requirements: 全部_
  - [ ] 1.5 创建 `shared/marketplace/index.ts` 模块导出

- [ ] 2. 实现审计链服务
  - [ ] 2.1 创建 `server/marketplace/audit-chain.ts`，实现审计链记录服务
    - 实现 appendEntry() 方法，基于 previousHash 计算当前 hash（链式完整性）
    - 实现 getEntries() 查询方法，支持按 entityType、entityId、actorId 过滤
    - 实现 verifyChain() 方法，验证审计链完整性
    - _Requirements: 1.7, 2.8, 3.9, 4.8, 6.8, 7.7, 8.8, 9.7, 11.8, 12.8, 13.7, 14.7, 15.7, 16.6, 17.6, 18.7_
  - [ ]\* 2.2 编写审计链完整性属性测试
    - **Property 2: 审计链完整性**
    - **Validates: Requirements 1.7, 2.8, 3.9, 4.8, 6.8, 7.7, 8.8, 9.7, 11.8, 12.8, 13.7, 14.7, 15.7, 16.6, 17.6, 18.7**

- [ ] 3. 实现 Marketplace 数据存储层
  - [ ] 3.1 创建 `server/marketplace/marketplace-store.ts`，实现本地 JSON 数据库存储
    - 参考 `server/db/index.ts` 的模式，实现 CRUD 操作
    - 包含 developers、packages、audits、listings、purchases、licenses、integrations、versions、revenue、feedback、suites、healthChecks、reviews、analytics 等集合
    - _Requirements: 全部_

- [ ] 4. 实现开发者与认证服务
  - [ ] 4.1 创建 `server/marketplace/developer-service.ts`，实现开发者注册、认证、团队管理
    - 实现 register()、certify()、updateVerificationLevel()、addTeamMember()、removeTeamMember()
    - 认证级别与权限/收益比例映射
    - 所有操作调用审计链
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6, 1.7_
  - [ ]\* 4.2 编写认证级别与权限映射属性测试
    - **Property 18: 认证级别与权限映射**
    - **Validates: Requirements 1.4, 1.5**

- [ ] 5. 实现 Agent 打包与版本服务
  - [ ] 5.1 创建 `server/marketplace/package-service.ts`，实现 Agent 打包验证
    - 实现 validatePackage()：检查格式、元数据完整性、SOUL.md 存在、文档存在、语义化版本、依赖声明
    - 实现 createPackage()、getPackage()、listPackages()
    - _Requirements: 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8_
  - [ ]\* 5.2 编写语义化版本格式验证属性测试
    - **Property 7: 语义化版本格式验证**
    - **Validates: Requirements 2.6, 12.2**
  - [ ] 5.3 创建 `server/marketplace/version-service.ts`，实现版本管理
    - 实现 createVersion()、listVersions()、markVersionStatus()、rollbackVersion()、checkBackwardCompatibility()
    - 支持 stable/beta/pre_release/deprecated/end_of_life 状态
    - 支持生命周期管理（supportEndDate）
    - _Requirements: 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8_
  - [ ]\* 5.4 编写版本回滚正确性属性测试
    - **Property 21: 版本回滚正确性**
    - **Validates: Requirements 12.6**

- [ ] 6. 检查点 - 确保所有测试通过
  - 确保所有测试通过，如有问题请向用户确认。

- [ ] 7. 实现安全审核服务
  - [ ] 7.1 创建 `server/marketplace/audit-service.ts`，实现安全审核
    - 实现 triggerAudit()：支持 code/permission/dependency/privacy/compliance 审核类型
    - 实现 performCodeAudit()、performPermissionAudit()、performDependencyAudit()、performPrivacyAudit()、performComplianceAudit()
    - 依赖审核包含循环依赖检测
    - _Requirements: 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9_

- [ ] 8. 实现依赖管理服务
  - [ ] 8.1 创建 `server/marketplace/dependency-service.ts`，实现依赖解析和冲突检测
    - 实现 buildDependencyGraph()：构建依赖图
    - 实现 detectConflicts()：检测循环依赖和版本不兼容
    - 实现 resolveDependencies()：拓扑排序产生安装顺序
    - 实现 lockVersions()、updateDependencies()
    - 支持 agent/mcp_tool/model/system 四种依赖类型
    - _Requirements: 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8_
  - [ ]\* 8.2 编写依赖冲突检测属性测试
    - **Property 13: 依赖冲突检测**
    - **Validates: Requirements 3.5, 10.6, 10.7**

- [ ] 9. 实现发布与上架服务
  - [ ] 9.1 创建 `server/marketplace/listing-service.ts`，实现 Agent 发布和上架
    - 实现 createListing()、updateListing()、publishListing()、delistListing()
    - 实现状态机：draft → pending_review → published → delisted
    - 支持分类、标签、定价模式（free/one_time/subscription/usage_based）
    - 支持版本管理和发布说明
    - _Requirements: 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8_
  - [ ]\* 9.2 编写发布状态机转换属性测试
    - **Property 6: 发布状态机转换合法性**
    - **Validates: Requirements 4.2**

- [ ] 10. 实现搜索与推荐服务
  - [ ] 10.1 创建 `server/marketplace/search-service.ts`，实现搜索、浏览、推荐
    - 实现 search()：支持全文搜索（名称/描述/能力）、分类过滤、标签过滤、高级搜索
    - 实现 sort()：支持按 popularity/rating/price/publishDate 排序
    - 实现 browseByCategory()、getRecommendations()
    - 搜索结果包含基本信息、评分、价格、下载量
    - _Requirements: 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8_
  - [ ]\* 10.2 编写搜索过滤正确性属性测试
    - **Property 3: 搜索过滤正确性**
    - **Validates: Requirements 5.2, 5.3, 5.4, 5.7**
  - [ ]\* 10.3 编写搜索排序正确性属性测试
    - **Property 4: 搜索排序正确性**
    - **Validates: Requirements 5.5**
  - [ ]\* 10.4 编写搜索结果信息完整性属性测试
    - **Property 5: 搜索结果信息完整性**
    - **Validates: Requirements 5.8**

- [ ] 11. 实现评价服务
  - [ ] 11.1 创建 `server/marketplace/review-service.ts`，实现用户评价
    - 实现 createReview()、listReviews()、upvoteReview()、replyToReview()、reportReview()
    - 实现 calculateAverageRating()：计算 Agent 平均评分
    - _Requirements: 6.6, 6.7, 6.8_
  - [ ]\* 11.2 编写评价操作正确性属性测试
    - **Property 19: 评价操作正确性**
    - **Validates: Requirements 6.6, 6.7**

- [ ] 12. 检查点 - 确保所有测试通过
  - 确保所有测试通过，如有问题请向用户确认。

- [ ] 13. 实现交易与许可证服务
  - [ ] 13.1 创建 `server/marketplace/transaction-service.ts`，实现购买和订阅
    - 实现 createPurchase()：支持 one_time/subscription/usage_based
    - 实现 cancelSubscription()、renewSubscription()
    - 购买完成后生成 licenseKey 并创建 License 记录
    - 支持多种支付方式
    - _Requirements: 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_
  - [ ]\* 13.2 编写购买生成许可证属性测试
    - **Property 10: 购买生成许可证**
    - **Validates: Requirements 7.6**
  - [ ] 13.3 创建 `server/marketplace/license-service.ts`，实现许可证管理
    - 实现 activateLicense()、deactivateLicense()、transferLicense()、renewLicense()
    - 实现设备限制和使用量限制检查
    - 实现过期自动禁用逻辑
    - 状态机：inactive → active → expired/revoked/transferred
    - _Requirements: 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8_
  - [ ]\* 13.4 编写许可证限制执行属性测试
    - **Property 8: 许可证限制执行**
    - **Validates: Requirements 8.3, 8.4**
  - [ ]\* 13.5 编写许可证生命周期状态机属性测试
    - **Property 9: 许可证生命周期状态机**
    - **Validates: Requirements 8.2, 8.5, 8.6, 8.7**

- [ ] 14. 实现集成与监控服务
  - [ ] 14.1 创建 `server/marketplace/integration-service.ts`，实现 Agent 集成
    - 实现 createIntegration()、updateIntegration()、toggleIntegration()
    - 支持参数配置、版本选择、权限配置
    - 实现使用监控（callCount、totalCost）
    - _Requirements: 9.2, 9.3, 9.4, 9.5, 9.6, 9.7_
  - [ ]\* 14.2 编写集成配置持久化属性测试
    - **Property 20: 集成配置持久化**
    - **Validates: Requirements 9.2, 9.3, 9.4, 9.5**
  - [ ] 14.3 创建 `server/marketplace/health-service.ts`，实现健康检查
    - 实现 performHealthCheck()：可用性、性能、错误率、安全检查
    - 实现阈值告警逻辑
    - _Requirements: 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8_
  - [ ]\* 14.4 编写健康检查阈值告警属性测试
    - **Property 17: 健康检查阈值告警**
    - **Validates: Requirements 11.5, 11.7**

- [ ] 15. 实现收益与反馈服务
  - [ ] 15.1 创建 `server/marketplace/revenue-service.ts`，实现收益计算和结算
    - 实现 calculateRevenue()：基于交易数据计算总收入
    - 实现 calculatePlatformFee()：根据认证级别确定费率
    - 实现 requestWithdrawal()：支持最低提现金额限制
    - 支持月/季/年结算周期
    - _Requirements: 13.2, 13.3, 13.4, 13.5, 13.6, 13.7_
  - [ ]\* 15.2 编写收益计算正确性属性测试
    - **Property 11: 收益计算正确性**
    - **Validates: Requirements 13.2, 13.3**
  - [ ]\* 15.3 编写最低提现金额限制属性测试
    - **Property 12: 最低提现金额限制**
    - **Validates: Requirements 13.6**
  - [ ] 15.4 创建 `server/marketplace/feedback-service.ts`，实现用户反馈
    - 实现 createFeedback()、listFeedback()、replyToFeedback()
    - 实现 getFeedbackAnalytics()：统计分析
    - 支持分类和优先级排序
    - _Requirements: 14.2, 14.3, 14.4, 14.5, 14.6, 14.7_
  - [ ]\* 15.5 编写反馈统计分析正确性属性测试
    - **Property 22: 反馈统计分析正确性**
    - **Validates: Requirements 14.5, 14.6**

- [ ] 16. 实现套件与安全合规服务
  - [ ] 16.1 创建 `server/marketplace/suite-service.ts`，实现 Agent 套件管理
    - 实现 createSuite()、updateSuite()、listSuites()
    - 实现捆绑折扣计算和多开发者收益分配
    - _Requirements: 16.2, 16.3, 16.4, 16.5, 16.6_
  - [ ]\* 16.2 编写套件折扣正确性属性测试
    - **Property 14: 套件折扣正确性**
    - **Validates: Requirements 16.3**
  - [ ]\* 16.3 编写套件收益分配属性测试
    - **Property 15: 套件收益分配**
    - **Validates: Requirements 16.4**
  - [ ] 16.4 创建 `server/marketplace/security-service.ts`，实现安全策略
    - 实现权限声明管理、数据访问控制、权限撤销、数据删除
    - _Requirements: 17.2, 17.3, 17.4, 17.7, 17.8_
  - [ ]\* 16.5 编写权限访问控制属性测试
    - **Property 16: 权限访问控制**
    - **Validates: Requirements 17.3, 17.4, 17.7, 17.8, 18.5**
  - [ ] 16.6 创建 `server/marketplace/compliance-service.ts`，实现合规检查
    - 实现合规策略管理、ToS/隐私政策验证、数据/模型声明验证
    - _Requirements: 18.2, 18.3, 18.4, 18.5, 18.6, 18.7_

- [ ] 17. 检查点 - 确保所有测试通过
  - 确保所有测试通过，如有问题请向用户确认。

- [ ] 18. 实现社区与分析服务
  - [ ] 18.1 创建 `server/marketplace/community-service.ts`，实现社区功能
    - 实现排行榜、开发者荣誉系统
    - _Requirements: 15.5, 15.6, 15.7_
  - [ ] 18.2 创建 `server/marketplace/analytics-service.ts`，实现运营分析
    - 实现 getAnalytics()：计算 GMV、用户数、Agent 数、转化率、留存率、NPS
    - 实现 getAnalyticsByDimension()：按时间/分类/开发者维度分析
    - 实现 identifyTrends()：识别 trending/emerging/declining Agent
    - _Requirements: 20.1, 20.2, 20.3, 20.4, 20.5_
  - [ ]\* 18.3 编写运营分析指标正确性属性测试
    - **Property 23: 运营分析指标正确性**
    - **Validates: Requirements 20.1, 20.2, 20.3**

- [ ] 19. 实现服务端 API 路由层
  - [ ] 19.1 创建 `server/routes/marketplace.ts`，实现所有 Marketplace REST API 路由
    - 挂载到 `/api/marketplace/*`
    - 连接所有服务层方法到对应的路由
    - 实现请求验证和错误处理
    - _Requirements: 全部_
  - [ ] 19.2 在 `server/index.ts` 中注册 Marketplace 路由
    - _Requirements: 全部_
  - [ ] 19.3 实现 Socket.IO 事件广播
    - 在关键操作（发布、购买、评价、健康告警、版本发布、审核完成）时广播 Socket 事件
    - _Requirements: 全部_
  - [ ]\* 19.4 编写 API 路由单元测试
    - 测试关键路由的请求验证、响应格式、错误处理
    - _Requirements: 全部_

- [ ] 20. 检查点 - 确保所有测试通过
  - 确保所有测试通过，如有问题请向用户确认。

- [ ] 21. 实现前端 Marketplace Store 和 API 客户端
  - [ ] 21.1 创建 `client/src/lib/marketplace-client.ts`，封装 Marketplace REST API 调用
    - 参考 `client/src/lib/mission-client.ts` 的模式
    - _Requirements: 全部_
  - [ ] 21.2 创建 `client/src/lib/marketplace-store.ts`，实现 Zustand store
    - 管理 Marketplace 状态：listings、search results、purchases、licenses、integrations
    - 实现 Socket.IO 事件监听
    - _Requirements: 全部_

- [ ] 22. 实现前端 Marketplace 页面
  - [ ] 22.1 创建 `client/src/pages/marketplace/MarketplacePage.tsx`，实现 Marketplace 主页
    - 展示热门 Agent、推荐 Agent、新发布 Agent
    - _Requirements: 19.1_
  - [ ] 22.2 创建 `client/src/pages/marketplace/SearchPage.tsx`，实现搜索与浏览页
    - 支持全文搜索、分类浏览、标签过滤、高级搜索、排序
    - _Requirements: 19.2, 19.3_
  - [ ] 22.3 创建 `client/src/pages/marketplace/AgentDetailPage.tsx`，实现 Agent 详情页
    - 展示完整信息、评价、版本历史、相关 Agent
    - 支持提交评价
    - _Requirements: 19.4, 6.1, 6.2, 6.3, 6.4, 6.5_
  - [ ] 22.4 创建 `client/src/pages/marketplace/PurchasePage.tsx`，实现购买与订阅页
    - 支持一键购买、订阅管理
    - _Requirements: 19.5_
  - [ ] 22.5 创建 `client/src/pages/marketplace/MyAgentsPage.tsx`，实现我的 Agent 页
    - 展示已购买 Agent、许可证、使用情况
    - _Requirements: 19.6_
  - [ ] 22.6 创建 `client/src/pages/marketplace/DevDashboardPage.tsx`，实现开发者后台
    - 支持 Agent 发布、管理、分析、反馈查看
    - _Requirements: 19.7_
  - [ ] 22.7 创建 `client/src/pages/marketplace/AnalyticsPage.tsx`，实现运营分析页
    - 展示 GMV、用户数、转化率等指标
    - _Requirements: 20.1, 20.2, 20.3_

- [ ] 23. 路由注册与导航集成
  - [ ] 23.1 在 `client/src/App.tsx` 中添加 Marketplace 页面路由
    - _Requirements: 19.1_
  - [ ] 23.2 在导航组件中添加 Marketplace 入口
    - _Requirements: 19.1_

- [ ] 24. 最终检查点 - 确保所有测试通过
  - 确保所有测试通过，如有问题请向用户确认。

## 备注

- 标记 `*` 的任务为可选任务，可跳过以加速 MVP 开发
- 每个任务引用了具体的需求编号以确保可追溯性
- 检查点确保增量验证
- 属性测试验证通用正确性属性
- 单元测试验证具体示例和边界条件
