# Olhos Falantes

> Photograph a scene and hear a short, clear description of it. Built for people
> who cannot see the screen.
> Fotografe uma cena e ouça uma descrição curta e clara dela. Feito para quem não
> vê a tela.

---

## 1. Purpose

A person who is blind or has low vision holds a phone and wants to know what is
in front of them: what is on the table, what the room looks like, what a paper
says. Existing apps are heavy, ad-filled, or hide the "describe" action behind
menus that require sight.

**One-liner:** photo in, short spoken scene description out.

---

## 2. Main Pain (the reason this exists)

- "I can't see what's around me and I need a quick description."
- Screen-first apps assume the user can find the button by looking.
- A long, vague, or slow answer is useless in the moment.
- The person needs it fast, in plain language, and possibly repeated.

---

## 3. Persona

**Primary persona — dona Lúcia, 58, blind since her 40s.**
- Uses a phone daily with a screen reader (TalkBack).
- Needs large, predictable controls and voice feedback for everything.
- Holds the phone and needs the back camera to point at the scene.
- Wants a description of objects, layout, and short text — not a novel.
- Device: Android phone, TalkBack on, Chrome up to date.

**Secondary persona — a person with low vision.**
- Same need, benefits from high contrast and big text.

**Anti-persona.**
- Someone using it to read confidential documents or to identify people. That
  is out of scope and unsafe.

---

## 4. Features

### MVP (v1)
- One primary, huge button: **"Tirar foto e descrever"**.
- Secondary: **"Escolher foto"**.
- After capture: send image to the cloud vision-language API and get a **short
  description** (a few sentences): main objects, layout, and short visible text.
- Show the text on screen in large, high-contrast type.
- A clear **"Ouvir"** button that speaks the text via `speechSynthesis`.
- Spoken progress states ("Analisando...", "Pronto") so the user is never left
  in silence during the wait.
- Repeat button to hear again.
- Works on: desktop browser, Android Chrome, and Android TWA.

### Later (v1.1+)
- Adjustable speech rate.
- "Descrever com foco" modes (e.g. "leia o texto", "descreva o ambiente").
- Save last description (local only).

### Out of scope (do NOT build in v1)
- Identifying or naming people, faces, age, gender, emotion, ethnicity.
- Reading identity documents, credit cards, or banking screens.
- Guessing medical information from an image.
- Continuous live description (video). Snapshots only.
- Accounts, cloud history, iOS.

---

## 5. Platforms & Compatibility

| Platform | Supported | Notes |
|---|---|---|
| Desktop browser (Chrome/Edge) | Yes | Webcam or file picker |
| Android Chrome | Yes | Main mobile target; TalkBack |
| Android TWA (installed app) | Yes | Same web app wrapped |
| iOS Safari / iPhone | No | Out of scope for v1 |

**Accessibility is a hard requirement, not a nicety.**
- The UI must be fully usable **without seeing the screen**: large targets,
  high contrast, and spoken feedback for every state.
- No hover-only interactions. No color-only meaning.
- Every control has a proper accessible label for TalkBack.
- Buttons >= 48px; primary action even larger.
- Focus order is logical and predictable.

**Rules that make this work everywhere:**
- The site is the product; the TWA is the same site wrapped with Bubblewrap.
- HTTPS is mandatory.
- Camera permission requested only after a tap, with a spoken/visible cue.
- `speechSynthesis` **only fires reliably after a user gesture**, so speech is
  always tied to the "Ouvir" button, never assumed to auto-play.
- TTS inside a TWA can fail silently; always keep the text on screen and test on
  a real device.

---

## 6. Architecture

```
[ Browser (Vite + TS PWA) ]
   |  HTTPS, image compressed client-side
   v
[ Lightweight backend / proxy ]  -- holds API key, rate limit, strips EXIF
   |
   v
[ Cloud vision-language API ]  -- returns a short description (prompt fixed)
   |
   v
[ Browser shows large text + optional speech via speechSynthesis ]
```

- **No API key in the client.**
- One backend route: `POST /api/describe`.
- The vision-language vendor sits behind an **adapter**; the prompt is **fixed**
  and lives on the server.
- The text is the deliverable; audio is an enhancement.

---

## 7. Tech Stack — Tools, Libraries, Frameworks

### Frontend
- **Vite 6** + **TypeScript**.
- **vite-plugin-pwa** — manifest, service worker, installability.
- **Vanilla TS + minimal CSS**, built with accessibility first.
- Camera: `getUserMedia({ video: { facingMode: "environment" } })` + file
  picker fallback.
- Image handling: `<canvas>` for EXIF rotation, resize, JPEG re-encode.
- Speech: `window.speechSynthesis` (`SpeechSynthesisUtterance`, pt-BR voice).
- Screen reader support: correct ARIA roles/labels, `aria-live` for progress and
  result announcements.

### Backend (proxy)
- **Python + FastAPI** (local venv) or an equivalent small serverless function.
- Holds the vendor key, enforces the fixed prompt, rate limits, strips metadata,
  never persists images.

### Android packaging (TWA)
- **Bubblewrap** to generate the TWA project.
- **Digital Asset Links** matching the signing certificate SHA-256.
- Android manifest declares **camera** only.
- Icons 192/512 + maskable, `display: standalone`.

### Vision vendor
- A cloud vision-language API behind an adapter with a **fixed prompt** (section
  8). The heaviest of the five projects; keep it server-side.

### Tooling
- `npm` for the frontend; `~/.venv/bin/python` and `~/.venv/bin/pip` for the
  backend. Never install Python packages globally.

---

## 8. API Contract (fixed)

**Fixed server-side prompt (summary):** describe the scene in short sentences
in Brazilian Portuguese: main objects, their rough layout, and any short visible
text. Do not identify people, do not guess identity, do not give medical or
safety advice, do not speculate beyond what is visible. Built by
`server/prompt.py:build_prompt(detail, people)`; only the two user options below
change it.

- Length by `detail`: `short` = at most 3 sentences, `medium` (default) = 6,
  `long` = 9, `full` = as much detail and information as possible.
- `people=true` adds a description of people that are present (count, position,
  clothing, posture, action). Identity, name, age, gender, emotion, ethnicity
  and facial features stay forbidden in every mode.

**Request** — `POST /api/describe`, `multipart/form-data`:
- `image`: JPEG, max 1280px long edge, max ~1.5 MB.
- `mode` (optional in v1): e.g. `scene` (default).
- `detail` (optional): `short` | `medium` | `long` | `full`; default `medium`.
  Unknown values fall back to `medium`.
- `people` (optional): `true` | `false`; default `false`.
- `confidence_threshold` (optional): 0–1; default `CONFIDENCE_THRESHOLD`.
- `timeout_connection` (optional): seconds to connect and upload, per attempt,
  1–60; default `VISION_TIMEOUT_CONNECTION`.
- `timeout_request` (optional): seconds waiting for the model answer, per
  attempt, 5–300; default `VISION_TIMEOUT_REQUEST`.
- `attempts` (optional): integer, 1–30; default `VISION_ATTEMPTS` (3).
- The server clamps every optional value to its range. Defaults come from
  `.env` and are published, without secrets, at `GET /api/config`.

**Response** — JSON, fixed schema:
```json
{
  "ok": true,
  "confidence": 0.83,
  "description": "Uma mesa com uma xícara, um caderno e um celular. A janela ao fundo está aberta.",
  "user_message": "Descrição pronta.",
  "retry": false
}
```

- `description`: plain pt-BR, length set by `detail`.
- `confidence` in `[0,1]`.
- If the image is unusable → `ok:true` with a `user_message` asking for another
  photo and `retry:true`; never fabricate a description.
- **The contract and the prompt must not change** once the UI is built.

---

## 9. Camera & Image Pipeline Rules

- Request permission only after a tap; announce it via speech and screen reader.
- Prefer the **back camera** (`facingMode: "environment"`) for pointing at a
  scene.
- One snapshot per action. No video.
- Before upload: EXIF-rotate, resize long edge <= 1280px, JPEG q0.8, strip
  metadata, reject if > ~1.5 MB.
- Upload timeout: 20s, with **spoken** progress ("Analisando...").
- Rate limit a few requests per minute.
- Always keep the description text on screen even if speech fails.

---

## 10. Privacy & LGPD

- This app may photograph other people. Consent for camera use and for sending
  images to a third-party cloud API must be explicit, in plain Portuguese, before
  the first send.
- **No face recognition, no identity, no biometrics.** The fixed prompt forbids
  identifying people.
- No image is stored by default — neither on device nor server. The backend must
  not log image contents.
- Service worker must not cache any POST response or image.
- Do not use it to read confidential documents; state this limitation.

---

## 11. Failure Modes & Safeguards

| Failure | Safeguard |
|---|---|
| Camera permission denied | File-picker fallback, announced by voice |
| `speechSynthesis` silent/failing (common in TWA) | Keep text on screen; "Ouvir" re-triggers; test on device |
| Speech needs a gesture | Only speak from the "Ouvir" button |
| Long/vague answer | Fixed prompt caps length and forbids speculation |
| Identifies a person | Prompt forbids it; description is about objects/scene |
| Photo dark/blurry | Ask for another photo (spoken), no fabrication |
| API timeout | Retry; 20s timeout; spoken status |
| Vendor outage | `ok:false`, friendly + spoken message, app stays usable |
| User cannot find the button | One huge primary action; TalkBack labels |

---

## 12. Build Order (roadmap)

1. **Week 0 — decide and freeze.** Domain + HTTPS, privacy text, the fixed
   prompt, JSON contract, and a stub descriptor.
2. **Week 1 — camera + accessibility on real hardware.** Camera + fallback on
   desktop and a real Android phone with TalkBack, against the stub. Verify the
   whole flow can be completed with the screen reader alone.
3. **Week 2 — real API.** Connect proxy + vendor; verify description quality and
   length in pt-BR.
4. **Week 3 — harden.** Speech fallbacks, low confidence, blurry/dark, offline,
   timeout, denied permission.
5. **Week 4 — PWA install.** Manifest, icons, service worker; verify on Android
   Chrome with TalkBack.
6. **Week 5 — TWA.** Bubblewrap, Digital Asset Links, camera permission; test
   TTS and camera inside the installed app.

Never build the APK/TWA before the site works in Android Chrome.

---

## 13. Definition of Done (v1)

- [ ] The full flow works with TalkBack only, no sight required.
- [ ] One huge "Tirar foto e descrever" button; "Escolher foto" fallback.
- [ ] Short pt-BR description from a fixed server-side prompt.
- [ ] "Ouvir" speaks the text; text always on screen too.
- [ ] Spoken progress states ("Analisando...", "Pronto").
- [ ] No person identification anywhere in the output.
- [ ] No API key in client code or bundles.
- [ ] Images resized and EXIF-rotated before upload.
- [ ] Offline, denied-permission, timeout handled with voice feedback.
- [ ] Service worker caches only the app shell.
- [ ] Privacy notice shown and accepted before first upload.
- [ ] Installs as PWA; TWA builds and camera + TTS work inside it.
- [ ] High contrast; buttons >= 48px.

---

## 14. Shared Traps — Do Not Trip On These

The five projects share this list. It is repeated in each document on purpose.

1. Never expose the cloud API key in the client. Always use a proxy.
2. Test the camera on a real Android device in the first week.
3. Keep HTTPS from day one; `getUserMedia` and TWA both require it.
4. Compress and rotate images before upload.
5. Define a confidence threshold and show "não sei" below it.
6. Handle denied permission, offline, and timeout from the start.
7. Do not store photos locally by default.
8. Build the TWA only after the site works in Android Chrome.
9. The Android asset-links fingerprint must match the exact signing keystore.
10. Fix the JSON contract before building the UI.
11. TTS in a TWA fails silently: always keep the text visible and test early.
12. `speechSynthesis` needs a user gesture; do not auto-assume it played.
13. Never identify people. The prompt must forbid it.
14. iOS is out of scope. Do not let it creep back in mid-development.

---

## 15. Fixed Scope Guard

- One snapshot per action; short description; text is the deliverable.
- Fixed, server-side prompt; no person identification; no document reading.
- Accessibility (TalkBack + voice) is mandatory, not optional.
- No accounts, no history, no payments, no iOS.
- Android only for the packaged app.
