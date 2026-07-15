import { expect } from "chai";
import { ethers } from "hardhat";
import { mine } from "@nomicfoundation/hardhat-network-helpers";

describe("DisCO economy", function () {
  const PERIOD = 10n;

  async function deployStack() {
    const [gov, alice, bob, carol] = await ethers.getSigners();

    const Treasury = await ethers.getContractFactory("ProtocolTreasury");
    const treasury = await Treasury.deploy(gov.address);

    const Factory = await ethers.getContractFactory("DisCOFactory");
    const factory = await Factory.deploy(await treasury.getAddress(), gov.address, PERIOD, 0n);
    await treasury.connect(gov).setFactory(await factory.getAddress());

    await factory.connect(alice).createNode("EcoLab");
    await factory.connect(bob).createNode("Traductores");

    const nodeA = await ethers.getContractAt(
      "DisCONode",
      await factory.allNodes(0)
    );
    const nodeB = await ethers.getContractAt(
      "DisCONode",
      await factory.allNodes(1)
    );

    await nodeA.connect(alice).addMember(carol.address);

    return { gov, alice, bob, carol, treasury, factory, nodeA, nodeB, PERIOD };
  }

  it("registers nodes via factory", async function () {
    const { treasury, nodeA, nodeB } = await deployStack();
    expect(await treasury.isNode(await nodeA.getAddress())).to.equal(true);
    expect(await treasury.isNode(await nodeB.getAddress())).to.equal(true);
    expect(await treasury.nodeCount()).to.equal(2n);
  });

  it("seeds node treasury on createNode (100% to node)", async function () {
    const [gov, alice] = await ethers.getSigners();
    const Treasury = await ethers.getContractFactory("ProtocolTreasury");
    const treasury = await Treasury.deploy(gov.address);
    const Factory = await ethers.getContractFactory("DisCOFactory");
    const factory = await Factory.deploy(await treasury.getAddress(), gov.address, PERIOD, 0n);
    await treasury.connect(gov).setFactory(await factory.getAddress());

    const seed = ethers.parseEther("5");
    await factory.connect(alice).createNode("SeededLab", { value: seed });
    const nodeAddr = await factory.allNodes(0);
    expect(await ethers.provider.getBalance(nodeAddr)).to.equal(seed);
    // protocol treasury unchanged by seed (unlike contribute)
    expect(await ethers.provider.getBalance(await treasury.getAddress())).to.equal(0n);
  });

  it("createNodeWithConfig sets reserveFloor + seed", async function () {
    const [gov, alice] = await ethers.getSigners();
    const Treasury = await ethers.getContractFactory("ProtocolTreasury");
    const treasury = await Treasury.deploy(gov.address);
    const Factory = await ethers.getContractFactory("DisCOFactory");
    const factory = await Factory.deploy(await treasury.getAddress(), gov.address, PERIOD, 0n);
    await treasury.connect(gov).setFactory(await factory.getAddress());

    const seed = ethers.parseEther("2");
    const floor = ethers.parseEther("1");
    await factory.connect(alice).createNodeWithConfig("CfgLab", floor, { value: seed });
    const node = await ethers.getContractAt("DisCONode", await factory.allNodes(0));
    expect(await node.reserveFloor()).to.equal(floor);
    expect(await ethers.provider.getBalance(await node.getAddress())).to.equal(seed);
  });

  it("tips: Care to sender, Love to receiver, value to receiver", async function () {
    const { alice, carol, nodeA } = await deployStack();
    const before = await ethers.provider.getBalance(carol.address);
    const tip = ethers.parseEther("1");
    const tx = await nodeA.connect(alice).tip(carol.address, { value: tip });
    const receipt = await tx.wait();
    const gas = receipt!.gasUsed * receipt!.gasPrice;
    const after = await ethers.provider.getBalance(carol.address);
    expect(after - before).to.equal(tip);
    expect(await nodeA.carePoints(alice.address)).to.equal(1n);
    expect(await nodeA.lovePoints(carol.address)).to.equal(1n);
    void gas;
  });

  it("contribute splits 80/20 to node and protocol", async function () {
    const { alice, nodeA, treasury } = await deployStack();
    const amount = ethers.parseEther("10");
    await nodeA.connect(alice).contribute({ value: amount });
    expect(await ethers.provider.getBalance(await nodeA.getAddress())).to.equal(
      (amount * 8000n) / 10000n
    );
    expect(await ethers.provider.getBalance(await treasury.getAddress())).to.equal(
      (amount * 2000n) / 10000n
    );
  });

  it("harvests with higher sustainBps when isolated and distributes hybrid", async function () {
    const { alice, bob, nodeA, nodeB, treasury, PERIOD } = await deployStack();

    await nodeA.connect(alice).contribute({ value: ethers.parseEther("100") });
    await nodeB.connect(bob).contribute({ value: ethers.parseEther("100") });

    // Node A: tip creates love+care → more integrated; also federation
    await nodeA.connect(alice).tip(alice.address, { value: ethers.parseEther("0.01") });
    // tip to self not allowed unless member - alice is member, tip to alice works (love to alice)
    await nodeA.connect(alice).addFederationLink(await nodeB.getAddress());

    // Node B: only contribute, no love tips and no links → isolated → 5%
    await mine(Number(PERIOD) + 1);

    const periodId = 0n; // first period was 0 when created at block ~0-9
    // After mining, currentPeriod >= 1. Harvest period 0.
    const createdPeriodA = await nodeA.createdPeriod();
    const harvestPeriod = createdPeriodA;

    await nodeA.harvest(harvestPeriod);
    await nodeB.harvest(harvestPeriod);

    const balBeforeA = await ethers.provider.getBalance(await nodeA.getAddress());
    const balBeforeB = await ethers.provider.getBalance(await nodeB.getAddress());
    const protoBefore = await ethers.provider.getBalance(await treasury.getAddress());

    await treasury.distribute(harvestPeriod);

    const balAfterA = await ethers.provider.getBalance(await nodeA.getAddress());
    const balAfterB = await ethers.provider.getBalance(await nodeB.getAddress());
    expect(balAfterA).to.be.gt(balBeforeA);
    expect(balAfterB).to.be.gt(balBeforeB);
    expect(await ethers.provider.getBalance(await treasury.getAddress())).to.be.lt(protoBefore);
  });

  it("rejects distribute twice", async function () {
    const { alice, bob, nodeA, nodeB, treasury, PERIOD } = await deployStack();
    await nodeA.connect(alice).contribute({ value: ethers.parseEther("5") });
    await nodeB.connect(bob).contribute({ value: ethers.parseEther("5") });
    await nodeA.connect(alice).tip(alice.address, { value: 1 });
    await mine(Number(PERIOD) + 1);
    const p = await nodeA.createdPeriod();
    await nodeA.harvest(p);
    await nodeB.harvest(p);
    await treasury.distribute(p);
    await expect(treasury.distribute(p)).to.be.revertedWith("ProtocolTreasury: done");
  });

  it("dissolve empties members, pays residual, unregisters node", async function () {
    const { alice, carol, nodeA, treasury } = await deployStack();
    const seed = ethers.parseEther("3");
    await alice.sendTransaction({ to: await nodeA.getAddress(), value: seed });

    const before = await ethers.provider.getBalance(alice.address);
    const tx = await nodeA.connect(alice).dissolve(alice.address);
    const receipt = await tx.wait();
    const gas = receipt!.gasUsed * receipt!.gasPrice;
    const after = await ethers.provider.getBalance(alice.address);

    expect(await nodeA.dissolved()).to.equal(true);
    expect(await nodeA.memberCount()).to.equal(0n);
    expect(await nodeA.isMember(alice.address)).to.equal(false);
    expect(await nodeA.isMember(carol.address)).to.equal(false);
    expect(await treasury.isNode(await nodeA.getAddress())).to.equal(false);
    expect(await ethers.provider.getBalance(await nodeA.getAddress())).to.equal(0n);
    expect(after + gas - before).to.equal(seed);

    await expect(
      nodeA.connect(alice).tip(alice.address, { value: 1 })
    ).to.be.revertedWith("DisCONode: dissolved");
  });
});
