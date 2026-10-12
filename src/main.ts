import { describeImage, DescribeError, fetchConfig, fetchVoices } from "./api";
import { announce, setDescription, setStatus } from "./a11y";
import { cameraErrorMessage, captureFrame, closeCamera, openCamera } from "./camera";
import { prepareImage } from "./image";
import {
  buildFields,
  buildSettings,
  DEVICE_VOICE,
  DEVICE_VOICE_NAME,
  describeTimeoutMs,
  FALLBACK_CONFIG,
  type Field,
  loadSettings,
  saveSettings,
  type SettingKey,
  type Settings,
  speakTimeoutMs
} from "./settings";
import { mountSettingsPanel } from "./settingsPanel";
import {
  pauseSpeech,
  type PlaybackState,
  resumeSpeech,
  setPlaybackHandler,
  setServerSpeechOptions,
  setVoiceChoice,
  setVoiceErrorHandler,
  speak
} from "./speech";
import {
  getUi,
  setActionButtonsDisabled,
  setCameraVisible,
  setListenEnabled,
  showConsent,
  startProgress,
  showPhotoPreview
} from "./ui";
import type { DescribeResponse, VoiceChoice } from "./types";

const ui = getUi();
let busy = false;
let lastPhoto: Blob | null = null;
let describedWith: string | null = null;
const reportedVoiceErrors = new Set<string>();
let consented = false;
let config = FALLBACK_CONFIG;
let fields: Field[] = buildFields([], config.limits);
let settings: Settings = { ...config.defaults };

const READY_MESSAGE = "Tudo pronto. Clique no bot\u00e3o Ouvir para escutar a descri\u00e7\u00e3o da imagem.";

function speakStatus(message: string): void {
  setStatus(message);
  announce(message);
  speak(message, { cache: true });
}

function setBusy(value: boolean): void {
  busy = value;
  setActionButtonsDisabled(ui, value || !consented);
  ui.btnCapture.disabled = value;
  ui.btnRedescribe.disabled = value || !consented || !lastPhoto;
}

async function requestDescription(image: Blob): Promise<void> {
  setListenEnabled(ui, false);
  setDescription("");
  speakStatus("Analisando a imagem.");
  const stopProgress = startProgress(ui);
  try {
    const response = await describeImage(image, {
      detail: settings.detail,
      people: settings.people,
      confidenceThreshold: settings.confidenceThreshold,
      timeoutConnection: settings.visionTimeoutConnection,
      timeoutRequest: settings.visionTimeoutRequest,
      attempts: settings.visionAttempts,
      timeoutMs: describeTimeoutMs(settings, config.visionRetryDelay)
    });
    describedWith = renderResponse(response) ? JSON.stringify(settings) : null;
  } catch (error) {
    const message =
      error instanceof DescribeError ? error.message : "N\u00e3o consegui descrever agora. Tente de novo.";
    setListenEnabled(ui, false);
    setDescription("");
    speakStatus(message);
  } finally {
    stopProgress();
  }
}

function renderResponse(response: DescribeResponse): boolean {
  if (!response.ok || response.retry || !response.description.trim()) {
    setListenEnabled(ui, false);
    setDescription("");
    speakStatus(response.user_message || "A foto n\u00e3o ficou boa. Tente outra.");
    return false;
  }
  setDescription(response.description);
  setListenEnabled(ui, true);
  speakStatus(READY_MESSAGE);
  return true;
}

async function sendPhoto(raw: Blob): Promise<void> {
  try {
    const prepared = await prepareImage(raw);
    lastPhoto = prepared;
    describedWith = null;
    ui.btnRedescribe.hidden = false;
    showPhotoPreview(ui, prepared);
    await requestDescription(prepared);
  } catch (error) {
    speakStatus(error instanceof Error ? error.message : "N\u00e3o consegui preparar a imagem.");
  }
}

function openFilePicker(): void {
  ui.fileInput.value = "";
  ui.fileInput.click();
}

async function startCameraFlow(): Promise<void> {
  if (busy) {
    return;
  }
  setBusy(true);
  try {
    await openCamera(ui.video);
    setCameraVisible(ui, true);
    speakStatus("C\u00e2mera aberta. Aponte para o que voc\u00ea quer saber e toque em Capturar.");
  } catch (error) {
    setCameraVisible(ui, false);
    speakStatus(cameraErrorMessage(error));
    openFilePicker();
  } finally {
    setBusy(false);
  }
}

async function handleCapture(): Promise<void> {
  if (busy) {
    return;
  }
  setBusy(true);
  try {
    const frame = await captureFrame(ui.video);
    closeCamera();
    setCameraVisible(ui, false);
    await sendPhoto(frame);
  } catch (error) {
    speakStatus(error instanceof Error ? error.message : "N\u00e3o consegui capturar a foto.");
  } finally {
    setBusy(false);
  }
}

function cancelCamera(): void {
  closeCamera();
  setCameraVisible(ui, false);
  speakStatus("C\u00e2mera fechada.");
}

async function handleFileChosen(): Promise<void> {
  const file = ui.fileInput.files?.[0];
  if (!file || busy) {
    return;
  }
  setBusy(true);
  try {
    closeCamera();
    setCameraVisible(ui, false);
    await sendPhoto(file);
  } finally {
    setBusy(false);
  }
}

async function redescribe(): Promise<void> {
  if (busy || !lastPhoto) {
    return;
  }
  if (describedWith === JSON.stringify(settings)) {
    listen();
    return;
  }
  setBusy(true);
  try {
    await requestDescription(lastPhoto);
  } finally {
    setBusy(false);
  }
}

function listen(): void {
  if (ui.btnListen.disabled) {
    return;
  }
  const text = document.getElementById("result")?.textContent ?? "";
  const stopProgress = startProgress(ui);
  if (!speak(text, { onReady: stopProgress, pausable: true })) {
    stopProgress();
  }
}

let playback: PlaybackState = "idle";

function togglePause(): void {
  if (playback === "paused") {
    resumeSpeech();
  } else {
    pauseSpeech();
  }
}

function renderPlayback(state: PlaybackState): void {
  playback = state;
  const visible = state === "playing" || state === "paused";
  if (!visible && document.activeElement === ui.btnPause) {
    ui.btnListen.focus();
  }
  ui.btnPause.hidden = !visible;
  ui.btnPause.textContent = state === "paused" ? "Continuar" : "Pausar";
}

function acceptConsent(): void {
  consented = true;
  setActionButtonsDisabled(ui, false);
  showConsent(ui, false);
  ui.btnDescribe.focus();
  speakStatus("Pronto. Tire ou envie uma foto para ser descrita.");
}

function initConsent(): void {
  setActionButtonsDisabled(ui, !consented);
  showConsent(ui, !consented);
  ui.consentCheck.addEventListener("change", () => {
    ui.consentAccept.disabled = !ui.consentCheck.checked;
  });
  ui.consentAccept.addEventListener("click", acceptConsent);
}

function voiceChoiceFrom(value: string): VoiceChoice {
  return value === DEVICE_VOICE ? { engine: "device" } : { engine: "piper", voice: value };
}

function voiceName(value: string): string {
  const field = fields.find((candidate) => candidate.key === "voice");
  const label = field?.kind === "select" ? field.options.find((option) => option.value === value)?.label : undefined;
  return value === DEVICE_VOICE || !label ? DEVICE_VOICE_NAME : label;
}

function applySettings(next: Settings): void {
  settings = next;
  setVoiceChoice(voiceChoiceFrom(next.voice));
  setServerSpeechOptions({
    ttsTimeout: next.ttsTimeout,
    timeoutMs: speakTimeoutMs(next, config.ttsRetryDelays)
  });
}

function greetVoice(): void {
  speak(`Oi, eu sou ${voiceName(settings.voice)}, estarei com voc\u00ea nessa jornada!`, { cache: true });
}

function handleSettingsChange(next: Settings, changed: SettingKey[], defaults: Settings): void {
  saveSettings(fields, next, defaults);
  applySettings(next);
  if (changed.includes("voice")) {
    reportedVoiceErrors.clear();
    greetVoice();
  }
}

async function initSettings(): Promise<void> {
  const [loadedConfig, { voices }] = await Promise.all([fetchConfig(), fetchVoices()]);
  config = loadedConfig;
  fields = buildFields(voices, config.limits);
  const defaults = buildSettings(fields, (field) => config.defaults[field.key], FALLBACK_CONFIG.defaults);
  applySettings(loadSettings(fields, defaults));
  mountSettingsPanel({
    form: ui.settingsForm,
    reset: ui.btnResetSettings,
    fields,
    current: settings,
    defaults,
    onChange: (next, changed) => handleSettingsChange(next, changed, defaults),
    onReset: (next, changed) => {
      handleSettingsChange(next, changed, defaults);
      speakStatus("Configura\u00e7\u00f5es restauradas para o padr\u00e3o do .env.");
    }
  });
}

function reportVoiceError(message: string): void {
  if (reportedVoiceErrors.has(message)) {
    return;
  }
  reportedVoiceErrors.add(message);
  const notice = `${message} Usando a voz do aparelho.`;
  setStatus(notice);
  announce(notice);
}

ui.btnDescribe.addEventListener("click", () => {
  void startCameraFlow();
});
ui.btnCapture.addEventListener("click", () => {
  void handleCapture();
});
ui.btnCancel.addEventListener("click", cancelCamera);
ui.btnChoose.addEventListener("click", openFilePicker);
ui.fileInput.addEventListener("change", () => {
  void handleFileChosen();
});
ui.btnListen.addEventListener("click", listen);
ui.btnPause.addEventListener("click", togglePause);
ui.btnRedescribe.addEventListener("click", () => {
  void redescribe();
});

setVoiceErrorHandler(reportVoiceError);
setPlaybackHandler(renderPlayback);
applySettings(settings);
initConsent();
void initSettings();
