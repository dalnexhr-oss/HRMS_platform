import { getSession } from '@/lib/server-auth';
import { getTickets, getTicketComments } from '@/lib/server-queries';
import { HelpdeskScreen } from '@/components/helpdesk/HelpdeskScreen';

async function HelpdeskPage() {
  const [{ profile }, tickets] = await Promise.all([getSession(), getTickets()]);
  const comments = await getTicketComments(tickets.map((t) => t.id));
  return <HelpdeskScreen tickets={tickets} comments={comments} selfId={profile?.id ?? null} />;
}

export { HelpdeskPage as default };
