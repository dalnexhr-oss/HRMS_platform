import { getTickets, getTicketComments } from '@/lib/queries';
import { HelpdeskScreen } from '@/components/helpdesk/HelpdeskScreen';

export default async function HelpdeskPage() {
  const tickets = await getTickets();
  const comments = await getTicketComments(tickets.map((t) => t.id));
  return <HelpdeskScreen tickets={tickets} comments={comments} />;
}
