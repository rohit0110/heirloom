import { useCallback, useEffect, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PublicKey } from "@solana/web3.js";

import { GRACE_SECONDS, KEEPER, PROGRAM_ID } from "./config";
import { chainTime, checkIn, closePlan, createPlan, fetchPlan, type OwnerWallet, type Plan } from "./heirloom";

const ctx = { programId: PROGRAM_ID, keeper: KEEPER };

const UNITS = [
  { label: "seconds", secs: 1 },
  { label: "minutes", secs: 60 },
  { label: "hours", secs: 3600 },
  { label: "days", secs: 86400 },
] as const;

function fmt(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts = [d && `${d}d`, (d || h) && `${h}h`, (d || h || m) && `${m}m`, `${s % 60}s`];
  return parts.filter(Boolean).join(" ");
}

function short(pk: PublicKey): string {
  const s = pk.toBase58();
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

export default function App() {
  const { connection } = useConnection();
  const { publicKey, signTransaction } = useWallet();

  const [plan, setPlan] = useState<Plan | null | undefined>(undefined); // undefined = loading
  const [skew, setSkew] = useState(0); // on-chain clock minus local clock, seconds
  const [now, setNow] = useState(() => Date.now() / 1000);
  const [beneficiary, setBeneficiary] = useState("");
  const [amount, setAmount] = useState("30");
  const [unit, setUnit] = useState<number>(1);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const wallet: OwnerWallet | null = useMemo(
    () => (publicKey && signTransaction ? { publicKey, signTransaction } : null),
    [publicKey, signTransaction],
  );

  const refresh = useCallback(async () => {
    if (!publicKey) return setPlan(undefined);
    try {
      const [p, chain] = await Promise.all([fetchPlan(connection, ctx, publicKey), chainTime(connection)]);
      setPlan(p);
      setSkew(chain - Date.now() / 1000);
    } catch (e) {
      setError(String(e));
    }
  }, [connection, publicKey]);

  useEffect(() => {
    setError(null);
    void refresh();
    const t = setInterval(() => void refresh(), 10_000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(t);
  }, []);

  const benefKey = useMemo(() => {
    try {
      return beneficiary ? new PublicKey(beneficiary.trim()) : null;
    } catch {
      return null;
    }
  }, [beneficiary]);
  const intervalSec = Math.round(Number(amount) * UNITS[unit].secs);
  const formOk = !!benefKey && Number.isFinite(intervalSec) && intervalSec > 0;

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    setError(null);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const chainNow = now + skew;

  return (
    <main className="page">
      <header className="top">
        <h1>Heirloom</h1>
        <WalletMultiButton />
      </header>

      {!wallet && <p className="hint">Connect a wallet to create or manage a plan.</p>}

      {wallet && plan === undefined && <p className="hint">Loading…</p>}

      {wallet && plan === null && (
        <>
          <section className="boxes">
            <div className="box">
              <label htmlFor="ben">Beneficiary wallet</label>
              <input
                id="ben"
                placeholder="Public key"
                value={beneficiary}
                onChange={(e) => setBeneficiary(e.target.value)}
                spellCheck={false}
              />
              {beneficiary && !benefKey && <small className="bad">Not a valid public key</small>}
            </div>
            <div className="box">
              <label htmlFor="period">Check in every</label>
              <div className="row">
                <input
                  id="period"
                  type="number"
                  min="1"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
                <select value={unit} onChange={(e) => setUnit(Number(e.target.value))}>
                  {UNITS.map((u, i) => (
                    <option key={u.label} value={i}>
                      {u.label}
                    </option>
                  ))}
                </select>
              </div>
              <small>Plus a {GRACE_SECONDS}s grace period before the plan can execute.</small>
            </div>
          </section>
          <div className="actions">
            <button
              disabled={!formOk || !!busy}
              onClick={() =>
                run("Creating plan (3 wallet prompts)…", () =>
                  createPlan(connection, ctx, wallet, benefKey!, intervalSec, GRACE_SECONDS),
                )
              }
            >
              {busy ?? "Create plan"}
            </button>
          </div>
        </>
      )}

      {wallet && plan && plan.status === "Active" && (
        <section className="status">
          <div className="box wide">
            <div className="kv">
              <span>Beneficiary</span>
              <b title={plan.beneficiary.toBase58()}>{short(plan.beneficiary)}</b>
            </div>
            <div className="kv">
              <span>Check in every</span>
              <b>{fmt(plan.checkinInterval)}</b>
            </div>
            <div className="countdown">
              {chainNow < plan.signBy ? (
                <>
                  <span>Time left to sign</span>
                  <strong>{fmt(plan.signBy - chainNow)}</strong>
                </>
              ) : chainNow < plan.deadline ? (
                <>
                  <span className="bad">Overdue. Grace period left</span>
                  <strong className="bad">{fmt(plan.deadline - chainNow)}</strong>
                </>
              ) : (
                <>
                  <span className="bad">Deadline passed</span>
                  <strong className="bad">The plan can execute at any moment</strong>
                </>
              )}
            </div>
            <button
              disabled={!!busy}
              onClick={() => run("Signing (2 wallet prompts)…", () => checkIn(connection, ctx, wallet, plan))}
            >
              {busy ?? "Sign"}
            </button>
            <button
              className="link"
              disabled={!!busy}
              onClick={() => {
                if (window.confirm("Cancel this plan? Your beneficiary will no longer receive anything from it.")) {
                  void run("Cancelling…", () => closePlan(connection, ctx, wallet));
                }
              }}
            >
              Cancel plan
            </button>
          </div>
        </section>
      )}

      {wallet && plan && plan.status === "Distributed" && (
        <section className="status">
          <div className="box wide">
            <p>
              This plan has executed. The balance was sent to <b>{short(plan.beneficiary)}</b>.
            </p>
            <button disabled={!!busy} onClick={() => run("Closing…", () => closePlan(connection, ctx, wallet))}>
              {busy ?? "Start a new plan"}
            </button>
          </div>
        </section>
      )}

      {error && <p className="error">{error}</p>}
    </main>
  );
}
