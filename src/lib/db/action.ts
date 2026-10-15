import 'server-only';
import { revalidatePath as invalidatePath } from 'next/cache';
import { withTransaction } from '@/lib/db/mongodb-connection';
import { deferUntilCommit } from '@/lib/db/transaction-context';

class ActionRefused<T> extends Error {
  constructor(readonly result: T) {
    super('The action was refused.');
  }
}

/** A returned refusal must roll back earlier writes just like a thrown driver error. */
async function runAction<T extends { ok?: boolean; error?: string }>(
  work: () => Promise<T>,
): Promise<T | { ok: false; error: string }> {
  try {
    return await withTransaction(
      async () => {
        const result = await work();
        if (result.ok === false) {
          throw new ActionRefused(result);
        }
        return result;
      },
      { required: true },
    );
  } catch (error) {
    if (error instanceof ActionRefused) {
      return error.result as T;
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Nothing was saved. Try again.',
    };
  }
}

function revalidatePath(path: string, type?: 'page' | 'layout'): void {
  if (!deferUntilCommit(() => invalidatePath(path, type))) {
    invalidatePath(path, type);
  }
}

export { runAction, revalidatePath };
