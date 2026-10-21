import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import hre from "hardhat";
import { Encryptable, FheTypes } from "@cofhe/sdk";
import { expect } from "chai";

const TASK_COFHE_MOCKS_DEPLOY = "task:cofhe-mocks:deploy";

// Moves
const ROCK = 0n;
const PAPER = 1n;
const SCISSORS = 2n;

// Outcomes
const DRAW = 0n;
const A_WINS = 1n;
const B_WINS = 2n;

describe("RockPaperScissors", function () {
  async function deployFixture() {
    await hre.run(TASK_COFHE_MOCKS_DEPLOY);

    const [deployer, alice, bob, carol] = await hre.ethers.getSigners();

    const Game = await hre.ethers.getContractFactory("RockPaperScissors");
    const game = await Game.connect(deployer).deploy();
    const gameAddress = await game.getAddress();

    const aliceClient = await hre.cofhe.createClientWithBatteries(alice);
    const bobClient = await hre.cofhe.createClientWithBatteries(bob);
    const carolClient = await hre.cofhe.createClientWithBatteries(carol);

    return { game, gameAddress, alice, bob, carol, aliceClient, bobClient, carolClient };
  }

  // Encrypts a move in the browser/SDK, bound to the game contract.
  async function encryptMove(client: any, gameAddress: string, move: bigint) {
    const [handle, proof] = await client
      .encryptInputs([Encryptable.uint8(move)])
      .setConsumingContract(gameAddress)
      .execute();
    return { handle, proof };
  }

  // Plays one full round: create -> join -> reveal. Returns the revealed outcome.
  async function playRound(moveA: bigint, moveB: bigint) {
    const ctx = await loadFixture(deployFixture);
    const { game, gameAddress, alice, bob, aliceClient, bobClient, carolClient, carol } = ctx;

    // Alice creates game #1
    const a = await encryptMove(aliceClient, gameAddress, moveA);
    await game.connect(alice).createGame(a.handle, a.proof);

    // Bob joins game #1
    const b = await encryptMove(bobClient, gameAddress, moveB);
    await game.connect(bob).joinGame(1, b.handle, b.proof);

    // Anyone (here: Carol, a spectator) decrypts the public result and reveals it
    const resultHandle = (await game.games(1)).result;
    const decrypted = await carolClient.decryptForTx(resultHandle).withoutACP().execute();
    await game.connect(carol).revealResult(1, decrypted.decryptedValue, decrypted.signature);

    const g = await game.games(1);
    return { outcome: BigInt(g.outcome), status: Number(g.status), ctx };
  }

  describe("All 9 combinations", function () {
    const cases: [string, bigint, bigint, bigint][] = [
      ["Rock vs Rock", ROCK, ROCK, DRAW],
      ["Rock vs Paper", ROCK, PAPER, B_WINS],
      ["Rock vs Scissors", ROCK, SCISSORS, A_WINS],
      ["Paper vs Rock", PAPER, ROCK, A_WINS],
      ["Paper vs Paper", PAPER, PAPER, DRAW],
      ["Paper vs Scissors", PAPER, SCISSORS, B_WINS],
      ["Scissors vs Rock", SCISSORS, ROCK, B_WINS],
      ["Scissors vs Paper", SCISSORS, PAPER, A_WINS],
      ["Scissors vs Scissors", SCISSORS, SCISSORS, DRAW],
    ];

    for (const [name, moveA, moveB, expected] of cases) {
      it(`${name} -> outcome ${expected}`, async function () {
        const { outcome, status } = await playRound(moveA, moveB);
        expect(outcome).to.equal(expected);
        expect(status).to.equal(3); // Finished
      });
    }
  });

  describe("Fair play", function () {
    it("Treats an invalid move (7) as Rock", async function () {
      // Alice sends 7 (invalid) -> treated as Rock; Bob plays Paper -> Bob wins
      const { outcome } = await playRound(7n, PAPER);
      expect(outcome).to.equal(B_WINS);
    });

    it("Each player can decrypt their own move", async function () {
      const { game, gameAddress, alice, aliceClient } = await loadFixture(deployFixture);

      const a = await encryptMove(aliceClient, gameAddress, SCISSORS);
      await game.connect(alice).createGame(a.handle, a.proof);

      const moveA = (await game.games(1)).moveA;
      const mine = await aliceClient.decryptForView(moveA, FheTypes.Uint8).execute();
      expect(mine).to.equal(SCISSORS);
    });

    it("Opponent and spectators cannot decrypt a player's move", async function () {
      const { game, gameAddress, alice, bob, aliceClient, bobClient, carolClient } =
        await loadFixture(deployFixture);

      const a = await encryptMove(aliceClient, gameAddress, PAPER);
      await game.connect(alice).createGame(a.handle, a.proof);
      const b = await encryptMove(bobClient, gameAddress, ROCK);
      await game.connect(bob).joinGame(1, b.handle, b.proof);

      const moveA = (await game.games(1)).moveA;

      // Bob (opponent) tries to peek at Alice's move -> must fail
      let bobFailed = false;
      try {
        await bobClient.decryptForView(moveA, FheTypes.Uint8).execute();
      } catch {
        bobFailed = true;
      }
      expect(bobFailed, "Bob should NOT be able to decrypt Alice's move").to.be.true;

      // Carol (spectator) tries too -> must fail
      let carolFailed = false;
      try {
        await carolClient.decryptForView(moveA, FheTypes.Uint8).execute();
      } catch {
        carolFailed = true;
      }
      expect(carolFailed, "Carol should NOT be able to decrypt Alice's move").to.be.true;

      // Alice herself still can
      const mine = await aliceClient.decryptForView(moveA, FheTypes.Uint8).execute();
      expect(mine).to.equal(PAPER);
    });

    it("Rejects a revealed outcome that does not match the signature", async function () {
      const { game, gameAddress, alice, bob, aliceClient, bobClient, carolClient, carol } =
        await loadFixture(deployFixture);

      const a = await encryptMove(aliceClient, gameAddress, ROCK);
      await game.connect(alice).createGame(a.handle, a.proof);
      const b = await encryptMove(bobClient, gameAddress, SCISSORS);
      await game.connect(bob).joinGame(1, b.handle, b.proof);

      const resultHandle = (await game.games(1)).result;
      const decrypted = await carolClient.decryptForTx(resultHandle).withoutACP().execute();
      expect(decrypted.decryptedValue).to.equal(A_WINS);

      // Bob tries to claim he won (2) using Alice's real signature
      await expect(game.connect(bob).revealResult(1, B_WINS, decrypted.signature)).to.be.reverted;
    });
  });

  describe("Game rules", function () {
    it("Cannot play against yourself", async function () {
      const { game, gameAddress, alice, aliceClient } = await loadFixture(deployFixture);

      const a = await encryptMove(aliceClient, gameAddress, ROCK);
      await game.connect(alice).createGame(a.handle, a.proof);

      const again = await encryptMove(aliceClient, gameAddress, PAPER);
      await expect(game.connect(alice).joinGame(1, again.handle, again.proof)).to.be.revertedWith(
        "You cannot play against yourself",
      );
    });

    it("Cannot join a game that is already full", async function () {
      const { game, gameAddress, alice, bob, carol, aliceClient, bobClient, carolClient } =
        await loadFixture(deployFixture);

      const a = await encryptMove(aliceClient, gameAddress, ROCK);
      await game.connect(alice).createGame(a.handle, a.proof);
      const b = await encryptMove(bobClient, gameAddress, PAPER);
      await game.connect(bob).joinGame(1, b.handle, b.proof);

      const c = await encryptMove(carolClient, gameAddress, SCISSORS);
      await expect(game.connect(carol).joinGame(1, c.handle, c.proof)).to.be.revertedWith(
        "Game is not open",
      );
    });

    it("Creator can cancel before anyone joins, others cannot", async function () {
      const { game, gameAddress, alice, bob, aliceClient, bobClient } = await loadFixture(deployFixture);

      const a = await encryptMove(aliceClient, gameAddress, ROCK);
      await game.connect(alice).createGame(a.handle, a.proof);

      await expect(game.connect(bob).cancelGame(1)).to.be.revertedWith("Only the creator can cancel");
      await game.connect(alice).cancelGame(1);
      expect(Number((await game.games(1)).status)).to.equal(4); // Cancelled

      const b = await encryptMove(bobClient, gameAddress, PAPER);
      await expect(game.connect(bob).joinGame(1, b.handle, b.proof)).to.be.revertedWith(
        "Game is not open",
      );
    });

    it("Game ids count up", async function () {
      const { game, gameAddress, alice, aliceClient } = await loadFixture(deployFixture);

      for (let i = 0; i < 2; i++) {
        const a = await encryptMove(aliceClient, gameAddress, ROCK);
        await game.connect(alice).createGame(a.handle, a.proof);
      }
      expect(await game.gameCount()).to.equal(2n);
    });
  });
});
