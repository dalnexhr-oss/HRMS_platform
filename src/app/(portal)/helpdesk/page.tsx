import { getTickets } from '@/lib/queries';
import { HelpdeskScreen } from '@/components/helpdesk/HelpdeskScreen';

export default async function HelpdeskPage() {
  const tickets = await getTickets();
  return <HelpdeskScreen tickets={tickets} />;
}
