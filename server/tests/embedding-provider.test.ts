import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  OpenAIEmbeddingProvider,
  createEmbeddingProviderFromConfig,
  type EmbeddingProvider,
} from "../rag/embedding/embedding-provider.js";
import { resetRAGConfigCache } from "../rag/config.js";

// ---------------------------------------------------------------------------
// Helper: mock fetch
// ---------------------------------------------------------------------------

function mockFetchSuccess(data: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  });
}

function mockFetchError(status: number, body: string) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    text: () => Promise.resolve(body),
  });
}

// ---------------------------------------------------------------------------
// OpenAIEmbeddingProvider
// ---------------------------------------------------------------------------

describe("OpenAIEmbeddingProvider", () => {
  const defaultOpts = {
    apiKey: "sk-test",
    baseUrl: "https://api.openai.com/v1",
    model: "text-embedding-3-small",
    dimension: 1536,
  };

  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("exposes modelName and dimension from constructor options", () => {
    const provider = new OpenAIEmbeddingProvider(defaultOpts);
    expect(provider.modelName).toBe("text-embedding-3-small");
    expect(provider.dimension).toBe(1536);
  });

  it("returns empty array for empty input", async () => {
    const provider = new OpenAIEmbeddingProvider(defaultOpts);
    const result = await provider.embed([]);
    expect(result).toEqual([]);
  });

  it("calls OpenAI embeddings endpoint and returns vectors in input order", async () => {
    const mockResponse = {
      data: [
        { index: 1, embedding: [0.2, 0.3] },
        { index: 0, embedding: [0.1, 0.4] },
      ],
      usage: { prompt_tokens: 10, total_tokens: 10 },
    };

    globalThis.fetch = mockFetchSuccess(mockResponse);
    const provider = new OpenAIEmbeddingProvider(defaultOpts);
    const result = await provider.embed(["hello", "world"]);

    expect(result).toEqual([
      [0.1, 0.4],
      [0.2, 0.3],
    ]);

    // Verify fetch was called with correct params
    expect(globalThis.fetch).toHaveBeenCalledOnce();
    const [url, opts] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/embeddings");
    expect(opts.method).toBe("POST");
    expect(JSON.parse(opts.body)).toEqual({
      model: "text-embedding-3-small",
      input: ["hello", "world"],
    });
    expect(opts.headers["Authorization"]).toBe("Bearer sk-test");
  });

  it("strips trailing slashes from baseUrl", async () => {
    const mockResponse = {
      data: [{ index: 0, embedding: [0.1] }],
    };
    globalThis.fetch = mockFetchSuccess(mockResponse);

    const provider = new OpenAIEmbeddingProvider({
      ...defaultOpts,
      baseUrl: "https://api.openai.com/v1///",
    });
    await provider.embed(["test"]);

    const [url] = (globalThis.fetch as any).mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/embeddings");
  });

  it("throws on non-ok HTTP response", async () => {
    globalThis.fetch = mockFetchError(401, "Unauthorized");
    const provider = new OpenAIEmbeddingProvider(defaultOpts);

    await expect(provider.embed(["test"])).rejects.toThrow(
      /Embedding API error 401/
    );
  });

  it("throws on malformed response (missing data array)", async () => {
    globalThis.fetch = mockFetchSuccess({ result: "bad" });
    const provider = new OpenAIEmbeddingProvider(defaultOpts);

    await expect(provider.embed(["test"])).rejects.toThrow(
      /malformed response/
    );
  });

  it("throws timeout error when request exceeds timeoutMs", async () => {
    globalThis.fetch = vi.fn().mockImplementation((_url: string, opts: any) => {
      return new Promise((_resolve, reject) => {
        opts.signal.addEventListener("abort", () => {
          const err = new Error("The operation was aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    });

    const provider = new OpenAIEmbeddingProvider({
      ...defaultOpts,
      timeoutMs: 50,
    });

    await expect(provider.embed(["test"])).rejects.toThrow(
      /timed out after 50ms/
    );
  });

  it("satisfies EmbeddingProvider interface", () => {
    const provider: EmbeddingProvider = new OpenAIEmbeddingProvider(
      defaultOpts
    );
    expect(typeof provider.embed).toBe("function");
    expect(typeof provider.dimension).toBe("number");
    expect(typeof provider.modelName).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// createEmbeddingProviderFromConfig
// ---------------------------------------------------------------------------

describe("createEmbeddingProviderFromConfig", () => {
  afterEach(() => {
    resetRAGConfigCache();
    vi.unstubAllEnvs();
  });

  it("throws when apiKey is missing", () => {
    vi.stubEnv("RAG_EMBEDDING_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    resetRAGConfigCache();

    expect(() => createEmbeddingProviderFromConfig()).toThrow(/API key/);
  });

  it("throws when baseUrl is missing", () => {
    vi.stubEnv("RAG_EMBEDDING_API_KEY", "sk-test");
    vi.stubEnv("RAG_EMBEDDING_BASE_URL", "");
    vi.stubEnv("OPENAI_BASE_URL", "");
    resetRAGConfigCache();

    expect(() => createEmbeddingProviderFromConfig()).toThrow(/base URL/);
  });

  it("creates OpenAIEmbeddingProvider from valid config", () => {
    vi.stubEnv("RAG_EMBEDDING_API_KEY", "sk-test");
    vi.stubEnv("RAG_EMBEDDING_BASE_URL", "https://api.openai.com/v1");
    vi.stubEnv("RAG_EMBEDDING_MODEL", "text-embedding-3-large");
    vi.stubEnv("RAG_EMBEDDING_DIMENSION", "3072");
    resetRAGConfigCache();

    const provider = createEmbeddingProviderFromConfig();
    expect(provider.modelName).toBe("text-embedding-3-large");
    expect(provider.dimension).toBe(3072);
  });
});
