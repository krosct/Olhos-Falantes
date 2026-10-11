import { describe, expect, it, vi } from "vitest";
import { describeImage, fetchConfig } from "../src/api";
import {
  buildFields,
  buildSettings,
  describeTimeoutMs,
  FALLBACK_CONFIG,
  sanitize,
  speakTimeoutMs,
  type Field,
  visionRetryDelays
} from "../src/settings";

const fields = buildFields(
  [
    { id: "pt_BR-faber-medium", label: "Faber", group: "piper" },
    { id: "cloud:a53e", label: "OnyxGrave", group: "cloud" }
  ],
  FALLBACK_CONFIG.limits
);

function field(key: string): Field {
  const found = fields.find((candidate) => candidate.key === key);
  if (!found) {
    throw new Error(key);
  }
  return found;
}

function fakeResponse(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => body } as unknown as Response;
}

describe("settings fields", () => {
  it("names the .env variable behind every setting", () => {
    expect(fields.map((item) => [item.key, item.env])).toEqual([
      ["detail", "DEFAULT_DETAIL"],
      ["people", "DEFAULT_PEOPLE"],
      ["confidenceThreshold", "CONFIDENCE_THRESHOLD"],
      ["voice", "DEFAULT_VOICE"],
      ["ttsTimeout", "TTS_TIMEOUT_S"],
      ["visionTimeoutConnection", "VISION_TIMEOUT_CONNECTION"],
      ["visionTimeoutRequest", "VISION_TIMEOUT_REQUEST"],
      ["visionAttempts", "VISION_ATTEMPTS"]
    ]);
  });

  it("offers the device voice and the server voices grouped", () => {
    const voice = field("voice");
    expect(voice.kind === "select" && voice.options).toEqual([
      { value: "device", label: "Aparelho" },
      { value: "pt_BR-faber-medium", label: "Faber", group: "Servidor (Piper)" },
      { value: "cloud:a53e", label: "OnyxGrave", group: "Nuvem" }
    ]);
  });

  it("clamps numbers to the limits and rejects unknown options", () => {
    expect(sanitize(field("visionTimeoutRequest"), "999")).toBe(300);
    expect(sanitize(field("visionTimeoutConnection"), "0")).toBe(1);
    expect(sanitize(field("visionTimeoutRequest"), "abc")).toBeNull();
    expect(sanitize(field("detail"), "huge")).toBeNull();
    expect(sanitize(field("people"), "sim")).toBe(true);
  });

  it("falls back to defaults for invalid stored values", () => {
    const stored: Record<string, unknown> = { detail: "full", visionTimeoutRequest: "x", voice: "gone" };
    const result = buildSettings(fields, (item) => stored[item.key], FALLBACK_CONFIG.defaults);
    expect(result.detail).toBe("full");
    expect(result.visionTimeoutRequest).toBe(60);
    expect(result.voice).toBe("device");
  });
});

describe("client timeouts follow the server worst case", () => {
  it("covers three attempts of connection, upload and response plus the retry pauses", () => {
    const settings = { ...FALLBACK_CONFIG.defaults, visionTimeoutConnection: 10, visionTimeoutRequest: 60 };
    expect(describeTimeoutMs(settings, { base: 1.5, max: 10 })).toBe((3 * (2 * 10 + 60) + 4.5 + 10) * 1000);
  });

  it("covers three cloud voice attempts", () => {
    const settings = { ...FALLBACK_CONFIG.defaults, ttsTimeout: 20 };
    expect(speakTimeoutMs(settings, [1.5, 3])).toBe((3 * 3 * 20 + 4.5 + 5) * 1000);
  });
});

describe("fetchConfig", () => {
  it("merges the server defaults from .env", async () => {
    const body = {
      defaults: { detail: "long", visionTimeoutRequest: 90 },
      limits: { visionTimeoutRequest: { min: 5, max: 120 } },
      visionRetryDelay: { base: 2, max: 8 },
      ttsRetryDelays: [1]
    };
    const config = await fetchConfig(vi.fn(async () => fakeResponse(body)) as unknown as typeof fetch);
    expect(config.defaults.detail).toBe("long");
    expect(config.defaults.visionTimeoutRequest).toBe(90);
    expect(config.defaults.people).toBe(false);
    expect(config.limits.visionTimeoutRequest).toEqual({ min: 5, max: 120 });
    expect(config.visionRetryDelay).toEqual({ base: 2, max: 8 });
  });

  it("uses the built-in defaults when the server is down", async () => {
    const failing = vi.fn(async () => {
      throw new TypeError("offline");
    });
    await expect(fetchConfig(failing as unknown as typeof fetch)).resolves.toEqual(FALLBACK_CONFIG);
  });
});

describe("describeImage sends the user's settings", () => {
  it("adds confidence and timeouts to the form", async () => {
    const valid = { ok: true, confidence: 0.9, description: "Uma mesa.", user_message: "", retry: false };
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => fakeResponse(valid));
    await describeImage(new Blob(["x"]), {
      confidenceThreshold: 0.5,
      timeoutConnection: 8,
      timeoutRequest: 45,
      fetchImpl: fetchImpl as unknown as typeof fetch
    });
    const form = fetchImpl.mock.calls[0][1].body as FormData;
    expect(form.get("confidence_threshold")).toBe("0.5");
    expect(form.get("timeout_connection")).toBe("8");
    expect(form.get("timeout_request")).toBe("45");
  });
});

describe("vision attempts", () => {
  it("keeps the attempts between 1 and 30 as whole numbers", () => {
    expect(sanitize(field("visionAttempts"), "0")).toBe(1);
    expect(sanitize(field("visionAttempts"), "45")).toBe(30);
    expect(sanitize(field("visionAttempts"), "4.6")).toBe(5);
  });

  it("pauses 1.5 s, 3 s, 6 s and then 10 s between attempts", () => {
    expect(visionRetryDelays(1, { base: 1.5, max: 10 })).toEqual([]);
    expect(visionRetryDelays(6, { base: 1.5, max: 10 })).toEqual([1.5, 3, 6, 10, 10]);
  });

  it("waits long enough on the client for every attempt", () => {
    const settings = {
      ...FALLBACK_CONFIG.defaults,
      visionTimeoutConnection: 10,
      visionTimeoutRequest: 60,
      visionAttempts: 5
    };
    expect(describeTimeoutMs(settings, { base: 1.5, max: 10 })).toBe((5 * 80 + 1.5 + 3 + 6 + 10 + 10) * 1000);
  });

  it("sends the attempts with the photo", async () => {
    const valid = { ok: true, confidence: 0.9, description: "Uma mesa.", user_message: "", retry: false };
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => fakeResponse(valid));
    await describeImage(new Blob(["x"]), { attempts: 7, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect((fetchImpl.mock.calls[0][1].body as FormData).get("attempts")).toBe("7");
  });
});
