import type { AppConfig } from "./config";
import { Logger, previewText } from "./logging/logger";
import {
	buildChatCompletionResponse,
	estimateTokens,
	validateChatCompletionRequest,
} from "./openai/chatCompletions";
import { buildModelsResponse } from "./openai/models";

interface AppDependencies {
	readonly processTranscript: (text: string, context?: { requestId?: string }) => Promise<string>;
}

interface AppRuntime {
	readonly config: AppConfig;
	readonly logger: Logger;
	readonly deps: AppDependencies;
}

interface RequestContext {
	readonly requestId: string;
	readonly request: Request;
	readonly url: URL;
	readonly startedAt: number;
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			"content-type": "application/json",
		},
	});
}

function openAIError(status: number, code: string, message: string): Response {
	return jsonResponse(
		{
			error: {
				message,
				type: "invalid_request_error",
				param: null,
				code,
			},
		},
		status,
	);
}

function buildCompletionId(): string {
	const rand = Math.random().toString(36).slice(2, 10);
	return `chatcmpl_${Date.now().toString(36)}${rand}`;
}

function createRequestContext(request: Request): RequestContext {
	return {
		requestId: crypto.randomUUID(),
		request,
		url: new URL(request.url),
		startedAt: Date.now(),
	};
}

function getAuthMode(request: Request): "none" | "bearer" | "other" {
	const authHeader = request.headers.get("authorization");
	if (!authHeader) {
		return "none";
	}
	if (authHeader.startsWith("Bearer ")) {
		return "bearer";
	}
	return "other";
}

function logRequestReceived(logger: Logger, context: RequestContext): void {
	logger.info("request_received", {
		request_id: context.requestId,
		method: context.request.method,
		path: context.url.pathname,
		auth: getAuthMode(context.request),
	});
}

function logRequestCompleted(logger: Logger, context: RequestContext): void {
	logger.info("request_completed", {
		request_id: context.requestId,
		method: context.request.method,
		path: context.url.pathname,
		latency_ms: Date.now() - context.startedAt,
	});
}

function logRequestFailure(logger: Logger, context: RequestContext, error: unknown): void {
	logger.error("request_failed", {
		request_id: context.requestId,
		path: context.url.pathname,
		method: context.request.method,
		error: error instanceof Error ? error.message : String(error),
	});
}

function routeStaticResponse(config: AppConfig, context: RequestContext): Response | null {
	if (context.request.method === "GET" && context.url.pathname === "/healthz") {
		return jsonResponse({
			status: "ok",
			service: "transparker",
			model: config.modelId,
		});
	}

	if (context.request.method === "GET" && context.url.pathname === "/v1/models") {
		return jsonResponse(buildModelsResponse(config.modelId, config.modelOwner));
	}

	return null;
}

async function readJsonBody(
	request: Request,
): Promise<{ ok: true; payload: unknown } | { ok: false }> {
	try {
		return { ok: true, payload: await request.json() };
	} catch {
		return { ok: false };
	}
}

function logTranscriptReceived(args: {
	runtime: AppRuntime;
	requestId: string;
	model: string;
	text: string;
}): void {
	args.runtime.logger.info("transcript_received", {
		request_id: args.requestId,
		model: args.model,
		input_chars: args.text.length,
		input_preview: previewText(args.text),
		...(args.runtime.config.logFullTranscripts ? { input_full: args.text } : {}),
	});
}

function logTranscriptProcessed(
	args: { runtime: AppRuntime; requestId: string; text: string },
): void {
	args.runtime.logger.info("transcript_processed", {
		request_id: args.requestId,
		output_chars: args.text.length,
		output_preview: previewText(args.text),
		...(args.runtime.config.logFullTranscripts ? { output_full: args.text } : {}),
	});
}

function buildCompletionResponse(model: string, content: string, sourceText: string): Response {
	const promptTokens = estimateTokens(sourceText);
	const completionTokens = estimateTokens(content);
	return jsonResponse(
		buildChatCompletionResponse({
			id: buildCompletionId(),
			model,
			content,
			promptTokens,
			completionTokens,
		}),
	);
}

async function handleChatCompletions(
	runtime: AppRuntime,
	context: RequestContext,
): Promise<Response> {
	const payloadResult = await readJsonBody(context.request);
	if (!payloadResult.ok) {
		return openAIError(400, "invalid_json", "Request body must be valid JSON.");
	}

	const validation = validateChatCompletionRequest(payloadResult.payload, runtime.config.modelId);
	if (!validation.ok) {
		return openAIError(validation.status, validation.code, validation.message);
	}

	logTranscriptReceived({
		runtime,
		requestId: context.requestId,
		model: validation.model,
		text: validation.userText,
	});
	const processed = await runtime.deps.processTranscript(validation.userText, {
		requestId: context.requestId,
	});
	logTranscriptProcessed({ runtime, requestId: context.requestId, text: processed });
	return buildCompletionResponse(validation.model, processed, validation.userText);
}

async function routeRequest(runtime: AppRuntime, context: RequestContext): Promise<Response> {
	const staticResponse = routeStaticResponse(runtime.config, context);
	if (staticResponse) {
		return staticResponse;
	}

	if (context.request.method === "POST" && context.url.pathname === "/v1/chat/completions") {
		return handleChatCompletions(runtime, context);
	}

	return openAIError(404, "not_found",
		`Route not found: ${context.request.method} ${context.url.pathname}`);
}

async function handleRequest(runtime: AppRuntime, request: Request): Promise<Response> {
	const context = createRequestContext(request);
	logRequestReceived(runtime.logger, context);

	try {
		return await routeRequest(runtime, context);
	} catch (error) {
		logRequestFailure(runtime.logger, context, error);
		return openAIError(500, "internal_error", "Internal server error.");
	} finally {
		logRequestCompleted(runtime.logger, context);
	}
}

export function createApp(config: AppConfig, logger: Logger, deps: AppDependencies): {
	fetch: (request: Request) => Promise<Response>;
} {
	const runtime: AppRuntime = { config, logger, deps };
	return {
		fetch: async (request: Request): Promise<Response> => handleRequest(runtime, request),
	};
}
