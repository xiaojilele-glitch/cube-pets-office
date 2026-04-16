import { Router } from "express";

import { getAIConfig } from "../core/ai-config.js";
import { callLLM } from "../core/llm-client.js";

const router = Router();

router.post("/", async (req, res) => {
  const rawMessages = req.body?.messages;
  const messages = Array.isArray(rawMessages)
    ? rawMessages
        .filter(
          message =>
            message &&
            typeof message === "object" &&
            ["system", "user", "assistant"].includes(message.role) &&
            typeof message.content === "string"
        )
        .map(message => ({
          role: message.role as "system" | "user" | "assistant",
          content: message.content,
        }))
    : [];

  if (messages.length === 0) {
    return res.status(400).json({ error: "messages is required" });
  }

  const temperature = Math.max(
    0,
    Math.min(2, Number(req.body?.temperature) || 0.7)
  );
  const maxTokens = Math.max(
    64,
    Math.min(4000, Number(req.body?.maxTokens) || 400)
  );

  try {
    const config = getAIConfig();
    const response = await callLLM(messages, {
      model: config.model,
      temperature,
      maxTokens,
    });

    res.json({
      content: response.content,
      usage: response.usage,
      model: config.model,
    });
  } catch (error: any) {
    res.status(500).json({ error: error?.message || "Chat request failed." });
  }
});

export default router;
