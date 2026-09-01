// ============================================================================
// Live ticket messages over SSE. Replaces Supabase Realtime's postgres_changes.
//
// Two transports, chosen at connect time:
//
//  * CHANGE STREAM on a replica set. mongod pushes each insert as it is
//    committed — the true equivalent of what Realtime did.
//  * POLLING on a standalone. Change streams require an oplog, which a
//    standalone does not have, and a chat window that silently never updates is
//    a worse outcome than one that updates a second late. The transport in use
//    is announced in the opening event so it is visible, not guessed at.
//
// Access is checked ONCE at subscribe time and the ticket id is then fixed for
// the life of the stream, so a caller cannot widen what they receive after the
// check has passed.
//
// Runs on Node, not the edge: an SSE stream needs a long-lived process.
// ============================================================================
import { COLLECTIONS } from '@/lib/db/collections';
import { scoped } from '@/lib/db/repo';
import { db, supportsTransactions } from '@/lib/db/mongo';
import { currentScope } from '@/lib/db/scope';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** How often the polling fallback looks for new messages. */
const POLL_MS = 2_000;
/** Comment keeping proxies from closing an idle connection. */
const HEARTBEAT_MS = 25_000;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ ticketId: string }> },
) {
  const { ticketId } = await params;

  const scope = await currentScope();
  if (!scope) return new Response('Not signed in.', { status: 401 });

  // The ticket must be visible to this caller under the collection's policy.
  // Checking here means the stream cannot be used to read a ticket the drawer
  // would never have opened.
  const tickets = await scoped<{ _id: string; status: string }>(COLLECTIONS.helpdeskTickets);
  const ticket = await tickets.findOne({ _id: ticketId });
  if (!ticket) return new Response('Not found.', { status: 404 });

  const live = await supportsTransactions(); // replica set => change streams
  const encoder = new TextEncoder();

  // Held so cancel() can reach the same teardown start() built.
  let stopRef: (() => void) | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      send('open', { transport: live ? 'change-stream' : 'poll' });

      const heartbeat = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(': ping\n\n'));
      }, HEARTBEAT_MS);

      let cleanup = () => {};

      // Idempotent: abort, a change-stream error and a normal close all reach
      // it, sometimes more than once.
      const stop = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        cleanup();
        try { controller.close(); } catch { /* already closed */ }
      };

      // REGISTERED BEFORE THE FIRST AWAIT, and this ordering is the fix.
      //
      // An AbortSignal does not fire listeners added after it has already
      // aborted. Registering at the end of start() meant a client who
      // disconnected while `await db()` was still resolving the connection
      // attached to a dead signal: stop() never ran, so the 25-second
      // heartbeat, the poll timer or the open change-stream cursor and the
      // captured controller all survived for the life of the process. Opening
      // and closing the drawer quickly, repeatedly, accumulated them.
      //
      // `cleanup` is read at call time, so the transports can assign it below.
      stopRef = stop;
      req.signal.addEventListener('abort', stop);
      if (req.signal.aborted) return stop();

      const database = await db();
      const comments = database.collection(COLLECTIONS.helpdeskTicketComments);

      // The client may have gone during the await; opening a change stream or
      // a poll timer now would leak exactly what the listener above prevents.
      if (closed || req.signal.aborted) return stop();

      if (live) {
        const changeStream = comments.watch(
          [{ $match: { operationType: 'insert', 'fullDocument.ticket_id': ticketId } }],
          { fullDocument: 'updateLookup' },
        );
        changeStream.on('change', (change) => {
          const doc = (change as { fullDocument?: Record<string, unknown> }).fullDocument;
          if (doc) send('comment', { ...doc, id: doc._id });
        });
        changeStream.on('error', () => {
          // ENDING the response is what makes this recoverable. After a
          // failover or a dropped cursor the change stream is dead and nothing
          // will ever arrive on it again — but the heartbeat kept ticking, so
          // the connection looked healthy to EventSource, which therefore never
          // reconnected and the drawer went quiet with nothing on screen to say
          // so. Closing is what triggers the browser's automatic retry.
          send('error', { message: 'The live connection dropped. Reconnecting…' });
          stop();
        });
        cleanup = () => void changeStream.close().catch(() => {});
      } else {
        // Poll by created_at rather than by a count: a count misses the case
        // where one message is deleted as another arrives.
        let since = new Date();
        const timer = setInterval(async () => {
          if (closed) return;
          try {
            const fresh = await comments
              .find({ ticket_id: ticketId, created_at: { $gt: since } })
              .sort({ created_at: 1 })
              .toArray();
            for (const doc of fresh) {
              since = (doc.created_at as Date) > since ? (doc.created_at as Date) : since;
              send('comment', { ...doc, id: doc._id });
            }
          } catch {
            // A transient read failure must not kill the stream; the next tick
            // picks up anything missed, because `since` only advances on success.
          }
        }, POLL_MS);
        cleanup = () => clearInterval(timer);
      }
    },
    cancel() {
      // The consumer let go of the stream without an abort — close the cursor
      // and the timers the same way.
      stopRef?.();
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Tells nginx not to buffer, which would otherwise hold every event until
      // the response ended — i.e. never.
      'x-accel-buffering': 'no',
    },
  });
}
