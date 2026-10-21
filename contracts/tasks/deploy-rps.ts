import { task } from 'hardhat/config'
import { HardhatRuntimeEnvironment } from 'hardhat/types'
import { saveDeployment } from './utils'

// Task to deploy the encrypted Rock-Paper-Scissors game
task('deploy-rps', 'Deploy the RockPaperScissors contract to the selected network').setAction(
	async (_, hre: HardhatRuntimeEnvironment) => {
		const { ethers, network } = hre

		console.log(`Deploying RockPaperScissors to ${network.name}...`)

		const [deployer] = await ethers.getSigners()
		console.log(`Deploying with account: ${deployer.address}`)

		const Game = await ethers.getContractFactory('RockPaperScissors')
		const game = await Game.deploy()
		await game.waitForDeployment()

		const gameAddress = await game.getAddress()
		console.log(`RockPaperScissors deployed to: ${gameAddress}`)

		saveDeployment(network.name, 'RockPaperScissors', gameAddress)

		return gameAddress
	},
)
