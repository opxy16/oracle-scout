import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { LogEntry, LogStore } from "./log.js";

/** JSON Lines file store: one entry per line, only ever appended to. Node only. */
export class JsonlFileStore implements LogStore {
  private cache: LogEntry[] | null = null;

  constructor(readonly path: string) {}

  async readAll(): Promise<LogEntry[]> {
    if (this.cache) return [...this.cache];
    let text = "";
    try {
      text = await readFile(this.path, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    this.cache = text
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as LogEntry);
    return [...this.cache];
  }

  async append(entry: LogEntry): Promise<void> {
    await this.readAll();
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, JSON.stringify(entry) + "\n", "utf8");
    this.cache!.push(entry);
  }
}
