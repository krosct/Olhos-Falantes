const STATUS_ID = "status";
const RESULT_ID = "result";
const ANNOUNCER_ID = "announcer";

function elementById(id: string): HTMLElement | null {
  return document.getElementById(id);
}

export function setStatus(message: string): void {
  const el = elementById(STATUS_ID);
  if (el) {
    el.textContent = message;
  }
}

export function setDescription(message: string): void {
  const el = elementById(RESULT_ID);
  if (el) {
    el.textContent = message;
  }
}

export function announce(message: string, assertive = false): void {
  let el = elementById(ANNOUNCER_ID);
  if (!el) {
    el = document.createElement("div");
    el.id = ANNOUNCER_ID;
    el.className = "visually-hidden";
    el.setAttribute("role", "status");
    document.body.appendChild(el);
  }
  el.setAttribute("aria-live", assertive ? "assertive" : "polite");
  el.textContent = "";
  window.setTimeout(() => {
    el!.textContent = message;
  }, 60);
}
