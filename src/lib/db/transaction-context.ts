import 'server-only';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { ClientSession } from 'mongodb';

interface TransactionContext {
  session: ClientSession;
  afterCommit: Array<() => void | Promise<void>>;
}

const transactionContext = new AsyncLocalStorage<TransactionContext>();

function transactionSession(): ClientSession | undefined {
  return transactionContext.getStore()?.session;
}

/** Return true when the effect was queued; aborted/retried attempts discard their effects. */
function deferUntilCommit(effect: () => void | Promise<void>): boolean {
  const context = transactionContext.getStore();
  if (!context) {
    return false;
  }
  context.afterCommit.push(effect);
  return true;
}

export { transactionContext, transactionSession, deferUntilCommit };
