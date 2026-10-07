import { apiRoute } from '@/lib/api/route-handler';
import { handlePunch } from '@/lib/punch-http';

export const dynamic = 'force-dynamic';

const POST = apiRoute('POST /api/punch/in', (request) => handlePunch(request, 'in'));

export { POST };
