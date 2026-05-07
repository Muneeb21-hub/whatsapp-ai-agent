import pino from 'pino';
import { config } from './config.js';

const isDev = config.NODE_ENV !== 'production';

export const logger = pino(
  {
    level: config.LOG_LEVEL,
    base: { pid: process.pid },
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  isDev
    ? pino.transport({
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:HH:MM:ss',
          ignore: 'pid,hostname',
        },
      })
    : undefined,
);
