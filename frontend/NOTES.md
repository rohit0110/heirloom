# Notes and open questions

## One plan per wallet: not yet thought through
The program seeds the plan PDA with `["plan", owner]`, so one wallet can hold exactly one plan
(creating a second one fails with `AccountAlreadyInUse`, REQ01). **We have not yet considered what
happens when a person creates more than one plan on the protocol, and some limit is needed.** Open:

- The limit is per *wallet*, not per *person*. Anyone can use several wallets, each with its own plan,
  its own nonce account and its own beneficiary. Do we want to cap that, or is it fine?
- The UI offers no way to change the heir or cancel. Today a plan is "set and forget" from the page
  (`close_plan` and `update_plan` exist on-chain and in the CLI but not in the UI).
- An executed plan (`Distributed`) still occupies the PDA until the owner calls `close_plan`, so that
  wallet cannot create a new plan from the UI afterwards.
- Multiple beneficiaries or split plans are roadmap (A6 in the deliverable), and would change the
  seeds.
- Every plan costs the owner about 0.0014 SOL of nonce-account rent, plus the keeper's scan work.
  Nothing currently prices or limits creating many plans that the keeper must watch (spam surface).

## Wallets can rewrite the sweep (found on devnet)
A real wallet prepended two Compute Budget (priority-fee) instructions to the partial sweep, so
instruction 0 was no longer `AdvanceNonceAccount`. That makes it a non-nonce transaction and fails the
program's A1 check, so that plan could never execute (the keeper rightly refused it). Mitigations now in place:

- The sweep is built as `[AdvanceNonce, SetComputeUnitLimit, SetComputeUnitPrice, heir_sweep]`, so a wallet
  that only adds fees when none exist leaves it alone.
- The page compares the message before and after signing and refuses to create the plan if the wallet
  changed it.
- The keeper accepts Compute Budget instructions between advance and `heir_sweep` (nothing else).
- **Sign** re-signs (a second prompt) when the stored sweep is malformed, which repairs plans created
  before this fix.

Still unknown: other wallets, and mainnet wallet-side protections (for example Phantom's Lighthouse
assertions), may also alter or reject these transactions. Test each wallet you intend to support.

## Other things the UI does not cover yet
- Wallet compatibility is untested in a real browser wallet. The transaction encoding is verified
  with a keypair standing in for the wallet (`npm run smoke`). Some wallets warn on, or refuse to
  sign, durable-nonce transactions whose fee payer is not the user.
- Creating a plan takes 3 wallet prompts (each step needs the previous step's result, so they cannot
  be batched). Signing takes 1: the stored partial sweep is resent unchanged, and re-signed (2nd
  prompt) only if the nonce value has changed.
- The grace period is a fixed config value (`VITE_GRACE_SECONDS`), not a user input.
- The orphan-nonce gap (see `../anchor/README.md`) applies here too: if the user rejects the third
  prompt, a funded nonce account is left behind.
