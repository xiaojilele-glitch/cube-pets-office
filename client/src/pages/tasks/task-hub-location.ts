export function resolveTaskHubLocationUpdate(params: {
  missionId: string | null;
  currentSearch: string;
  filteredTaskIds: string[];
  allTaskIds: string[];
}): {
  nextSearch: string;
  focusTaskId: string | null;
  highlightTaskId: string | null;
} {
  const { missionId, currentSearch, filteredTaskIds, allTaskIds } = params;

  if (!missionId || !allTaskIds.includes(missionId)) {
    return {
      nextSearch: currentSearch,
      focusTaskId: null,
      highlightTaskId: null,
    };
  }

  return {
    nextSearch: filteredTaskIds.includes(missionId) ? currentSearch : "",
    focusTaskId: missionId,
    highlightTaskId: missionId,
  };
}
