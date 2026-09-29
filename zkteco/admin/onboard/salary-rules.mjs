// Explicit import rules only; salary arithmetic uses integer paise.
import { Decimal128 } from 'mongodb';

const money = (value) => {
  if (!/^\d+(?:\.\d{1,2})?$/.test(String(value))) {
    throw new Error(
      'Salary amounts must be nonnegative rupee amounts with at most two decimal places.',
    );
  }
  const [whole, fraction = ''] = String(value).split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
};
const decimal = (paise) =>
  Decimal128.fromString(`${paise / 100n}.${String(paise % 100n).padStart(2, '0')}`);

export function readSalaryRules(rules, roster) {
  if (!Array.isArray(rules.femaleCodes) || rules.otherGender !== 'Male') {
    throw new Error('Supply the explicitly confirmed female codes and otherGender Male.');
  }
  for (const code of rules.femaleCodes) {
    if (!roster.some((row) => row.userId === code)) {
      throw new Error(`Unknown gender rule code ${code}.`);
    }
  }
  const gross = money(rules.gross);
  const basic = money(rules.basic);
  const hra = money(rules.hra);
  const special = money(rules.special);
  if (gross !== basic + hra + special) {
    throw new Error('Salary components must sum exactly to gross.');
  }
  return { gross, basic, hra, special };
}

export { decimal };
