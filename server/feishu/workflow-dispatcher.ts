import { workflowEngine } from "../core/workflow-engine.js";

export interface FeishuTaskDispatcher {
  start(params: {
    taskId: string;
    text: string;
  }): Promise<{ workflowId?: string }>;
}

export class WorkflowFeishuTaskDispatcher implements FeishuTaskDispatcher {
  async start(params: {
    taskId: string;
    text: string;
  }): Promise<{ workflowId?: string }> {
    const workflowId = await workflowEngine.startWorkflow(params.text);
    return { workflowId };
  }
}
