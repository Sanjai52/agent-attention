/**
 * Notification provider contracts (PRD.md §9.4 C, Task 2.8).
 *
 * Providers submit a notification to the operating system and report a
 * structured outcome. "Delivered" means *submitted to the OS*, never "seen".
 * A provider MUST fail independently: implementations catch their own errors
 * and return `failed` or `unavailable` with an `errorCode`; they never throw
 * into the core or the queue.
 *
 * This package is pure orchestration. Windows implementations live in
 * `@agent-attention/platform-windows` (PRD §11).
 */

export type ProviderStatus = "delivered" | "failed" | "unavailable";

export interface ProviderResult {
  status: ProviderStatus;
  errorCode?: string;
}

export interface SoundRequest {
  soundId: string;
  volume: number;
  filePath?: string;
}

export interface SpeechRequest {
  text: string;
  voiceId: string | null;
  volume: number;
  rate: number;
}

export interface DesktopRequest {
  title: string;
  body: string;
}

export interface SoundProvider {
  play(request: SoundRequest): Promise<ProviderResult>;
}

export interface SpeechProvider {
  speak(request: SpeechRequest): Promise<ProviderResult>;
}

export interface DesktopProvider {
  show(request: DesktopRequest): Promise<ProviderResult>;
}

export interface ProviderSet {
  sound: SoundProvider;
  voice: SpeechProvider;
  desktop: DesktopProvider;
}
