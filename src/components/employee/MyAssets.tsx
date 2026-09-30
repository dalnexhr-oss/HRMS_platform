// Show the employee's current IT asset assignments. HR manages assignments.
import { formatDate } from '@/lib/display-formatting';
import type { MyAssetRow } from '@/lib/queries/assets';

function MyAssets({ assets, id }: { assets: MyAssetRow[]; id?: string }) {
  return (
    <div className="card" id={id}>
      <div className="card-header">
        <h3>My assets</h3>
        <span className="card-caption">{assets.length} assigned to you</span>
      </div>
      <div className="card-body">
        {assets.length === 0 ? (
          <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
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
                    <td className="text-monospace">{a.serial_no ?? '—'}</td>
                    <td>{a.model_no ?? '—'}</td>
                    <td className="text-monospace">
                      {a.assigned_date ? formatDate(a.assigned_date) : '—'}
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

export { MyAssets };
