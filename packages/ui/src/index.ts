/**
 * The design system's single entry point.
 *
 * Empty on purpose: `W12-T01` builds the package, its build and its exports map so that the seven
 * primitives in `W12-T02` land in something that already works. Tokens are not exported from here —
 * they are a stylesheet, reachable as `@marketplace/ui/tokens.css`, because a consumer that must
 * run a build before it can read a colour is a consumer that will hardcode the colour.
 */
export {};
