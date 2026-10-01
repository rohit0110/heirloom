# Execution Mechanism Discussion Notes (2026-09-29)

**Context:** follow-up design discussion after `poc-heir-sweep` (see `poc-heir-sweep/README.md`) proved that a durable-nonce presigned transaction can sweep an owner's *live* balance (no amount frozen at signing time), but also found a fatal flaw: a single premature submission attempt by anyone holding a copy of the signed bytes permanently burns the nonce, destroying the only valid copy of the owner's authorization, with the owner unavailable (by the product's own premise) to sign a replacement.

Hard constraint carried through this whole discussion: **assets stay in the user's own wallet until they perish.** No custodial vault deposit, no escrow PDA holding funds while the owner is alive. That's the stated selling point and it is not up for revision here — the goal is to find a safe *execution* mechanism within that constraint, not to change the product.

## User-story coverage of the POC (recap)

Against the original user stories:

- ✅ Set beneficiary pubkey — `Initialize { beneficiary, timeout_secs }`.
- ✅ Set deadman-switch time period — `timeout_secs`, checked against `Clock` + `last_checkin`.
- ⚠️ Execute transfer once the deadline hits — on-chain gate + CPI logic works and is tested, but nothing *automatically* triggers submission.
- ❌ Fixed amount X with max-failover — not implemented; POC always sweeps live balance, no amount field at all.
- ❌ Store the transfer instruction safely — this is the open problem this whole discussion is about.
- ❌ Monitor for nonce burn and reinitiate — not implemented; this is the gap explored below.
- ❌ Daily batch check of due instructions — no keeper/indexer exists yet.

## The core problem

A presigned durable-nonce transaction is a **bearer secret**: whoever holds a copy of the signed bytes can submit it. Submitting it early doesn't just fail cleanly — Solana's `AdvanceNonceAccount` instruction commits even when the rest of the transaction fails, so one premature attempt (accidental or malicious) permanently kills the plan. The attacker's cost is ~one base tx fee (~5,000 lamports); the victim's loss is the entire inheritance plan, with no recovery path once the owner is gone. That asymmetry — near-zero griefing cost vs. irreversible total loss — is the actual problem to solve, not just "can we detect it."

## Options considered

### 1. Monitor the nonce account, prompt owner to re-sign on grief
Subscribe to the nonce account (`accountSubscribe` / poll), diff the stored `durable_nonce` hash against the value captured at signing time. A change without a corresponding successful sweep means someone replayed the bytes.

- **Covers:** the realistic majority case — impatient beneficiary, leaked custody copy, curious/hostile third party — while the owner is still alive and reachable to re-sign.
- **Doesn't cover:** the case the product exists for — owner already gone, nobody available to re-sign. No monitoring/replay scheme can fix this; there is no signer.
- **Verdict:** worth building regardless, as a cheap first layer. Not sufficient alone.

### 2. Time-lock / conditional threshold encryption (not ZK)
Encrypt the presigned tx so it's unreadable until a condition is met (drand `tlock` for fixed future timestamps, or condition-gated threshold decryption networks like Lit Protocol for arbitrary on-chain conditions). Removes premature-submission risk entirely, since nobody can read the bytes before the trigger.

- **Pro:** structurally eliminates the griefing vector, not just detects it.
- **Con:** trades "single point of failure = wherever the plaintext lives" for "liveness/honesty of a third-party decryption network" — a new external dependency, added integration complexity, and (for tlock specifically) a poor fit for a *resettable* deadline without re-encrypting on every check-in.
- **Verdict:** real and buildable, but heavier than necessary — see option 5.

### 3. Protocol runs its own node, holds the encryption/decryption key
Same idea as #2 but self-hosted instead of a decentralized network: protocol's own keypair encrypts the presigned tx, ciphertext stored on-chain, protocol's node decrypts and submits when it independently verifies the check-in condition.

- **Correction made during discussion:** holding this key is *not* the same as custody of funds. The decrypted artifact is a transaction the owner already fully signed, with a fixed destination beneficiary — the key only grants the ability to reveal-and-submit, not to redirect or spend anything beyond what the owner authorized. Earlier framing of this as inherently "custodial" was overstated.
- **Real residual risk:** blast radius of key compromise. One leaked/stolen protocol key can grief or stall *every* vault, not just one. This is a liveness/availability dependency on the protocol's infrastructure staying alive for the life of the product (years/decades), separate from any theft risk.
- **Verdict:** cryptographically fine, but more engineering than necessary once option 5 is on the table.

### 4. Plain off-chain storage, no cryptography
Rejected early — exactly the single-point-of-failure problem this whole discussion is trying to avoid, no protection against premature replay by whoever holds the bytes.

### 5. Protocol as a withheld required co-signer (adopted direction)
Refinement of the "set fee payer to the protocol" instinct raised mid-discussion. Instead of encrypting a *complete* transaction and decrypting it later, make the transaction **structurally incomplete** until the protocol chooses to complete it:

- Set the protocol's pubkey as the nonce account's authority (and/or fee payer / an additional required signer). The owner signs their part now; the protocol does not sign yet.
- Solana verifies signatures before any instruction runs, including the implicit `AdvanceNonceAccount` — verification is all-or-nothing. A transaction missing a required signature is rejected outright, before it ever touches the ledger, so the nonce is never advanced and never burned no matter who holds a copy of the owner's partial signature. The half-signed bytes are safe to store anywhere, including publicly on-chain.
- The protocol's keeper (already needed to watch `last_checkin`) adds its own signature and broadcasts only once it independently verifies the deadline condition.

**Why this is the preferred design over encryption:** identical security property (nobody can act on the bytes prematurely) with none of the cryptographic machinery — no ciphertext format, no KMS-for-encryption pipeline, just Solana's native partial-sign / complete-sign multisig mechanics (`Transaction.partialSign`), which is dramatically less to build and reason about.

**What doesn't go away:** the protocol still holds one signing key that gates every vault. A leak has the same blast radius as the encryption-key approach — this is a separate, later hardening problem (HSM/KMS, eventually an N-of-M/threshold signer set for the protocol's own role), not a blocker to building the mechanism now.

## Where this leaves the design

Adopted direction: **durable-nonce presigned transaction + protocol as a withheld required co-signer**, layered with nonce-state monitoring (option 1) as a cheap early-warning system while the owner is still reachable.

Open follow-ups, not yet resolved:
- Harden the protocol's own signing key (HSM/KMS at minimum; N-of-M multisig or threshold signer set as a later step) since it's now the single artifact whose compromise has protocol-wide blast radius.
- Design the daily/keeper scan across all due vaults (user story 6) — not addressed in this discussion.
- Fixed-amount transfer with max-failover (user story 2) — not addressed; current mechanism only supports live-balance sweep.
- Whether the protocol being nonce authority (rather than just fee payer) introduces any new capability worth separately reasoning about (it can advance/close the nonce independently, which is a withholding/DoS risk covered by the same trust assumption as the co-signer role generally, not a new theft vector).
