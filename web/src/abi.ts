// Address of the RockPaperScissors contract on Arbitrum Sepolia
export const GAME_ADDRESS = '0xf2Ef8AfC552e046e78a784c9b651759dB58bb754' as const;

// Only the parts of the contract the website uses
export const gameAbi = [
  {
    type: 'function',
    name: 'createGame',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'encryptedMove', type: 'bytes32' },
      { name: 'proof', type: 'bytes' },
    ],
    outputs: [{ name: 'gameId', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'joinGame',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'gameId', type: 'uint256' },
      { name: 'encryptedMove', type: 'bytes32' },
      { name: 'proof', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'revealResult',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'gameId', type: 'uint256' },
      { name: 'outcome', type: 'uint8' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'cancelGame',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'gameId', type: 'uint256' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'gameCount',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'games',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [
      { name: 'playerA', type: 'address' },
      { name: 'playerB', type: 'address' },
      { name: 'moveA', type: 'bytes32' },
      { name: 'moveB', type: 'bytes32' },
      { name: 'result', type: 'bytes32' },
      { name: 'status', type: 'uint8' },
      { name: 'outcome', type: 'uint8' },
    ],
  },
  {
    type: 'event',
    name: 'GameCreated',
    inputs: [
      { name: 'gameId', type: 'uint256', indexed: true },
      { name: 'playerA', type: 'address', indexed: true },
    ],
  },
] as const;
