import "dotenv/config";
import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const accounts = PRIVATE_KEY ? [PRIVATE_KEY] : [];

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.24",
        settings: {
          optimizer: { enabled: true, runs: 200 },
          evmVersion: "paris",
        },
      },
    ],
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },
    /** Polkadot Hub TestNet (PVM vía eth-rpc / pallet-revive) */
    paseo: {
      url:
        process.env.PASEO_RPC_URL ||
        "https://services.polkadothub-rpc.com/testnet/",
      chainId: 420420417,
      accounts,
    },
    /** Base Sepolia — testnet L2 con faucet */
    baseSepolia: {
      url: process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org",
      chainId: 84532,
      accounts,
    },
    /** Base mainnet — liquidez / producción L2 */
    base: {
      url: process.env.BASE_RPC_URL || "https://mainnet.base.org",
      chainId: 8453,
      accounts,
    },
    /**
     * Arbitrum Sepolia — EVM Nitro (Solidity nativo).
     * Stylus (Rust/WASM) es otro runtime; estos contratos van por EVM.
     */
    arbitrumSepolia: {
      url:
        process.env.ARB_SEPOLIA_RPC_URL ||
        "https://sepolia-rollup.arbitrum.io/rpc",
      chainId: 421614,
      accounts,
    },
    /** Arbitrum One — EVM Nitro mainnet */
    arbitrum: {
      url: process.env.ARB_RPC_URL || "https://arb1.arbitrum.io/rpc",
      chainId: 42161,
      accounts,
    },
  },
};

export default config;
