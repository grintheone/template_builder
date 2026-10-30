import { expect, it } from 'vitest';
import { createFormValuesSchema, formatFormValues, type FormField } from './templates.js';
const fields: FormField[] = [
  { id: '123e4567-e89b-42d3-a456-426614174000', key: 'name', label: 'Name', type: 'text', required: true, formatting: {} },
  { id: '123e4567-e89b-42d3-a456-426614174001', key: 'date', label: 'Date', type: 'date', required: true, formatting: { dateFormat: 'YYYY-MM-DD' } },
  { id: '123e4567-e89b-42d3-a456-426614174002', key: 'amount', label: 'Amount', type: 'currency', required: true, formatting: { locale: 'en-US', currency: 'USD', precision: 2 } },
  { id: '123e4567-e89b-42d3-a456-426614174003', key: 'count', label: 'Count', type: 'number', required: false, formatting: { locale: 'de-DE', precision: 1 } },
];
const values = { name: 'Иван Петров', date: '2028-02-29', amount: 1234.5 };
it('validates typed required/optional values and deterministic formatting', () => {
  expect(formatFormValues(fields, values)).toEqual({ name: 'Иван Петров', date: '2028-02-29', amount: '$1,234.50', count: '' });
  expect(formatFormValues(fields, { ...values, count: 1234.5 }).count).toBe('1.234,5');
  expect(formatFormValues(fields, { ...values, count: '' }).count).toBe('');
});
it('rejects unknown/missing fields, invalid dates, nonfinite numbers, wrong types and XML controls', () => {
  for (const input of [{ ...values, extra: 'x' }, { date: values.date, amount: 0 }, { ...values, name: ' ' }, { ...values, name: '\u0000' }, { ...values, date: '2026-02-29' }, { ...values, date: '2028-02-30' }, { ...values, amount: '123' }, { ...values, amount: null }, { ...values, amount: Infinity }]) expect(createFormValuesSchema(fields).safeParse(input).success).toBe(false);
});
