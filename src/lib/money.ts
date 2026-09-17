/** Parse decimal rupees as integer paise, rounding half away from zero. */
export function parseMoneyPaise(value: string): number {
  const text = value.trim();
  if (text === '') {
    return 0;
  }
  const match = /^(-)?(\d*)(?:\.(\d*))?$/.exec(text);
  if (!match) {
    throw new TypeError(`Not a money value: ${text}`);
  }
  const [, sign, whole = '0', frac = ''] = match;
  const digits = `${frac}000`.slice(0, 3);
  let amount = Number(whole || '0') * 100 + Number(digits.slice(0, 2));
  if (Number(digits[2]) >= 5) {
    amount += 1;
  }
  return sign === '-' ? -amount : amount;
}

export function formatPaise(paise: number): string {
  return (paise / 100).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
