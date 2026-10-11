const BACK_CAMERA: MediaTrackConstraints = { facingMode: { ideal: "environment" } };
const CAPTURE_QUALITY = 0.92;

let activeStream: MediaStream | null = null;

export function isCameraSupported(): boolean {
  return typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
}

export function cameraErrorMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Permiss\u00e3o de c\u00e2mera negada. Use 'Escolher foto' para enviar uma imagem.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "N\u00e3o encontrei uma c\u00e2mera. Use 'Escolher foto'.";
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "N\u00e3o consegui abrir a c\u00e2mera. Use 'Escolher foto'.";
}

export async function openCamera(video: HTMLVideoElement): Promise<void> {
  if (!isCameraSupported()) {
    throw new Error("Este aparelho n\u00e3o tem c\u00e2mera dispon\u00edvel. Escolha uma foto.");
  }
  closeCamera();
  const stream = await navigator.mediaDevices.getUserMedia({ video: BACK_CAMERA, audio: false });
  activeStream = stream;
  video.srcObject = stream;
  await video.play();
}

export function closeCamera(): void {
  if (activeStream) {
    for (const track of activeStream.getTracks()) {
      track.stop();
    }
    activeStream = null;
  }
}

export async function captureFrame(video: HTMLVideoElement): Promise<Blob> {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) {
    throw new Error("A c\u00e2mera ainda n\u00e3o est\u00e1 pronta. Tente de novo.");
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("N\u00e3o consegui capturar a foto.");
  }
  context.drawImage(video, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", CAPTURE_QUALITY);
  });
  if (!blob) {
    throw new Error("N\u00e3o consegui capturar a foto.");
  }
  return blob;
}
