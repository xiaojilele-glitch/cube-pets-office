import type { AppLocale } from "@/lib/locale";
import type { LineageNodeType } from "@shared/lineage/contracts.js";

function t(locale: AppLocale, zh: string, en: string) {
  return locale === "zh-CN" ? zh : en;
}

export type LineageViewTab = "dag" | "timeline" | "heatmap";

export function getLineageTabs(locale: AppLocale) {
  return [
    {
      key: "dag" as const,
      label: "DAG",
      description: t(
        locale,
        "查看上下游依赖关系",
        "Explore upstream and downstream dependencies"
      ),
    },
    {
      key: "timeline" as const,
      label: t(locale, "时间线", "Timeline"),
      description: t(
        locale,
        "按执行顺序追踪事件",
        "Follow events in execution order"
      ),
    },
    {
      key: "heatmap" as const,
      label: t(locale, "热力图", "Heatmap"),
      description: t(
        locale,
        "定位高密度来源和活跃 Agent",
        "Spot dense sources and active agents"
      ),
    },
  ];
}

export function getLineageNodeTypeOptions(locale: AppLocale): Array<{
  value: LineageNodeType | "";
  label: string;
}> {
  return [
    { value: "", label: t(locale, "全部类型", "All Types") },
    { value: "source", label: t(locale, "来源", "Source") },
    { value: "transformation", label: t(locale, "转换", "Transformation") },
    { value: "decision", label: t(locale, "决策", "Decision") },
  ];
}

export function getLineageCopy(locale: AppLocale) {
  return {
    page: {
      eyebrow: t(locale, "更多 / 治理", "More / Governance"),
      title: t(locale, "数据血缘", "Data Lineage"),
      description: t(
        locale,
        "把血缘图、执行轨迹和节点上下文统一到工作台语言里，同时保留治理与排障需要的工具感。",
        "Bring the lineage graph, execution trace, and node context into the same warm workspace language as the rest of the product, without losing the tooling feel."
      ),
      reload: t(locale, "重新加载", "Reload"),
      retry: t(locale, "重试", "Retry"),
      agentIdPlaceholder: t(locale, "按 Agent ID 过滤", "Agent ID"),
      searchPlaceholder: t(locale, "搜索节点或来源", "Search node or source"),
      refreshingStatus: t(locale, "正在刷新血缘图", "Refreshing graph"),
      fallbackStatus: t(locale, "当前为降级视图", "Fallback state"),
      readyStatus: t(locale, "近期血缘已就绪", "Recent lineage ready"),
      filteredView: t(locale, "已按条件筛选", "Filtered view"),
      refreshFailed: t(locale, "血缘刷新失败", "Lineage refresh failed"),
      loadingTitle: t(locale, "正在加载血缘图", "Loading lineage graph"),
      loadingDescription: t(
        locale,
        "正在拉取最近的血缘节点，用于渲染图谱、时间线和热力图。",
        "Fetching recent lineage nodes so the graph, timeline, and heatmap can render a meaningful view."
      ),
      loadingHint: t(
        locale,
        "如果后端刚启动，这里可能需要稍等一下。",
        "If the backend is still starting up, this can take a moment."
      ),
      previewModeTitle: t(
        locale,
        "血缘当前处于预览模式",
        "Lineage is running in preview mode"
      ),
      serviceUnavailableTitle: t(
        locale,
        "血缘服务暂不可用",
        "Lineage service is unavailable"
      ),
      requestFailedTitle: t(locale, "血缘请求失败", "Lineage request failed"),
      previewModeDescription: t(
        locale,
        "前端收到的是回退页面而不是实时血缘 JSON，所以当前停留在安全预览态。",
        "The frontend received a fallback page instead of live lineage JSON, so the page stayed in a safe preview state."
      ),
      serviceUnavailableDescription: t(
        locale,
        "暂时无法连接后端，因此血缘图还不能加载。",
        "The backend could not be reached, so the lineage graph cannot load yet."
      ),
      requestFailedDescription: t(
        locale,
        "血缘 API 返回了异常结果，界面里已隐藏底层解析错误。",
        "The lineage API returned an unexpected result, and the raw parser error was hidden from the UI."
      ),
      emptyTitle: t(locale, "没有匹配的血缘节点", "No lineage nodes matched"),
      emptyFilteredDescription: t(
        locale,
        "当前筛选条件没有匹配到最近的血缘节点。",
        "The current filters did not match any recent lineage node."
      ),
      emptyDefaultDescription: t(
        locale,
        "最近还没有记录任何血缘节点，所以图谱暂时为空。",
        "No recent lineage node has been recorded yet, so the graph is still empty."
      ),
      emptyFilteredHint: t(
        locale,
        "清空或放宽筛选条件后，再重新加载更大的图谱范围。",
        "Clear or relax the filters, then retry to load a broader graph."
      ),
      emptyDefaultHint: t(
        locale,
        "先通过后端运行一次工作流或导入数据，再回来查看生成的血缘链路。",
        "Run a workflow or ingest data through the backend, then come back to explore the resulting lineage."
      ),
      viewSuffix: t(locale, "视图", "View"),
      nodesCount: (count: number) =>
        t(locale, `${count} 个节点`, `${count} nodes`),
    },
    detail: {
      noSelection: t(
        locale,
        "选择一个节点后，可在这里查看它的血缘上下文。",
        "Select a node to inspect its lineage context."
      ),
      closeDetails: t(locale, "关闭详情", "Close details"),
      sections: {
        general: t(locale, "概览", "General"),
        context: t(locale, "上下文", "Context"),
        source: t(locale, "来源", "Source"),
        transformation: t(locale, "转换", "Transformation"),
        decision: t(locale, "决策", "Decision"),
        links: t(locale, "关联关系", "Links"),
        metadata: t(locale, "元数据", "Metadata"),
      },
      fields: {
        type: t(locale, "类型", "Type"),
        timestamp: t(locale, "时间", "Timestamp"),
        complianceTags: t(locale, "合规标签", "Compliance Tags"),
        sessionId: t(locale, "会话 ID", "Session ID"),
        userId: t(locale, "用户 ID", "User ID"),
        requestId: t(locale, "请求 ID", "Request ID"),
        environment: t(locale, "环境", "Environment"),
        missionId: t(locale, "任务 ID", "Mission ID"),
        workflowId: t(locale, "工作流 ID", "Workflow ID"),
        sourceId: t(locale, "来源 ID", "Source ID"),
        sourceName: t(locale, "来源名称", "Source Name"),
        query: t(locale, "查询", "Query"),
        resultHash: t(locale, "结果哈希", "Result Hash"),
        resultSize: t(locale, "结果大小", "Result Size"),
        agentId: t(locale, "Agent ID", "Agent ID"),
        operation: t(locale, "操作", "Operation"),
        codeLocation: t(locale, "代码位置", "Code Location"),
        dataChanged: t(locale, "数据是否变更", "Data Changed"),
        executionTime: t(locale, "执行耗时", "Execution Time"),
        parameters: t(locale, "参数", "Parameters"),
        decisionId: t(locale, "决策 ID", "Decision ID"),
        logic: t(locale, "决策逻辑", "Logic"),
        result: t(locale, "结果", "Result"),
        confidence: t(locale, "置信度", "Confidence"),
        modelVersion: t(locale, "模型版本", "Model Version"),
        upstream: t(locale, "上游", "Upstream"),
        downstream: t(locale, "下游", "Downstream"),
        inputLineageIds: t(locale, "输入血缘 ID", "Input Lineage IDs"),
        outputLineageId: t(locale, "输出血缘 ID", "Output Lineage ID"),
      },
    },
    timeline: {
      empty: t(locale, "还没有时间线数据。", "No timeline data yet."),
    },
    heatmap: {
      empty: t(locale, "还没有热力图数据。", "No heatmap data yet."),
      rowLabel: t(locale, "Agent / 来源", "Agent / Source"),
      low: t(locale, "低", "Low"),
      high: t(locale, "高", "High"),
      unknownLabel: t(locale, "未知", "unknown"),
      cellTooltip: (rowLabel: string, timeLabel: string, count: number) =>
        t(
          locale,
          `${rowLabel} - ${timeLabel}：${count}`,
          `${rowLabel} - ${timeLabel}: ${count}`
        ),
    },
    export: {
      button: t(locale, "导出", "Export"),
      exportPng: t(locale, "导出 PNG", "Export PNG"),
      exportSvg: t(locale, "导出 SVG", "Export SVG"),
      canvas: t(locale, "画布", "Canvas"),
      vector: t(locale, "矢量", "Vector"),
    },
    dag: {
      empty: t(
        locale,
        "还没有可展示的血缘数据。",
        "No lineage data to display yet."
      ),
    },
  };
}

export function formatLineageTimestamp(timestamp: number, locale: AppLocale) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(timestamp));
}

export function formatLineageClock(timestamp: number, locale: AppLocale) {
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(timestamp));
}

export function formatLineageBoolean(value: boolean, locale: AppLocale) {
  return value ? t(locale, "是", "Yes") : t(locale, "否", "No");
}

export function formatLineageSize(value: number, locale: AppLocale) {
  return locale === "zh-CN" ? `${value} 字节` : `${value} bytes`;
}

export function formatLineageDuration(value: number, locale: AppLocale) {
  return locale === "zh-CN" ? `${value} 毫秒` : `${value} ms`;
}
