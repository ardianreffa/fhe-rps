// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@fhenixprotocol/cofhe-contracts/FHE.sol";

/// @title Encrypted Rock-Paper-Scissors on Fhenix CoFHE
/// @notice Both moves stay encrypted onchain. The contract computes the winner
///         without ever seeing the moves, and only the final result is revealed.
///
/// Moves:   0 = Rock, 1 = Paper, 2 = Scissors
/// Outcome: 0 = Draw, 1 = Player A wins, 2 = Player B wins
contract RockPaperScissors {
    enum Status {
        None,               // game does not exist
        WaitingForOpponent, // player A has moved, waiting for player B
        WaitingForReveal,   // both moved, encrypted result ready to be revealed
        Finished,           // result revealed
        Cancelled           // player A cancelled before anyone joined
    }

    struct Game {
        address playerA;
        address playerB;
        euint8 moveA;   // encrypted move of player A
        euint8 moveB;   // encrypted move of player B
        euint8 result;  // encrypted outcome (0 draw, 1 A wins, 2 B wins)
        Status status;
        uint8 outcome;  // plaintext outcome, filled in after reveal
    }

    uint256 public gameCount;
    mapping(uint256 => Game) public games;

    // Encrypted constants, created once and reused.
    euint8 private ZERO;
    euint8 private THREE;

    event GameCreated(uint256 indexed gameId, address indexed playerA);
    event GameJoined(uint256 indexed gameId, address indexed playerB);
    event GameFinished(uint256 indexed gameId, uint8 outcome, address winner);
    event GameCancelled(uint256 indexed gameId);

    constructor() {
        ZERO = FHE.asEuint8(0);
        THREE = FHE.asEuint8(3);
        FHE.allowThis(ZERO);
        FHE.allowThis(THREE);
    }

    /// @dev The contract cannot check an encrypted move with `require`,
    ///      so any invalid value (3..255) silently becomes Rock (0).
    ///      A cheater gains nothing by sending a weird number.
    function _sanitize(euint8 move) private returns (euint8) {
        return FHE.select(FHE.lt(move, THREE), move, ZERO);
    }

    /// @notice Player A opens a new game with an encrypted move.
    function createGame(externalEuint8 encryptedMove, bytes memory proof) external returns (uint256 gameId) {
        euint8 move = _sanitize(FHE.asEuint8(encryptedMove, proof));

        gameId = ++gameCount;
        Game storage g = games[gameId];
        g.playerA = msg.sender;
        g.moveA = move;
        g.status = Status.WaitingForOpponent;

        FHE.allowThis(move);   // the contract needs it later to compute the winner
        FHE.allowSender(move); // player A can still decrypt their own move

        emit GameCreated(gameId, msg.sender);
    }

    /// @notice Player B joins an open game with an encrypted move.
    ///         The winner is computed right away, still encrypted.
    function joinGame(uint256 gameId, externalEuint8 encryptedMove, bytes memory proof) external {
        Game storage g = games[gameId];
        require(g.status == Status.WaitingForOpponent, "Game is not open");
        require(msg.sender != g.playerA, "You cannot play against yourself");

        euint8 move = _sanitize(FHE.asEuint8(encryptedMove, proof));
        g.playerB = msg.sender;
        g.moveB = move;
        FHE.allowThis(move);
        FHE.allowSender(move);

        // Outcome = (moveA - moveB) mod 3, computed without branching:
        //   d = moveA + 3 - moveB  -> always between 1 and 5
        //   outcome = d >= 3 ? d - 3 : d
        euint8 d = FHE.sub(FHE.add(g.moveA, THREE), move);
        euint8 result = FHE.select(FHE.gte(d, THREE), FHE.sub(d, THREE), d);

        g.result = result;
        g.status = Status.WaitingForReveal;

        FHE.allowThis(result);
        FHE.allowPublic(result); // only the outcome may be decrypted by anyone

        emit GameJoined(gameId, msg.sender);
    }

    /// @notice Anyone can publish the decrypted outcome together with the
    ///         Threshold Network signature (from the SDK's decryptForTx).
    function revealResult(uint256 gameId, uint8 outcome, bytes memory signature) external {
        Game storage g = games[gameId];
        require(g.status == Status.WaitingForReveal, "Nothing to reveal");
        require(outcome <= 2, "Invalid outcome");
        require(FHE.verifyDecryptResult(g.result, outcome, signature), "Invalid decryption signature");

        g.outcome = outcome;
        g.status = Status.Finished;

        address winner = address(0);
        if (outcome == 1) winner = g.playerA;
        else if (outcome == 2) winner = g.playerB;

        emit GameFinished(gameId, outcome, winner);
    }

    /// @notice Player A can cancel a game nobody has joined yet.
    function cancelGame(uint256 gameId) external {
        Game storage g = games[gameId];
        require(g.status == Status.WaitingForOpponent, "Game cannot be cancelled");
        require(msg.sender == g.playerA, "Only the creator can cancel");

        g.status = Status.Cancelled;
        emit GameCancelled(gameId);
    }
}
