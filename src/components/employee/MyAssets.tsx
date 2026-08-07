// Read-only card: the IT asset(s) currently assigned to the signed-in employee.
// Assignment is managed by HR on the Asset Management tab; this just surfaces it.
import { formatDate } from '@/lib/format';
import type { MyAssetRow } from '@/lib/queries';

export function MyAssets({ assets, id }: { assets: MyAssetRow[]; id?: string }) {
  return (
    <div className="card" id={id}>
      <div className="hd">
        <h3>My assets</h3>
        <span className="folio">
          {assets.length} assigned to you
        </span>
      </div>
      <div className="bd">
        {assets.length === 0 ? (
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>
            No IT asset is assigned to you.
          </p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>Asset</th>
                  <th>Brand</th>
                  <th>Serial no.</th>
                  <th>Model</th>
                  <th>Assigned on</th>
                </tr>
              </thead>
              <tbody>
                {assets.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <b>{a.desktop_name}</b>
                    </td>
                    <td>{a.brand ?? '—'}</td>
                    <td className="mono">{a.serial_no ?? '—'}</td>
                    <td>{a.model_no ?? '—'}</td>
                    <td className="mono">{a.assigned_date ? formatDate(a.assigned_date) : '—'}</td>
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
