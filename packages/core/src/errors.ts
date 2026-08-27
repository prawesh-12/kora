export interface KoraErrorOptions {
  code: string;
  retryable?: boolean;
  context?: Record<string, unknown>;
  cause?: unknown;
}

export class KoraError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly context: Record<string, unknown>;

  constructor(message: string, opts: KoraErrorOptions) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = new.target.name;
    this.code = opts.code;
    this.retryable = opts.retryable ?? false;
    this.context = opts.context ?? {};
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      context: this.context,
    };
  }
}

export class ToolError extends KoraError {}
export class PolicyError extends KoraError {}
export class ModelError extends KoraError {}
export class ValidationError extends KoraError {}
export class ConfigError extends KoraError {}
