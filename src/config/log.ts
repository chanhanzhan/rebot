import * as fs from 'fs';
import * as path from 'path';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

export class Logger {
  private static logLevel: LogLevel = LogLevel.INFO;
  private static logToFile: boolean = true;
  private static logToConsole: boolean = true;
  private static logDir: string = path.resolve('logs');
  private static logFile: string = path.join(Logger.logDir, 'bot.log');
  private static maxLogSize: number = 10 * 1024 * 1024; // 10MB
  private static maxLogFiles: number = 5;

  public static setLogLevel(level: LogLevel) {
    Logger.logLevel = level;
  }
  public static setLogToFile(enable: boolean) {
    Logger.logToFile = enable;
  }
  public static setLogToConsole(enable: boolean) {
    Logger.logToConsole = enable;
  }
  public static setLogDir(dir: string) {
    Logger.logDir = dir;
    Logger.logFile = path.join(dir, 'bot.log');
  }
  public static setMaxLogSize(size: number) {
    Logger.maxLogSize = size;
  }
  public static setMaxLogFiles(count: number) {
    Logger.maxLogFiles = count;
  }

  private static ensureLogDir() {
    if (!fs.existsSync(Logger.logDir)) {
      fs.mkdirSync(Logger.logDir, { recursive: true });
    }
  }

  private static rotateLogs() {
    if (!fs.existsSync(Logger.logFile)) return;
    const stats = fs.statSync(Logger.logFile);
    if (stats.size < Logger.maxLogSize) return;
    for (let i = Logger.maxLogFiles - 1; i >= 1; i--) {
      const src = path.join(Logger.logDir, `bot.log.${i}`);
      const dst = path.join(Logger.logDir, `bot.log.${i + 1}`);
      if (fs.existsSync(src)) fs.renameSync(src, dst);
    }
    fs.renameSync(Logger.logFile, path.join(Logger.logDir, 'bot.log.1'));
  }

  private static writeLog(level: string, msg: string) {
    Logger.ensureLogDir();
    Logger.rotateLogs();
    const now = new Date();
    const line = `[${now.toISOString()}] [${level}] ${msg}\n`;
    if (Logger.logToFile) {
      fs.appendFileSync(Logger.logFile, line, { encoding: 'utf8' });
    }
    if (Logger.logToConsole) {
      let coloredLine = line.trim();
      switch (level) {
        case 'ERROR':
          coloredLine = `\x1b[31m${coloredLine}\x1b[0m`;
          break;
        case 'WARN':
          coloredLine = `\x1b[33m${coloredLine}\x1b[0m`;
          break;
        case 'INFO':
          coloredLine = `\x1b[36m${coloredLine}\x1b[0m`;
          break;
        case 'DEBUG':
          coloredLine = `\x1b[32m${coloredLine}\x1b[0m`;
          break;
      }
      console.log(coloredLine);
    }
  }

  public static debug(...args: any[]) {
    if (Logger.logLevel <= LogLevel.DEBUG) {
      Logger.writeLog('DEBUG', args.map(Logger.stringify).join(' '));
    }
  }
  public static info(...args: any[]) {
    if (Logger.logLevel <= LogLevel.INFO) {
      Logger.writeLog('INFO', args.map(Logger.stringify).join(' '));
    }
  }
  public static warn(...args: any[]) {
    if (Logger.logLevel <= LogLevel.WARN) {
      Logger.writeLog('WARN', args.map(Logger.stringify).join(' '));
    }
  }
  public static error(...args: any[]) {
    if (Logger.logLevel <= LogLevel.ERROR) {
      Logger.writeLog('ERROR', args.map(Logger.stringify).join(' '));
    }
  }
  private static stringify(arg: any): string {
    if (typeof arg === 'string') return arg;
    try {
      return JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  }
}