// test/MerklePool.test.ts
import { expect } from "chai";
import { ethers } from "hardhat";
import { keccak256 } from "ethers";

describe("MerklePool", function() {
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
  // MerkleTree helper class (remains the same as before)
  async function deployContract() {
    const [owner, user1, user2] = await ethers.getSigners();
    
    // Create a sample nullifier
    const nullifierHash = ethers.hexlify(ethers.randomBytes(32));
    
    // Create leaf for the Merkle tree
    const leaf = keccak256(
      ethers.solidityPacked(
        ["bytes32", "address"],
        [nullifierHash, user2.address]
      )
    );
    const leaves = [leaf];
    
    // Create Merkle tree and get root
    const merkleTree = new MerkleTree(leaves);
    const root = merkleTree.getRoot();
    const proof = merkleTree.getProof(0);
    
    // Deploy contract
    const MerklePool = await ethers.getContractFactory("MerklePool");
    const pool = await MerklePool.deploy(root);
    await pool.waitForDeployment();
    
    return {
      pool,
      owner,
      user1,
      user2,
      nullifierHash,
      proof,
      merkleTree,
      leaf
    };
  }

  it("Should allow deposit and withdrawal with valid proof", async function() {
    const {
      pool,
      user1,
      user2,
      nullifierHash,
      proof
    } = await deployContract();
    
    // Deposit
    const depositAmount = ethers.parseEther("1");
    await pool.connect(user1).deposit({ value: depositAmount });
    
    // Verify initial balance
    expect(await ethers.provider.getBalance(await pool.getAddress()))
      .to.equal(depositAmount);
    
    // Get user2's initial balance
    const initialBalance = await ethers.provider.getBalance(user2.address);
    
    // Withdraw
    await pool.connect(user1).withdraw(
      nullifierHash,
      proof,
      user2.address
    );
    
    // Verify final balances
    expect(await ethers.provider.getBalance(await pool.getAddress()))
      .to.equal(0n);
      
    expect(await ethers.provider.getBalance(user2.address))
      .to.equal(initialBalance + depositAmount);
  });

  it("Should reject withdrawal with invalid proof", async function() {
    const {
      pool,
      user1,
      user2,
      nullifierHash
    } = await deployContract();
    
    // Create invalid proof (wrong proof array)
    const invalidProof = [ethers.hexlify(ethers.randomBytes(32))];
    
    // Deposit
    const depositAmount = ethers.parseEther("1");
    await pool.connect(user1).deposit({ value: depositAmount });
    
    // Attempt withdrawal with invalid proof
    await expect(
      pool.connect(user1).withdraw(
        nullifierHash,
        invalidProof,
        user2.address
      )
    ).to.be.revertedWith("Invalid proof");
  });

  it("Should reject withdrawal with empty proof", async function() {
    const {
      pool,
      user1,
      user2,
      nullifierHash
    } = await deployContract();
    
    // Create empty proof array
    const emptyProof: string[] = [];
    
    // Deposit
    const depositAmount = ethers.parseEther("1");
    await pool.connect(user1).deposit({ value: depositAmount });
    
    // Attempt withdrawal with empty proof
    await expect(
      pool.connect(user1).withdraw(
        nullifierHash,
        emptyProof,
        user2.address
      )
    ).to.be.revertedWith("Proof cannot be empty");
  });

  it("Should prevent double spending", async function() {
    const {
      pool,
      user1,
      user2,
      nullifierHash,
      proof
    } = await deployContract();
    
    // Deposit
    const depositAmount = ethers.parseEther("1");
    await pool.connect(user1).deposit({ value: depositAmount });
    
    // First withdrawal should succeed
    await pool.connect(user1).withdraw(
      nullifierHash,
      proof,
      user2.address
    );
    
    // Second withdrawal should fail
    await expect(
      pool.connect(user1).withdraw(
        nullifierHash,
        proof,
        user2.address
      )
    ).to.be.revertedWith("Withdrawal already processed");
  });

  it("Should reject deposits with incorrect amount", async function() {
    const { pool, user1 } = await deployContract();
    
    // Attempt deposit with wrong amount
    const wrongAmount = ethers.parseEther("2");
    await expect(
      pool.connect(user1).deposit({ value: wrongAmount })
    ).to.be.revertedWith("Must deposit exact amount");
  });
});
