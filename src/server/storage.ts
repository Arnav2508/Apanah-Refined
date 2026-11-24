import fs from 'node:fs/promises';
import path from 'node:path';
import { createSeedState } from '../core/seed';
import type { StoreState } from '../core/types';

function resolveDataFilePath(): string {
  if (process.env.APANAH_STATE_FILE) {
    return process.env.APANAH_STATE_FILE;
  }
  const isServerless = Boolean(
    process.env.VERCEL ||
      process.env.AWS_LAMBDA_FUNCTION_NAME ||
      process.env.K_SERVICE
  );
  if (isServerless) {
    return '/tmp/apanah-state.json';
  }
  return path.resolve(process.cwd(), 'data', 'apanah-state.json');
}

let writeQueue: Promise<void> = Promise.resolve();
let memoryCache: StoreState | null = null;

async function ensureWritablePath(): Promise<string> {
  const primary = resolveDataFilePath();
  try {
    await fs.mkdir(path.dirname(primary), { recursive: true });
    return primary;
  } catch {
    const fallback = '/tmp/apanah-state.json';
    await fs.mkdir(path.dirname(fallback), { recursive: true });
    return fallback;
  }
}

export async function loadStoreState(): Promise<StoreState> {
  if (memoryCache) {
    return memoryCache;
  }

  const filePath = await ensureWritablePath();
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as StoreState;
    if (parsed && Array.isArray(parsed.inventory) && Array.isArray(parsed.menu)) {
      memoryCache = parsed;
      return parsed;
    }
  } catch {
    // Seed state will be initialized below
  }

  const seed = createSeedState();
  await saveStoreState(seed);
  return seed;
}

async function writeStateToDisk(state: StoreState): Promise<void> {
  memoryCache = state;
  const filePath = await ensureWritablePath();
  const tmpPath = `${filePath}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(state, null, 2), 'utf-8');
  await fs.rename(tmpPath, filePath);
}

export async function saveStoreState(state: StoreState): Promise<StoreState> {
  memoryCache = state;
  const runWrite = () => writeStateToDisk(state);
  writeQueue = writeQueue.then(runWrite, runWrite);
  await writeQueue;
  return state;
}

export async function mutateStoreState<T>(
  mutator: (current: StoreState) => { nextState: StoreState; result: T } | Promise<{ nextState: StoreState; result: T }>
): Promise<{ state: StoreState; result: T }> {
  let outcome!: { state: StoreState; result: T };
  const task = async () => {
    const current = await loadStoreState();
    const { nextState, result } = await mutator(current);
    await writeStateToDisk(nextState);
    outcome = { state: nextState, result };
  };
  writeQueue = writeQueue.then(task, task);
  await writeQueue;
  return outcome;
}

export async function resetStoreState(): Promise<StoreState> {
  const seed = createSeedState();
  return saveStoreState(seed);
}
