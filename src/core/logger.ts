import pino from 'pino';

export const createLogger = (level: string) =>
  pino({
    level,
    redact: {
      paths: ['req.headers.authorization', 'req.headers.x-api-key', 'config.privateKey'],
      censor: '[REDACTED]',
    },
  });
