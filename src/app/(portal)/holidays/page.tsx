import { getHolidays } from '@/lib/queries';
import { HolidaysScreen } from '@/components/holidays/HolidaysScreen';

export default async function HolidaysPage() {
  const holidays = await getHolidays();
  return <HolidaysScreen holidays={holidays} />;
}
