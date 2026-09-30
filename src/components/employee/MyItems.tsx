// Show inventory issued to the employee. HR manages issues and returns.
import { formatDate } from '@/lib/display-formatting';
import type { MyItemRow } from '@/lib/queries/items';

function heldPill(returned: boolean): React.CSSProperties {
  return returned
    ? { borderColor: 'var(--border-strong)', color: 'var(--text-muted)' }
    : {
        borderColor: 'var(--attendance-present-border)',
        color: 'var(--attendance-present)',
        background: 'var(--attendance-present-background)',
      };
}

function MyItems({ items, id }: { items: MyItemRow[]; id?: string }) {
  const held = items.filter((i) => !i.returned).length;

  return (
    <div className="card" id={id}>
      <div className="card-header">
        <h3>My materials &amp; tools</h3>
        <span className="card-caption">
          {held} held · {items.length} issued
        </span>
      </div>
      <div className="card-body">
        {items.length === 0 ? (
          <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
            No materials or tools have been issued to you, they will appear here.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Material / Tool</th>
                  <th>Category</th>
                  <th className="text-right">Qty</th>
                  <th>Issued on</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <tr key={i.id}>
                    <td>
                      <b>{i.itemName}</b>
                    </td>
                    <td>{i.category ?? '—'}</td>
                    <td className="text-right text-monospace">
                      {i.quantity}
                      {i.unit ? ` ${i.unit}` : ''}
                    </td>
                    <td className="text-monospace">{formatDate(i.assignedDate)}</td>
                    <td>
                      <span className="status-badge" style={heldPill(i.returned)}>
                        {i.returned
                          ? `Returned${i.returnedDate ? ` ${formatDate(i.returnedDate)}` : ''}`
                          : 'Held'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export { MyItems };
