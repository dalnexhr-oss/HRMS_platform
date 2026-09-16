import { parseMoneyPaise } from '@/lib/money';

interface SalaryInput {
  gross_monthly: string;
  basic_da: string;
  hra: string;
}

type SalaryCalculation =
  | { ok: true; gross: number; basic: number; hra: number; special: number }
  | { ok: false; error: string; special: number | null };

function salaryPaise(value: string): number | null {
  const text = value.replace(/[,\s₹]/g, '');
  if (!text) {
    return 0;
  }
  if (!/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text)) {
    return null;
  }
  const paise = parseMoneyPaise(text);
  return Number.isSafeInteger(paise) ? paise : null;
}

/** Shared by the live form and server save; all returned amounts are integer paise. */
export function calculateSalary(input: SalaryInput): SalaryCalculation {
  const gross = salaryPaise(input.gross_monthly);
  const basic = salaryPaise(input.basic_da);
  const hra = salaryPaise(input.hra);
  if (gross === null || basic === null || hra === null) {
    return {
      ok: false,
      error: 'Enter valid salary amounts, e.g. 30,000 or 30000.50.',
      special: null,
    };
  }
  const special = gross - basic - hra;
  if (!Number.isSafeInteger(special)) {
    return { ok: false, error: 'The salary amounts are too large.', special: null };
  }
  if (gross <= 0) {
    return { ok: false, error: 'Gross monthly must be greater than zero.', special };
  }
  if (basic < 0 || hra < 0) {
    return { ok: false, error: 'Basic + DA and HRA cannot be negative.', special };
  }
  if (special < 0) {
    return {
      ok: false,
      error: 'Basic + DA plus HRA exceed gross. Adjust the salary structure.',
      special,
    };
  }
  return { ok: true, gross, basic, hra, special };
}
