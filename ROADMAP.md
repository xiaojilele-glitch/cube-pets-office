# 实现路径规划：从展示页面到多智能体编排系统

## 当前状态

## 当前实现状态（2026-03-26 更新）

### 本轮新增完成

- [x] **AI 配置统一收口到服务端**：聊天面板与多智能体 workflow 现在共用同一套服务端配置，不再出现“界面显示一个模型、实际执行另一个模型”的分叉。
- [x] **`.env` 成为唯一真源**：当前模型、Base URL、API Key、推理强度等配置只从 `.env` 读取；前端配置面板改为只读展示，并提示“修改 `.env` 后需重启服务”。
- [x] **服务端聊天代理接入完成**：前端聊天面板不再直接请求第三方 `/chat/completions`，统一改走服务端 `/api/chat`，减少前后端配置漂移。
- [x] **Agent 启动模型与 `.env` 对齐**：服务启动时，18 个 agents 的 `model` 会按 `.env` 中的当前模型刷新，保证 workflow 执行链路一致。
- [x] **运行时数据目录已从 Git 跟踪中移除**：`data/agents/*/sessions/`、`data/agents/*/memory/`、`data/agents/*/reports/` 已按 `.gitignore` 预期处理；后续新产生的 runtime 文件不应再进入版本控制。

### 当前确认结论

- [x] **`GET /api/config/ai` 为只读配置接口**：接口返回配置来源为 `.env`，并显式标记 `writable: false`。
- [x] **`PUT /api/config/ai` 已移除**：不再支持运行时改写模型配置，避免服务运行期间配置状态与仓库环境变量脱节。
- [x] **TypeScript 检查通过**：`npm run check` 已验证通过。
- [x] **Phase 2 勾选已按当前代码状态回填**：CEO 拆解、经理规划、Worker 执行、前端指令面板与消息流可视化已在现有实现中落地，先前只是 ROADMAP 未同步。

### 下一步执行计划（建议顺序）

当前推荐的主线不是继续堆展示层，而是先把基础层和记忆层补硬，再进入自主行为：

1. **Phase 1 收尾：把“能跑”补成“够硬”**
   - [ ] 启动时一次性创建 18 个 agent 工作空间，补齐缺失目录（当前需特别确认 `scout`）
   - [ ] 将消息总线层级校验从“告警”升级为“强制拦截”
   - [ ] 收敛 agent 的工作空间访问入口，避免直接跨目录读写
   - [ ] 为基础层补一轮最小验证：注册表、工作空间、层级通信

2. **Phase 5 补强：把记忆系统从摘要检索推进到论文目标版**
   - [x] 补齐当前 workflow 内完整上下文注入，而不只是最近片段
   - [x] 实现中期记忆的 embedding / 向量检索
   - [x] 将长期记忆从数据库 `soul_md` 推进到文件版 `SOUL.md`
   - [x] 明确每个 agent 只能访问自己的 sessions / memory / reports
   - [x] 已先行执行 `phase-5-memory`；若后续与 Phase 1 hardening 的 workspace / 访问接口收敛冲突，再解决冲突

3. **Phase 7 启动：把智能体从“被动执行”推进到“定时自主工作”**
   - [ ] 增加 heartbeat 调度器与配置载入
   - [ ] 打通自主搜索 / 总结 / 报告生成链路
   - [ ] 报告落盘到各自 `reports/`，并在前端补最小可视化状态

4. **Phase 8 收口：做真正的自进化闭环**
   - [ ] 关键词学习，沉淀到 `HEARTBEAT.md` 或等价配置层
   - [ ] 能力注册表维护，记录 agent 已展示能力
   - [ ] 将绩效反馈闭环从“追加 `soul_md`”扩展到文件版 persona 演化

### 近期里程碑建议（按 1-2 周拆分）

- [ ] 里程碑 A：完成 Phase 1 未勾选项
- [x] 里程碑 B：完成 Phase 5 未勾选项中的“完整上下文 + 向量检索”
- [ ] 里程碑 B+：补齐结构化报告输出链路（部门汇总、CEO 总报告、落盘与查看）
- [ ] 里程碑 C：跑通首个 heartbeat 自主报告闭环
- [ ] 里程碑 D：完成 Phase 8 的关键词学习与能力注册

### 报告输出能力（单列说明）

这条能力当前**部分存在，但没有被单列成一个独立子系统**：

- [x] 当前工作流内已存在“报告雏形”：经理 `summary` 汇总、CEO `feedback` 总结、记忆摘要 `workflow_summary`
- [ ] 缺少统一的“最终报告模型”：没有把部门报告、总报告、关键评分、问题清单、后续建议收敛成固定结构
- [ ] 缺少报告落盘：当前 `reports/` 目录已预留，但还没有稳定写入部门报告 / CEO 总报告
- [ ] 缺少报告查看入口：前端能看到 workflow 进度和反馈，但没有“报告中心 / 报告详情”视图
- [ ] 缺少报告导出：尚未支持 Markdown / JSON / PDF 等导出形式

建议将“报告输出”视为一条横跨 Phase 5 和 Phase 7 的独立主线：

1. **先补工作流结束后的结构化总报告**
   - [ ] 定义 workflow final report schema
   - [ ] 将部门 summary、review 分数、meta audit、verify 结果、CEO feedback 汇总成一份最终报告
   - [ ] 在工作流完成时写入 `data/agents/ceo/reports/` 或 workflow 级别 `reports/`

2. **再补面向每个 agent 的报告沉淀**
   - [ ] 经理报告写入各自 `reports/`
   - [ ] heartbeat 趋势报告写入各自 `reports/`
   - [ ] 让 `reports/` 与 `memory/` 分工明确：前者偏交付物，后者偏检索记忆

3. **最后补报告消费层**
   - [ ] 增加报告查询 API
   - [ ] 前端增加报告列表 / 报告详情视图
   - [ ] 视需要支持导出与分享

### 当前不建议优先投入的方向

- [ ] 暂不优先继续扩前端展示形态；现有 3D 场景、消息流和仪表盘已足够支撑演示
- [ ] 暂不优先引入新的推荐系统/数据平台模块；当前项目主线仍是多智能体编排，不是推荐引擎
- [ ] 暂不优先重做数据库层；在基础隔离、记忆和 heartbeat 完成前，本地 JSON 仍可支撑迭代

### 现阶段仍保留的行为

- [ ] **Session / Memory 文件仍会继续生成**：这是当前记忆与回溯机制的正常行为，不是异常；只是这些文件现在应留在本地 runtime 数据中，而不是进入 Git。
- [ ] **ROADMAP 旧段落存在历史内容与部分乱码**：本次先补充最新进度，尚未对整份文档做全文清洗或重构。

## 当前实现状态 (2026-03-25 更新)

**核心达成：**
- [x] **全栈编排系统**：实现了从展示页面到多智能体层级委派系统的完整转型。
- [x] **十阶段管道**：实现了论文描述的完整闭环（方向->规划->执行->评审->审计->修订->验证->汇总->反馈->进化）。
- [x] **3D 实时联动**：前端 3D 宠物根据后端工作流状态实时改变行为。
- [x] **本地零配置运行**：采用本地 JSON 数据库替代 MySQL，方便快速部署。

---
项目现在是论文的 **3D 可视化前端**：5 只宠物在温馨书房里"工作"，用户可以点击聊天、看 PDF、配 API。后端是一个只提供静态文件的 Express 服务器。

**与论文系统的核心差距：没有智能体间通信、没有层级委派、没有工作流管道。**

## 目标状态

实现论文描述的核心架构：用户输入一条指令 → CEO 分解 → 经理规划 → Worker 执行 → 评审 → 修订 → 汇总，前端 3D 场景实时展示每个智能体的工作状态。

## 技术选型建议

- **后端**：复用现有 Express 服务器，扩展为 WebSocket + REST API
- **数据库**：MySQL 8.x（远程实例，mysql2 驱动 + 连接池）
- **LLM 调用**：复用现有 AI Config 中的 OpenAI 兼容 API
- **实时通信**：Socket.IO（前端已有基础设施）
- **文件系统隔离**：Node.js fs 模块，每个智能体独立目录

---

## Phase 0：基础设施准备（预计 2-3 天）

**目标：让后端从"静态文件服务器"变成"能跑逻辑的应用服务器"。**

### 0.1 后端 API 框架

当前 `server/index.ts` 只有一个 `app.get("*")` 路由。需要扩展为：

```
server/
├── index.ts              # 入口，挂载路由和 WebSocket
├── routes/
│   ├── agents.ts         # GET/POST 智能体相关 API
│   ├── workflows.ts      # 工作流执行 API
│   └── config.ts         # 系统配置 API
├── core/
│   ├── agent.ts          # Agent 基类定义
│   ├── registry.ts       # 智能体注册表
│   ├── llm-client.ts     # LLM API 调用封装
│   └── message-bus.ts    # 智能体间消息总线
├── memory/
│   ├── workspace.ts      # 文件系统工作空间管理
│   └── session-store.ts  # 会话历史存储
└── db/
    ├── schema.sql        # MySQL 表结构
    ├── seed.ts           # 18 个智能体初始数据
    └── index.ts          # MySQL 连接池
```

### 0.2 数据库 Schema

环境变量配置（`.env`）：

```dotenv
DB_HOST=115.191.22.18
DB_PORT=3306
DB_NAME=cube_pets_office
DB_USER=root
DB_PASSWORD=Wang13734121540.
```

连接池封装（`server/db/index.ts`）：

```typescript
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
dotenv.config();

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  waitForConnections: true,
  connectionLimit: 10,       // 并发智能体调用时足够
  queueLimit: 0,
  charset: 'utf8mb4',        // 中文内容 + emoji 支持
  timezone: '+08:00',
});

export default pool;

// 便捷查询方法
export async function query<T = any>(sql: string, params?: any[]): Promise<T[]> {
  const [rows] = await pool.execute(sql, params);
  return rows as T[];
}

export async function queryOne<T = any>(sql: string, params?: any[]): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

export async function execute(sql: string, params?: any[]) {
  const [result] = await pool.execute(sql, params);
  return result;
}
```

MySQL 表结构（`server/db/schema.sql`）：

```sql
CREATE DATABASE IF NOT EXISTS cube_pets_office
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE cube_pets_office;

-- ============================================================
-- 智能体定义（对应三文件规范中的静态配置）
-- ============================================================
CREATE TABLE IF NOT EXISTS agents (
  id VARCHAR(32) PRIMARY KEY,            -- 'blaze', 'tensor', 'pixel'...
  name VARCHAR(64) NOT NULL,
  department ENUM('game','ai','life','meta') NOT NULL,
  role ENUM('ceo','manager','worker') NOT NULL,
  manager_id VARCHAR(32) DEFAULT NULL,   -- 上级 ID（CEO 为 NULL）
  model VARCHAR(64) DEFAULT 'gpt-4o',    -- 可替换执行器
  soul_md TEXT,                           -- SOUL.md 内容
  heartbeat_config JSON,                  -- HEARTBEAT.md 配置
  is_active TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_department (department),
  INDEX idx_role (role),
  FOREIGN KEY (manager_id) REFERENCES agents(id) ON DELETE SET NULL
) ENGINE=InnoDB;

-- ============================================================
-- 工作流运行记录
-- ============================================================
CREATE TABLE IF NOT EXISTS workflow_runs (
  id VARCHAR(36) PRIMARY KEY,              -- UUID
  directive TEXT NOT NULL,                  -- 用户原始指令
  status ENUM('pending','running','completed','failed') DEFAULT 'pending',
  current_stage VARCHAR(32) DEFAULT NULL,
  departments_involved JSON,               -- ['game','ai','life']
  started_at TIMESTAMP NULL,
  completed_at TIMESTAMP NULL,
  results JSON,                            -- 最终汇总结果
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_status (status),
  INDEX idx_created (created_at)
) ENGINE=InnoDB;

-- ============================================================
-- 智能体间消息（通信记录）
-- ============================================================
CREATE TABLE IF NOT EXISTS messages (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  workflow_id VARCHAR(36) NOT NULL,
  from_agent VARCHAR(32) NOT NULL,
  to_agent VARCHAR(32) NOT NULL,
  stage VARCHAR(32) NOT NULL,              -- 'direction','planning','execution'...
  content MEDIUMTEXT NOT NULL,             -- 消息内容（可能很长）
  metadata JSON,                           -- 评分、附件等结构化数据
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_workflow (workflow_id),
  INDEX idx_to_agent (to_agent, workflow_id),
  INDEX idx_stage (workflow_id, stage),
  FOREIGN KEY (workflow_id) REFERENCES workflow_runs(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ============================================================
-- 任务分配与评分
-- ============================================================
CREATE TABLE IF NOT EXISTS tasks (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  workflow_id VARCHAR(36) NOT NULL,
  worker_id VARCHAR(32) NOT NULL,
  manager_id VARCHAR(32) NOT NULL,
  department ENUM('game','ai','life','meta') NOT NULL,
  description TEXT NOT NULL,
  deliverable MEDIUMTEXT,                  -- Worker 产出（v1）
  deliverable_v2 MEDIUMTEXT,               -- 修订后产出（v2）
  deliverable_v3 MEDIUMTEXT,               -- 二次修订（v3，如有）
  score_accuracy TINYINT UNSIGNED,          -- 0-5
  score_completeness TINYINT UNSIGNED,
  score_actionability TINYINT UNSIGNED,
  score_format TINYINT UNSIGNED,
  total_score TINYINT UNSIGNED,             -- 0-20
  manager_feedback TEXT,                    -- 经理反馈
  meta_audit_feedback TEXT,                 -- 元部门审计反馈
  verify_result JSON,                       -- 验证阶段逐条确认结果
  version TINYINT UNSIGNED DEFAULT 1,       -- 当前版本 1/2/3
  status ENUM('assigned','executing','submitted','reviewed',
              'audited','revising','verified','passed','failed') DEFAULT 'assigned',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_workflow (workflow_id),
  INDEX idx_worker (worker_id),
  INDEX idx_status (status),
  FOREIGN KEY (workflow_id) REFERENCES workflow_runs(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ============================================================
-- 进化日志（M7 自进化子系统）
-- ============================================================
CREATE TABLE IF NOT EXISTS evolution_log (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  agent_id VARCHAR(32) NOT NULL,
  workflow_id VARCHAR(36),                  -- 触发进化的工作流
  dimension VARCHAR(32),                    -- accuracy/completeness/actionability/format
  old_score DECIMAL(3,1),
  new_score DECIMAL(3,1),
  patch_content TEXT,                       -- SOUL.md 补丁内容
  applied TINYINT(1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_agent (agent_id),
  INDEX idx_workflow (workflow_id)
) ENGINE=InnoDB;

-- ============================================================
-- 关键词学习表（M7-2）
-- ============================================================
CREATE TABLE IF NOT EXISTS heartbeat_keywords (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  agent_id VARCHAR(32) NOT NULL,
  keyword VARCHAR(128) NOT NULL,
  category ENUM('effective','neutral','ineffective') DEFAULT 'neutral',
  correlation DECIMAL(4,3) DEFAULT 0.000,   -- 与高分的相关系数
  occurrence_count INT UNSIGNED DEFAULT 0,
  last_seen_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_agent_keyword (agent_id, keyword),
  INDEX idx_agent (agent_id)
) ENGINE=InnoDB;

-- ============================================================
-- 能力注册表（M7-3）
-- ============================================================
CREATE TABLE IF NOT EXISTS agent_capabilities (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  agent_id VARCHAR(32) NOT NULL,
  capability VARCHAR(256) NOT NULL,
  confidence DECIMAL(4,3) DEFAULT 0.500,    -- EMA 置信度
  demo_count INT UNSIGNED DEFAULT 0,         -- 成功展示次数
  last_demonstrated_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_agent_cap (agent_id, capability(191)),
  INDEX idx_agent (agent_id),
  INDEX idx_confidence (confidence DESC)
) ENGINE=InnoDB;
```

### 0.3 WebSocket 实时通道

前端需要实时看到智能体在做什么。用 Socket.IO 推送事件：

```typescript
// 事件类型
type AgentEvent =
  | { type: 'stage_change'; workflowId: string; stage: string }
  | { type: 'agent_active'; agentId: string; action: string }
  | { type: 'message_sent'; from: string; to: string; preview: string }
  | { type: 'score_assigned'; taskId: number; score: number }
  | { type: 'workflow_complete'; workflowId: string; summary: string };
```

### 0.4 交付物

- [x] Express 服务器可运行 REST API 和 WebSocket
- [x] 本地 JSON 数据库 (database.json) + 18 个智能体种子数据
- [x] LLM Client 封装 (支持 gpt-4.1-mini)
- [x] `.env` 已统一管理 AI 配置与 API 密钥（当前默认使用本地 JSON 数据库，无需数据库连接配置）
- [x] 前端 WebSocket 连接建立

---

## Phase 1：智能体基础层（预计 3-4 天）

**目标：每个智能体有独立身份、独立记忆、可被独立调用。**

### 1.1 Agent 基类

```typescript
// server/core/agent.ts
interface AgentConfig {
  id: string;
  name: string;
  department: string;
  role: 'ceo' | 'manager' | 'worker';
  managerId: string | null;
  model: string;
  soulMd: string;
}

class Agent {
  config: AgentConfig;
  workspace: AgentWorkspace;   // 独立文件系统目录

  // 核心方法
  async invoke(prompt: string, context?: string[]): Promise<string>;
  async sendMessage(toAgentId: string, content: string): void;
  async getHistory(limit?: number): Promise<Message[]>;
}
```

### 1.2 文件系统工作空间隔离

```
data/agents/
├── pixel/              # 游戏部经理
│   ├── SOUL.md
│   ├── AGENTS.md       # 共享只读
│   ├── HEARTBEAT.md
│   └── sessions/       # 会话历史 JSONL
├── blaze/              # 游戏部 Worker
│   ├── SOUL.md
│   ├── ...
├── nexus/              # AI 部经理
│   ├── ...
└── ...（18 个目录）
```

关键：每个智能体的 `invoke()` 方法只读取自己的 SOUL.md 和 sessions/，绝不访问其他目录。

当前代码状态（2026-03-26）：
- 智能体 persona 当前存储在数据库 `soul_md` 字段，而不是磁盘 `SOUL.md` 文件
- `sessions/`、`memory/`、`reports/` 目录已实现，但工作空间目录按需创建，不是 18 个目录在启动时一次性全部落盘
- 目前仍属于“约定式隔离”，还不是严格文件系统隔离

### 1.3 SOUL.md / soul_md 初始配置

为论文中的 18 个智能体编写初始 SOUL 配置。可以从论文附录 A 的模板出发，每个配置包含：

- 身份定义（名称、部门、汇报关系）
- 专业领域
- 输出格式要求
- 行为规则

### 1.4 消息总线

```typescript
// server/core/message-bus.ts
class MessageBus {
  // 发送消息（自动校验层级约束）
  async send(from: string, to: string, content: string, workflowId: string): Promise<void>;

  // 层级校验：CEO↔Manager, Manager↔Worker（同部门内），阻止越级
  private validateHierarchy(from: Agent, to: Agent): boolean;

  // 获取某智能体的收件箱
  async getInbox(agentId: string, workflowId?: string): Promise<Message[]>;
}
```

### 1.5 前端：智能体状态面板

在 3D 场景中，每只宠物上方显示当前状态标签：

```
🟢 空闲 | 🟡 思考中... | 🔵 执行任务 | 🟠 等待评审 | ✅ 完成
```

### 1.6 交付物

- [x] 18 个智能体已注册进系统（数据库）
- [ ] 18 个智能体的工作空间目录启动即完整落盘
- [x] 初始 persona 配置完成（当前实现为数据库 `soul_md`，非文件版 `SOUL.md`）
- [x] 消息总线可发送/接收
- [ ] 消息总线层级校验强制执行（当前为告警，不拦截）
- [x] 前端能实时显示智能体状态

---

## Phase 2：层级委派与 CEO 网关（预计 3-4 天）

**目标：实现"单指令动员"——用户说一句话，CEO 自动分解并下发给各部门经理。**

### 2.1 CEO 网关

```typescript
// server/core/ceo-gateway.ts
class CEOGateway {
  async processDirective(directive: string): Promise<WorkflowRun> {
    // 1. 创建工作流记录
    const workflow = await db.createWorkflow(directive);

    // 2. 调用 CEO Agent 分析指令
    //    CEO 的 system prompt 要求它：
    //    - 判断需要哪些部门参与
    //    - 为每个参与部门生成具体方向指令
    //    - 输出结构化 JSON
    const ceoResponse = await this.ceoAgent.invoke(
      `分析以下战略指令，确定需要哪些部门参与，并为每个部门生成具体方向：\n${directive}`,
    );

    // 3. 解析 CEO 输出，向各经理发送方向指令
    const departments = parseCEOResponse(ceoResponse);
    for (const dept of departments) {
      await this.messageBus.send('ceo', dept.managerId, dept.direction, workflow.id);
    }

    // 4. 触发下一阶段（规划）
    await this.startStage(workflow.id, 'planning');

    return workflow;
  }
}
```

### 2.2 经理规划逻辑

```typescript
// server/core/manager.ts
class ManagerAgent extends Agent {
  async planTasks(direction: string, workflowId: string): Promise<Task[]> {
    // 经理收到 CEO 方向后：
    // 1. 分析方向，分解为 Worker 级任务
    // 2. 根据 Worker 能力分配任务
    // 3. 通过消息总线下发给各 Worker
    const plan = await this.invoke(
      `你收到了以下部门方向：\n${direction}\n\n` +
      `你的团队成员：${this.getWorkerList()}\n\n` +
      `请为每个 Worker 分配具体任务。输出 JSON 格式。`
    );

    const tasks = parsePlan(plan);
    for (const task of tasks) {
      await this.messageBus.send(this.id, task.workerId, task.description, workflowId);
      await db.createTask(workflowId, task);
    }
    return tasks;
  }
}
```

### 2.3 前端：指令输入与组织图

替换现有的简单聊天窗口，新增一个"指令面板"：

- 顶部输入框：输入战略指令（如"本周聚焦用户增长"）
- 下方实时显示组织图（CEO → 经理 → Worker）
- 消息流动时，3D 场景中对应的宠物之间出现粒子/光线动画

### 2.4 交付物

- [x] CEO 网关可接收指令并分解
- [x] 经理可接收方向并分配任务给 Worker
- [x] Worker 可接收任务并执行（当前已进入完整工作流，而非仅单轮执行）
- [x] 前端指令输入面板 + 消息流可视化

---

## Phase 3：工作流管道 V2（预计 4-5 天）

**目标：实现七阶段工作流管道（方向→规划→执行→评审→修订→汇总→反馈）。**

### 3.1 工作流引擎

```typescript
// server/core/workflow-engine.ts
const V2_STAGES = [
  'direction',   // CEO → 经理：下发方向
  'planning',    // 经理：分解任务
  'execution',   // Worker：执行任务，提交 v1
  'review',      // 经理：评分 (0-20) 并反馈
  'revision',    // Worker：依据反馈修订为 v2
  'summary',     // 经理：为 CEO 综合汇报
  'feedback',    // CEO：评估部门绩效
] as const;

class WorkflowEngine {
  async runStage(workflowId: string, stage: Stage): Promise<void> {
    switch (stage) {
      case 'direction':
        // CEO 分解指令给各经理
        break;
      case 'planning':
        // 各经理并行规划任务
        break;
      case 'execution':
        // 各 Worker 并行执行
        break;
      case 'review':
        // 经理评审 Worker 产出
        break;
      case 'revision':
        // 评分 <16 的 Worker 修订
        break;
      case 'summary':
        // 经理汇总部门结果
        break;
      case 'feedback':
        // CEO 总评
        break;
    }

    // 自动推进到下一阶段
    const nextStage = getNextStage(stage);
    if (nextStage) {
      await this.runStage(workflowId, nextStage);
    }
  }
}
```

### 3.2 评审机制（20 分制）

```typescript
// server/core/reviewer.ts
interface ReviewScore {
  accuracy: number;      // 0-5
  completeness: number;  // 0-5
  actionability: number; // 0-5
  format: number;        // 0-5
  total: number;         // 0-20
  feedback: string;      // 具体改进建议
}

class ReviewProcess {
  async review(managerId: string, task: Task): Promise<ReviewScore> {
    const score = await this.managerAgent.invoke(
      `评审以下交付物。按四个维度评分（每项0-5分）：\n` +
      `准确性：事实正确性、引用来源\n` +
      `完整性：所有必要部分是否齐全\n` +
      `可操作性：下一步是否清晰、可实现\n` +
      `格式：是否遵循模板、结构是否规范\n\n` +
      `任务描述：${task.description}\n` +
      `Worker 交付物：${task.deliverable}\n\n` +
      `输出 JSON 格式评分和反馈。`
    );
    return parseReviewScore(score);
  }

  // 评分 ≥16 通过，10-15 退回修订，<10 拒绝
  getVerdict(score: ReviewScore): 'pass' | 'revise' | 'reject' {
    if (score.total >= 16) return 'pass';
    if (score.total >= 10) return 'revise';
    return 'reject';
  }
}
```

### 3.3 前端：工作流进度面板

新增一个可展开的工作流面板，显示：

```
📊 工作流进度
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[✅ 方向] → [✅ 规划] → [🔵 执行] → [⬜ 评审] → [⬜ 修订] → [⬜ 汇总] → [⬜ 反馈]

游戏部 (Pixel)
  ├─ Blaze: 🔵 执行中... "设计春节活动方案"
  ├─ Lyra:  🔵 执行中... "策划玩家参与机制"
  └─ Nova:  ✅ 已提交 v1

AI 部 (Nexus)
  ├─ Tensor: 🔵 执行中...
  └─ Quark:  🟡 等待任务...
```

3D 场景中，正在"执行"的宠物动画加速，"等待"的宠物 idle。

### 3.4 交付物

- [x] 十阶段工作流管道可完整运行
- [x] 20 分制评审打分功能正常
- [x] 评分 <16 触发自动修订
- [x] 前端工作流进度可视化
- [x] 所有中间消息记录到数据库

---

## Phase 4：工作流管道 V3（预计 3-4 天）

**目标：在 V2 基础上新增三个阶段，完成十阶段管道。**

### 4.1 新增阶段

```
V2:  方向 → 规划 → 执行 → 评审       → 修订 → 汇总 → 反馈
V3:  方向 → 规划 → 执行 → 评审 → [元审计] → 修订 → [验证] → 汇总 → 反馈 → [进化]
                                  ↑ 新增      ↑ 新增                  ↑ 新增
```

### 4.2 元审计阶段（阶段 5）

经理评审完成后，Warden 和 Prism 两个元部门智能体对 Worker 产出做独立审计：

```typescript
async metaAudit(workflowId: string, tasks: Task[]): Promise<AuditResult[]> {
  // Warden: SOUL.md 合规检查 — Worker 输出是否符合其角色定义
  const wardenAudit = await this.warden.invoke(
    `检查以下交付物是否符合 Worker 的 SOUL.md 规范：\n${taskSummary}`
  );

  // Prism: 质量分析 — 是否存在 AI 套话、结构问题
  const prismAudit = await this.prism.invoke(
    `分析以下交付物的质量问题，检查是否存在 AI 套话、内容空洞等问题：\n${taskSummary}`
  );

  return [wardenAudit, prismAudit];
}
```

### 4.3 验证阶段（阶段 7）

经理逐条确认修订是否回应了全部反馈点：

```typescript
async verify(task: Task): Promise<VerifyResult> {
  // 经理收到：原始反馈点列表 + 修订后的 v2
  // 逐条确认是否回应，>30% 未回应则要求 v3
  const result = await this.manager.invoke(
    `原始反馈：\n${task.feedback}\n\n` +
    `修订后交付物：\n${task.deliverable_v2}\n\n` +
    `逐条确认每个反馈点是否被回应。输出 JSON。`
  );
  return parseVerifyResult(result);
}
```

### 4.4 进化阶段（阶段 10）

纯脚本，不调用 LLM：

```typescript
async evolve(workflowId: string): Promise<void> {
  // 1. 从数据库提取本轮所有评分
  const scores = await db.getScoresForWorkflow(workflowId);

  // 2. 识别弱维度（<3/5）
  for (const agentScores of groupByAgent(scores)) {
    const weakDimensions = findWeakDimensions(agentScores);

    // 3. 生成 SOUL.md 补丁
    if (weakDimensions.length > 0) {
      const patch = generatePatch(agentScores.agentId, weakDimensions);
      await db.saveEvolutionLog(agentScores.agentId, patch);

      // 4. 自动应用到 SOUL.md
      await applyPatch(agentScores.agentId, patch);
    }
  }
}
```

### 4.5 交付物

- [x] 十阶段 V3 管道完整运行
- [x] 元审计（Warden + Prism）独立于经理评审
- [x] 验证阶段逐条确认反馈回应
- [x] 进化阶段自动生成并应用 SOUL.md 补丁 (框架已就绪)

---

## Phase 5：记忆系统完善（预计 2-3 天）

**目标：实现三级记忆架构。**

### 5.1 短期记忆

当前会话的完整消息历史，直接作为 LLM 上下文传入。

### 5.2 中期记忆

使用向量嵌入存储历史会话，按语义相似度检索：

```typescript
// 可选方案（按复杂度递增）：
// A. 简单方案：MySQL FULLTEXT 全文搜索索引（InnoDB 原生支持）
// B. 中等方案：本地向量库（如 vectra，纯 JS 实现）
// C. 完整方案：外部向量数据库（如 Chroma）

class MidTermMemory {
  async search(agentId: string, query: string, topK: number = 5): Promise<MemoryChunk[]>;
  async store(agentId: string, content: string, metadata: any): Promise<void>;
}
```

建议从方案 A 开始（零依赖），后续按需升级。

### 5.3 长期记忆

目标态是 SOUL.md 文件本身。每次智能体调用时完整读入。进化阶段自动追加 `## Learned Behaviors` 章节。

当前代码状态（2026-03-26）：
- 已实现 persona 长期记忆，但当前落在数据库 `soul_md` 字段
- `evolution` 阶段已能自动给 `soul_md` 追加 learned behaviors
- 文件版 `SOUL.md` 已落地，并与数据库 `soul_md` 保持同步

### 5.4 交付物

- [x] 短期记忆：最近会话上下文注入已实现
- [x] 短期记忆：当前工作流内的完整上下文
- [x] 中期记忆：历史工作流可检索摘要（当前为摘要 + 关键词检索）
- [x] 中期记忆：向量检索 / embedding 召回
- [x] 长期记忆：persona / `soul_md` 自动更新
- [x] 长期记忆：文件版 `SOUL.md` 自动更新
- [x] 记忆严格隔离：每个智能体只能访问自己的记忆

### 5.5 实施备注（`phase-5-memory`）

目标：完整上下文、向量检索、`SOUL.md` 文件化、记忆隔离。

主写文件：
- `server/memory/session-store.ts`
- `server/core/agent.ts`
- `server/routes/agents.ts`

可新增文件：
- `server/memory/vector-store.ts`
- `server/memory/soul-store.ts`

冲突高风险：
- `server/core/agent.ts` 会与 Phase 1 hardening 的 workspace / 访问接口收敛产生明显重叠，合并时需要特别注意

建议：
- 已先行执行 `phase-5-memory`；后续如与 Phase 1 hardening 冲突，再按接口收敛结果解决

---

## Phase 6：前端深度集成（预计 4-5 天）

**目标：3D 场景从"装饰"变成"实时监控仪表盘"。**

### 6.1 智能体数量扩展

从 5 只宠物扩展到论文的 18 个智能体。3D 场景布局重新设计：

```
布局方案：四个部门区域
┌──────────────────────────────────┐
│            CEO 桌 (顶部中央)       │
│                                    │
│  ┌─────────┐  ┌─────────┐        │
│  │ 游戏部   │  │  AI 部   │        │
│  │ Pixel    │  │ Nexus    │        │
│  │ 4 Worker │  │ 4 Worker │        │
│  └─────────┘  └─────────┘        │
│                                    │
│  ┌─────────┐  ┌─────────┐        │
│  │ 生活部   │  │ 元部门   │        │
│  │ Echo     │  │ Warden   │        │
│  │ 2 Worker │  │ 3 Worker │        │
│  └─────────┘  └─────────┘        │
└──────────────────────────────────┘
```

### 6.2 实时动画映射

| 工作流阶段 | 3D 场景表现 |
|-----------|-----------|
| 方向下发 | CEO 宠物头顶出现💬，光线射向各经理 |
| 规划 | 经理宠物面前出现📋规划板动画 |
| 执行 | Worker 快速打字/翻书/讨论动画 |
| 评审 | 经理走向 Worker，头顶出现评分数字 |
| 元审计 | 元部门宠物亮起🔍扫描光线 |
| 修订 | 被退回的 Worker 头顶出现⚠️，加速工作 |
| 汇总 | 经理向 CEO 方向走动，递交📊 |
| 进化 | 场景全体宠物短暂发光✨ |

### 6.3 消息流可视化

智能体间发送消息时，3D 场景中显示飘动的消息气泡，沿层级路径移动（CEO → 经理 → Worker 的粒子流）。

### 6.4 仪表盘面板

替换现有的简单聊天面板，新增多个可切换的视图：

- **指令视图**：输入战略指令，查看 CEO 分解结果
- **组织视图**：实时组织结构图（树状），显示每个节点的状态
- **工作流视图**：十阶段进度条 + 每个阶段的详情
- **评审视图**：所有 Worker 的评分卡片，四维度雷达图
- **历史视图**：过往工作流列表，可回放

### 6.5 交付物

- [x] 18 个智能体在 3D 场景中布局
- [x] 工作流阶段与宠物动画实时联动
- [x] 消息流粒子动画
- [x] 仪表盘多视图面板 (指令、组织、进度、评审、历史、记忆)

---

## Phase 7：心跳与自主行为（预计 2 天）

**目标：智能体能在无人触发时自主工作。**

### 7.1 心跳调度器

```typescript
// server/core/heartbeat.ts
class HeartbeatScheduler {
  // 每 6 小时触发一次（可配置）
  async tick(agentId: string): Promise<void> {
    const config = await this.loadHeartbeatConfig(agentId);

    // 1. 执行网络搜索（模拟，或调用搜索 API）
    const searchResults = await this.search(config.keywords);

    // 2. 让智能体总结搜索结果
    const report = await agent.invoke(
      `基于以下搜索结果，撰写简要趋势报告：\n${searchResults}`
    );

    // 3. 保存到工作空间
    await agent.workspace.saveReport(report);
  }
}
```

### 7.2 前端：自主活动指示

宠物定期自动执行搜索和报告时，头顶显示 🔍 图标和搜索关键词。

### 7.3 交付物

- [ ] 心跳调度器按配置间隔触发
- [ ] 智能体自主生成趋势报告
- [ ] 报告保存到各自工作空间

---

## Phase 8：自进化子系统（预计 3 天）

**目标：实现论文 M7 的三个并行学习闭环。**

### 8.1 绩效反馈闭环（M7-1）

```typescript
// 从评审评分中识别弱维度 → 生成 SOUL.md 补丁
async analyzePerformance(agentId: string): Promise<Patch | null> {
  const recentScores = await db.getRecentScores(agentId, 5);
  const weakDimensions = recentScores
    .flatMap(s => [
      { dim: 'accuracy', score: s.accuracy },
      { dim: 'completeness', score: s.completeness },
      { dim: 'actionability', score: s.actionability },
      { dim: 'format', score: s.format },
    ])
    .filter(d => d.score < 3);

  if (weakDimensions.length === 0) return null;

  return generateSOULPatch(agentId, weakDimensions);
}
```

### 8.2 关键词学习（M7-2）

跟踪高分/低分交付物中的关键词，更新 HEARTBEAT.md。

### 8.3 能力注册（M7-3）

从执行日志中提取已展示的能力，维护动态注册表。

### 8.4 交付物

- [x] 绩效反馈 → `soul_md` 补丁自动生成（当前落在数据库字段，尚非文件版 `SOUL.md`）
- [ ] 关键词分析 → HEARTBEAT.md 优化
- [ ] 能力注册表维护

---

## 里程碑总结

| Phase | 里程碑 | 预计工期 | 论文对应 |
|-------|--------|---------|---------|
| 0 | 后端基础设施 | 2-3 天 | 基础 |
| 1 | 18 个独立智能体 | 3-4 天 | 原则 2,3：独立记忆 |
| 2 | CEO 网关 + 层级委派 | 3-4 天 | 原则 1：层级委派 |
| 3 | V2 七阶段管道 | 4-5 天 | 原则 8：工作流映射 |
| 4 | V3 十阶段管道 | 3-4 天 | 原则 4,6：元部门+自进化 |
| 5 | 三级记忆系统 | 2-3 天 | 原则 3：分层压缩 |
| 6 | 前端深度集成 | 4-5 天 | 可视化 |
| 7 | 心跳自主行为 | 2 天 | 心跳机制 |
| 8 | 自进化子系统 | 3 天 | 原则 6：自进化 |
| **总计** | | **~26-35 天** | |

## 优先级建议

如果时间有限，**Phase 0→1→2→3 是最小可行产品（MVP）**，大约 12-16 天可以实现：

> 用户输入一条指令 → CEO 分解 → 经理规划 → Worker 执行 → 经理评审 → 修订 → 汇总

这已经能展示论文 80% 的核心主张（意图放大、层级委派、独立记忆、评审机制）。

Phase 4-8 是锦上添花：元审计、进化、心跳。这些在论文中也被标记为"初步验证"的能力，生产系统中可以后续迭代。

## 风险与注意事项

1. **LLM 调用成本**：十阶段管道每次运行需要 13-39 次 API 调用。开发阶段建议用便宜的模型（如 GPT-4o-mini），并缓存重复调用。

2. **响应时间**：完整十阶段管道可能需要 5-30 分钟。前端必须做好异步 + 实时进度推送，不能让用户干等。

3. **错误处理**：LLM 输出不可控，每次 `invoke()` 都要做 JSON 解析容错。建议定义 fallback 策略（重试 3 次、降级为简单文本输出）。

4. **Prompt Engineering**：系统质量 80% 取决于 SOUL.md 和各阶段的 system prompt 质量。建议把 prompt 全部外置为配置文件，方便快速迭代。

5. **并发控制**：多部门并行执行时要注意 API rate limit。建议实现请求队列，控制并发数。

6. **MySQL 远程连接注意事项**：
   - 确保 MySQL 服务器 `115.191.22.18:3306` 对部署机器开放防火墙端口
   - 确保 root 账户允许远程登录（`GRANT ALL ON cube_pets_office.* TO 'root'@'%'`）
   - 生产环境建议新建专用账户，避免 root 直连
   - `MEDIUMTEXT` 字段存储智能体交付物，单条最大 16MB，足够容纳长文本产出
   - 连接池 `connectionLimit: 10` 可应对 18 个智能体并行调用（因为不是所有智能体同时活跃）
   - `.env` 文件已加入 `.gitignore`，不要提交到版本控制

7. **新增依赖**：
   ```bash
   pnpm add mysql2 dotenv
   pnpm add -D @types/node
   ```
