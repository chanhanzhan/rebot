export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

export class Logger {
  private static instance: Logger;
  private logLevel: LogLevel = LogLevel.INFO;

  private constructor() {}

  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  private formatMessage(level: string, message: string, meta?: any): string {
    const timestamp = new Date().toISOString();
    const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
    return `${timestamp} [${level}]: ${message}${metaStr}`;
  }

  private log(level: LogLevel, levelName: string, message: string, meta?: any): void {
    if (level < this.logLevel) return;

    const formattedMessage = this.formatMessage(levelName, message, meta);
    console.log(formattedMessage);
  }

  public static info(message: string, meta?: any): void {
    Logger.getInstance().log(LogLevel.INFO, 'INFO', message, meta);
  }

  public static warn(message: string, meta?: any): void {
    Logger.getInstance().log(LogLevel.WARN, 'WARN', message, meta);
  }

  public static error(message: string, meta?: any): void {
    Logger.getInstance().log(LogLevel.ERROR, 'ERROR', message, meta);
  }

  public static debug(message: string, meta?: any): void {
    Logger.getInstance().log(LogLevel.DEBUG, 'DEBUG', message, meta);
  }

  public static setLogLevel(level: LogLevel): void {
    Logger.getInstance().logLevel = level;
  }
}