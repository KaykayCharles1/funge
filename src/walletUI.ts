import type { ElectrumNetworkProvider } from "cashscript";
import { CONFIG } from "./config.ts";
import { formatUnits } from "./lib/format.ts";
import { newMnemonic } from "./wallet/local.ts";
import type { LocalWallet } from "./wallet/local.ts";
import { requestPersistentStorage, vault } from "./wallet/vault.ts";

const $ = (id: string) => document.getElementById(id)!;
const field = (id: string) => $(id) as HTMLInputElement | HTMLTextAreaElement;
const show = (id: string, visible: boolean) => $(id).classList.toggle("hidden", !visible);

const listeners = new Set<() => void>();
let seedTimer: ReturnType<typeof setTimeout> | undefined;

export const getLocalWallet = (): LocalWallet | null => vault.wallet();
export const onLocalWalletChange = (listener: () => void) => void listeners.add(listener);
const notify = () => listeners.forEach((l) => l());

function message(text: string, isError = true) {
  const el = $("lwMsg");
  el.textContent = text;
  el.className = `mt-2 text-sm ${isError ? "text-red-400" : "text-slate-300"}`;
}

function hideSeed() {
  clearTimeout(seedTimer);
  $("lwSeed").textContent = "";
  show("lwSeedBox", false);
}

function showSeed(mnemonic: string) {
  $("lwSeed").textContent = mnemonic;
  show("lwSeedBox", true);
  clearTimeout(seedTimer);
  seedTimer = setTimeout(hideSeed, 60_000); // never leave the phrase on screen
}

function render() {
  const state = vault.state();
  show("lwNone", state === "none");
  show("lwLocked", state === "locked");
  show("lwUnlocked", state === "unlocked");
  show("lwLockBtn", vault.hasPassword());
  $("lwAddress").textContent = vault.wallet()?.tokenAddress ?? "";
  if (state !== "unlocked") {
    hideSeed();
    $("lwBch").textContent = "—";
    $("lwPusd").textContent = "—";
  }
}

export async function refreshBalances(provider: ElectrumNetworkProvider) {
  const wallet = vault.wallet();
  if (!wallet) return;
  try {
    const { sats, pusd } = await wallet.getBalances(provider);
    $("lwBch").textContent = `${formatUnits(sats, 8)} BCH`;
    $("lwPusd").textContent = `${formatUnits(pusd, CONFIG.pusdDecimals)} PUSD`;
  } catch (e) {
    console.error(e);
  }
}

export async function initLocalWallet(provider: ElectrumNetworkProvider) {
  try {
    await vault.init();
  } catch (e) {
    console.error(e);
    message("Could not open browser storage. Private windows or blocked storage cannot keep a wallet.");
  }
  render();
  notify();
  void refreshBalances(provider);

  $("lwCreateBtn").addEventListener("click", async () => {
    const password = field("lwPassword").value;
    const imported = field("lwImport").value.trim();
    if (password && password !== field("lwPassword2").value) {
      message("The two passwords do not match.");
      return;
    }
    const button = $("lwCreateBtn") as HTMLButtonElement;
    button.disabled = true;
    message("Creating…", false);
    try {
      const mnemonic = imported || newMnemonic();
      await vault.create(mnemonic, password || undefined);
      void requestPersistentStorage();
      field("lwPassword").value = "";
      field("lwPassword2").value = "";
      field("lwImport").value = "";
      message("", false);
      if (!imported) showSeed(mnemonic);
      render();
      notify();
      void refreshBalances(provider);
    } catch (e) {
      message(e instanceof Error ? e.message : "Could not create the wallet.");
    } finally {
      button.disabled = false;
    }
  });

  $("lwUnlockBtn").addEventListener("click", async () => {
    const button = $("lwUnlockBtn") as HTMLButtonElement;
    button.disabled = true;
    message("Unlocking…", false);
    try {
      const ok = await vault.unlock(field("lwUnlockPassword").value);
      if (!ok) {
        message("Wrong password.");
        return;
      }
      field("lwUnlockPassword").value = "";
      message("", false);
      render();
      notify();
      void refreshBalances(provider);
    } finally {
      button.disabled = false;
    }
  });

  $("lwLockBtn").addEventListener("click", () => {
    vault.lock();
    message("", false);
    render();
    notify();
  });

  $("lwCopyBtn").addEventListener("click", () => {
    const wallet = vault.wallet();
    if (wallet) void navigator.clipboard.writeText(wallet.tokenAddress);
  });

  $("lwBackupBtn").addEventListener("click", () => {
    const mnemonic = vault.revealMnemonic();
    if (mnemonic) showSeed(mnemonic);
  });

  $("lwSeedDoneBtn").addEventListener("click", hideSeed);

  $("lwDeleteBtn").addEventListener("click", async () => {
    const sure = window.confirm(
      "Delete this wallet from this browser? Without your seed phrase backup, any funds in it are lost for good.",
    );
    if (!sure) return;
    await vault.wipe();
    message("", false);
    render();
    notify();
  });
}