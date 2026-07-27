import { getTickets, getTicketComments } from '@/lib/queries';
import { getSession } from '@/lib/auth';
import { HelpdeskScreen } from '@/components/helpdesk/HelpdeskScreen';

export default async function HelpdeskPage() {
  const [{ profile }, tickets] = await Promise.all([getSession(), getTickets()]);
  const comments = await getTicketComments(tickets.map((t) => t.id));
  return <HelpdeskScreen tickets={tickets} comments={comments} selfId={profile?.id ?? null} />;
}
