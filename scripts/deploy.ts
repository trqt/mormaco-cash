import { ethers } from "hardhat";

async function main() {
  // For demonstration, using a dummy root
  const dummyRoot = ethers.ZeroHash;
  
  const MerklePool = await ethers.getContractFactory("MerklePool");
  const pool = await MerklePool.deploy(dummyRoot);
  await pool.waitForDeployment();
  
  console.log("MerklePool deployed to:", pool.target);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
