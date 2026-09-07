# Repo memory — glossary

Use these words in code, specs and UI copy. Consistent vocabulary is what lets thirteen agents
write one product. Code identifiers are English; user-facing copy is ES-first with an EN key.

| Term (ES) | EN | Meaning in this codebase |
|---|---|---|
| **manitas** | handyman | Non-licensed provider. `ProviderProfile.kind = MANITAS`. Cannot be surfaced for `requiresLicence` categories. |
| **profesional** | professional | Licensed provider. `kind = PRO`. Needs an approved `Certification` for gated categories. |
| **presupuesto** | quote | A provider's priced offer on a Job. Model: `Quote`. Never call it "estimate" in code. |
| **subasta** | auction | Reverse bidding on a Job. Models: `Auction`, `Bid`. |
| **urgencia** | emergency | Immediate call-out. Model: `EmergencyRequest`. |
| **reforma** | renovation | Larger multi-day works. A category, not a separate flow. |
| **mantenimiento** | maintenance | Routine repairs. A category. |
| **autónomo** | self-employed | The tax status most providers hold in Spain. Matters for invoicing (R7). |
| **colegio profesional** | professional body | Issues/registers licences. `Certification.issuingBody`. |
| **IVA** | VAT | Spanish VAT. Invoicing rules are `[H]` — accountant-defined (`W5-T09`). |
| **fianza / señal** | deposit | Not in MVP. Do not introduce the concept without an ADR. |

## Naming rules
- Code, tables, API fields: **English** (`quote`, `auction`, `bid`, `provider`).
- User-facing copy: **ES primary, EN secondary**, via i18n keys. No hardcoded strings.
- One word per concept. `quote` never appears as `estimate` or `offer` elsewhere.
- `provider` covers both manitas and pro; use `manitas`/`pro` only where the distinction matters.
