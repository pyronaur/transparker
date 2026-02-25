interface ValidationOk {
  readonly ok: true;
  readonly model: string;
  readonly userText: string;
}

interface ValidationError {
  readonly ok: false;
  readonly status: number;
  readonly code: string;
  readonly message: string;
}

export type ValidationResult = ValidationOk | ValidationError;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function extractTextFromContent(content: unknown): string | null {
  if (typeof content === "string") {
    const normalized = normalizeText(content);
    return normalized.length > 0 ? normalized : null;
  }

  if (!Array.isArray(content)) {
    return null;
  }

  const parts: string[] = [];
  for (const item of content) {
    if (!isObject(item)) {
      continue;
    }

    const type = item.type;
    if ((type === "text" || type === "input_text") && typeof item.text === "string") {
      const normalized = normalizeText(item.text);
      if (normalized.length > 0) {
        parts.push(normalized);
      }
    }
  }

  if (parts.length === 0) {
    return null;
  }

  return parts.join(" ");
}

export function extractLatestUserText(messages: unknown): string | null {
  if (!Array.isArray(messages)) {
    return null;
  }

  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!isObject(message) || message.role !== "user") {
      continue;
    }

    const text = extractTextFromContent(message.content);
    if (text) {
      return text;
    }
  }

  return null;
}

export function validateChatCompletionRequest(body: unknown, expectedModelId: string): ValidationResult {
  if (!isObject(body)) {
    return {
      ok: false,
      status: 400,
      code: "invalid_json",
      message: "Request body must be a JSON object."
    };
  }

  if (body.stream === true) {
    return {
      ok: false,
      status: 400,
      code: "streaming_unsupported",
      message: "stream=true is unsupported for this service."
    };
  }

  if (typeof body.model !== "string" || body.model.length === 0) {
    return {
      ok: false,
      status: 400,
      code: "missing_model",
      message: "Request must include a model."
    };
  }

  if (body.model !== expectedModelId) {
    return {
      ok: false,
      status: 404,
      code: "model_not_found",
      message: `Model "${body.model}" not found. Use "${expectedModelId}".`
    };
  }

  const userText = extractLatestUserText(body.messages);
  if (!userText) {
    return {
      ok: false,
      status: 400,
      code: "missing_user_text",
      message: "Request must include user text in messages."
    };
  }

  return {
    ok: true,
    model: body.model,
    userText
  };
}

export function estimateTokens(text: string): number {
  const normalized = normalizeText(text);
  if (normalized.length === 0) {
    return 0;
  }

  return normalized.split(" ").length;
}

export function buildChatCompletionResponse(params: {
  readonly id: string;
  readonly model: string;
  readonly content: string;
  readonly promptTokens: number;
  readonly completionTokens: number;
}): Record<string, unknown> {
  const totalTokens = params.promptTokens + params.completionTokens;

  return {
    id: params.id,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: params.model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: params.content,
          refusal: null,
          annotations: []
        },
        logprobs: null,
        finish_reason: "stop"
      }
    ],
    usage: {
      prompt_tokens: params.promptTokens,
      completion_tokens: params.completionTokens,
      total_tokens: totalTokens,
      prompt_tokens_details: {
        cached_tokens: 0,
        audio_tokens: 0
      },
      completion_tokens_details: {
        reasoning_tokens: 0,
        audio_tokens: 0,
        accepted_prediction_tokens: 0,
        rejected_prediction_tokens: 0
      }
    },
    service_tier: "default"
  };
}
