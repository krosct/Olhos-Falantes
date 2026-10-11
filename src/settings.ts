import type { DescribeDetail, ServerVoice, VoiceGroup } from "./types";

export interface Settings {
  detail: DescribeDetail;
  people: boolean;
  confidenceThreshold: number;
  voice: string;
  visionTimeoutConnection: number;
  visionTimeoutRequest: number;
  ttsTimeout: number;
  visionAttempts: number;
}

export type SettingKey = keyof Settings;
export type SettingValue = Settings[SettingKey];
export type FieldGroup = "description" | "voice" | "timing";
export type NumberKey =
  | "confidenceThreshold"
  | "visionTimeoutConnection"
  | "visionTimeoutRequest"
  | "ttsTimeout"
  | "visionAttempts";

export interface Limits {
  min: number;
  max: number;
}

export interface AppConfig {
  defaults: Settings;
  limits: Record<NumberKey, Limits>;
  visionRetryDelay: { base: number; max: number };
  ttsRetryDelays: number[];
}

interface BaseField {
  key: SettingKey;
  env: string;
  group: FieldGroup;
  label: string;
  help: string;
}

export interface NumberField extends BaseField {
  kind: "number";
  key: NumberKey;
  min: number;
  max: number;
  step: number;
  integer?: boolean;
}

export interface SelectOption {
  value: string;
  label: string;
  group?: string;
}

export interface SelectField extends BaseField {
  kind: "select";
  options: SelectOption[];
}

export interface BooleanField extends BaseField {
  kind: "boolean";
}

export type Field = NumberField | SelectField | BooleanField;

export const DEVICE_VOICE = "device";
export const DEVICE_VOICE_NAME = "a voz do aparelho";
export const STORAGE_KEY = "olhos-falantes:settings";

export const GROUP_TITLES: Record<FieldGroup, string> = {
  description: "Descrição",
  voice: "Voz",
  timing: "Tempo de espera"
};

const VOICE_GROUP_LABELS: Record<VoiceGroup, string> = {
  piper: "Servidor (Piper)",
  cloud: "Nuvem"
};

export const FALLBACK_CONFIG: AppConfig = {
  defaults: {
    detail: "medium",
    people: false,
    confidenceThreshold: 0.35,
    voice: DEVICE_VOICE,
    visionTimeoutConnection: 10,
    visionTimeoutRequest: 60,
    ttsTimeout: 20,
    visionAttempts: 3
  },
  limits: {
    confidenceThreshold: { min: 0, max: 1 },
    visionTimeoutConnection: { min: 1, max: 60 },
    visionTimeoutRequest: { min: 5, max: 300 },
    ttsTimeout: { min: 1, max: 120 },
    visionAttempts: { min: 1, max: 30 }
  },
  visionRetryDelay: { base: 1.5, max: 10 },
  ttsRetryDelays: [1.5, 3]
};

const TRUE_VALUES = new Set(["1", "true", "yes", "on", "sim"]);
const FALSE_VALUES = new Set(["0", "false", "no", "off", "nao", "não"]);

export function buildFields(voices: readonly ServerVoice[], limits: AppConfig["limits"]): Field[] {
  const number = (key: NumberKey, step: number) => ({ min: limits[key].min, max: limits[key].max, step });
  return [
    {
      key: "detail",
      env: "DEFAULT_DETAIL",
      group: "description",
      kind: "select",
      label: "Tamanho da descrição",
      help: "Curta: até 3 frases. Média: até 6. Longa: até 9. Total: o máximo de detalhes.",
      options: [
        { value: "short", label: "Curta" },
        { value: "medium", label: "Média" },
        { value: "long", label: "Longa" },
        { value: "full", label: "Total" }
      ]
    },
    {
      key: "people",
      env: "DEFAULT_PEOPLE",
      group: "description",
      kind: "boolean",
      label: "Descrever pessoas",
      help: "Posição, roupas e o que estão fazendo. Nunca diz quem é a pessoa."
    },
    {
      key: "confidenceThreshold",
      env: "CONFIDENCE_THRESHOLD",
      group: "description",
      kind: "number",
      label: "Confiança mínima",
      help: "Abaixo deste valor (0 a 1), o app pede outra foto em vez de arriscar uma descrição.",
      ...number("confidenceThreshold", 0.05)
    },
    {
      key: "voice",
      env: "DEFAULT_VOICE",
      group: "voice",
      kind: "select",
      label: "Voz da leitura",
      help: "Aparelho usa a voz do celular. As do servidor são geradas pelo Piper; as da nuvem, pelo modelo de voz configurado.",
      options: [
        { value: DEVICE_VOICE, label: "Aparelho" },
        ...voices.map((voice) => ({ value: voice.id, label: voice.label, group: VOICE_GROUP_LABELS[voice.group] }))
      ]
    },
    {
      key: "ttsTimeout",
      env: "TTS_TIMEOUT_S",
      group: "voice",
      kind: "number",
      label: "Espera da voz da nuvem (s)",
      help: "Tempo máximo, por tentativa, para a nuvem gerar o áudio. Depois disso, usa a voz do aparelho.",
      ...number("ttsTimeout", 1)
    },
    {
      key: "visionTimeoutConnection",
      env: "VISION_TIMEOUT_CONNECTION",
      group: "timing",
      kind: "number",
      label: "Conexão e envio da foto (s)",
      help: "Tempo máximo, por tentativa, para conectar ao modelo e enviar a foto.",
      ...number("visionTimeoutConnection", 1)
    },
    {
      key: "visionTimeoutRequest",
      env: "VISION_TIMEOUT_REQUEST",
      group: "timing",
      kind: "number",
      label: "Resposta do modelo (s)",
      help: "Tempo máximo, por tentativa, esperando o modelo responder depois de receber a foto.",
      ...number("visionTimeoutRequest", 1)
    },
    {
      key: "visionAttempts",
      env: "VISION_ATTEMPTS",
      group: "timing",
      kind: "number",
      label: "Tentativas do modelo",
      help: "Quantas vezes tentar quando o modelo está ocupado ou fora do ar (1 a 30). Pausas de 1,5 s, 3 s, 6 s e depois 10 s.",
      integer: true,
      ...number("visionAttempts", 1)
    }
  ];
}

export function sanitize(field: Field, raw: unknown): SettingValue | null {
  if (field.kind === "boolean") {
    if (typeof raw === "boolean") {
      return raw;
    }
    const value = String(raw ?? "").trim().toLowerCase();
    if (TRUE_VALUES.has(value)) {
      return true;
    }
    return FALSE_VALUES.has(value) ? false : null;
  }
  if (field.kind === "select") {
    const value = String(raw ?? "").trim();
    return field.options.some((option) => option.value === value) ? value : null;
  }
  if (raw === null || raw === undefined || String(raw).trim() === "") {
    return null;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  const clamped = Math.min(field.max, Math.max(field.min, parsed));
  return field.integer ? Math.round(clamped) : clamped;
}

export function buildSettings(
  fields: readonly Field[],
  source: (field: Field) => unknown,
  base: Settings
): Settings {
  const result: Record<string, SettingValue> = { ...base };
  for (const field of fields) {
    result[field.key] = sanitize(field, source(field)) ?? base[field.key];
  }
  return result as unknown as Settings;
}

function readStored(): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function loadSettings(fields: readonly Field[], defaults: Settings): Settings {
  const stored = readStored();
  return buildSettings(fields, (field) => stored[field.key], defaults);
}

export function saveSettings(fields: readonly Field[], settings: Settings, defaults: Settings): void {
  const overrides: Record<string, unknown> = {};
  for (const field of fields) {
    if (settings[field.key] !== defaults[field.key]) {
      overrides[field.key] = settings[field.key];
    }
  }
  try {
    if (Object.keys(overrides).length === 0) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
    }
  } catch {
    // Storage may be blocked; settings still apply for this session.
  }
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

const DESCRIBE_MARGIN_S = 10;
const SPEAK_MARGIN_S = 5;

export function visionRetryDelays(attempts: number, delay: AppConfig["visionRetryDelay"]): number[] {
  return Array.from({ length: Math.max(0, attempts - 1) }, (_, index) => Math.min(delay.base * 2 ** index, delay.max));
}

export function describeTimeoutMs(settings: Settings, delay: AppConfig["visionRetryDelay"]): number {
  const perAttempt = 2 * settings.visionTimeoutConnection + settings.visionTimeoutRequest;
  const delays = visionRetryDelays(settings.visionAttempts, delay);
  return (settings.visionAttempts * perAttempt + sum(delays) + DESCRIBE_MARGIN_S) * 1000;
}

export function speakTimeoutMs(settings: Settings, retryDelays: readonly number[]): number {
  const perAttempt = 3 * settings.ttsTimeout;
  return ((retryDelays.length + 1) * perAttempt + sum(retryDelays) + SPEAK_MARGIN_S) * 1000;
}
