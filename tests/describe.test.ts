import { describe, expect, it, vi } from "vitest";
import { DESCRIBE_PATH, DescribeError, describeImage, isValidResponse } from "../src/api";
import type { DescribeResponse } from "../src/types";

const validResponse: DescribeResponse = {
  ok: true,
  confidence: 0.83,
  description: "Uma mesa com uma xicara, um caderno e um celular.",
  user_message: "Descricao pronta.",
  retry: false
};

function fakeResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

describe("isValidResponse", () => {
  it("accepts a well-formed payload", () => {
    expect(isValidResponse(validResponse)).toBe(true);
  });

  it("rejects missing fields", () => {
    expect(isValidResponse({ ok: true, confidence: 1 })).toBe(false);
    expect(isValidResponse(null)).toBe(false);
    expect(isValidResponse("texto")).toBe(false);
  });
});

describe("describeImage", () => {
  it("returns the parsed response on success", async () => {
    const fetchImpl = vi.fn(async () => fakeResponse(validResponse)) as unknown as typeof fetch;
    const result = await describeImage(new Blob([new Uint8Array([1, 2, 3])]), { fetchImpl });
    expect(result).toEqual(validResponse);
  });

  it("posts multipart form data to the describe endpoint", async () => {
    const fetchImpl = vi.fn(async () => fakeResponse(validResponse)) as unknown as typeof fetch;
    await describeImage(new Blob([new Uint8Array([1])]), { fetchImpl, mode: "scene" });
    const [path, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit
    ];
    expect(path).toBe(DESCRIBE_PATH);
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get("mode")).toBe("scene");
    expect((init.body as FormData).get("image")).toBeInstanceOf(Blob);
  });

  it("throws when the payload shape is invalid", async () => {
    const fetchImpl = vi.fn(async () => fakeResponse({ ok: true })) as unknown as typeof fetch;
    await expect(describeImage(new Blob([new Uint8Array([1])]), { fetchImpl })).rejects.toBeInstanceOf(
      DescribeError
    );
  });

  it("uses the friendly message from a failed HTTP response", async () => {
    const fetchImpl = vi.fn(async () =>
      fakeResponse({ ok: false, user_message: "Muitas tentativas." }, false, 429)
    ) as unknown as typeof fetch;
    await expect(describeImage(new Blob([new Uint8Array([1])]), { fetchImpl })).rejects.toThrow(
      "Muitas tentativas."
    );
  });

  it("maps aborts to a timeout message", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new DOMException("aborted", "AbortError");
    }) as unknown as typeof fetch;
    await expect(describeImage(new Blob([new Uint8Array([1])]), { fetchImpl })).rejects.toThrow(
      "O modelo que analisa as imagens n\u00e3o respondeu at\u00e9 agora. Tente novamente em breve."
    );
  });

  it("passes through retry responses without throwing", async () => {
    const retryResponse: DescribeResponse = {
      ok: true,
      confidence: 0.1,
      description: "",
      user_message: "Tente outra foto.",
      retry: true
    };
    const fetchImpl = vi.fn(async () => fakeResponse(retryResponse)) as unknown as typeof fetch;
    const result = await describeImage(new Blob([new Uint8Array([1])]), { fetchImpl });
    expect(result.retry).toBe(true);
    expect(result.description).toBe("");
  });
});

describe("describeImage preferences", () => {
  async function sentForm(options: Parameters<typeof describeImage>[1]): Promise<FormData> {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => fakeResponse(validResponse));
    await describeImage(new Blob(["x"]), { ...options, fetchImpl: fetchImpl as unknown as typeof fetch });
    return fetchImpl.mock.calls[0][1].body as FormData;
  }

  it("sends medium detail without people by default", async () => {
    const form = await sentForm({});
    expect(form.get("detail")).toBe("medium");
    expect(form.get("people")).toBe("false");
  });

  it("sends the chosen detail and people option", async () => {
    const form = await sentForm({ detail: "full", people: true });
    expect(form.get("detail")).toBe("full");
    expect(form.get("people")).toBe("true");
  });
});
