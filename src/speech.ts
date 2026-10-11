import { fetchSpeech, SpeechError } from "./api";
import type { VoiceChoice } from "./types";

const SPEECH_LANG = "pt-BR";
const SPEECH_RATE = 1;

type VoiceInfo = Pick<SpeechSynthesisVoice, "name" | "lang" | "voiceURI" | "localService">;

const QUALITY_HINTS: ReadonlyArray<[RegExp, number]> = [
  [/natural/i, 60],
  [/neural|enhanced|premium|wavenet/i, 50],
  [/online/i, 30],
  [/network/i, 25],
  [/google/i, 20],
  [/espeak|compact|robot/i, -80]
];

let cachedVoices: SpeechSynthesisVoice[] = [];

export function isSpeechSupported(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

function normalizeLang(lang: string): string {
  return lang.replace("_", "-").toLowerCase();
}

export function scoreVoice(voice: VoiceInfo): number {
  const lang = normalizeLang(voice.lang);
  let score: number;
  if (lang === "pt-br") {
    score = 1000;
  } else if (lang.startsWith("pt")) {
    score = 10;
  } else {
    return -Infinity;
  }
  const label = `${voice.name} ${voice.voiceURI}`;
  for (const [pattern, bonus] of QUALITY_HINTS) {
    if (pattern.test(label)) {
      score += bonus;
    }
  }
  if (!voice.localService) {
    score += 5;
  }
  return score;
}

export function pickBestVoice<T extends VoiceInfo>(voices: readonly T[]): T | undefined {
  let best: T | undefined;
  let bestScore = -Infinity;
  for (const voice of voices) {
    const score = scoreVoice(voice);
    if (score > bestScore) {
      best = voice;
      bestScore = score;
    }
  }
  return best;
}

function loadVoices(): SpeechSynthesisVoice[] {
  const voices = window.speechSynthesis.getVoices();
  if (voices.length > 0) {
    cachedVoices = voices;
  }
  return cachedVoices;
}

if (isSpeechSupported()) {
  loadVoices();
  window.speechSynthesis.addEventListener?.("voiceschanged", loadVoices);
}

let choice: VoiceChoice = { engine: "device" };
let currentAudio: HTMLAudioElement | null = null;
let currentRequest: AbortController | null = null;
let onVoiceError: ((message: string) => void) | null = null;

export interface SpeakOptions {
  cache?: boolean;
}

let serverOptions: { ttsTimeout?: number; timeoutMs?: number } = {};

export function setServerSpeechOptions(options: { ttsTimeout?: number; timeoutMs?: number }): void {
  serverOptions = options;
}

export function setVoiceErrorHandler(handler: (message: string) => void): void {
  onVoiceError = handler;
}

export function setVoiceChoice(next: VoiceChoice): void {
  choice = next;
}

export function getVoiceChoice(): VoiceChoice {
  return choice;
}

function stopAudio(): void {
  if (currentAudio) {
    currentAudio.pause();
    URL.revokeObjectURL(currentAudio.src);
    currentAudio = null;
  }
}

export function cancelSpeech(): void {
  currentRequest?.abort();
  currentRequest = null;
  stopAudio();
  if (isSpeechSupported()) {
    window.speechSynthesis.cancel();
  }
}

function speakWithDevice(text: string): boolean {
  if (!isSpeechSupported()) {
    return false;
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = SPEECH_LANG;
  utterance.rate = SPEECH_RATE;
  const voice = pickBestVoice(loadVoices());
  if (voice) {
    utterance.voice = voice;
  }
  window.speechSynthesis.speak(utterance);
  return true;
}

async function speakWithServer(
  text: string,
  voice: string,
  controller: AbortController,
  cache: boolean
): Promise<void> {
  const blob = await fetchSpeech(text, voice, controller.signal, { ...serverOptions, cache });
  if (controller.signal.aborted) {
    return;
  }
  const audio = new Audio(URL.createObjectURL(blob));
  currentAudio = audio;
  audio.addEventListener("ended", () => {
    if (currentAudio === audio) {
      stopAudio();
    }
  });
  await audio.play();
}

export function speak(text: string, options: SpeakOptions = {}): boolean {
  if (!text.trim()) {
    return false;
  }
  cancelSpeech();
  if (choice.engine === "device") {
    return speakWithDevice(text);
  }
  const controller = new AbortController();
  currentRequest = controller;
  speakWithServer(text, choice.voice, controller, options.cache ?? false)
    .catch((error: unknown) => {
      if (controller.signal.aborted) {
        return;
      }
      speakWithDevice(text);
      if (error instanceof SpeechError && error.userMessage) {
        onVoiceError?.(error.userMessage);
      }
    })
    .finally(() => {
      if (currentRequest === controller) {
        currentRequest = null;
      }
    });
  return true;
}
