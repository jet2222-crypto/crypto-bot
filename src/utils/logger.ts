import { nowIso } from "./time";

function format(level: "INFO" | "WARN" | "ERROR", message: string): string {
  return `[${nowIso()}] [${level}] ${message}`;
}

export function info(message: string): void {
  console.log(format("INFO", message));
}

export function warn(message: string): void {
  console.warn(format("WARN", message));
}

export function error(message: string): void {
  console.error(format("ERROR", message));
}
