'use client';

import { useId, useState } from 'react';
import { calculateSalary } from '@/lib/salary';
import { formatPaise } from '@/lib/money';

interface SalaryValues {
  gross_monthly: number;
  basic_da: number;
  hra: number;
}

const defaultSalary: SalaryValues = { gross_monthly: 30_000, basic_da: 15_000, hra: 9_000 };

export function SalaryFields({ initial = defaultSalary }: { initial?: SalaryValues }) {
  const id = useId();
  // The drawer's keyed form remounts this state when another employee is opened.
  const [amounts, setAmounts] = useState(() => ({
    gross_monthly: initial.gross_monthly.toLocaleString('en-IN'),
    basic_da: initial.basic_da.toLocaleString('en-IN'),
    hra: initial.hra.toLocaleString('en-IN'),
  }));
  const salary = calculateSalary(amounts);
  const errorId = `${id}-error`;

  function amountField(name: keyof SalaryValues, label: string) {
    return (
      <div className="f">
        <label htmlFor={`${id}-${name}`}>{label}</label>
        <input
          id={`${id}-${name}`}
          name={name}
          className="mono"
          inputMode="decimal"
          value={amounts[name]}
          onChange={(event) =>
            setAmounts((current) => ({ ...current, [name]: event.target.value }))
          }
          aria-describedby={salary.ok ? undefined : errorId}
        />
      </div>
    );
  }

  return (
    <>
      <div className="fold">Salary structure</div>
      <div className="f-row">
        {amountField('gross_monthly', 'Gross / month (₹)')}
        {amountField('basic_da', 'Basic + DA (₹)')}
      </div>
      <div className="f-row">
        {amountField('hra', 'HRA (₹)')}
        <div className="f">
          <label htmlFor={`${id}-special`}>Special allowance (₹)</label>
          <input
            id={`${id}-special`}
            name="special_allowance"
            className="mono"
            value={salary.special === null ? '' : formatPaise(salary.special)}
            readOnly
            aria-invalid={!salary.ok}
            aria-describedby={salary.ok ? `${id}-hint` : errorId}
          />
        </div>
      </div>
      <div className="hint" id={`${id}-hint`}>
        Special allowance updates as you type: Gross − (Basic + DA) − HRA. PT applies by branch
        state.
      </div>
      {!salary.ok && (
        <div className="login-error" id={errorId} role="status">
          {salary.error}
        </div>
      )}
    </>
  );
}
