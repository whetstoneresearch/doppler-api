export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

const readStatusCode = (err: unknown): number | undefined => {
  if (typeof err !== 'object' || err === null || !('statusCode' in err)) {
    return undefined;
  }

  const statusCode = (err as { statusCode?: unknown }).statusCode;
  if (typeof statusCode !== 'number' || !Number.isInteger(statusCode)) {
    return undefined;
  }

  if (statusCode < 400 || statusCode > 599) {
    return undefined;
  }

  return statusCode;
};

const readCode = (err: unknown): string | undefined => {
  if (typeof err !== 'object' || err === null || !('code' in err)) {
    return undefined;
  }

  const code = (err as { code?: unknown }).code;
  if (typeof code !== 'string' || code.length === 0) {
    return undefined;
  }

  return code;
};

const readMessage = (err: unknown): string | undefined => {
  if (err instanceof Error && err.message.length > 0) {
    return err.message;
  }

  if (typeof err !== 'object' || err === null || !('message' in err)) {
    return undefined;
  }

  const message = (err as { message?: unknown }).message;
  if (typeof message !== 'string' || message.length === 0) {
    return undefined;
  }

  return message;
};

const readDetails = (err: unknown): unknown => {
  if (typeof err !== 'object' || err === null || !('details' in err)) {
    return undefined;
  }

  return (err as { details?: unknown }).details;
};

const resolveFallbackCode = (statusCode: number): string => {
  if (statusCode === 429) return 'RATE_LIMITED';
  if (statusCode >= 500) return 'INTERNAL_ERROR';
  return 'REQUEST_FAILED';
};

const resolveFallbackMessage = (statusCode: number): string => {
  if (statusCode === 429) return 'Rate limit exceeded';
  if (statusCode >= 500) return 'Internal server error';
  return 'Request failed';
};

export const asAppError = (err: unknown): AppError => {
  if (err instanceof AppError) {
    return err;
  }

  const statusCode = readStatusCode(err);
  if (statusCode !== undefined) {
    return new AppError(
      statusCode,
      readCode(err) ?? resolveFallbackCode(statusCode),
      readMessage(err) ?? resolveFallbackMessage(statusCode),
      readDetails(err),
    );
  }

  if (err instanceof Error) {
    return new AppError(500, 'INTERNAL_ERROR', err.message);
  }

  return new AppError(500, 'INTERNAL_ERROR', 'Unknown error');
};
