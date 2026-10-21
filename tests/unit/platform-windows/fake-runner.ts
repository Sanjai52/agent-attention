import type {
  FixedScriptOptions,
  FixedScriptResult,
  RunFixedScript,
} from "@agent-attention/platform-windows";

export interface RunnerCall {
  options: FixedScriptOptions;
  result: FixedScriptResult;
}

export function scriptResult(
  overrides: Partial<FixedScriptResult> = {},
): FixedScriptResult {
  return {
    code: 0,
    stdout: "",
    stderr: "",
    timedOut: false,
    aborted: false,
    ...overrides,
  };
}

export interface FakeRunner {
  run: RunFixedScript;
  calls: RunnerCall[];
}

/**
 * Deterministic stand-in for the PowerShell runner. Unit tests never spawn a
 * real process, so they cannot pop audio, speak, or show a toast.
 */
export function createFakeRunner(
  handler: (
    options: FixedScriptOptions,
    callIndex: number,
  ) => FixedScriptResult | Promise<FixedScriptResult> = () => scriptResult(),
): FakeRunner {
  const calls: RunnerCall[] = [];

  const run: RunFixedScript = async (options) => {
    const result = await handler(options, calls.length);
    calls.push({ options, result });
    return result;
  };

  return { run, calls };
}
