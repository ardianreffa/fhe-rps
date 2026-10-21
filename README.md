# Encrypted Rock Paper Scissors ✊✋✌️

Rock-paper-scissors where **both moves stay encrypted onchain**. The contract picks the winner without ever seeing either move, and only the result is revealed.

Built on [Fhenix CoFHE](https://www.fhenix.io/) (Fully Homomorphic Encryption coprocessor) on **Arbitrum Sepolia testnet**.

- 🎮 **Play:** https://fhe-rps.vercel.app
- 📜 **Contract (verified):** [`0xf2Ef8AfC552e046e78a784c9b651759dB58bb754`](https://sepolia.arbiscan.io/address/0xf2Ef8AfC552e046e78a784c9b651759dB58bb754#code)

## Why FHE?

On a normal blockchain, rock-paper-scissors is broken: everything is public, so player 2 can read player 1's move onchain and always win.

With CoFHE, each move is encrypted in the player's browser before it is sent. The contract computes the winner on the encrypted moves, and only the final outcome is decrypted and published.

## How a game works

1. **Player A** picks a move. It is encrypted in the browser (`@cofhe/sdk`) and sent with `createGame`.
2. **Player B** joins with their own encrypted move via `joinGame`.
3. The contract computes the outcome **while everything is still encrypted**:
   - `d = moveA + 3 - moveB`
   - `outcome = d >= 3 ? d - 3 : d` (done with `FHE.gte` + `FHE.select`, no branching)
   - `0` = draw, `1` = player A wins, `2` = player B wins
4. Only the outcome is marked public (`FHE.allowPublic`). Anyone can decrypt it offchain with `decryptForTx` and publish it with `revealResult`, which checks the Threshold Network signature using `FHE.verifyDecryptResult`.

Moves: `0` = Rock, `1` = Paper, `2` = Scissors.

## Privacy & fairness

- Moves are never revealed. Each player can decrypt **only their own** move (`FHE.allowSender`).
- An invalid encrypted move (for example `7`) is silently turned into Rock with `FHE.select`, so cheating gives no advantage.
- A fake outcome is rejected, because the decryption signature must match the real encrypted result.
- Encrypted inputs are bound to the game contract and the sender, so nobody can copy another player's encrypted move.
- Note: after the reveal, each player can infer the opponent's move from their own move plus the outcome. This is inherent to the game. Spectators cannot (except that a draw means both moves were equal).

## Tests

17 tests run against the CoFHE mocks (`contracts/test/RockPaperScissors.test.ts`), including:

- all 9 move combinations
- invalid move handling
- opponent and spectators **cannot** decrypt a player's move
- fake outcomes are rejected
- game rules (no self-play, full games, cancel)

## Gas on Arbitrum Sepolia (measured on testnet)

| Action | Avg gas |
|---|---|
| `createGame` | ~285k |
| `joinGame` | ~492k |
| `revealResult` | ~62k |

## Project structure

```
contracts/   Hardhat project: Solidity contract, tests, deploy & gas tasks
web/         Website (Vite + viem + @cofhe/sdk), deployed on Vercel
```

## Run it yourself

**Contracts** (Node.js 20+ and pnpm):

```bash
cd contracts
pnpm install
pnpm hardhat test test/RockPaperScissors.test.ts
```

To deploy, create `contracts/.env` with `PRIVATE_KEY=...` (never commit it), then:

```bash
pnpm hardhat deploy-rps --network arb-sepolia
```

**Website:**

```bash
cd web
pnpm install
pnpm dev
```

## Stack

- `@cofhe/sdk` 1.0.1
- `@fhenixprotocol/cofhe-contracts` 1.0.0
- Hardhat 2, viem, Vite

## Credits

Built by [@ardianreffa](https://x.com/ardianreffa), a non-coder, step by step with AI assistance, following the Fhenix [CoFHE mainnet developer guide](https://cofhe-docs.fhenix.zone/).

The `contracts/` folder is based on Fhenix's [cofhe-hardhat-starter](https://github.com/fhenixprotocol/cofhe-hardhat-starter) (MIT).

⚠️ Testnet only. Not audited.
