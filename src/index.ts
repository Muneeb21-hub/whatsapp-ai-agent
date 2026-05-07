import { logger } from './logger.js';
import { startWhatsApp } from './whatsapp.js';

// ── Unhandled rejection / exception safety net ─────────────────────────────────

process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, 'Unhandled promise rejection');
  process.exit(1);
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');
  process.exit(1);
});

// ── Boot ───────────────────────────────────────────────────────────────────────

logger.info('🚀 Starting WhatsApp AI Agent...');

startWhatsApp().catch((err) => {
  logger.fatal({ err }, 'Fatal error during startup');
  process.exit(1);
});
