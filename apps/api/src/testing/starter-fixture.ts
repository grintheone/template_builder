import { createDocxFixture, paragraph } from './docx-fixture.js';

export function createStarterFixture() {
  return createDocxFixture({
    body: paragraph('This agreement is made between Acme Corporation and John Smith on 28 October 2026.')
      + '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>John </w:t></w:r><w:r><w:t>Smith will commence employment on 1 November 2026.</w:t></w:r></w:p>'
      + `<w:tbl><w:tblPr/><w:tblGrid><w:gridCol w:w="9000"/></w:tblGrid><w:tr><w:tc>${paragraph('The monthly salary is 5,000 USD.')}</w:tc></w:tr></w:tbl>`
      + paragraph('Working hours per week: 40.')
      + paragraph('John Smith is also the author of an unrelated reference; leave this sentence unchanged.'),
    header: paragraph('Acme Corporation · Employment agreement'),
    footer: paragraph('Prepared for John Smith'),
  });
}

// Explicit review choices for the synthetic demo. The unrelated author is omitted.
export const starterFields = [
  { key: 'employer', label: 'Employer', type: 'text' as const, quote: 'Acme Corporation', count: 2, formatting: {} },
  { key: 'employee_name', label: 'Employee', type: 'text' as const, quote: 'John Smith', count: 3, formatting: {} },
  { key: 'agreement_date', label: 'Agreement date', type: 'date' as const, quote: '28 October 2026', count: 1, formatting: { dateFormat: 'YYYY-MM-DD' as const } },
  { key: 'start_date', label: 'Start date', type: 'date' as const, quote: '1 November 2026', count: 1, formatting: { dateFormat: 'YYYY-MM-DD' as const } },
  { key: 'salary', label: 'Monthly salary', type: 'currency' as const, quote: '5,000 USD', count: 1, formatting: { locale: 'en-US', currency: 'USD', precision: 2 } },
  { key: 'hours', label: 'Hours per week', type: 'number' as const, quote: '40', count: 1, formatting: { locale: 'en-US', precision: 0 } },
];
