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
export type PlaybackState = "idle" | "loading" | "playing" | "paused";

let choice: VoiceChoice = { engine: "device" };
let currentAudio: HTMLAudioElement | null = null;
let currentRequest: AbortController | null = null;
let currentUtterance: SpeechSynthesisUtterance | null = null;
let onVoiceError: ((message: string) => void) | null = null;
let onPlayback: ((state: PlaybackState) => void) | null = null;
let lastClip: { key: string; blob: Blob } | null = null;
let playback: PlaybackState = "idle";
let tracked = false;
let deviceText = "";
let deviceOffset = 0;

export interface SpeakOptions {
  cache?: boolean;
  onReady?: () => void;
  pausable?: boolean;
}

let serverOptions: { ttsTimeout?: number; timeoutMs?: number } = {};

export function setServerSpeechOptions(options: { ttsTimeout?: number; timeoutMs?: number }): void {
  serverOptions = options;
}

export function setVoiceErrorHandler(handler: (message: string) => void): void {
  onVoiceError = handler;
}

export function setPlaybackHandler(handler: (state: PlaybackState) => void): void {
  onPlayback = handler;
}

export function setVoiceChoice(next: VoiceChoice): void {
  choice = next;
}

export function getVoiceChoice(): VoiceChoice {
  return choice;
}

function setPlayback(state: PlaybackState): void {
  const next = tracked ? state : "idle";
  if (next !== playback) {
    playback = next;
    onPlayback?.(next);
  }
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
  currentUtterance = null;
  if (isSpeechSupported()) {
    window.speechSynthesis.cancel();
  }
  setPlayback("idle");
  tracked = false;
}

function speakWithDevice(text: string, offset = 0): boolean {
  if (!isSpeechSupported()) {
    setPlayback("idle");
    return false;
  }
  deviceText = text;
  deviceOffset = offset;
  const utterance = new SpeechSynthesisUtterance(text.slice(offset));
  utterance.lang = SPEECH_LANG;
  utterance.rate = SPEECH_RATE;
  const voice = pickBestVoice(loadVoices());
  if (voice) {
    utterance.voice = voice;
  }
  utterance.addEventListener("boundary", (event) => {
    if (currentUtterance === utterance && event.name === "word") {
      deviceOffset = offset + event.charIndex;
    }
  });
  const finish = (): void => {
    if (currentUtterance === utterance) {
      currentUtterance = null;
      setPlayback("idle");
    }
  };
  utterance.addEventListener("end", finish);
  utterance.addEventListener("error", finish);
  currentUtterance = utterance;
  window.speechSynthesis.speak(utterance);
  setPlayback("playing");
  return true;
}

async function speakWithServer(
  text: string,
  voice: string,
  controller: AbortController,
  cache: boolean
): Promise<void> {
  const key = `${voice}\n${text}`;
  const blob =
    lastClip?.key === key
      ? lastClip.blob
      : await fetchSpeech(text, voice, controller.signal, { ...serverOptions, cache });
  if (controller.signal.aborted) {
    return;
  }
  lastClip = { key, blob };
  const audio = new Audio(URL.createObjectURL(blob));
  currentAudio = audio;
  audio.addEventListener("ended", () => {
    if (currentAudio === audio) {
      stopAudio();
      setPlayback("idle");
    }
  });
  await audio.play();
  setPlayback("playing");
}

export function pauseSpeech(): void {
  if (playback !== "playing") {
    return;
  }
  if (currentAudio) {
    currentAudio.pause();
  } else {
    currentUtterance = null;
    window.speechSynthesis.cancel();
  }
  setPlayback("paused");
}

export function resumeSpeech(): void {
  if (playback !== "paused") {
    return;
  }
  if (currentAudio) {
    void currentAudio.play().then(() => setPlayback("playing"));
  } else {
    speakWithDevice(deviceText, deviceOffset);
  }
}

export function speak(text: string, options: SpeakOptions = {}): boolean {
  if (!text.trim()) {
    return false;
  }
  cancelSpeech();
  tracked = options.pausable ?? false;
  if (choice.engine === "device") {
    const spoken = speakWithDevice(text);
    options.onReady?.();
    return spoken;
  }
  const controller = new AbortController();
  currentRequest = controller;
  setPlayback("loading");
  speakWithServer(text, choice.voice, controller, options.cache ?? false)
    .catch((error: unknown) => {
      if (controller.signal.aborted) {
        return;
      }
      stopAudio();
      speakWithDevice(text);
      if (error instanceof SpeechError && error.userMessage) {
        onVoiceError?.(error.userMessage);
      }
    })
    .finally(() => {
      if (currentRequest === controller) {
        currentRequest = null;
      }
      options.onReady?.();
    });
  return true;
}
