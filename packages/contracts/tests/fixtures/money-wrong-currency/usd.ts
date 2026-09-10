import { money, type Currency } from '../../../src/index.js';

// Decision A: 'USD' is not a Currency. Both lines below must fail to compile — that is the
// assertion. No suppression directive here on purpose: a suppressed error is not an error.
export const dollars = money(100, 'USD');
export const currency: Currency = 'USD';
