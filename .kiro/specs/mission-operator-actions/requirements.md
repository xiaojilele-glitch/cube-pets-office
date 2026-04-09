# Mission 操作动作栏 - 需求文档

## 概述

当前任务详情页更像“执行观察面板”，而不是“任务控制台”：

- 用户可以看执行状态、日志、产物、决策
- 但缺少暂停、恢复、重试、标记阻塞、终止等标准操作动作
- 社区已经明确反馈“最基本的任务不能取消和切换状态”

在 `mission-cancel-control` 打通取消能力之后，本 spec 继续补齐操作平面，建立统一的 Mission Operator Actions 能力。目标是让 `/tasks` 第一时间具备“像在带团队执行任务”一样的控制感。

## 设计目标

1. 建立统一的操作动作模型，而不是散落多个零碎按钮
2. 支持 `pause`、`resume`、`retry`、`mark-blocked`、`terminate`
3. 用户的操作动作可审计、可回放、可在 UI 中追踪
4. 操作动作与执行状态分层表达，避免把所有语义都塞进 `MissionStatus`
5. 让任务详情页具备清晰的主操作区

## 依赖关系

- 本 spec 依赖 `mission-cancel-control`
- `terminate` 复用 cancel 基础设施

## 非目标

- 本 spec 不重新定义 Docker 执行计划本身
- 本 spec 不覆盖批量任务运营能力
- 本 spec 不做整体视觉润色，该部分放入 `mission-ui-polish`

## 用户故事与验收标准

### 1. 统一操作动作模型

#### 1.1 作为系统，我希望所有人工控制都通过统一动作模型表达，以便前后端和审计逻辑一致

- AC 1.1.1: 系统 SHALL 定义 `MissionOperatorActionType = "pause" | "resume" | "retry" | "mark-blocked" | "terminate"`
- AC 1.1.2: 系统 SHALL 定义 `MissionOperatorState = "active" | "paused" | "blocked" | "terminating"`
- AC 1.1.3: `MissionRecord` SHALL 新增 `operatorState?: MissionOperatorState`
- AC 1.1.4: 系统 SHALL 记录 `operatorActions: MissionOperatorActionRecord[]` 历史

#### 1.2 作为系统，我希望操作动作有统一的提交接口

- AC 1.2.1: 服务端 SHALL 提供 `POST /api/tasks/:id/operator-actions`
- AC 1.2.2: 请求体 SHALL 至少包含 `action`、可选 `reason`、`requestedBy`
- AC 1.2.3: 响应 SHALL 返回最新 `MissionRecord` 与已执行动作摘要

### 2. Pause / Resume

#### 2.1 作为用户，我希望暂停运行中的任务，以便在不中止整体上下文的情况下暂时冻结执行

- AC 2.1.1: 当 Mission 处于 `queued` 或 `running` 时，用户 SHALL 可以执行 `pause`
- AC 2.1.2: `pause` 成功后，Mission 的 `operatorState` SHALL 变为 `paused`
- AC 2.1.3: 当任务已进入 executor 且支持容器级暂停时，系统 SHALL 尝试暂停底层执行
- AC 2.1.4: UI SHALL 明确区分“任务正在运行”与“任务被人工暂停”

#### 2.2 作为用户，我希望恢复已暂停任务，以便继续当前执行

- AC 2.2.1: 当 Mission `operatorState = paused` 时，用户 SHALL 可以执行 `resume`
- AC 2.2.2: `resume` 成功后，`operatorState` SHALL 恢复为 `active`
- AC 2.2.3: 若底层 executor 已暂停容器，则系统 SHALL 尝试恢复容器执行
- AC 2.2.4: 重复 `resume` SHALL 幂等

### 3. Mark Blocked

#### 3.1 作为用户，我希望把任务标记为阻塞，以便让团队知道现在不是“失败”，而是“卡住了”

- AC 3.1.1: 用户 SHALL 可以对非终态 Mission 执行 `mark-blocked`
- AC 3.1.2: `mark-blocked` SHALL 强制要求填写阻塞原因
- AC 3.1.3: `mark-blocked` 成功后，Mission 的 `operatorState` SHALL 为 `blocked`
- AC 3.1.4: 任务详情页 SHALL 显示最新 blocker 文案和时间
- AC 3.1.5: 任务列表 SHALL 能直观看出该任务已被阻塞

#### 3.2 作为用户，我希望阻塞状态可被解除，以便任务继续推进

- AC 3.2.1: 当 `operatorState = blocked` 时，用户 SHALL 可以执行 `resume`
- AC 3.2.2: 恢复后 SHALL 清除当前 blocker 高亮，但保留历史记录

### 4. Retry

#### 4.1 作为用户，我希望对失败或取消的任务发起重试，以便快速重新执行

- AC 4.1.1: 当 Mission 处于 `failed`、`cancelled` 或 `operatorState = blocked` 时，用户 SHALL 可以执行 `retry`
- AC 4.1.2: 重试 SHALL 记录新的执行尝试编号 `attempt`
- AC 4.1.3: 重试成功后，Mission SHALL 回到 `queued` 或 `running`
- AC 4.1.4: 重试 SHALL 保留历史事件、历史产物和历史操作记录，不覆盖旧记录
- AC 4.1.5: 若当前 Mission 缺少重试所需的关键上下文，系统 SHALL 返回明确错误

### 5. Terminate

#### 5.1 作为用户，我希望能强制终止任务，以便处理异常占用、长时间挂死或明显错误执行

- AC 5.1.1: 当 Mission 处于任意非终态时，用户 SHALL 可以执行 `terminate`
- AC 5.1.2: `terminate` SHALL 要求明确确认，并支持填写原因
- AC 5.1.3: `terminate` SHALL 复用 `mission-cancel-control` 的底层停止能力
- AC 5.1.4: `terminate` 完成后，Mission 最终 SHALL 进入 `cancelled`
- AC 5.1.5: 操作历史中 SHALL 明确区分 `terminate` 与普通 `cancel`

### 6. 审计与时间线

#### 6.1 作为系统，我希望每个操作动作都可审计，以便后续回放与分析

- AC 6.1.1: 每次动作都 SHALL 生成 `MissionOperatorActionRecord`
- AC 6.1.2: 每条记录至少包含 `action`、`requestedBy`、`reason`、`createdAt`、`result`
- AC 6.1.3: Mission Socket 推送 SHALL 包含操作动作导致的状态更新
- AC 6.1.4: 任务详情页 SHALL 展示最近操作动作摘要

### 7. 前端操作栏

#### 7.1 作为用户，我希望在任务详情页第一时间看到当前能做什么操作

- AC 7.1.1: 任务详情页 SHALL 提供统一 `OperatorActionBar`
- AC 7.1.2: `OperatorActionBar` SHALL 根据 Mission 状态与 `operatorState` 动态显示可用按钮
- AC 7.1.3: 同时不可用的按钮 SHALL 隐藏或禁用，并附带原因提示
- AC 7.1.4: 每个动作提交中 SHALL 显示独立 loading 状态

#### 7.2 作为用户，我希望操作动作有清晰文案和风险提示

- AC 7.2.1: `pause`、`resume`、`retry` 使用中性操作文案
- AC 7.2.2: `mark-blocked` 需要说明“不会结束任务，只是人工标记阻塞”
- AC 7.2.3: `terminate` 使用风险色与确认文案

## 约束与风险

- `pause/resume` 若做到底层 Docker 容器级控制，需要补 executor 协议与运行时支持
- `retry` 需要明确“同一 Mission 新尝试”与“新建 Mission”之间的产品语义，本 spec 采用“同一 Mission 内增加 attempt”
- `operatorState` 与 `status` 双轨表达会影响前端筛选和标签展示，需要统一 helper 层
