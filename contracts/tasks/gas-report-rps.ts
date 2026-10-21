import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { getDeployment } from './utils'

// Reads the real transactions of the deployed RockPaperScissors game
// and prints how much gas each kind of action used on the network.
task('gas-report-rps', 'Show real gas usage of RockPaperScissors transactions').setAction(
	async (_, hre: HardhatRuntimeEnvironment) => {
		const { ethers, network } = hre

		const address = getDeployment(network.name, 'RockPaperScissors')
		if (!address) {
			console.error(`No RockPaperScissors deployment found for ${network.name}`)
			return
		}

		const game = await ethers.getContractAt('RockPaperScissors', address)
		const provider = ethers.provider
		const latest = await provider.getBlockNumber()

		// Look back in chunks (Arbitrum makes ~4 blocks per second)
		const CHUNK = 100_000
		const LOOKBACK = 1_500_000
		const start = Math.max(0, latest - LOOKBACK)

		const events = [
			{ label: 'createGame', filter: game.filters.GameCreated() },
			{ label: 'joinGame', filter: game.filters.GameJoined() },
			{ label: 'revealResult', filter: game.filters.GameFinished() },
			{ label: 'cancelGame', filter: game.filters.GameCancelled() },
		]

		console.log(`Contract: ${address} on ${network.name}`)
		console.log(`Scanning blocks ${start} to ${latest}...\n`)

		for (const { label, filter } of events) {
			const hashes = new Set<string>()
			for (let from = start; from <= latest; from += CHUNK) {
				const to = Math.min(from + CHUNK - 1, latest)
				const logs = await game.queryFilter(filter, from, to)
				logs.forEach((l) => hashes.add(l.transactionHash))
			}

			if (hashes.size === 0) {
				console.log(`${label}: no transactions found`)
				continue
			}

			let totalGas = 0n
			let totalFee = 0n
			for (const hash of hashes) {
				const r = await provider.getTransactionReceipt(hash)
				if (!r) continue
				totalGas += r.gasUsed
				totalFee += r.gasUsed * r.gasPrice
			}
			const n = BigInt(hashes.size)
			console.log(
				`${label.padEnd(13)} | ${hashes.size} tx | avg gas ${(totalGas / n).toString().padStart(9)} | avg fee ${ethers.formatEther(totalFee / n)} ETH`,
			)
		}
	},
)
