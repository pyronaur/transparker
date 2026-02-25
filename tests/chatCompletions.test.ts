import { describe, expect, test } from "bun:test";
import {
  extractLatestUserText,
  validateChatCompletionRequest
} from "../src/openai/chatCompletions";

describe("extractLatestUserText", () => {
  test("reads latest user string content", () => {
    const text = extractLatestUserText([
      { role: "user", content: "first" },
      { role: "assistant", content: "ignored" },
      { role: "user", content: "last value" }
    ]);
    expect(text).toBe("last value");
  });

  test("reads user array content text parts", () => {
    const text = extractLatestUserText([
      {
        role: "user",
        content: [
          { type: "text", text: "hello" },
          { type: "image_url", image_url: { url: "https://example.com/a.png" } },
          { type: "input_text", text: "world" }
        ]
      }
    ]);

    expect(text).toBe("hello world");
  });
});

describe("validateChatCompletionRequest", () => {
  test("rejects stream mode", () => {
    const result = validateChatCompletionRequest(
      {
        model: "Transparker",
        stream: true,
        messages: [{ role: "user", content: "abc" }]
      },
      "Transparker"
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("streaming_unsupported");
      expect(result.status).toBe(400);
    }
  });

  test("rejects unknown model", () => {
    const result = validateChatCompletionRequest(
      {
        model: "unknown-model",
        messages: [{ role: "user", content: "abc" }]
      },
      "Transparker"
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("model_not_found");
      expect(result.status).toBe(404);
    }
  });

  test("accepts valid request", () => {
    const result = validateChatCompletionRequest(
      {
        model: "Transparker",
        messages: [{ role: "user", content: "Please clean this transcript" }]
      },
      "Transparker"
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.userText).toBe("Please clean this transcript");
    }
  });
});
