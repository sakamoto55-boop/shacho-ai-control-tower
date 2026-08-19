import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { Deal, MoneyEntry, Pillar, TimeEntry } from '../domain/types.js';
import { nowIso } from '../utils/date.js';

interface Db {
  pillars: Pillar[];
  deals: Deal[];
  timeEntries: TimeEntry[];
  moneyEntries: MoneyEntry[];
}

function emptyDb(): Db {
  return { pillars: [], deals: [], timeEntries: [], moneyEntries: [] };
}

/**
 * ローカルJSON1ファイルの保管庫。
 * 一人分の記録にデータベースは要らない。中身を直接開いて直せることのほうが価値がある。
 */
export class Store {
  private readonly path: string;

  constructor(path = process.env.LOCAL_DB_PATH ?? './data/sanbo.json') {
    this.path = resolve(path);
  }

  get filePath(): string {
    return this.path;
  }

  private async read(): Promise<Db> {
    try {
      const content = await readFile(this.path, 'utf8');
      return { ...emptyDb(), ...(JSON.parse(content) as Partial<Db>) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyDb();
      throw error;
    }
  }

  private async write(db: Db): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, `${JSON.stringify(db, null, 2)}\n`, 'utf8');
  }

  async load(): Promise<Db> {
    return this.read();
  }

  async addPillar(pillar: Pillar): Promise<Pillar> {
    const db = await this.read();
    db.pillars.push(pillar);
    await this.write(db);
    return pillar;
  }

  async updatePillar(id: string, patch: Partial<Pillar>): Promise<Pillar | null> {
    const db = await this.read();
    const index = db.pillars.findIndex((item) => item.id === id);
    if (index < 0) return null;
    db.pillars[index] = { ...db.pillars[index], ...patch, id, updatedAt: nowIso() };
    await this.write(db);
    return db.pillars[index];
  }

  async listPillars(): Promise<Pillar[]> {
    return (await this.read()).pillars;
  }

  async addDeal(deal: Deal): Promise<Deal> {
    const db = await this.read();
    db.deals.push(deal);
    await this.write(db);
    return deal;
  }

  async updateDeal(id: string, patch: Partial<Deal>): Promise<Deal | null> {
    const db = await this.read();
    const index = db.deals.findIndex((item) => item.id === id);
    if (index < 0) return null;
    db.deals[index] = { ...db.deals[index], ...patch, id, updatedAt: nowIso() };
    await this.write(db);
    return db.deals[index];
  }

  async listDeals(): Promise<Deal[]> {
    return (await this.read()).deals;
  }

  async addTimeEntry(entry: TimeEntry): Promise<TimeEntry> {
    const db = await this.read();
    db.timeEntries.push(entry);
    await this.write(db);
    return entry;
  }

  async listTimeEntries(): Promise<TimeEntry[]> {
    return (await this.read()).timeEntries;
  }

  async addMoneyEntry(entry: MoneyEntry): Promise<MoneyEntry> {
    const db = await this.read();
    db.moneyEntries.push(entry);
    await this.write(db);
    return entry;
  }

  async listMoneyEntries(): Promise<MoneyEntry[]> {
    return (await this.read()).moneyEntries;
  }
}

/**
 * IDの先頭一致で1件だけ特定する。CLIで長いUUIDを打たなくて済むようにする。
 * 候補が複数ある場合はnullを返し、呼び出し側で「もう1文字ください」と伝える。
 */
export function findByIdPrefix<T extends { id: string }>(items: T[], prefix: string): T | null {
  const exact = items.find((item) => item.id === prefix);
  if (exact) return exact;
  const matched = items.filter((item) => item.id.startsWith(prefix));
  return matched.length === 1 ? matched[0] : null;
}
