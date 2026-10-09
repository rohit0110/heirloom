# Heirloom: Anchor workspace

Non-custodial digital succession for Solana wallets. See `../deliverable-2-requirements-architecture.md` for the requirements (REQxx) and use cases (UCx) referenced throughout the code.

**Status:** on-chain program, owner client/CLI and keeper are implemented and verified end to end on a local validator (create plan, sweep after the deadline, cancel plus nonce burn). Not deployed to devnet or mainnet.

## Layout

```
anchor/
├── Anchor.toml
├── programs/heirloom/        # on-chain program (Anchor 1.1, litesvm tests)
│   ├── src/
│   │   ├── lib.rs            # 5 entrypoints: initialize_plan, check_in, heir_sweep, close_plan, update_plan
│   │   ├── state.rs          # Plan PDA, PlanStatus      (REQ04)
│   │   ├── error.rs          # HeirloomError
│   │   ├── constants.rs      # seeds, bounds
│   │   └── instructions/     # one file per use case (UC1-UC5)
│   └── tests/plan_lifecycle.rs   # ignored placeholders, one per UC
├── client/                   # owner-side helpers: nonce creation, partial sweep signing (REQ05, REQ10)
└── keeper/                   # off-chain keeper: scan, preflight, co-sign, broadcast, nonce burn (REQ11, REQ14)
```

| UC | Instruction | File | REQ |
|----|-------------|------|-----|
| UC1 | `initialize_plan` | `instructions/initialize_plan.rs` | 01, 04, 05, 10 |
| UC2 | `check_in` | `instructions/check_in.rs` | 02, 10 |
| UC3 | `heir_sweep` | `instructions/heir_sweep.rs` | 03, 06-09 |
| UC4 | `close_plan` | `instructions/close_plan.rs` | 12 (+14 in keeper) |
| UC5 | `update_plan` | `instructions/update_plan.rs` | 13 |

## Prerequisites

- Rust (version pinned in `rust-toolchain.toml`)
- Solana CLI (Agave) and Anchor CLI 1.1.x (`anchor --version`)
- A local keypair at `~/.config/solana/id.json` (`solana-keygen new`)

## Getting started

```bash
cd anchor

anchor build          # compiles program, writes target/deploy/heirloom.so and the IDL
cargo check           # type-check the whole workspace (program, client, keeper)
cargo test            # litesvm tests (needs anchor build first); placeholders are #[ignore]d

# Optional: run against a local validator
solana-test-validator            # separate terminal
anchor deploy
```

## Localnet demo

The program has a `short-timers` feature that lowers min interval/grace to seconds. **Localnet only, never deploy it elsewhere.**

```bash
# terminal 1: builds with short timers, starts a validator with the program preloaded
./scripts/localnet.sh

# terminal 2 (from anchor/)
cargo run -p heirloom-keeper -- keygen                 # once; key is gitignored
KEEPER=$(solana address -k keeper/keeper-keypair.json)
solana airdrop 5 $KEEPER -u localhost
solana-keygen new -o /tmp/owner.json; solana-keygen new -o /tmp/ben.json
solana airdrop 10 $(solana address -k /tmp/owner.json) -u localhost
export OWNER_KEYPAIR=/tmp/owner.json

cargo run -p heirloom-client -- setup --keeper $KEEPER --beneficiary $(solana address -k /tmp/ben.json) --interval 8 --grace 2
cargo run -p heirloom-client -- status
cargo run -p heirloom-keeper -- scan        # too early: nothing happens
sleep 11
cargo run -p heirloom-keeper -- scan        # past deadline: keeper co-signs and sweeps
solana balance $(solana address -k /tmp/ben.json) -u localhost
```

Other owner commands: `check-in`, `update --interval N --grace N`, `close` (then a keeper scan burns the nonce).
`cargo run -p heirloom-keeper -- run --every 30` loops the scan.

## Tests

```bash
anchor build                                   # once; the program tests load target/deploy/heirloom.so
cargo test --workspace                         # everything below
```

| Test | What | Covers |
|------|------|--------|
| `programs/heirloom/tests/plan_lifecycle.rs` | LiteSVM, one or more tests per on-chain requirement (names carry the REQ id) | REQ01-REQ15, REQ17-REQ20, REQ25 |
| `keeper/tests/e2e_multi_user.rs` | Real validator, real keeper + client. Owners A, B, C, D with separate beneficiaries, interleaved create / check-in / sweep / cancel; exact balance and status assertions | REQ16, REQ21-REQ24, REQ26 |
| `keeper/src/scan.rs` unit tests | deadline logic | REQ23 |

The e2e test builds the program itself with `--features short-timers`, starts its own `solana-test-validator` on free ports and takes ~2 min. It skips with a message if the validator is not installed. Run only it with `cargo test -p heirloom-keeper --test e2e_multi_user -- --nocapture`.

Requirement ids follow the Deliverable 2 PDF (REQ01-REQ26).

## Keeper

- Own keypair at `keeper/keeper-keypair.json` (gitignored). It is the nonce authority, fee payer and final co-signer for every plan that names it.
- `keeper/keeper-state.json` (gitignored) remembers plan -> (owner, nonce) so it can burn the nonce after a plan is closed.
- **Known gap:** the keeper only learns a plan's nonce by seeing the plan. A plan created and closed between two scans leaves its nonce account unburned (inert, but the rent is not reclaimed). Fix options: scan for orphan nonces with authority = keeper, or have the client register the nonce with the keeper.
- **Hard guard (REQ26):** right before signing, the keeper re-reads the plan and the Clock at *finalized* commitment and refuses unless `Clock >= deadline + safety margin` (`--safety-margin`, default 300s).
- Preflight before signing: fee payer is keeper, 2 expected instructions, nonce authority is keeper, nonce value still matches the tx (not stale), owner signature valid, plus a simulation.

## Notes

- This is a subfolder of the `heirloom` repo; it has no git repo of its own (`anchor init --no-git`).
- Program ID in `declare_id!` / `Anchor.toml` is the generated dev key; run `anchor keys sync` after changing `target/deploy/heirloom-keypair.json`.
- Production bounds in `constants.rs` (interval/grace min/max) are placeholders pending a decision.
