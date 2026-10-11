import { describe, expect, it } from "vitest";
import { pickBestVoice, scoreVoice } from "../src/speech";

function voice(name: string, lang: string, localService = true, voiceURI = name) {
  return { name, lang, localService, voiceURI };
}

describe("pickBestVoice", () => {
  it("prefers a natural pt-BR voice over a basic one", () => {
    const voices = [
      voice("eSpeak Portuguese (Brazil)", "pt-BR"),
      voice("Microsoft Maria - Portuguese (Brazil)", "pt-BR"),
      voice("Microsoft Francisca Online (Natural) - Portuguese (Brazil)", "pt-BR", false)
    ];
    expect(pickBestVoice(voices)?.name).toContain("Francisca");
  });

  it("prefers the Google network voice in Chrome", () => {
    const voices = [
      voice("Luciana", "pt-BR"),
      voice("Google português do Brasil", "pt-BR", false)
    ];
    expect(pickBestVoice(voices)?.name).toBe("Google português do Brasil");
  });

  it("prefers the Android network voice", () => {
    const voices = [
      voice("Português Brasil", "pt_BR", true, "pt-br-x-afs-local"),
      voice("Português Brasil", "pt_BR", true, "pt-br-x-afs-network")
    ];
    expect(pickBestVoice(voices)?.voiceURI).toBe("pt-br-x-afs-network");
  });

  it("prefers pt-BR over pt-PT even if pt-PT sounds better", () => {
    const voices = [
      voice("Microsoft Raquel Online (Natural) - Portuguese (Portugal)", "pt-PT", false),
      voice("Microsoft Maria - Portuguese (Brazil)", "pt-BR")
    ];
    expect(pickBestVoice(voices)?.lang).toBe("pt-BR");
  });

  it("ignores voices in other languages", () => {
    expect(pickBestVoice([voice("Google US English", "en-US", false)])).toBeUndefined();
    expect(scoreVoice(voice("Google US English", "en-US", false))).toBe(-Infinity);
  });
});
