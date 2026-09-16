// Stream helpdesk messages over SSE after checking ticket access. Use MongoDB change streams on
// replica sets and polling on standalone deployments.
import { collections } from '@/lib/db/collections';
import { scoped } from '@/lib/db/repo';
import { db, supportsTransactions } from '@/lib/db/mongo';
import { currentScope } from '@/lib/db/scope';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// How often the polling fallback looks for new messages.
const pollMs = 2_000;
// Keep idle connections open through proxies.
const heartbeatMs = 25_000;

export async function GET(req: Request, { params }: { params: Promise<{ ticketId: string }> }) {
  const { ticketId } = await params;

  const scope = await currentScope();
  if (!scope) return new Response('Not signed in.', { status: 401 });

  // The ticket must be visible to this caller under the collection's policy.
  // Checking here means the stream cannot be used to read a ticket the drawer
  // would never have opened.
  const tickets = await scoped<{ _id: string; status: string }>(collections.helpdeskTickets);
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
      }, heartbeatMs);

      let cleanup = () => {};

      // Idempotent: abort, a change-stream error and a normal close all reach
      // it, sometimes more than once.
      const stop = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        cleanup();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      // Register abort handling before the first await so an early disconnect cannot leave timers
      // or change streams running. stop() reads the latest cleanup callback.
      stopRef = stop;
      req.signal.addEventListener('abort', stop);
      if (req.signal.aborted) return stop();

      const database = await db();
      const comments = database.collection(collections.helpdeskTicketComments);

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
        }, pollMs);
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
