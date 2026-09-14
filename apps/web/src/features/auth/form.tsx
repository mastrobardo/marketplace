/**
 * Where React Hook Form meets React Router — `W2-T09` §4.1, and the part most worth reading once.
 *
 * **RHF and React Query do not compete, because they are not doing the same job.** RHF owns field
 * state, focus and client-side validation. The *write* goes through a React Router `action` — never
 * `useMutation`. ADR-011 R3 says data comes from the loader and a component never fetches on mount;
 * an `action` is the write-side of that same rule, it is what `W12-T14`'s framework-mode switch
 * keeps, and a mutation buried in a component is exactly what that switch would have to unpick.
 * React Query's job on a write happens afterwards, in the action: invalidate the session.
 *
 * So `handleSubmit` validates and then hands the values to `useSubmit()`. The values reach the
 * action as `FormData`, which is what a form posts in every rendering model this application might
 * end up in — including the one with no JavaScript at all.
 */
import { type ReactElement } from 'react';
import { useSubmit } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  useController,
  useForm,
  type Control,
  type DefaultValues,
  type FieldValues,
  type Path,
  type UseFormReturn,
} from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { type ZodType } from 'zod';
import { TextInput } from '@marketplace/ui';
import { type TranslationKey } from '../../i18n/locales/es.js';

export interface AuthFormOptions<T extends FieldValues> {
  /**
   * Input and output are the same shape on purpose: these schemas validate, they do not transform.
   * A resolver whose parsed output differs from its input would hand the action fields the form
   * never showed — and `zodResolver` types that mismatch as an error rather than letting it happen.
   */
  schema: ZodType<T, T>;
  defaultValues: DefaultValues<T>;
  /**
   * Fields the action needs that the user does not type — the resend `intent`, the reset `token`.
   * They travel in the same `FormData`, so the action reads one object rather than reconciling two
   * sources.
   */
  extra?: Record<string, string>;
}

export interface AuthForm<T extends FieldValues> {
  form: UseFormReturn<T, unknown, T>;
  /** Give this to `<form onSubmit>`. It validates first and only then posts. */
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}

export function useAuthForm<T extends FieldValues>({
  schema,
  defaultValues,
  extra,
}: AuthFormOptions<T>): AuthForm<T> {
  const form = useForm<T, unknown, T>({ resolver: zodResolver(schema), defaultValues });
  const submit = useSubmit();

  const onSubmit = form.handleSubmit((values) => {
    // `method: 'post'` and nothing else: no `action` target, so it posts to the route that rendered
    // it. A password in a `GET` would be a password in the URL, in history and in every log between
    // here and the server (AC26).
    void submit({ ...values, ...extra }, { method: 'post' });
  });

  return { form, onSubmit };
}

export interface AuthFieldProps<T extends FieldValues> {
  control: Control<T>;
  name: Path<T>;
  label: string;
  type?: 'text' | 'email' | 'password';
  autoComplete?: string;
  description?: string;
}

/**
 * One field, bound to the design system's `TextInput`.
 *
 * `useController` rather than `register`, because `TextInput` is a React Aria controlled component
 * whose `onChange` hands over a string rather than an event. Going through the controller is what
 * keeps the label association, the `aria-invalid` and the error's `aria-describedby` — all of which
 * `Field` already does correctly — instead of reimplementing them around an uncontrolled input.
 *
 * The error message arrives as a translation key (`schema.ts`), so this is where it becomes words.
 */
export function AuthField<T extends FieldValues>({
  control,
  name,
  label,
  type = 'text',
  autoComplete,
  description,
}: AuthFieldProps<T>): ReactElement {
  const { t } = useTranslation();
  const { field, fieldState } = useController<T>({ control, name });
  const error = fieldState.error?.message;

  return (
    <TextInput
      label={label}
      type={type}
      name={field.name}
      isRequired
      value={typeof field.value === 'string' ? field.value : ''}
      onChange={field.onChange}
      {...(autoComplete !== undefined ? { autoComplete } : {})}
      {...(description !== undefined ? { description } : {})}
      {...(error !== undefined ? { errorMessage: t(error as TranslationKey) } : {})}
    />
  );
}

/**
 * The one thing the server said, said once.
 *
 * `role="alert"` because a failure that arrives after a submit is a change a screen-reader user did
 * not ask for and must still hear. It is a single region per form: `W2-T01` §4.5 answers every
 * sign-in refusal identically, and a page with a message per cause would be inventing causes.
 */
export function FormAlert({ children }: { children: string }): ReactElement {
  return (
    <p className="mp-form__alert" role="alert">
      {children}
    </p>
  );
}
