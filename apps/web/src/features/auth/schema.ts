/**
 * What the forms accept — `W2-T09` §4.2.
 *
 * **Local to `apps/web`, deliberately** (operator, 2026-09-14). These validate a *form*, not a wire
 * contract we publish: the wire contract belongs to better-auth, and restating it in
 * `packages/contracts` would put a second definition of somebody else's shape into the frozen seam
 * `agent-contracts` owns under L3 — for schemas nothing else consumes. `packages/ui` may not import
 * `packages/contracts` at all (`W12-T07`), which is the same reason the forms live in the app and
 * only the primitives come from the design system.
 *
 * **Every message is a translation key, not a sentence.** zod holds the rule, the catalogue holds
 * the words, and `TranslationKey` makes a key that does not exist a compile error rather than a
 * string rendered raw at a user. The component translates at the point of rendering, which is also
 * the only point that knows the current language.
 */
import * as z from 'zod';
import { type TranslationKey } from '../../i18n/index.js';

/**
 * better-auth's own limits, mirrored so the browser can say it before the network does.
 *
 * A mirrored rule is a rule in two places, and §6 keeps the server's answer handled rather than
 * assumed: if these ever drift, the request fails and the page says so. What it must never do is
 * accept something the API will reject and show the user a generic error for it.
 */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

const message = (key: TranslationKey): TranslationKey => key;

const emailField = z.email({ error: message('auth.error.email.invalid') });

const passwordField = z
  .string()
  .min(PASSWORD_MIN, { error: message('auth.error.password.tooShort') })
  .max(PASSWORD_MAX, { error: message('auth.error.password.tooLong') });

export const SignUpSchema = z.object({
  // Trimmed before it is measured: a name of three spaces is not a name, and the API would store it.
  name: z
    .string()
    .trim()
    .min(1, { error: message('auth.error.name.required') }),
  email: emailField,
  password: passwordField,
});

/**
 * Sign-in does **not** apply the length rule.
 *
 * A password that is too short is a password that cannot be right, and the temptation is to say so
 * without asking the server. But the page would then be able to refuse locally what the API refuses
 * remotely with one deliberately identical message, and the two refusals would look different —
 * which is the enumeration surface `W2-T01` §4.5 closed, reopened on the client. Empty is the only
 * thing worth catching here, because an empty field is a slip rather than an answer.
 */
export const LoginSchema = z.object({
  email: emailField,
  password: z.string().min(1, { error: message('auth.error.password.required') }),
});

export const ResetRequestSchema = z.object({ email: emailField });

export const ResendSchema = z.object({ email: emailField });

export const ResetSetSchema = z
  .object({ newPassword: passwordField, confirmPassword: z.string() })
  .refine((values) => values.newPassword === values.confirmPassword, {
    // On the second field, so the message lands under the input the user must change.
    path: ['confirmPassword'],
    error: message('auth.error.password.mismatch'),
  });

export type SignUpValues = z.infer<typeof SignUpSchema>;
export type LoginValues = z.infer<typeof LoginSchema>;
export type ResetRequestValues = z.infer<typeof ResetRequestSchema>;
export type ResendValues = z.infer<typeof ResendSchema>;
export type ResetSetValues = z.infer<typeof ResetSetSchema>;
