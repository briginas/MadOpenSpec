export function asError(value: unknown): Error & {code?: string | number; details?: Record<string, unknown>; stdout?: string; stderr?: string} {
  return value instanceof Error ? value : new Error(String(value));
}

export class CliError extends Error {
  code: string;
  details: Record<string, unknown>;

  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'CliError';
    this.code = code;
    this.details = details;
  }
}

export function problem(value: unknown) {
  const error = asError(value);
  return {code: String(error.code ?? 'IO_ERROR'), message: error.message, ...error.details};
}
