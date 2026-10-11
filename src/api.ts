import {
  type AppConfig,
  describeTimeoutMs,
  FALLBACK_CONFIG,
  type NumberKey,
  type Settings,
  speakTimeoutMs
} from "./settings";
import type { DescribeDetail, DescribeMode, DescribeResponse, VoicesResponse } from "./types";

export const DESCRIBE_PATH = "/api/describe";
export const VOICES_PATH = "/api/voices";
export const SPEAK_PATH = "/api/speak";
export const CONFIG_PATH = "/api/config";
export const SPEAK_TIMEOUT_MS = speakTimeoutMs(FALLBACK_CONFIG.defaults, FALLBACK_CONFIG.ttsRetryDelays);
export const REQUEST_TIMEOUT_MS = describeTimeoutMs(FALLBACK_CONFIG.defaults, FALLBACK_CONFIG.visionRetryDelay);
export const DEFAULT_MODE: DescribeMode = "scene";
export const DEFAULT_DETAIL: DescribeDetail = "medium";

export class DescribeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DescribeError";
  }
}

export function isValidResponse(value: unknown): value is DescribeResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.ok === "boolean" &&
    typeof candidate.confidence === "number" &&
    typeof candidate.description === "string" &&
    typeof candidate.user_message === "string" &&
    typeof candidate.retry === "boolean"
  );
}

function extractUserMessage(value: unknown): string | undefined {
  if (typeof value === "object" && value !== null) {
    const message = (value as Record<string, unknown>).user_message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }
  return undefined;
}

function isAbortError(error: unknown): boolean {
  if (error instanceof DOMException) {
    return error.name === "AbortError";
  }
  return error instanceof Error && error.name === "AbortError";
}

export interface DescribeOptions {
  mode?: DescribeMode;
  detail?: DescribeDetail;
  people?: boolean;
  confidenceThreshold?: number;
  timeoutConnection?: number;
  timeoutRequest?: number;
  attempts?: number;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export async function describeImage(image: Blob, options: DescribeOptions = {}): Promise<DescribeResponse> {
  const {
    mode = DEFAULT_MODE,
    detail = DEFAULT_DETAIL,
    people = false,
    confidenceThreshold,
    timeoutConnection,
    timeoutRequest,
    attempts,
    fetchImpl = fetch,
    timeoutMs = REQUEST_TIMEOUT_MS
  } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const form = new FormData();
    form.append("image", image, "photo.jpg");
    form.append("mode", mode);
    form.append("detail", detail);
    form.append("people", people ? "true" : "false");
    const numbers: Array<[string, number | undefined]> = [
      ["confidence_threshold", confidenceThreshold],
      ["timeout_connection", timeoutConnection],
      ["timeout_request", timeoutRequest],
      ["attempts", attempts]
    ];
    for (const [name, value] of numbers) {
      if (value !== undefined) {
        form.append(name, String(value));
      }
    }
    const response = await fetchImpl(DESCRIBE_PATH, {
      method: "POST",
      body: form,
      signal: controller.signal
    });
    let data: unknown = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    if (!response.ok) {
      throw new DescribeError(
        extractUserMessage(data) ?? "O servi\u00e7o n\u00e3o respondeu como esperado. Tente de novo."
      );
    }
    if (!isValidResponse(data)) {
      throw new DescribeError("Resposta inesperada do servi\u00e7o. Tente de novo.");
    }
    return data;
  } catch (error) {
    if (error instanceof DescribeError) {
      throw error;
    }
    if (isAbortError(error)) {
      throw new DescribeError("O modelo que analisa as imagens n\u00e3o respondeu at\u00e9 agora. Tente novamente em breve.");
    }
    throw new DescribeError("Sem conex\u00e3o com o servi\u00e7o. Verifique a internet e tente de novo.");
  } finally {
    clearTimeout(timer);
  }
}

export function isValidVoices(value: unknown): value is VoicesResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    Array.isArray(candidate.voices) &&
    candidate.voices.every(
      (voice) =>
        typeof voice === "object" &&
        voice !== null &&
        typeof (voice as Record<string, unknown>).id === "string" &&
        typeof (voice as Record<string, unknown>).label === "string" &&
        ((voice as Record<string, unknown>).group === "piper" ||
          (voice as Record<string, unknown>).group === "cloud")
    ) &&
    (candidate.default === null || typeof candidate.default === "string")
  );
}

export async function fetchVoices(fetchImpl: typeof fetch = fetch): Promise<VoicesResponse> {
  try {
    const response = await fetchImpl(VOICES_PATH);
    const data: unknown = response.ok ? await response.json() : null;
    if (isValidVoices(data)) {
      return data;
    }
  } catch {
    // Server voices are optional; the device voice still works.
  }
  return { voices: [], default: null };
}

export class SpeechError extends Error {
  readonly userMessage: string | undefined;

  constructor(status: number, userMessage: string | undefined) {
    super(`speak failed: ${status}`);
    this.name = "SpeechError";
    this.userMessage = userMessage;
  }
}

export interface SpeechOptions {
  cache?: boolean;
  ttsTimeout?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export async function fetchSpeech(
  text: string,
  voice: string,
  signal: AbortSignal,
  options: SpeechOptions = {}
): Promise<Blob> {
  const { cache = false, ttsTimeout, timeoutMs = SPEAK_TIMEOUT_MS, fetchImpl = fetch } = options;
  const timeout = AbortSignal.timeout(timeoutMs);
  const response = await fetchImpl(SPEAK_PATH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(ttsTimeout === undefined ? { text, voice, cache } : { text, voice, cache, tts_timeout: ttsTimeout }),
    signal: AbortSignal.any([signal, timeout])
  });
  if (!response.ok) {
    let data: unknown = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    throw new SpeechError(response.status, extractUserMessage(data));
  }
  return response.blob();
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === "number" && Number.isFinite(item));
}

function isRetryDelay(value: unknown): value is AppConfig["visionRetryDelay"] {
  const candidate = value as { base?: unknown; max?: unknown } | null;
  return (
    typeof candidate?.base === "number" &&
    typeof candidate.max === "number" &&
    candidate.base > 0 &&
    candidate.max >= candidate.base
  );
}

export async function fetchConfig(fetchImpl: typeof fetch = fetch): Promise<AppConfig> {
  try {
    const response = await fetchImpl(CONFIG_PATH);
    const data: unknown = response.ok ? await response.json() : null;
    if (typeof data !== "object" || data === null) {
      return FALLBACK_CONFIG;
    }
    const candidate = data as Record<string, unknown>;
    const defaults = { ...FALLBACK_CONFIG.defaults, ...(candidate.defaults as Partial<Settings> | undefined) };
    const limits = { ...FALLBACK_CONFIG.limits };
    const rawLimits = (candidate.limits ?? {}) as Record<string, unknown>;
    for (const key of Object.keys(limits) as NumberKey[]) {
      const limit = rawLimits[key] as { min?: unknown; max?: unknown } | undefined;
      if (typeof limit?.min === "number" && typeof limit.max === "number" && limit.min <= limit.max) {
        limits[key] = { min: limit.min, max: limit.max };
      }
    }
    return {
      defaults,
      limits,
      visionRetryDelay: isRetryDelay(candidate.visionRetryDelay)
        ? candidate.visionRetryDelay
        : FALLBACK_CONFIG.visionRetryDelay,
      ttsRetryDelays: isNumberArray(candidate.ttsRetryDelays) ? candidate.ttsRetryDelays : FALLBACK_CONFIG.ttsRetryDelays
    };
  } catch {
    return FALLBACK_CONFIG;
  }
}
