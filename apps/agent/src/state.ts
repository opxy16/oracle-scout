import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { EvidenceItem, Stance } from "@oracle-scout/evidence";

export interface SubmissionRecord {
  evidenceId: string;
  marketId: string;
  stance: Stance;
  fingerprint: string;
  note: string;
  submittedAt: string;
  dryRun: boolean;
  remoteId?: string;
  receipt?: { verdict?: string; rationale?: string; reward?: number; raw?: unknown; checkedAt: string };
}

/** Small JSON-file state: submissions (append-only JSONL) and evidence items (one JSON per item). */
export class AgentState {
  constructor(readonly dir: string) {}

  private get subsPath() {
    return join(this.dir, "submissions.jsonl");
  }

  async submissions(): Promise<SubmissionRecord[]> {
    try {
      const text = await readFile(this.subsPath, "utf8");
      const latest = new Map<string, SubmissionRecord>();
      // later lines (receipt updates) supersede earlier ones for the same evidenceId
      for (const l of text.split("\n")) if (l.trim()) {
        const r = JSON.parse(l) as SubmissionRecord;
        latest.set(r.evidenceId, { ...latest.get(r.evidenceId), ...r });
      }
      return [...latest.values()];
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
  }

  async addSubmission(r: SubmissionRecord): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await appendFile(this.subsPath, JSON.stringify(r) + "\n");
  }

  async saveEvidence(item: EvidenceItem): Promise<string> {
    const p = join(this.dir, "evidence", `${item.id}.json`);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, JSON.stringify(item, null, 2));
    return p;
  }

  async loadEvidence(id: string): Promise<EvidenceItem | null> {
    try {
      return JSON.parse(await readFile(join(this.dir, "evidence", `${id}.json`), "utf8")) as EvidenceItem;
    } catch {
      return null;
    }
  }
}
