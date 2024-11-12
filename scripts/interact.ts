// scripts/interact.ts
import { ethers } from "hardhat";
import { keccak256 } from "ethers";

async function main() {
  // Setup accounts
  const [deployer, depositor, recipient] = await ethers.getSigners();
  console.log("Deployer address:", await deployer.getAddress());
  console.log("Depositor address:", await depositor.getAddress());
  console.log("Recipient address:", await recipient.getAddress());

  // Create nullifier and Merkle tree (same as in test)
  const nullifierHash = ethers.hexlify(ethers.randomBytes(32));
  console.log("\nGenerated nullifier hash:", nullifierHash);

  // Create leaf for the Merkle tree
  const leaf = keccak256(
    ethers.solidityPacked(
      ["bytes32", "address"],
      [nullifierHash, recipient.address]
    )
  );
  const leaves = [leaf];

  // Simple Merkle tree implementation
    class MerkleTree {
  leaves: string[];
  layers: string[][];

  constructor(leaves: string[]) {
    // Ensure even number of leaves by duplicating last one if necessary
    this.leaves = leaves;
    if (leaves.length % 2 === 1) {
      this.leaves.push(leaves[leaves.length - 1]);
    }
    this.layers = this.buildLayers(this.leaves);
  }

  private buildLayers(leaves: string[]): string[][] {
    const layers: string[][] = [leaves];
    
    // Build tree layer by layer
    while (layers[layers.length - 1].length > 1) {
      const currentLayer = layers[layers.length - 1];
      const newLayer: string[] = [];
      
      // Process pairs in current layer
      for (let i = 0; i < currentLayer.length; i += 2) {
        const left = currentLayer[i];
        const right = currentLayer[i + 1];
        const node = keccak256(
          ethers.solidityPacked(
            ["bytes32", "bytes32"],
            [left, right]
          )
        );
        newLayer.push(node);
      }
      
      layers.push(newLayer);
    }
    
    return layers;
  }

  getRoot(): string {
    return this.layers[this.layers.length - 1][0];
  }

  getProof(index: number): string[] {
    const proof: string[] = [];
    let currentIndex = index;
    
    // Start from bottom layer (leaves) and work up
    for (let i = 0; i < this.layers.length - 1; i++) {
      const currentLayer = this.layers[i];
      const pairIndex = currentIndex % 2 === 0 ? currentIndex + 1 : currentIndex - 1;
      
      if (pairIndex < currentLayer.length) {
        proof.push(currentLayer[pairIndex]);
      }
      
      // Move to next layer
      currentIndex = Math.floor(currentIndex / 2);
    }
    
    return proof;
  }
}
 
  // Create Merkle tree
  const merkleTree = new MerkleTree(leaves);
  const root = merkleTree.getRoot();
  const proof = merkleTree.getProof(0);
  
  console.log("\nMerkle Root:", root);
  console.log("Merkle Proof:", proof);

  // Deploy contract
  console.log("\nDeploying MerklePool contract...");
  const MerklePool = await ethers.getContractFactory("MerklePool");
  const pool = await MerklePool.deploy(root);
  await pool.waitForDeployment();
  console.log("MerklePool deployed to:", await pool.getAddress());

  // Make deposit
  console.log("\nMaking deposit...");
  const depositAmount = ethers.parseEther("1");
  const depositTx = await pool.connect(depositor).deposit({ value: depositAmount });
  await depositTx.wait();
  console.log("Deposit successful!");

  // Check contract balance
  const contractBalance = await ethers.provider.getBalance(await pool.getAddress());
  console.log("\nContract balance:", ethers.formatEther(contractBalance), "ETH");

  // Get recipient's initial balance
  const initialBalance = await ethers.provider.getBalance(recipient.address);
  console.log("Recipient initial balance:", ethers.formatEther(initialBalance), "ETH");

  // Make withdrawal
  console.log("\nMaking withdrawal...");
  const withdrawTx = await pool.connect(depositor).withdraw(
    nullifierHash,
    proof,
    recipient.address
  );
  await withdrawTx.wait();
  console.log("Withdrawal successful!");

  // Check final balances
  const finalContractBalance = await ethers.provider.getBalance(await pool.getAddress());
  const finalRecipientBalance = await ethers.provider.getBalance(recipient.address);
  
  console.log("\nFinal contract balance:", ethers.formatEther(finalContractBalance), "ETH");
  console.log("Final recipient balance:", ethers.formatEther(finalRecipientBalance), "ETH");
  console.log("Recipient received:", 
    ethers.formatEther(finalRecipientBalance - initialBalance), "ETH");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
