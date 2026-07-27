// Read-only card: inventory items issued to the signed-in employee. Issued and
// returned by HR on the Item Management tab; this just surfaces the log.
import { formatDate } from '@/lib/format';
import type { MyItemRow } from '@/lib/queries';

function heldPill(returned: boolean): React.CSSProperties {
  return returned
    ? { borderColor: 'var(--line-2)', color: 'var(--ink-3)' }
    : { borderColor: 'var(--p-line)', color: 'var(--p)', background: 'var(--p-bg)' };
}

export function MyItems({ items }: { items: MyItemRow[] }) {
  const held = items.filter((i) => !i.returned).length;

  return (
    <div className="card">
      <div className="hd">
        <h3>My items</h3>
        <span className="folio">
          {held} held · {items.length} issued
        </span>
      </div>
      <div className="bd">
        {items.length === 0 ? (
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>
            No items have been issued to you, it will appear here.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Category</th>
                  <th className="right">Qty</th>
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
                    <td className="right mono">
                      {i.quantity}
                      {i.unit ? ` ${i.unit}` : ''}
                    </td>
                    <td className="mono">{formatDate(i.assignedDate)}</td>
                    <td>
                      <span className="pill" style={heldPill(i.returned)}>
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
