import { expect } from "chai";
import { IdManager, MemoryStorage, VaultysId } from "@vaultys/id";
import { PeerjsChannel, PeerjsChannelOptions } from "../src/peerjsChannel";

// BROWSER ONLY, with a real signalling server: this test needs WebRTC (absent from Node; the former optional `wrtc`
// package is gone and PeerJS never used it anyway) and a network. There is no default public server any more: the
// page that runs it must define `globalThis.PEERJS_TEST_OPTIONS = { host, iceServers, … }` (a server of the SAS),
// otherwise the test is skipped. Not matched by `test/*.test.ts`, so `test:node` does not run it.
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const testOptions = (globalThis as { PEERJS_TEST_OPTIONS?: PeerjsChannelOptions }).PEERJS_TEST_OPTIONS;

describe("PeerjsChannel tests (browser, network)", () => {
  it("Start and stop", async function () {
    if (!testOptions || typeof RTCPeerConnection === "undefined") return this.skip();
    const channel1 = new PeerjsChannel(undefined, "initiator", testOptions);
    const channel2 = new PeerjsChannel(channel1.key, "receiver", testOptions);

    const s1 = MemoryStorage(() => {});
    const s2 = MemoryStorage(() => {});
    const manager1 = new IdManager(await VaultysId.generatePerson(), s1);
    const manager2 = new IdManager(await VaultysId.generateMachine(), s2);

    await Promise.all([channel1.start(), channel2.start()]);

    await delay(2000);

    const [contact1, contact2] = await Promise.all([
      manager1.acceptContact(channel1),
      manager2.askContact(channel2),
    ]);

    expect(contact1.did).to.equal(manager2.vaultysId.did);
    expect(contact2.did).to.equal(manager1.vaultysId.did);

    expect(s1.list().length).to.equal(2);
    expect(s2.list().length).to.equal(2);

    expect(manager2.contacts.length).to.equal(1);
    expect(manager2.getContact(manager1.vaultysId.did)?.fingerprint).to.equal(
      manager1.vaultysId.fingerprint,
    );

    manager1.setContactMetadata(manager2.vaultysId.did, "name", "salut");
    manager1.setContactMetadata(manager2.vaultysId.did, "group", "pro");

    expect(
      manager1.getContactMetadata(manager2.vaultysId.did, "name"),
    ).to.equal("salut");
    expect(
      manager1.getContactMetadata(manager2.vaultysId.did, "group"),
    ).to.equal("pro");

    expect(await manager1.verifyRelationshipCertificate(manager2.vaultysId.did))
      .to.be.true;
    expect(await manager2.verifyRelationshipCertificate(manager1.vaultysId.did))
      .to.be.true;

    channel1.close();
    channel2.close();
  }).timeout(5000);
});
