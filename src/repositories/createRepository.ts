import type { Repository } from './Repository.js';
import { KintoneRepository } from './KintoneRepository.js';
import { LocalRepository } from './LocalRepository.js';

export function createRepository(): Repository {
  const driver = process.env.STORAGE_DRIVER ?? 'local';
  if (driver === 'kintone') return new KintoneRepository();
  return new LocalRepository();
}
