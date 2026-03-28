export interface FeishuMissionTopicInput {
  chatId: string;
  threadId?: string;
  rootMessageId?: string;
  requestId?: string;
}

function normalizeTopicKey(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function computeFeishuMissionTopicId(
  input: FeishuMissionTopicInput
): string {
  const chatId = normalizeTopicKey(input.chatId) ?? "unknown-chat";
  const threadKey =
    normalizeTopicKey(input.threadId) ??
    normalizeTopicKey(input.rootMessageId) ??
    normalizeTopicKey(input.requestId) ??
    "unknown-thread";

  return `topic:feishu:${chatId}:${threadKey}`;
}
