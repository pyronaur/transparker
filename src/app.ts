import type { AppConfig } from "./config";
import { createRequestId, Logger, previewText } from "./logging/logger";
import {
  buildChatCompletionResponse,
  estimateTokens,
  validateChatCompletionRequest
} from "./openai/chatCompletions";
import { buildModelsResponse } from "./openai/models";

interface AppDependencies {
  readonly processTranscript: (text: string) => Promise<string>;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}

function openAIError(status: number, code: string, message: string): Response {
  return jsonResponse(
    {
      error: {
        message,
        type: "invalid_request_error",
        param: null,
        code
      }
    },
    status
  );
}

function buildCompletionId(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `chatcmpl_${Date.now().toString(36)}${rand}`;
}

export function createApp(config: AppConfig, logger: Logger, deps: AppDependencies): {
  fetch: (request: Request) => Promise<Response>;
} {
  return {
    fetch: async (request: Request): Promise<Response> => {
      const requestId = createRequestId();
      const url = new URL(request.url);
      const start = Date.now();

      const authHeader = request.headers.get("authorization");
      const authMode = authHeader?.startsWith("Bearer ") ? "bearer" : authHeader ? "other" : "none";

      logger.info("request_received", {
        request_id: requestId,
        method: request.method,
        path: url.pathname,
        auth: authMode
      });

      try {
        if (request.method === "GET" && url.pathname === "/healthz") {
          return jsonResponse({
            status: "ok",
            service: "transparker",
            model: config.modelId
          });
        }

        if (request.method === "GET" && url.pathname === "/v1/models") {
          return jsonResponse(buildModelsResponse(config.modelId, config.modelOwner));
        }

        if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
          let payload: unknown;
          try {
            payload = await request.json();
          } catch {
            return openAIError(400, "invalid_json", "Request body must be valid JSON.");
          }

          const validation = validateChatCompletionRequest(payload, config.modelId);
          if (!validation.ok) {
            return openAIError(validation.status, validation.code, validation.message);
          }

          logger.info("transcript_received", {
            request_id: requestId,
            model: validation.model,
            input_chars: validation.userText.length,
            input_preview: previewText(validation.userText)
          });

          const processed = await deps.processTranscript(validation.userText);

          logger.info("transcript_processed", {
            request_id: requestId,
            output_chars: processed.length,
            output_preview: previewText(processed)
          });

          const promptTokens = estimateTokens(validation.userText);
          const completionTokens = estimateTokens(processed);

          return jsonResponse(
            buildChatCompletionResponse({
              id: buildCompletionId(),
              model: validation.model,
              content: processed,
              promptTokens,
              completionTokens
            })
          );
        }

        return openAIError(404, "not_found", `Route not found: ${request.method} ${url.pathname}`);
      } catch (error) {
        logger.error("request_failed", {
          request_id: requestId,
          path: url.pathname,
          method: request.method,
          error: error instanceof Error ? error.message : String(error)
        });
        return openAIError(500, "internal_error", "Internal server error.");
      } finally {
        logger.info("request_completed", {
          request_id: requestId,
          method: request.method,
          path: url.pathname,
          latency_ms: Date.now() - start
        });
      }
    }
  };
}
