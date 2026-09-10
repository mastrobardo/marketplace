import { add, allocate, money, prorate, type Currency, type Money } from '../../../src/index.js';

export const rate: Money = money(4500);
export const threeHours = add(rate, money(9000));
export const fee = prorate(threeHours, 1200, 10_000);
export const shares = allocate(threeHours, [1, 2]);

// The literal is the only currency there is, and naming it explicitly must still compile.
export const explicit: Money = money(100, 'EUR');
export const currency: Currency = 'EUR';
