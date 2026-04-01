/**
 * DemoStoreAdapter — Store 写入适配器
 *
 * 将 DemoTimelineEntry 的 AgentEvent 分发到 RuntimeEventBus，
 * 并管理 Demo Mission 的生命周期（创建 / 清理）。
 *
 * @Requirements 4.1, 4.2, 4.3, 4.4, 4.5
 */

import type { DemoDataBundle, DemoTimelineEntry } from "@shared/demo/contracts";
import type { RuntimeEvent } from "../../lib/runtime/types";
import { runtimeEventBus } from "../../lib/runtime/local-event-bus";
import { useTasksStore } from "../../lib/tasks-store";
import { useDemoStore } from "../../lib/demo-store";
import type { DemoMemoryEntry, DemoEvolutionLog } from "../../lib/demo-store";

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class DemoStoreAdapter {
  private demoTaskId: string | null = null;
  private previousTaskId: string | null = null;

  constructor(private readonly bundle: DemoDataBundle) {}

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * 初始化 Demo Mission：
   * 1. 记录当前 selectedTaskId 以便退出时恢复
   * 2. 通过 tasks-store.createMission 创建 kind="demo" 的 MissionRecord
   * 3. 将 demo mission 设置为当前选中任务
   * 4. 激活 demo-store
   */
  async initializeDemoMission(): Promise<void> {
    const tasksStore = useTasksStore.getState();
    this.previousTaskId = tasksStore.selectedTaskId;

    try {
      const taskId = await tasksStore.createMission({
        title: this.bundle.meta.title,
        sourceText: this.bundle.meta.description,
        kind: "demo",
      });

      this.demoTaskId = taskId;

      if (taskId) {
        useTasksStore.getState().selectTask(taskId);
      }

      useDemoStore.getState().activate();
    } catch (err) {
      console.error("[DemoStoreAdapter] Failed to create demo mission:", err);
      throw err;
    }
  }

  /**
   * 处理单个时间线事件，分发到对应 Store。
   * AgentEvent 通过 RuntimeEventBus 分发，驱动 workflow-store → UI 更新。
   */
  handleEvent(entry: DemoTimelineEntry): void {
    // AgentEvent 与 RuntimeEvent 结构兼容，直接分发
    try {
      runtimeEventBus.emit(entry.event as unknown as RuntimeEvent);
    } catch (err) {
      // 非致命错误：记录日志，继续处理后续事件
      console.warn("[DemoStoreAdapter] Event dispatch error:", err);
    }

    // 更新 demo-store 的当前阶段
    if (entry.event.type === "stage_change") {
      useDemoStore.getState().setCurrentStage(entry.event.stage);
    }
  }

  /**
   * 追加记忆条目到 demo-store
   */
  appendMemoryEntry(entry: DemoMemoryEntry): void {
    useDemoStore.getState().appendMemoryEntry(entry);
  }

  /**
   * 设置进化日志到 demo-store
   */
  setEvolutionLogs(logs: DemoEvolutionLog[]): void {
    useDemoStore.getState().setEvolutionLogs(logs);
  }

  /**
   * 清理所有演示数据，恢复 Store 状态。
   * 1. 移除 demo mission
   * 2. 恢复 selectedTaskId
   * 3. 重置 demo-store
   */
  cleanup(): void {
    try {
      // Restore previous task selection
      if (this.previousTaskId !== null) {
        useTasksStore.getState().selectTask(this.previousTaskId);
      }

      // Remove demo task from the task list if it exists
      if (this.demoTaskId) {
        const state = useTasksStore.getState();
        if (state.selectedTaskId === this.demoTaskId) {
          state.selectTask(this.previousTaskId);
        }
      }
    } catch (err) {
      console.warn("[DemoStoreAdapter] Cleanup error:", err);
    }

    // Reset demo-specific state
    useDemoStore.getState().reset();

    this.demoTaskId = null;
    this.previousTaskId = null;
  }
}
