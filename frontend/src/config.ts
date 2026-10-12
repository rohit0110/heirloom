import { PublicKey } from "@solana/web3.js";

const env = import.meta.env;

export const RPC_URL: string = env.VITE_RPC_URL ?? "https://api.devnet.solana.com";
export const PROGRAM_ID = new PublicKey(env.VITE_PROGRAM_ID);
export const KEEPER = new PublicKey(env.VITE_KEEPER_PUBKEY);
export const GRACE_SECONDS: number = Number(env.VITE_GRACE_SECONDS ?? 10);
