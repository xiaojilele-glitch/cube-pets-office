import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import { ReputationHistory } from "@/components/reputation/ReputationHistory";
import { useReputationStore } from "@/lib/reputation-store";

describe("ReputationHistory", () => {
  beforeEach(() => {
    useReputationStore.setState({
      profiles: {},
      events: {},
      leaderboard: [],
      loadingByAgent: {},
      loadedByAgent: {},
      errorsByAgent: {},
      loadingLeaderboard: false,
      leaderboardError: null,
    });
  });

  it("renders an explanatory empty state when no reputation events exist", () => {
    useReputationStore.setState({
      loadedByAgent: { "agent-1": true },
      events: { "agent-1": [] },
    });

    const markup = renderToStaticMarkup(
      <ReputationHistory agentId="agent-1" />
    );
    expect(markup).toContain("还没有信誉变化记录");
    expect(markup).toContain("趋势图和变更列表会先保持为空");
  });
});
