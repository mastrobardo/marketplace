# Repo memory — glossary

Use these words in code, specs and UI copy. Consistent vocabulary is what lets thirteen agents
write one product. Code identifiers are English; user-facing copy is ES-first with an EN key.

| Term (ES) | EN | Meaning in this codebase |
|---|---|---|
| **manitas** | handyman | Unlicensed provider. `ProviderProfile.kind = MANITAS`. May be listed in `requiresLicence` categories — the flag earns a badge, it does not exclude (operator, 2026-09-18). |
| **profesional** | professional | Licensed provider. `kind = PRO`. An approved `Certification` earns the `VERIFIED_LICENCE` badge in a `requiresLicence` category; it is not a condition of appearing there. |
| **presupuesto** | quote | A provider's priced offer on a Job. Model: `Quote`. Never call it "estimate" in code. |
| **subasta** | auction | Reverse bidding on a Job. Models: `Auction`, `Bid`. |
| **urgencia** | emergency | Immediate call-out. Model: `EmergencyRequest`. |
| **reforma** | renovation | Larger multi-day works. A category, not a separate flow. |
| **mantenimiento** | maintenance | Routine repairs. A category. |
| **autónomo** | self-employed | The tax status most providers hold in Spain. Matters for invoicing (R7). |
| **colegio profesional** | professional body | Issues/registers licences. `Certification.issuingBody`. |
| **IVA** | VAT | Spanish VAT. Invoicing rules are `[H]` — accountant-defined (`W5-T09`). |
| **fianza / señal** | deposit | Not in MVP. Do not introduce the concept without an ADR. |
| **petición de presupuesto** | request for quotes (RFQ) | What a **client** buys: the right to receive quotes on a job. The demand side pays; a provider never pays to answer one (ADR-014 §1). |
| **una tantum** | one-off | A single payment by a client with no subscription — the alternative to an included allowance (ADR-014 §2). Keep the Latin in ES copy; it is ordinary Spanish commercial usage. |
| **administrador de fincas** | property manager | Manages a *comunidad de propietarios* and commissions repairs on its behalf. A **client** persona, not a provider, and the strongest B2B channel (ADR-014 §6). Any payback to them is a commission on somebody else's money — see §6 before building it. |
| **comunidad de propietarios** | homeowners' association | The building's owners as a legal body. The actual client behind an `administrador de fincas`. |

**`requiresLicence` is a verification, not a gate.** Both rows above said otherwise until
2026-09-18, when the operator settled it: *"my idea was verification, not hard block — while you can
be listed as a pro, you will get a 'verified' badge once documents are uploaded and verified."* A
trade carrying the flag is one whose claim is checkable and whose proof is worth showing; an
unverified provider is listed, searchable and bookable, and simply has no badge. The frozen contract
already modelled it this way (`packages/contracts/src/catalogue.ts`). Evidence and the five gated
trades: `docs/specs/S3/W3-T01-category-tree.md` §3.5.2, `TODO.md` §10.1 `BD-07`.

## Naming rules
- Code, tables, API fields: **English** (`quote`, `auction`, `bid`, `provider`).
- User-facing copy: **ES primary, EN secondary**, via i18n keys. No hardcoded strings.
- One word per concept. `quote` never appears as `estimate` or `offer` elsewhere.
  **Why `quote` and not `estimate`:** in the English trades the two are different products — an
  *estimate* is an approximate, non-binding figure, a *quote* is a firm price the client can accept.
  A *presupuesto* here is the second, which is why `Quote` is the model and `accept` is a verb it
  can take.
- `provider` covers both manitas and pro; use `manitas`/`pro` only where the distinction matters.
