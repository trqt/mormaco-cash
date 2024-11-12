import { ethers } from "hardhat";
import { MerkleTree } from "merkletreejs";
import keccak256 from "keccak256";

async function main() {
  const MockERC20 = await ethers.getContractFactory("MockERC20");
  const token = await MockERC20.deploy("JoCoin", "JO");

  await token.waitForDeployment();

  console.log("MockERC20 deployed to:", token.target);

  const addresses = [
    "0xcafebabe2",
    "0xcafebabe3",
    "0xcafebabe4",
    "0xcafebabe5",
  ];
  
  const leaves = addresses.map((addr) => keccak256(addr));
  const merkleTree = new MerkleTree(leaves, keccak256, { sortPairs: true });
  const root = merkleTree.getHexRoot();

  const EnhancedMerklePool = await ethers.getContractFactory("EnhancedMerklePool");
  const enhancedMerklePool = await EnhancedMerklePool.deploy(root, token.target);
  console.log("EnhancedMerklePool deployed to:", enhancedMerklePool.target);

  console.log("Merkle Root:", root);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

