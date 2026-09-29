import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { deviceTokenMatches, parseDevicePunch } from './punch-protocol';
import { recordDevicePunch } from './record-device-punch';
import { UnknownDeviceEmployee } from './employee-mapping';
import type { NextRequest } from 'next/server';

async function POST(request: NextRequest) {
  if (!deviceTokenMatches(request.headers.get('authorization'), process.env.ZKTECO_API_TOKEN)) {
    return NextResponse.json({ error: 'Unauthorized device.' }, { status: 401 });
  }
  let event;
  try {
    const text = await request.text();
    if (text.length > 4096) {
      throw new Error('Device punch payload is too large.');
    }
    event = parseDevicePunch(JSON.parse(text), process.env.ZKTECO_DEVICE_ID ?? '');
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Invalid punch.' },
      { status: 400 },
    );
  }
  try {
    const result = await recordDevicePunch(event);
    if (result.status === 'recorded' && !result.duplicate) {
      for (const path of ['/today', '/register', '/me']) {
        revalidatePath(path);
      }
    }
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof UnknownDeviceEmployee) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    console.error('[zkteco] Punch ingestion failed:', error);
    return NextResponse.json(
      { error: 'Could not save the device punch. The system will retry.' },
      { status: 503 },
    );
  }
}

export { POST };
