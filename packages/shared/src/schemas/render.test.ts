import { describe, expect, it } from 'vitest';
import { fieldKeySchema, renderValuesSchema } from './render.js';

describe('render values contract', () => {
  it('accepts Unicode, explicit blanks, zero and negative finite numbers', () => {
    expect(renderValuesSchema.safeParse({ client_name: 'Иван 李 😀 & Co', amount: 0, blank: '', delta: -1.5 }).success).toBe(true);
  });
  it.each([null, [], { field: undefined }, { field: null }, { field: true }, { field: {} }, { field: Infinity }, { field: NaN }, { field: '\u0000' }, { field: '\ud800' }, { field: 'x'.repeat(10001) }, { 'client.name': 'x' }, { Client: 'x' }])('rejects invalid values: %o', (value) => {
    expect(renderValuesSchema.safeParse(value).success).toBe(false);
  });
  it('rejects prototype-related keys and too many fields', () => {
    for (const key of ['__proto__', 'constructor', 'prototype']) expect(fieldKeySchema.safeParse(key).success).toBe(false);
    expect(renderValuesSchema.safeParse(Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`field_${i}`, 'x']))).success).toBe(false);
  });
});
