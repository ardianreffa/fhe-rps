import './style.css';
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  parseEventLogs,
  type Address,
  type Hex,
  type WalletClient,
} from 'viem';
import { arbitrumSepolia } from 'viem/chains';
import { Encryptable } from '@cofhe/sdk';
import { arbSepolia } from '@cofhe/sdk/chains';
import { createCofheClient, createCofheConfig } from '@cofhe/sdk/web';
import { GAME_ADDRESS, gameAbi } from './abi';

// ---------- Setup ----------

const RPC_URL = 'https://sepolia-rollup.arbitrum.io/rpc';
const EXPLORER = 'https://sepolia.arbiscan.io';
const GAMES_TO_SHOW = 20;
// Public link used in "Share on X" posts (always the live site, even when testing locally)
const SITE_URL = 'https://fhe-rps.vercel.app';

const MOVES = ['✊', '✋', '✌️'];
const STATUS = ['None', 'Waiting for opponent', 'Ready to reveal', 'Finished', 'Cancelled'];

const publicClient = createPublicClient({ chain: arbitrumSepolia, transport: http(RPC_URL) });

// CoFHE client: encrypts moves and decrypts the public result.
const cofhe = createCofheClient(
  createCofheConfig({
    supportedChains: [arbSepolia],
    useWorkers: false,
  }),
);

let walletClient: WalletClient | null = null;
let account: Address | null = null;
let selectedMove: number | null = null;
let busy = false;

type Game = {
  id: bigint;
  playerA: Address;
  playerB: Address;
  result: Hex;
  status: number;
  outcome: number;
};

// ---------- Helpers ----------

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const same = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const ZERO = '0x0000000000000000000000000000000000000000';

function setStatus(message: string, kind: 'info' | 'ok' | 'error' = 'info') {
  const el = $('status');
  el.hidden = false;
  el.className = `status ${kind}`;
  el.innerHTML = message;
}

function readableError(err: unknown): string {
  const e = err as { shortMessage?: string; message?: string };
  const msg = e?.shortMessage || e?.message || String(err);
  if (/user rejected|denied/i.test(msg)) return 'You rejected the request in your wallet.';
  return msg.length > 300 ? msg.slice(0, 300) + '…' : msg;
}

function updateButtons() {
  const ready = !!account && selectedMove !== null && !busy;
  ($('createBtn') as HTMLButtonElement).disabled = !ready;

  // Tell the player why the buttons are disabled
  const hint = $('pickHint');
  if (!account) {
    hint.textContent = 'Connect your wallet to play';
    hint.classList.add('nudge');
  } else if (selectedMove === null) {
    hint.textContent = '👆 Pick a move above first';
    hint.classList.add('nudge');
  } else {
    hint.textContent = 'or join an open game below';
    hint.classList.remove('nudge');
  }
  document.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((b) => {
    const needsMove = b.dataset.action === 'join';
    b.disabled = busy || !account || (needsMove && selectedMove === null);
  });
}

async function withBusy(task: () => Promise<void>) {
  if (busy) return;
  busy = true;
  updateButtons();
  try {
    await task();
  } catch (err) {
    console.error(err);
    setStatus(`❌ ${readableError(err)}`, 'error');
  } finally {
    busy = false;
    updateButtons();
    await loadGames();
  }
}

// ---------- Wallet ----------

async function connect() {
  const eth = (window as any).ethereum;
  if (!eth) {
    setStatus('No wallet found. Please install MetaMask (or another browser wallet) and reload.', 'error');
    return;
  }

  await withBusy(async () => {
    setStatus('Connecting wallet…');
    const temp = createWalletClient({ chain: arbitrumSepolia, transport: custom(eth) });
    const [addr] = await temp.requestAddresses();

    try {
      await temp.switchChain({ id: arbitrumSepolia.id });
    } catch {
      await temp.addChain({ chain: arbitrumSepolia });
      await temp.switchChain({ id: arbitrumSepolia.id });
    }

    account = addr;
    walletClient = createWalletClient({ account: addr, chain: arbitrumSepolia, transport: custom(eth) });

    setStatus('Preparing encryption…');
    await cofhe.connect(publicClient as any, walletClient as any);

    $('connectBtn').textContent = short(addr);
    $('connectBtn').classList.remove('primary');
    setStatus(`✅ Connected as <b>${short(addr)}</b>. Pick a move, then create or join a game.`, 'ok');

    eth.on?.('accountsChanged', () => location.reload());
    eth.on?.('chainChanged', () => location.reload());
  });
}

// ---------- Encryption ----------

// The SDK goes through these steps when it encrypts a value.
const ENCRYPT_STEPS: { id: string; label: string }[] = [
  { id: 'initTfhe', label: 'Starting the encryption engine' },
  { id: 'fetchKeys', label: 'Fetching Fhenix public keys' },
  { id: 'pack', label: 'Packing your move' },
  { id: 'prove', label: 'Creating a zero-knowledge proof' },
  { id: 'verify', label: 'Verifying with the Fhenix network' },
];

function showEncryptStep(step: string) {
  const index = ENCRYPT_STEPS.findIndex((s) => s.id === step);
  if (index < 0) return;
  const bar = ENCRYPT_STEPS.map((_, i) => (i <= index ? '●' : '○')).join(' ');
  setStatus(
    `🔐 Encrypting your move… <b>${index + 1}/${ENCRYPT_STEPS.length}</b>: ${ENCRYPT_STEPS[index].label}` +
      `<div class="steps">${bar}</div>`,
  );
}

async function encryptMove(move: number) {
  setStatus('🔐 Encrypting your move in the browser… The first time can take up to a minute.');
  const [handle, proof] = await cofhe
    .encryptInputs([Encryptable.uint8(BigInt(move))])
    .setConsumingContract(GAME_ADDRESS)
    .onStep((step, context) => {
      if (context?.isStart) showEncryptStep(step);
    })
    .execute();
  return { handle: handle as Hex, proof: proof as Hex };
}

async function send(functionName: 'createGame' | 'joinGame' | 'revealResult' | 'cancelGame', args: readonly unknown[]) {
  if (!walletClient || !account) throw new Error('Connect your wallet first.');
  setStatus('🦊 Please confirm the transaction in your wallet…');
  const hash = await walletClient.writeContract({
    address: GAME_ADDRESS,
    abi: gameAbi,
    functionName,
    args: args as any,
    account,
    chain: arbitrumSepolia,
  });
  setStatus(`⏳ Waiting for confirmation… <a href="${EXPLORER}/tx/${hash}" target="_blank" rel="noreferrer">view tx</a>`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') throw new Error('Transaction failed onchain.');
  return { hash, receipt };
}

// ---------- Game actions ----------

async function createGame() {
  if (selectedMove === null) return;
  const move = selectedMove;
  await withBusy(async () => {
    const { handle, proof } = await encryptMove(move);
    const { hash, receipt } = await send('createGame', [handle, proof]);

    const logs = parseEventLogs({ abi: gameAbi, eventName: 'GameCreated', logs: receipt.logs });
    const id = logs[0]?.args.gameId;
    setStatus(
      `✅ Game <b>#${id ?? '?'}</b> created with your encrypted ${MOVES[move]}. Share the game number with a friend! ` +
        `<a href="${EXPLORER}/tx/${hash}" target="_blank" rel="noreferrer">view tx</a>`,
      'ok',
    );
  });
}

async function joinGame(id: bigint) {
  if (selectedMove === null) return;
  const move = selectedMove;
  await withBusy(async () => {
    const { handle, proof } = await encryptMove(move);
    const { hash } = await send('joinGame', [id, handle, proof]);
    setStatus(
      `✅ You joined game <b>#${id}</b> with your encrypted ${MOVES[move]}. The winner is computed while encrypted. ` +
        `Press <b>Reveal result</b> to open it. <a href="${EXPLORER}/tx/${hash}" target="_blank" rel="noreferrer">view tx</a>`,
      'ok',
    );
  });
}

async function revealResult(game: Game) {
  await withBusy(async () => {
    setStatus('🔓 Asking the Fhenix network to decrypt the result… This can take a little while.');
    const decrypted = await cofhe.decryptForTx(game.result).withoutACP().execute();
    const outcome = Number(decrypted.decryptedValue);
    await send('revealResult', [game.id, outcome, decrypted.signature as Hex]);

    const finished: Game = { ...game, status: 3, outcome };
    const isPlayer = same(game.playerA, account) || same(game.playerB, account);
    const share = isPlayer
      ? ` <a href="https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText(finished))}" target="_blank" rel="noreferrer">Share on 𝕏</a>`
      : '';
    setStatus(`✅ Result of game <b>#${game.id}</b> is now public: <b>${outcomeText(game, outcome)}</b>${share}`, 'ok');
  });
}

async function cancelGame(id: bigint) {
  await withBusy(async () => {
    await send('cancelGame', [id]);
    setStatus(`Game <b>#${id}</b> cancelled.`, 'ok');
  });
}

// ---------- Reading games ----------

function outcomeText(g: Pick<Game, 'playerA' | 'playerB'>, outcome: number) {
  if (outcome === 0) return '🤝 Draw';
  const winner = outcome === 1 ? g.playerA : g.playerB;
  return same(winner, account) ? '🏆 You won!' : `🏆 ${short(winner)} won`;
}

// Reads ALL games (newest first) in batched calls, so the leaderboard can use every result.
async function fetchGames(): Promise<Game[]> {
  const count = await publicClient.readContract({ address: GAME_ADDRESS, abi: gameAbi, functionName: 'gameCount' });
  const ids: bigint[] = [];
  for (let i = count; i >= 1n; i--) ids.push(i);
  if (ids.length === 0) return [];

  const rows = await publicClient.multicall({
    allowFailure: false,
    contracts: ids.map((id) => ({
      address: GAME_ADDRESS,
      abi: gameAbi,
      functionName: 'games' as const,
      args: [id] as const,
    })),
  });

  return rows.map((row, i) => {
    const [playerA, playerB, , , result, status, outcome] = row as readonly [
      Address,
      Address,
      Hex,
      Hex,
      Hex,
      number,
      number,
    ];
    return { id: ids[i], playerA, playerB, result, status: Number(status), outcome: Number(outcome) };
  });
}

// ---------- Leaderboard ----------

type Score = { player: Address; wins: number; draws: number; losses: number; points: number };

function buildLeaderboard(games: Game[]): Score[] {
  const table = new Map<string, Score>();
  const row = (p: Address) => {
    const key = p.toLowerCase();
    if (!table.has(key)) table.set(key, { player: p, wins: 0, draws: 0, losses: 0, points: 0 });
    return table.get(key)!;
  };

  for (const g of games) {
    if (g.status !== 3) continue; // only finished games count
    const a = row(g.playerA);
    const b = row(g.playerB);
    if (g.outcome === 0) {
      a.draws++;
      b.draws++;
    } else if (g.outcome === 1) {
      a.wins++;
      b.losses++;
    } else if (g.outcome === 2) {
      b.wins++;
      a.losses++;
    }
  }

  const scores = [...table.values()];
  scores.forEach((s) => (s.points = s.wins * 3 + s.draws));
  // More points first; then more wins; then fewer games played
  return scores.sort(
    (x, y) =>
      y.points - x.points || y.wins - x.wins || x.wins + x.draws + x.losses - (y.wins + y.draws + y.losses),
  );
}

function renderLeaderboard(games: Game[]) {
  const scores = buildLeaderboard(games);
  if (scores.length === 0) {
    $('board').innerHTML = '<p class="hint">No finished games yet.</p>';
    return;
  }

  const line = (s: Score, rank: number) => {
    const you = same(s.player, account);
    const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`;
    return `
      <div class="rank ${you ? 'mine' : ''}">
        <span class="pos">${medal}</span>
        <span class="who">${you ? 'You' : short(s.player)}</span>
        <span class="wdl">${s.wins}W ${s.draws}D ${s.losses}L</span>
        <span class="pts">${s.points} pts</span>
      </div>`;
  };

  let html = scores.slice(0, 10).map((s, i) => line(s, i + 1)).join('');

  // Show your own rank too, if you're outside the top 10
  const myIndex = scores.findIndex((s) => same(s.player, account));
  if (myIndex >= 10) html += `<div class="gap">…</div>${line(scores[myIndex], myIndex + 1)}`;

  $('board').innerHTML = html;
}

// ---------- Share on X ----------

function shareText(g: Game) {
  const youA = same(g.playerA, account);
  const won = (g.outcome === 1 && youA) || (g.outcome === 2 && !youA);
  const headline =
    g.outcome === 0
      ? "It's a draw 🤝 in encrypted rock-paper-scissors ✊✋✌️"
      : won
        ? 'I just won 🏆 a game of encrypted rock-paper-scissors ✊✋✌️'
        : 'I just lost 😅 a game of encrypted rock-paper-scissors ✊✋✌️';
  return (
    `${headline}\n\n` +
    `Both moves stayed encrypted onchain, only the result was revealed 🔐\n\n` +
    `Built on @fhenix CoFHE. Can you beat me?\n${SITE_URL}`
  );
}

function shareOnX(g: Game) {
  const url = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText(g))}`;
  window.open(url, '_blank', 'noopener,noreferrer');
}

function gameRow(g: Game) {
  const youA = same(g.playerA, account);
  const youB = same(g.playerB, account);
  const players =
    `<b>${youA ? 'You' : short(g.playerA)}</b> vs ` +
    (g.playerB === ZERO ? '<i>waiting…</i>' : `<b>${youB ? 'You' : short(g.playerB)}</b>`);

  let action = '';
  if (g.status === 1 && youA) action = `<button class="btn ghost" data-action="cancel" data-id="${g.id}">Cancel</button>`;
  else if (g.status === 1) action = `<button class="btn primary" data-action="join" data-id="${g.id}">Join with my move</button>`;
  else if (g.status === 2) action = `<button class="btn primary" data-action="reveal" data-id="${g.id}">Reveal result</button>`;
  else if (g.status === 3 && (youA || youB))
    action = `<button class="btn ghost" data-action="share" data-id="${g.id}">Share on 𝕏</button>`;

  const result = g.status === 3 ? `<span class="result">${outcomeText(g, g.outcome)}</span>` : '';

  return `
    <div class="game ${youA || youB ? 'mine' : ''}">
      <div class="gid">#${g.id}</div>
      <div class="info">
        <div>${players}</div>
        <div class="meta">${STATUS[g.status]} ${result}</div>
      </div>
      <div class="act">${action}</div>
    </div>`;
}

let currentGames: Game[] = [];

async function loadGames() {
  try {
    currentGames = await fetchGames();
    const recent = currentGames.slice(0, GAMES_TO_SHOW);
    $('games').innerHTML = recent.length
      ? recent.map(gameRow).join('')
      : '<p class="hint">No games yet. Be the first to create one!</p>';
    renderLeaderboard(currentGames);
    updateButtons();
  } catch (err) {
    console.error(err);
    $('games').innerHTML = `<p class="hint">Could not load games: ${readableError(err)}</p>`;
  }
}

// ---------- Events ----------

$('connectBtn').addEventListener('click', () => {
  if (!account) connect();
});

document.querySelectorAll<HTMLButtonElement>('.move').forEach((btn) => {
  btn.addEventListener('click', () => {
    selectedMove = Number(btn.dataset.move);
    document.querySelectorAll('.move').forEach((b) => b.classList.toggle('selected', b === btn));
    updateButtons();
  });
});

$('createBtn').addEventListener('click', createGame);
$('refreshBtn').addEventListener('click', loadGames);

$('games').addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-action]');
  if (!btn || btn.disabled) return;
  const id = BigInt(btn.dataset.id!);
  const game = currentGames.find((g) => g.id === id);
  if (btn.dataset.action === 'join') joinGame(id);
  if (btn.dataset.action === 'cancel') cancelGame(id);
  if (btn.dataset.action === 'reveal' && game) revealResult(game);
  if (btn.dataset.action === 'share' && game) shareOnX(game);
});

($('contractLink') as HTMLAnchorElement).href = `${EXPLORER}/address/${GAME_ADDRESS}`;

loadGames();
setInterval(() => {
  if (!busy) loadGames();
}, 15000);
