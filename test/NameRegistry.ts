import { expect } from "chai";
import { ethers } from "hardhat";

describe("NameRegistry", function () {
  async function deploy() {
    const [gov, alice, bob] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("NameRegistry");
    const names = await Factory.deploy(gov.address, gov.address, 0n);
    return { names, gov, alice, bob };
  }

  it("registers and resolves a label", async function () {
    const { names, alice } = await deploy();
    await names.connect(alice).register("ecolab");
    expect(await names.resolve("ecolab")).to.equal(alice.address);
    expect(await names.primaryLabelOf(alice.address)).to.equal(ethers.id("ecolab"));
  });

  it("rejects taken names and invalid charset", async function () {
    const { names, alice, bob } = await deploy();
    await names.connect(alice).register("ecolab");
    await expect(names.connect(bob).register("ecolab")).to.be.revertedWith(
      "NameRegistry: taken"
    );
    await expect(names.connect(bob).register("EcoLab")).to.be.revertedWith(
      "NameRegistry: charset"
    );
    await expect(names.connect(bob).register("ab")).to.be.revertedWith(
      "NameRegistry: length"
    );
    await expect(names.connect(bob).register("-eco")).to.be.revertedWith(
      "NameRegistry: hyphen"
    );
  });

  it("transfers and releases names", async function () {
    const { names, alice, bob } = await deploy();
    await names.connect(alice).register("andino");
    await names.connect(alice).transfer("andino", bob.address);
    expect(await names.resolve("andino")).to.equal(bob.address);
    await names.connect(bob).release("andino");
    expect(await names.resolve("andino")).to.equal(ethers.ZeroAddress);
  });

  it("charges registration fee to treasury", async function () {
    const [gov, alice] = await ethers.getSigners();
    const fee = ethers.parseEther("0.05");
    const Factory = await ethers.getContractFactory("NameRegistry");
    const names = await Factory.deploy(gov.address, gov.address, fee);
    const before = await ethers.provider.getBalance(gov.address);
    await names.connect(alice).register("peranto", { value: fee });
    const after = await ethers.provider.getBalance(gov.address);
    expect(after - before).to.equal(fee);
  });
});
