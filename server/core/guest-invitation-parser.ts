/**
 * Natural Language Invitation Parser
 *
 * Parses chat messages to detect guest agent invitation intent.
 * Supports both Chinese and English invitation patterns with "@Name" syntax.
 *
 * @see Requirements 3.1
 */

export interface ParsedInvitation {
  guestName: string;
  skills: string[];
  context: string;
}

/**
 * Invitation keyword patterns (Chinese + English).
 *
 * Chinese: "邀请", "请...加入", "让...加入", "叫...来"
 * English: "invite", "bring in", "add", "call in"
 */
const INVITATION_PATTERNS: RegExp[] = [
  // Chinese patterns: "邀请 @Name ..."
  /邀请\s*@([\w-]+)/i,
  // Chinese patterns: "请 @Name 加入..."
  /请\s*@([\w-]+)\s*加入/i,
  // Chinese patterns: "让 @Name 加入..."
  /让\s*@([\w-]+)\s*加入/i,
  // Chinese patterns: "叫 @Name 来..."
  /叫\s*@([\w-]+)\s*来/i,
  // English patterns: "invite @Name ..."
  /invite\s+@([\w-]+)/i,
  // English patterns: "bring in @Name ..."
  /bring\s+in\s+@([\w-]+)/i,
  // English patterns: "add @Name ..."
  /add\s+@([\w-]+)/i,
  // English patterns: "call in @Name ..."
  /call\s+in\s+@([\w-]+)/i,
];

/**
 * Extract skill hints from the context surrounding the invitation.
 * Looks for phrases like "帮忙分析", "help with analysis", "to do X", etc.
 */
function extractSkills(message: string, guestName: string): string[] {
  const skills: string[] = [];

  // Remove the @Name part for context analysis
  const contextText = message.replace(new RegExp(`@${guestName}`, "gi"), "").trim();

  // Chinese skill patterns
  const cnSkillPatterns = [
    /(?:帮忙|协助|一起|帮助)\s*(.{2,20})/,
    /(?:分析|设计|开发|测试|研究|编写|优化|审查|评审)(.{0,15})/,
  ];

  // English skill patterns
  const enSkillPatterns = [
    /(?:help\s+(?:with\s+)?|assist\s+(?:with\s+)?)(.{2,40})/i,
    /(?:to\s+)(?:help\s+)?(.{2,40})/i,
  ];

  for (const pattern of [...cnSkillPatterns, ...enSkillPatterns]) {
    const match = contextText.match(pattern);
    if (match?.[1]) {
      const skill = match[1].trim().replace(/[。，.!！?？]+$/, "");
      if (skill.length > 0) {
        skills.push(skill);
      }
    }
  }

  return skills;
}

/**
 * Parse a message for guest agent invitation intent.
 *
 * Returns a ParsedInvitation if the message contains an "@Name" pattern
 * combined with an invitation keyword. Returns null otherwise.
 *
 * @see Requirements 3.1
 */
export function parseInvitation(message: string): ParsedInvitation | null {
  if (!message || typeof message !== "string") {
    return null;
  }

  for (const pattern of INVITATION_PATTERNS) {
    const match = message.match(pattern);
    if (match?.[1]) {
      const guestName = match[1];
      const skills = extractSkills(message, guestName);

      return {
        guestName,
        skills,
        context: message,
      };
    }
  }

  return null;
}
