import { apiRoute } from '@/lib/api/route-handler';
import { handlePunch } from '@/lib/punch-http';

export const dynamic = 'force-dynamic';

const POST = apiRoute('POST /api/punch/out', (request) => handlePunch(request, 'out'));

export { POST };
