/**
 * Structured Logger
 *
 * Zero-dependency JSON logger wrapping console.log/error.
 * Usage: const log = createLogger("search"); log.info("query", { query: "test" });
 */

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  level: LogLevel;
  message: string;
  component?: string;
  requestId?: string;
  timestamp: string;
  [key: string]: unknown;
}

function emit(entry: LogEntry) {
  const line = JSON.stringify(entry);
  if (entry.level === "error" || entry.level === "warn") {
    console.error(line);
  } else {
    console.log(line);
  }
}

export function createLogger(component: string) {
  return {
    debug(message: string, data?: Record<string, unknown>) {
      if (process.env.NODE_ENV === "production" && !process.env.DEBUG) return;
      emit({ level: "debug", message, component, timestamp: new Date().toISOString(), ...data });
    },
    info(message: string, data?: Record<string, unknown>) {
      emit({ level: "info", message, component, timestamp: new Date().toISOString(), ...data });
    },
    warn(message: string, data?: Record<string, unknown>) {
      emit({ level: "warn", message, component, timestamp: new Date().toISOString(), ...data });
    },
    error(message: string, error?: unknown, data?: Record<string, unknown>) {
      const errData =
        error instanceof Error
          ? { error: error.message, stack: error.stack }
          : error !== undefined
            ? { error: String(error) }
            : {};
      emit({
        level: "error",
        message,
        component,
        timestamp: new Date().toISOString(),
        ...errData,
        ...data,
      });
    },
  };
}
