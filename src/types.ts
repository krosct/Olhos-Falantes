export interface DescribeResponse {
  ok: boolean;
  confidence: number;
  description: string;
  user_message: string;
  retry: boolean;
}

export type DescribeMode = "scene" | "text" | "environment";

export type DescribeDetail = "short" | "medium" | "long" | "full";

export type VoiceGroup = "piper" | "cloud";

export interface ServerVoice {
  id: string;
  label: string;
  group: VoiceGroup;
}

export interface VoicesResponse {
  voices: ServerVoice[];
  default: string | null;
}

export type VoiceChoice = { engine: "device" } | { engine: "piper"; voice: string };
