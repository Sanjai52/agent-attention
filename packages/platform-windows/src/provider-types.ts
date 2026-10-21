/**
 * Structural copies of the provider interfaces owned by `@agent-attention/notifications`.
 *
 * `packages/notifications` is the source of truth (Task 2.8). Phase 2 is being
 * implemented in parallel worktrees, so this package keeps local structural
 * copies to compile and test independently. The integration task should replace
 * these imports with the notifications package's definitions; the shapes are
 * intentionally identical.
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

export interface SoundProvider {
  play(request: SoundRequest): Promise<ProviderResult>;
}

export interface SpeechRequest {
  text: string;
  voiceId: string | null;
  volume: number;
  rate: number;
}

export interface SpeechProvider {
  speak(request: SpeechRequest): Promise<ProviderResult>;
}

export interface DesktopRequest {
  title: string;
  body: string;
}

export interface DesktopProvider {
  show(request: DesktopRequest): Promise<ProviderResult>;
}

export interface ForegroundWindow {
  processId: number;
  executable: string;
}

/**
 * Foreground-window detection only. Session attribution (session -> HWND) is
 * supplied by the host integration and is supported only for Windows Terminal
 * and classic console per Q-06/F13-R5.
 */
export interface FocusProvider {
  getForeground(): Promise<ForegroundWindow | undefined>;
}
