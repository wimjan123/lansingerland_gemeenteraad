import winston from 'winston';
import path from 'path';

const logLevel = process.env.LOG_LEVEL || 'info';
const logDir = path.resolve(process.cwd(), 'logs');

// Create winston logger
export const logger = winston.createLogger({
  level: logLevel,
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss'
    }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'lansingerland-scraper' },
  transports: [
    // Write all logs with level `error` and below to `error.log`
    new winston.transports.File({ 
      filename: path.join(logDir, 'error.log'), 
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    // Write all logs with level `info` and below to `scraper.log`
    new winston.transports.File({ 
      filename: path.join(logDir, 'scraper.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    // Write processing status to JSONL for easy parsing
    new winston.transports.File({
      filename: path.join(logDir, 'processing.jsonl'),
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
      maxsize: 10485760, // 10MB
      maxFiles: 3
    })
  ]
});

// If we're not in production, also log to console
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple(),
      winston.format.printf(({ timestamp, level, message, ...meta }) => {
        const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
        return `${timestamp} [${level}]: ${message}${metaStr}`;
      })
    )
  }));
}

// Helper function to log processing status
export function logProcessingStatus(
  meetingId: string, 
  status: 'started' | 'success' | 'skipped' | 'failed',
  details: Record<string, any> = {}
) {
  logger.info('processing_status', {
    meetingId,
    status,
    timestamp: new Date().toISOString(),
    ...details
  });
}