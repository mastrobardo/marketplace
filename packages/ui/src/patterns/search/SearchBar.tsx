import { type ReactElement, type ReactNode, useState } from 'react';
import { Form } from 'react-aria-components';
import { Button } from '../../primitives/Button.js';
import { Combobox } from '../../primitives/Combobox.js';
import { Select } from '../../primitives/Select.js';
import { cx } from '../../internal/cx.js';
import {
  collapsedField,
  fieldsFor,
  type SearchField,
  type SearchRendering,
  type SearchSchema,
} from './schema.js';
import { toSearchQuery, type SearchQuery, type SearchValues } from './query.js';
import styles from './SearchBar.module.css';

export interface SearchBarProps {
  schema: SearchSchema;
  rendering: SearchRendering;
  /** The landmark's accessible name. Two search bars on one page are two landmarks; this is how a screen-reader user tells them apart. */
  label: string;
  submitLabel: string;
  /** The compact header's disclosure. Required in practice whenever `rendering` is `header`. */
  expandLabel?: string;
  values?: SearchValues;
  defaultValues?: SearchValues;
  onValuesChange?: (values: SearchValues) => void;
  /** Receives the query, never the event: this component does not navigate. */
  onSubmit?: (query: SearchQuery) => void;
  isPending?: boolean;
  pendingLabel?: string;
  /** Per-field messages, by field name. The application owns the sentence. */
  errors?: Readonly<Record<string, string>>;
}

/**
 * One declaration, three renderings — ADR-011 §3. The hero, the header's compact control and the
 * results filter rail are this component with a different `rendering`, which is what stops them
 * drifting into three forms that disagree about which filters exist.
 *
 * It holds no copy, no domain type, no router and no `fetch`. Submitting hands the caller the
 * `SearchQuery` the pure function would have produced; who turns that into `/buscar?…` is the
 * page's business (`W12-T10`, `W12-T11`).
 */
export function SearchBar({
  schema,
  rendering,
  label,
  submitLabel,
  expandLabel,
  values,
  defaultValues,
  onValuesChange,
  onSubmit,
  isPending = false,
  pendingLabel,
  errors,
}: SearchBarProps): ReactElement {
  const [internal, setInternal] = useState<SearchValues>(defaultValues ?? {});
  const [isExpanded, setExpanded] = useState(false);
  const current = values ?? internal;

  function set(name: string, value: string | null): void {
    const next = { ...current, [name]: value };
    setInternal(next);
    onValuesChange?.(next);
  }

  // The header shows one field until it is asked for the rest. Everything else shows what the
  // declaration says — the rail including its extras.
  const collapsed = rendering === 'header' && !isExpanded;
  const only = collapsedField(schema);
  const visible: SearchField[] = collapsed
    ? only === undefined
      ? []
      : [only]
    : fieldsFor(schema, rendering);

  function field(descriptor: SearchField): ReactNode {
    const value = current[descriptor.name] ?? null;
    const error = errors?.[descriptor.name];
    const shared = {
      label: descriptor.label,
      options: descriptor.options,
      name: descriptor.name,
      isRequired: descriptor.isRequired ?? false,
      ...(descriptor.placeholder !== undefined ? { placeholder: descriptor.placeholder } : {}),
      ...(descriptor.description !== undefined ? { description: descriptor.description } : {}),
      ...(error !== undefined ? { errorMessage: error } : {}),
    };

    if (descriptor.kind === 'choice') {
      return (
        <Select
          key={descriptor.name}
          {...shared}
          selectedKey={value}
          onSelectionChange={(key) => set(descriptor.name, key)}
        />
      );
    }

    const suggestions = {
      ...(descriptor.isLoading !== undefined ? { isLoading: descriptor.isLoading } : {}),
      ...(descriptor.loadingLabel !== undefined ? { loadingLabel: descriptor.loadingLabel } : {}),
      ...(descriptor.emptyLabel !== undefined ? { emptyLabel: descriptor.emptyLabel } : {}),
    };

    // An open `place` is the text in the box, not a key: until `GET /places/suggest` exists, a
    // postcode a user typed is the only answer available, and it has to survive the round trip to
    // the URL. Picking a suggestion writes that suggestion's text into the same box, so there is
    // one value here rather than two that can disagree.
    if (descriptor.kind === 'place' && descriptor.allowsCustomValue === true) {
      return (
        <Combobox
          key={descriptor.name}
          {...shared}
          {...suggestions}
          allowsCustomValue
          inputValue={value ?? ''}
          onInputChange={(text) => set(descriptor.name, text === '' ? null : text)}
        />
      );
    }

    return (
      <Combobox
        key={descriptor.name}
        {...shared}
        {...suggestions}
        selectedKey={value}
        onSelectionChange={(key) => set(descriptor.name, key)}
      />
    );
  }

  return (
    <Form
      // `search` rather than the form's implicit role: this is a landmark, and `W12-T11` puts two
      // of them on one page.
      role="search"
      aria-label={label}
      // Not the native behaviour, deliberately. A required field left empty would otherwise have
      // the browser refuse the submit and show its own bubble — copy this product does not own, in
      // a style the design system cannot reach. `aria` reports the state to assistive technology
      // and lets the form submit; which fields are missing is `missingRequiredFields`, and the
      // sentence a user reads is the application's (spec §6).
      validationBehavior="aria"
      className={cx(styles['form'], styles[rendering])}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit?.(toSearchQuery(schema, current));
      }}
    >
      <div className={cx(styles['fields'])}>{visible.map(field)}</div>
      <div className={cx(styles['actions'])}>
        {rendering === 'header' && expandLabel !== undefined ? (
          <Button isExpanded={isExpanded} onPress={() => setExpanded(!isExpanded)}>
            {expandLabel}
          </Button>
        ) : null}
        <Button
          type="submit"
          variant={rendering === 'filters' ? 'secondary' : 'primary'}
          isPending={isPending}
          {...(pendingLabel !== undefined ? { pendingLabel } : {})}
        >
          {submitLabel}
        </Button>
      </div>
    </Form>
  );
}
