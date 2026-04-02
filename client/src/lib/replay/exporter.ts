import type {
  ExecutionEvent,
  ExecutionTimeline,
  PerformanceMetrics,
  CostSummary,
} from '../../../../shared/replay/contracts';

/* ─── Report Types ─── */

export type ReportSection =
  | 'summary'
  | 'events'
  | 'performance'
  | 'cost'
  | 'anomalies';

export interface ReportOptions {
  title?: string;
  sections: ReportSection[];
  performanceMetrics?: PerformanceMetrics;
  costSummary?: CostSummary;
}

export interface ReportData {
  title: string;
  missionId: string;
  generatedAt: number;
  sections: ReportSection[];
  content: Partial<Record<ReportSection, string>>;
}

/* ─── CSV Helpers ─── */

const CSV_HEADERS = [
  'eventId',
  'timestamp',
  'eventType',
  'sourceAgent',
  'targetAgent',
] as const;

function escapeCsvField(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function eventToCsvRow(event: ExecutionEvent): string {
  return [
    event.eventId,
    String(event.timestamp),
    event.eventType,
    event.sourceAgent,
    event.targetAgent ?? '',
  ]
    .map(escapeCsvField)
    .join(',');
}

/* ─── Report Content Builders ─── */

function buildSummarySection(timeline: ExecutionTimeline): string {
  const agents = new Set<string>();
  const types = new Set<string>();
  for (const e of timeline.events) {
    agents.add(e.sourceAgent);
    if (e.targetAgent) agents.add(e.targetAgent);
    types.add(e.eventType);
  }
  return [
    `Mission: ${timeline.missionId}`,
    `Duration: ${timeline.totalDuration}ms`,
    `Events: ${timeline.eventCount}`,
    `Agents: ${agents.size}`,
    `Event Types: ${Array.from(types).join(', ')}`,
    `Time Range: ${new Date(timeline.startTime).toISOString()} — ${new Date(timeline.endTime).toISOString()}`,
  ].join('\n');
}

function buildEventsSection(events: ExecutionEvent[]): string {
  return events
    .slice(0, 50) // cap for readability
    .map(
      (e) =>
        `[${new Date(e.timestamp).toISOString()}] ${e.eventType} | ${e.sourceAgent}${e.targetAgent ? ` → ${e.targetAgent}` : ''}`,
    )
    .join('\n');
}

function buildPerformanceSection(metrics?: PerformanceMetrics): string {
  if (!metrics) return 'No performance data available.';
  const lines = [
    `Total Duration: ${metrics.totalDuration}ms`,
    `LLM Calls: ${metrics.llmMetrics.callCount}`,
    `Avg LLM Response: ${metrics.llmMetrics.avgResponseTime.toFixed(1)}ms`,
    `Total Tokens: ${metrics.llmMetrics.totalTokens}`,
    `Max Concurrent Agents: ${metrics.concurrency.maxConcurrentAgents}`,
  ];
  if (metrics.stageMetrics.length > 0) {
    lines.push('Stages:');
    for (const s of metrics.stageMetrics) {
      lines.push(
        `  ${s.stageKey}: ${s.duration}ms${s.isBottleneck ? ' [BOTTLENECK]' : ''}`,
      );
    }
  }
  return lines.join('\n');
}

function buildCostSection(cost?: CostSummary): string {
  if (!cost) return 'No cost data available.';
  const lines = [`Total Cost: $${cost.totalCost.toFixed(4)}`];
  const agentEntries = Object.entries(cost.byAgent);
  if (agentEntries.length > 0) {
    lines.push('By Agent:');
    for (const [agent, c] of agentEntries) {
      lines.push(`  ${agent}: $${c.toFixed(4)}`);
    }
  }
  return lines.join('\n');
}

function buildAnomaliesSection(cost?: CostSummary): string {
  if (!cost || cost.anomalies.length === 0) return 'No anomalies detected.';
  return cost.anomalies
    .map((a) => `Event ${a.eventId}: $${a.cost.toFixed(4)} (threshold: $${a.threshold.toFixed(4)}) — ${a.reason}`)
    .join('\n');
}

const SECTION_BUILDERS: Record<
  ReportSection,
  (timeline: ExecutionTimeline, opts: ReportOptions) => string
> = {
  summary: (tl) => buildSummarySection(tl),
  events: (tl) => buildEventsSection(tl.events),
  performance: (_, opts) => buildPerformanceSection(opts.performanceMetrics),
  cost: (_, opts) => buildCostSection(opts.costSummary),
  anomalies: (_, opts) => buildAnomaliesSection(opts.costSummary),
};

/**
 * ReplayExporter — 回放数据导出
 *
 * 支持 JSON、CSV、交互式 HTML 导出，以及自定义章节的报告生成。
 * Requirements: 6.6, 15.1, 15.2, 15.3, 15.4, 15.5
 */
export class ReplayExporter {
  /**
   * 导出时间轴为 JSON 字符串。
   * Requirement 6.6, 15.1
   */
  exportJSON(timeline: ExecutionTimeline): string {
    // Serialize Maps to plain objects for JSON compatibility
    const serializable = {
      ...timeline,
      indices: {
        byTime: Object.fromEntries(timeline.indices.byTime),
        byAgent: Object.fromEntries(timeline.indices.byAgent),
        byType: Object.fromEntries(timeline.indices.byType),
        byResource: Object.fromEntries(timeline.indices.byResource),
      },
    };
    return JSON.stringify(serializable, null, 2);
  }

  /**
   * 导出事件为 CSV。
   * 列头：eventId, timestamp, eventType, sourceAgent, targetAgent
   * Requirement 6.6
   */
  exportCSV(timeline: ExecutionTimeline): string {
    const header = CSV_HEADERS.join(',');
    const rows = timeline.events.map(eventToCsvRow);
    return [header, ...rows].join('\n');
  }

  /**
   * 生成包含嵌入事件数据和基础回放控制的交互式 HTML。
   * Requirement 15.5
   */
  exportInteractiveHTML(timeline: ExecutionTimeline): string {
    const eventsJSON = JSON.stringify(timeline.events);
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Replay: ${timeline.missionId}</title>
<style>
  body{font-family:system-ui,sans-serif;margin:0;padding:16px;background:#1a1a2e;color:#e0e0e0}
  h1{font-size:1.4rem}
  #controls{margin:12px 0;display:flex;gap:8px}
  button{padding:6px 14px;border:none;border-radius:4px;background:#0f3460;color:#fff;cursor:pointer}
  button:hover{background:#16213e}
  #info{font-size:.85rem;color:#aaa;margin-bottom:8px}
  #event-detail{background:#16213e;padding:12px;border-radius:6px;white-space:pre-wrap;font-size:.82rem;max-height:60vh;overflow:auto}
</style>
</head>
<body>
<h1>Mission Replay: ${timeline.missionId}</h1>
<div id="info">Events: ${timeline.eventCount} | Duration: ${timeline.totalDuration}ms</div>
<div id="controls">
  <button onclick="prev()">⏮ Prev</button>
  <button onclick="playPause()">⏯ Play/Pause</button>
  <button onclick="next()">⏭ Next</button>
  <span id="counter" style="line-height:32px;margin-left:8px"></span>
</div>
<div id="event-detail"></div>
<script>
var DATA=${eventsJSON};
var idx=0,playing=false,timer=null;
function render(){
  document.getElementById('counter').textContent=(idx+1)+'/'+DATA.length;
  document.getElementById('event-detail').textContent=JSON.stringify(DATA[idx],null,2);
}
function next(){if(idx<DATA.length-1){idx++;render();}}
function prev(){if(idx>0){idx--;render();}}
function playPause(){
  if(playing){clearInterval(timer);playing=false;}
  else{playing=true;timer=setInterval(function(){if(idx<DATA.length-1){idx++;render();}else{clearInterval(timer);playing=false;}},500);}
}
if(DATA.length>0)render();
</script>
</body>
</html>`;
  }

  /**
   * 生成回放报告（支持自定义章节选择）。
   * Requirement 15.2, 15.3
   */
  generateReport(
    timeline: ExecutionTimeline,
    options: ReportOptions,
  ): ReportData {
    const title = options.title ?? `Replay Report: ${timeline.missionId}`;
    const content: Partial<Record<ReportSection, string>> = {};

    for (const section of options.sections) {
      const builder = SECTION_BUILDERS[section];
      if (builder) {
        content[section] = builder(timeline, options);
      }
    }

    return {
      title,
      missionId: timeline.missionId,
      generatedAt: Date.now(),
      sections: options.sections,
      content,
    };
  }

  /**
   * 导出报告为 HTML 格式。
   * Requirement 15.4
   */
  exportReportHTML(report: ReportData): string {
    const sectionHTML = report.sections
      .map((s) => {
        const body = report.content[s] ?? '';
        return `<section><h2>${s.charAt(0).toUpperCase() + s.slice(1)}</h2><pre>${body}</pre></section>`;
      })
      .join('\n');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>${report.title}</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:900px;margin:0 auto;padding:24px;background:#fff;color:#222}
  h1{border-bottom:2px solid #333;padding-bottom:8px}
  h2{color:#0f3460;margin-top:24px}
  pre{background:#f5f5f5;padding:12px;border-radius:4px;overflow-x:auto;font-size:.85rem}
  footer{margin-top:32px;font-size:.75rem;color:#999}
</style>
</head>
<body>
<h1>${report.title}</h1>
<p>Mission: ${report.missionId} | Generated: ${new Date(report.generatedAt).toISOString()}</p>
${sectionHTML}
<footer>Generated by Collaboration Replay System</footer>
</body>
</html>`;
  }

  /**
   * 导出报告为 Markdown 格式。
   * Requirement 15.4
   */
  exportReportMarkdown(report: ReportData): string {
    const lines: string[] = [
      `# ${report.title}`,
      '',
      `**Mission:** ${report.missionId}  `,
      `**Generated:** ${new Date(report.generatedAt).toISOString()}`,
      '',
    ];

    for (const section of report.sections) {
      const body = report.content[section] ?? '';
      lines.push(`## ${section.charAt(0).toUpperCase() + section.slice(1)}`, '', body, '');
    }

    lines.push('---', '*Generated by Collaboration Replay System*');
    return lines.join('\n');
  }
}
