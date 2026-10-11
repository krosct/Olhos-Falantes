import { describe, expect, it, vi } from "vitest";
import { SPEAK_PATH, SpeechError, VOICES_PATH, fetchSpeech, fetchVoices, isValidVoices } from "../src/api";

function fakeResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    blob: async () => new Blob(["RIFF"], { type: "audio/wav" })
  } as unknown as Response;
}

describe("fetchVoices", () => {
  it("returns the server voices", async () => {
    const body = {
      voices: [
        { id: "pt_BR-faber-medium", label: "Faber", group: "piper" },
        { id: "cloud:a53e", label: "OnyxGrave", group: "cloud" }
      ],
      default: "pt_BR-faber-medium"
    };
    const fetchImpl = vi.fn(async () => fakeResponse(body));
    await expect(fetchVoices(fetchImpl as unknown as typeof fetch)).resolves.toEqual(body);
    expect(fetchImpl).toHaveBeenCalledWith(VOICES_PATH);
  });

  it("falls back to no voices when the server is unreachable", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("offline");
    });
    await expect(fetchVoices(fetchImpl as unknown as typeof fetch)).resolves.toEqual({ voices: [], default: null });
  });

  it("rejects malformed payloads", () => {
    expect(isValidVoices({ voices: [{ id: 1 }], default: null })).toBe(false);
    expect(isValidVoices({ voices: [], default: null })).toBe(true);
  });
});

describe("fetchSpeech", () => {
  it("posts the text and voice and returns audio", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => fakeResponse(null));
    const blob = await fetchSpeech(
      "Uma mesa.",
      "pt_BR-cadu-medium",
      new AbortController().signal,
      { fetchImpl: fetchImpl as unknown as typeof fetch }
    );
    expect(blob.type).toBe("audio/wav");
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(SPEAK_PATH);
    expect(JSON.parse(init.body as string)).toEqual({ text: "Uma mesa.", voice: "pt_BR-cadu-medium", cache: false });
  });

  it("throws when the server cannot speak", async () => {
    const fetchImpl = vi.fn(async () => fakeResponse(null, false, 503));
    await expect(
      fetchSpeech("Oi.", "x", new AbortController().signal, { fetchImpl: fetchImpl as unknown as typeof fetch })
    ).rejects.toThrow("503");
  });
});

describe("fetchSpeech errors and cache", () => {
  it("asks the server to cache fixed phrases", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init: RequestInit) => fakeResponse(null));
    await fetchSpeech("Descri\u00e7\u00e3o pronta.", "cloud:a53e", new AbortController().signal, {
      cache: true,
      fetchImpl: fetchImpl as unknown as typeof fetch
    });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body as string).cache).toBe(true);
  });

  it("carries the server message when a voice is rejected", async () => {
    const body = { ok: false, user_message: "A voz Nanna n\u00e3o funciona com o modelo de voz configurado." };
    const fetchImpl = vi.fn(async () => fakeResponse(body, false, 503));
    const failure = fetchSpeech("Oi.", "cloud:x", new AbortController().signal, {
      fetchImpl: fetchImpl as unknown as typeof fetch
    });
    await expect(failure).rejects.toBeInstanceOf(SpeechError);
    await expect(failure).rejects.toMatchObject({ userMessage: body.user_message });
  });
});
