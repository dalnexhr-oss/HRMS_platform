import { getEmployeeContext } from '@/lib/employee-self-service';
import { getMyTickets, getTicketComments } from '@/lib/queries/helpdesk';
import { MyTickets } from '@/components/employee/MyTickets';
import { UnlinkedEmployeeNotice } from '@/components/employee/UnlinkedEmployeeNotice';

// The employee's own helpdesk tickets.
async function EmployeeHelpdeskPage() {
  const { profile, employeeId, canSubmit, blockedReason } = await getEmployeeContext();
  const tickets = employeeId ? await getMyTickets(employeeId) : [];
  // Fetch the comments for all tickets in one go, so each ticket can show its conversation.
  const comments = await getTicketComments(tickets.map((t) => t.id));

  return (
    <div className="content-container grid">
      <UnlinkedEmployeeNotice employeeId={employeeId} />
      <MyTickets
        tickets={tickets}
        comments={comments}
        selfId={profile?.id ?? null}
        canRaise={canSubmit}
        blockedReason={blockedReason}
        id="tickets"
      />
    </div>
  );
}

export { EmployeeHelpdeskPage as default };
