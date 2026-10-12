function required<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Elemento ausente: ${id}`);
  }
  return element as T;
}

export interface Ui {
  btnDescribe: HTMLButtonElement;
  btnChoose: HTMLButtonElement;
  btnCapture: HTMLButtonElement;
  btnCancel: HTMLButtonElement;
  btnListen: HTMLButtonElement;
  btnPause: HTMLButtonElement;
  btnRedescribe: HTMLButtonElement;
  photoPreview: HTMLImageElement;
  progress: HTMLElement;
  elapsed: HTMLElement;
  fileInput: HTMLInputElement;
  cameraPanel: HTMLElement;
  video: HTMLVideoElement;
  consent: HTMLElement;
  consentCheck: HTMLInputElement;
  consentAccept: HTMLButtonElement;
  appContent: HTMLElement;
  btnResetSettings: HTMLButtonElement;
  settingsForm: HTMLFormElement;
}

export function getUi(): Ui {
  return {
    btnDescribe: required<HTMLButtonElement>("btn-describe"),
    btnChoose: required<HTMLButtonElement>("btn-choose"),
    btnCapture: required<HTMLButtonElement>("btn-capture"),
    btnCancel: required<HTMLButtonElement>("btn-cancel"),
    btnListen: required<HTMLButtonElement>("btn-listen"),
    btnPause: required<HTMLButtonElement>("btn-pause"),
    btnRedescribe: required<HTMLButtonElement>("btn-redescribe"),
    photoPreview: required<HTMLImageElement>("photo-preview"),
    progress: required<HTMLElement>("progress"),
    elapsed: required<HTMLElement>("elapsed"),
    fileInput: required<HTMLInputElement>("file-input"),
    cameraPanel: required<HTMLElement>("camera-panel"),
    video: required<HTMLVideoElement>("camera"),
    consent: required<HTMLElement>("consent"),
    consentCheck: required<HTMLInputElement>("consent-check"),
    consentAccept: required<HTMLButtonElement>("consent-accept"),
    appContent: required<HTMLElement>("app-content"),
    btnResetSettings: required<HTMLButtonElement>("btn-reset-settings"),
    settingsForm: required<HTMLFormElement>("settings-form")
  };
}

export function setActionButtonsDisabled(ui: Ui, disabled: boolean): void {
  ui.btnDescribe.disabled = disabled;
  ui.btnChoose.disabled = disabled;
}

export function setCameraVisible(ui: Ui, visible: boolean): void {
  ui.cameraPanel.hidden = !visible;
  ui.btnDescribe.hidden = visible;
  ui.btnChoose.hidden = visible;
  ui.btnCapture.hidden = !visible;
  ui.btnCancel.hidden = !visible;
}

export function setListenEnabled(ui: Ui, enabled: boolean): void {
  ui.btnListen.disabled = !enabled;
}

let previewUrl: string | null = null;

export function showPhotoPreview(ui: Ui, photo: Blob): void {
  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
  }
  previewUrl = URL.createObjectURL(photo);
  ui.photoPreview.src = previewUrl;
  ui.photoPreview.hidden = false;
}

export function showConsent(ui: Ui, visible: boolean): void {
  ui.consent.hidden = !visible;
  ui.appContent.hidden = visible;
}

let activeProgress = 0;

export function startProgress(ui: Ui): () => void {
  const startedAt = performance.now();
  const render = (): void => {
    ui.elapsed.textContent = `${Math.floor((performance.now() - startedAt) / 1000)} s`;
  };
  render();
  activeProgress += 1;
  ui.progress.hidden = false;
  const timer = window.setInterval(render, 250);
  let stopped = false;
  return () => {
    if (stopped) {
      return;
    }
    stopped = true;
    window.clearInterval(timer);
    activeProgress -= 1;
    if (activeProgress === 0) {
      ui.progress.hidden = true;
    }
  };
}
