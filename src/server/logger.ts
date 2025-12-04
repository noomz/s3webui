const colors = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  gray: "\x1b[90m",
  blue: "\x1b[34m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
};

type Level = "info" | "warn" | "error" | "success";

const badges: Record<Level, string> = {
  info: `${colors.blue}INFO${colors.reset}`,
  warn: `${colors.yellow}WARN${colors.reset}`,
  error: `${colors.red}ERROR${colors.reset}`,
  success: `${colors.green}OK${colors.reset}`,
};

const time = () => `${colors.gray}${new Date().toISOString()}${colors.reset}`;

const print = (level: Level, message: string, ...rest: unknown[]) => {
  console.log(`${time()} ${badges[level]} ${message}`, ...rest);
};

export const logInfo = (message: string, ...rest: unknown[]) => print("info", message, ...rest);
export const logWarn = (message: string, ...rest: unknown[]) => print("warn", message, ...rest);
export const logError = (message: string, ...rest: unknown[]) => print("error", message, ...rest);
export const logSuccess = (message: string, ...rest: unknown[]) => print("success", message, ...rest);
