/**
 * ADR-011's route rules, as lint.
 *
 * R2, R3 and R5 are conventions until something fails a pull request over them, and the whole
 * argument for a client-rendered storefront today — that server rendering in `W12-T14` is a switch
 * and not a rewrite — rests on them being true in every route module written between now and then.
 * A rule that is discovered to have been aspirational after three hundred components is worth
 * nothing, which is why these land in `W12-T01`, before there is anything to retrofit.
 *
 * Written as rules rather than as `no-restricted-globals` and `no-restricted-syntax` selectors
 * because both of those are scope-blind. R2 bans `document` *at module scope* and requires it to
 * keep working inside an effect; an approximation either misses `export const x = window.foo` or
 * fires inside a callback, and a rule that cries wolf is switched off within a week.
 *
 * Scoped to `src/routes/**` and `src/features/**` by `eslint.config.js`; `tests/route-rules.test.ts`
 * asserts both the reports and that wiring, because a rule applied to no path is a gate that
 * reports success forever.
 */

/** R2. The ones that crash a server on import, in the order ADR-011 lists them. */
const BROWSER_GLOBALS = new Set([
  'window',
  'document',
  'localStorage',
  'sessionStorage',
  'matchMedia',
  'navigator',
]);

/** R5. The shapes a cache actually takes. A frozen constant is not a cache — see below. */
const CACHE_CONSTRUCTORS = new Set(['Map', 'Set', 'WeakMap', 'WeakSet']);

/** R3. The two route exports that are allowed to talk to the network. */
const DATA_FUNCTIONS = new Set(['loader', 'action']);

/**
 * True when the reference sits inside a function — an effect, a handler, a loader — rather than in
 * the body of the module. Block scopes (`if (…) { … }` at the top level) still count as module
 * scope, because that code runs on import too.
 */
function insideFunction(scope) {
  for (let current = scope; current; current = current.upper) {
    if (
      current.type === 'function' ||
      current.type === 'class-field-initializer' ||
      current.type === 'class-static-block'
    ) {
      return true;
    }
    if (current.type === 'module' || current.type === 'global') return false;
  }
  return false;
}

/**
 * Every reference to a global of this name, whether the config declares it (`globals.browser`, so
 * it resolves to a variable in the global scope) or does not (so it escapes as an unresolved
 * reference). Both spellings have to be handled or the rule silently depends on lint configuration.
 */
function globalReferences(sourceCode, program, names) {
  const moduleScope = sourceCode.getScope(program);
  const globalScope = moduleScope.type === 'module' ? moduleScope.upper : moduleScope;
  // A Set, because an unresolved reference appears in the `through` list of *every* scope it
  // escaped — module and global both — and a rule that reports `navigator` twice is a rule whose
  // first bug report is about itself.
  const found = new Set();

  for (const name of names) {
    const declared = globalScope?.set.get(name);
    // `defs.length > 0` would mean a real declaration somewhere in the program, i.e. not a global.
    if (declared && declared.defs.length === 0) {
      for (const reference of declared.references) found.add(reference);
    }
  }
  for (const scope of [moduleScope, globalScope]) {
    for (const reference of scope?.through ?? []) {
      if (names.has(reference.identifier.name) && reference.resolved === null) {
        found.add(reference);
      }
    }
  }
  return found;
}

/** R2 — no browser global at module scope. */
/** @type {import('eslint').Rule.RuleModule} */
const noModuleScopeBrowserGlobal = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow browser globals at module scope in route and feature modules (ADR-011 R2).',
    },
    schema: [],
    messages: {
      browserGlobal:
        "'{{name}}' is read when this module is imported, which is on the server as soon as W12-T14 flips the rendering switch. Move it inside an effect or an event handler (ADR-011 R2).",
    },
  },
  create(context) {
    return {
      'Program:exit'(program) {
        for (const reference of globalReferences(context.sourceCode, program, BROWSER_GLOBALS)) {
          if (insideFunction(reference.from)) continue;
          context.report({
            node: reference.identifier,
            messageId: 'browserGlobal',
            data: { name: reference.identifier.name },
          });
        }
      },
    };
  },
};

/**
 * R5 — no module-scope mutable cache.
 *
 * Deliberately narrower than "nothing mutable at module scope". R5 names a data-leak class: a
 * `const cache = new Map()` is per-user in a browser and *shared between every user* on a server.
 * A frozen list of navigation items is not that, and a rule that flagged it would be an obstacle
 * rather than a gate. `let`, `var` and the four collection constructors are the cache shapes.
 */
/** @type {import('eslint').Rule.RuleModule} */
const noModuleScopeMutable = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow mutable module-scope state in route and feature modules (ADR-011 R5).',
    },
    schema: [],
    messages: {
      mutableBinding:
        "'{{name}}' is module-scope mutable state. In the browser it is per user; on a server it is shared by every request. Put it in the loader's return value or in component state (ADR-011 R5).",
      moduleCache:
        "'{{name}}' is a module-scope cache. On a server one visitor's data is served to the next — a data leak, not a stale-cache bug. Cache per request instead (ADR-011 R5).",
    },
  },
  create(context) {
    function check(declaration) {
      for (const declarator of declaration.declarations) {
        const name = declarator.id.type === 'Identifier' ? declarator.id.name : 'this binding';

        if (declaration.kind !== 'const') {
          context.report({ node: declarator, messageId: 'mutableBinding', data: { name } });
          continue;
        }
        const init = declarator.init;
        if (
          init?.type === 'NewExpression' &&
          init.callee.type === 'Identifier' &&
          CACHE_CONSTRUCTORS.has(init.callee.name)
        ) {
          context.report({ node: declarator, messageId: 'moduleCache', data: { name } });
        }
      }
    }

    return {
      'Program > VariableDeclaration': check,
      'Program > ExportNamedDeclaration > VariableDeclaration': check,
    };
  },
};

/** The name a function is known by, whether it is declared, assigned or a property. */
function functionName(node) {
  if (node.type === 'FunctionDeclaration') return node.id?.name ?? '';
  const parent = node.parent;
  if (parent?.type === 'VariableDeclarator' && parent.id.type === 'Identifier') {
    return parent.id.name;
  }
  if (parent?.type === 'Property' && parent.key.type === 'Identifier') return parent.key.name;
  return '';
}

/** R3 — data comes from the loader; a component never fetches. */
/** @type {import('eslint').Rule.RuleModule} */
const noFetchInComponent = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow fetching outside a loader or action (ADR-011 R3).',
    },
    schema: [],
    messages: {
      fetchOutsideLoader:
        'Only a loader or an action fetches. Data fetched in a component arrives after the server has already sent the HTML, which is the SEO work undone (ADR-011 R3).',
    },
  },
  create(context) {
    return {
      'CallExpression > Identifier.callee[name="fetch"]'(callee) {
        // A local named `fetch` is somebody's own function, not the platform's.
        const variable = context.sourceCode
          .getScope(callee)
          .references.find((reference) => reference.identifier === callee)?.resolved;
        if (variable && variable.defs.length > 0) return;

        for (let node = callee.parent; node; node = node.parent) {
          if (
            node.type === 'FunctionDeclaration' ||
            node.type === 'FunctionExpression' ||
            node.type === 'ArrowFunctionExpression'
          ) {
            if (DATA_FUNCTIONS.has(functionName(node))) return;
          }
        }
        context.report({ node: callee.parent, messageId: 'fetchOutsideLoader' });
      },
    };
  },
};

export const rules = {
  'no-module-scope-browser-global': noModuleScopeBrowserGlobal,
  'no-module-scope-mutable': noModuleScopeMutable,
  'no-fetch-in-component': noFetchInComponent,
};

/** The plugin as `eslint.config.js` consumes it. */
export const routeRulesPlugin = { rules };
