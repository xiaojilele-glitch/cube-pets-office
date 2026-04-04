/**
 * AI Task Presets — predefined parameter configurations for different AI task types.
 *
 * Each preset defines temperature, maxTokens, jsonMode, and supportsImageInput
 * for a specific AI task category. Unknown task types fall back to text-generation.
 */

export interface AITaskPreset {
  temperature: number;
  maxTokens: number;
  jsonMode: boolean;
  supportsImageInput: boolean;
}

export const AI_TASK_PRESETS: Record<string, AITaskPreset> = {
  "text-generation": {
    temperature: 0.7,
    maxTokens: 2048,
    jsonMode: false,
    supportsImageInput: false,
  },
  "code-generation": {
    temperature: 0.2,
    maxTokens: 4096,
    jsonMode: false,
    supportsImageInput: false,
  },
  "data-analysis": {
    temperature: 0.1,
    maxTokens: 4096,
    jsonMode: true,
    supportsImageInput: false,
  },
  "image-understanding": {
    temperature: 0.5,
    maxTokens: 2048,
    jsonMode: false,
    supportsImageInput: true,
  },
};

const DEFAULT_PRESET = "text-generation";

/**
 * Get the AI task preset for a given task type.
 * Returns the matching preset, or falls back to text-generation for unknown types.
 */
export function getAITaskPreset(taskType: string): AITaskPreset {
  if (Object.hasOwn(AI_TASK_PRESETS, taskType)) {
    return AI_TASK_PRESETS[taskType];
  }
  return AI_TASK_PRESETS[DEFAULT_PRESET];
}
