import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app";
import type { AppConfig } from "../src/config";
import { Logger } from "../src/logging/logger";

const baseConfig: AppConfig = {
  port: 43113,
  host: "127.0.0.1",
  logLevel: "error",
  modelId: "Transparker",
  modelOwner: "transparker-local"
};

describe("app routes", () => {
  test("health endpoint works", async () => {
    const app = createApp(baseConfig, new Logger("error"), {
      processTranscript: async (text) => text
    });

    const response = await app.fetch(new Request("http://localhost/healthz"));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual({
      status: "ok",
      service: "transparker",
      model: "Transparker"
    });
  });

  test("models endpoint returns Transparker", async () => {
    const app = createApp(baseConfig, new Logger("error"), {
      processTranscript: async (text) => text
    });

    const response = await app.fetch(new Request("http://localhost/v1/models"));
    const json = await response.json() as { data: Array<{ id: string }> };

    expect(response.status).toBe(200);
    expect(json.data[0]?.id).toBe("Transparker");
  });

  test("chat completions returns OpenAI-shaped payload", async () => {
    const app = createApp(baseConfig, new Logger("error"), {
      processTranscript: async (text) => `processed:${text}`
    });

    const payload = {
      model: "Transparker",
      messages: [{ role: "user", content: "hello there" }]
    };

    const response = await app.fetch(
      new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(payload)
      })
    );

    const json = await response.json() as {
      object: string;
      model: string;
      choices: Array<{ message: { content: string } }>;
      usage: { total_tokens: number };
    };

    expect(response.status).toBe(200);
    expect(json.object).toBe("chat.completion");
    expect(json.model).toBe("Transparker");
    expect(json.choices[0]?.message.content).toBe("processed:hello there");
    expect(json.usage.total_tokens).toBeGreaterThan(0);
  });

  test("chat completions rejects stream=true", async () => {
    const app = createApp(baseConfig, new Logger("error"), {
      processTranscript: async (text) => text
    });

    const response = await app.fetch(
      new Request("http://localhost/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: "Transparker",
          stream: true,
          messages: [{ role: "user", content: "hello" }]
        })
      })
    );

    const json = await response.json() as { error: { code: string } };

    expect(response.status).toBe(400);
    expect(json.error.code).toBe("streaming_unsupported");
  });
});
