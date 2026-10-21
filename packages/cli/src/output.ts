export interface CliIo {
  stdout: { write(value: string): void };
  stderr: { write(value: string): void };
}

export function emit(value: unknown, options: { json: boolean; io: CliIo }): void {
  if (options.json) {
    options.io.stdout.write(`${JSON.stringify(value)}\n`);
    return;
  }
  if (typeof value === "string") {
    options.io.stdout.write(`${value}\n`);
    return;
  }
  options.io.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function error(io: CliIo, message: string): void {
  io.stderr.write(`${message}\n`);
}
