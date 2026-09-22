'use client';

import type { ComponentProps } from 'react';
import type { PunchAccess } from '@/types/punch';

const punchAccessHelp: Record<PunchAccess, string> = {
  both: 'Employee can punch in and out using the web buttons or the ZKTeco machine.',
  web: 'Employee can use the web punch buttons. ZKTeco scans will not  be used for  marking attendance.',
  zkteco: 'Employee must use the ZKTeco machine. Web punch buttons are disabled, and browser location is not required.',
};

function PunchAccessSelect(props: ComponentProps<'select'>) {
  return (
    <select {...props}>
      <option value="both">Web + ZKTeco</option>
      <option value="web">Web</option>
      <option value="zkteco">ZKTeco</option>
    </select>
  );
}

export { PunchAccessSelect, punchAccessHelp };
