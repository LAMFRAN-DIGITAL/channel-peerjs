import { expect } from "chai";
import { buildConnectionString, PeerjsChannel } from "../src/peerjsChannel";
// No network: the channel must refuse to start without an explicit signalling server and explicit ICE servers, and
// must never hand PeerJS a configuration that lets it fall back to its public servers.
const KEY = "b".repeat(64);
const LOCAL = { host: "localhost", port: 9, secure: false, iceServers: [] };
const asOptions = (value) => value;
/** Builds a channel and destroys its Peer at once (the host is local and unreachable anyway). */
function make(key, status, options) {
    const channel = new PeerjsChannel(key, status, options);
    channel.peer.destroy();
    return channel;
}
describe("PeerjsChannel mandatory options (no network)", () => {
    it("refuses to be built without a signalling host", () => {
        expect(() => new PeerjsChannel(undefined, "initiator", asOptions(undefined))).to.throw(/host.*mandatory/);
        expect(() => new PeerjsChannel(undefined, "initiator", asOptions({ iceServers: [] }))).to.throw(/host.*mandatory/);
        expect(() => new PeerjsChannel(undefined, "initiator", asOptions({ host: "", iceServers: [] }))).to.throw(/host.*mandatory/);
        // the former signature (a bare host string) carries no ICE servers
        expect(() => new PeerjsChannel(undefined, "initiator", asOptions("peer.example.org"))).to.throw(/mandatory/);
        expect(() => buildConnectionString(KEY, asOptions({ iceServers: [] }))).to.throw(/host.*mandatory/);
    });
    it("refuses to be built without ICE servers, or with invalid ones", () => {
        expect(() => new PeerjsChannel(undefined, "initiator", asOptions({ host: "localhost" }))).to.throw(/iceServers.*mandatory/);
        expect(() => new PeerjsChannel(KEY, "receiver", asOptions({ host: "localhost", iceServers: "stun:a" }))).to.throw(/iceServers.*mandatory/);
        expect(() => new PeerjsChannel(KEY, "receiver", asOptions({ host: "localhost", iceServers: [{ urls: "https://evil.example" }] }))).to.throw(/iceServers/);
        expect(() => buildConnectionString(KEY, asOptions({ host: "localhost" }))).to.throw(/iceServers.*mandatory/);
    });
    it("always passes `config.iceServers` to PeerJS, so that its public STUN/TURN servers are never used", () => {
        const ice = [{ urls: "turns:turn.example.org:5349", username: "u", credential: "p" }];
        const withIce = make(undefined, "initiator", { ...LOCAL, iceServers: ice });
        const config = withIce.peer.options;
        expect(config.host).to.equal("localhost");
        expect(config.config).to.deep.equal({ iceServers: ice });
        const none = make(undefined, "initiator", LOCAL);
        expect(none.peer.options.config).to.deep.equal({ iceServers: [] });
        expect(JSON.stringify(none.peer.options)).not.to.match(/google|peerjs\.com|92k\.de/);
    });
    it("passes the API key to PeerJS: `peerjs` by default, the given one otherwise", () => {
        const peerOptions = (channel) => channel.peer.options;
        expect(peerOptions(make(undefined, "initiator", LOCAL)).key).to.equal("peerjs");
        expect(peerOptions(make(undefined, "initiator", { ...LOCAL, apiKey: "sas-relay_1.0~x" })).key).to.equal("sas-relay_1.0~x");
        expect(peerOptions(make(KEY, "receiver", { ...LOCAL, apiKey: "peerjs" })).key).to.equal("peerjs");
    });
    it("refuses an API key that PeerJS would write into the signalling URL unencoded", () => {
        for (const apiKey of ["", "a&id=other", "a b", "a/b", "a?b", "é", "x".repeat(65), ".", "..", "-x", "~x", 42, null]) {
            expect(() => new PeerjsChannel(undefined, "initiator", asOptions({ ...LOCAL, apiKey })), String(apiKey)).to.throw(/apiKey/);
            expect(() => buildConnectionString(KEY, asOptions({ ...LOCAL, apiKey })), String(apiKey)).to.throw(/apiKey/);
        }
    });
    it("fromConnectionString: refuses a host outside the allowed list, accepts one inside", () => {
        const text = buildConnectionString(KEY, { host: "localhost", port: 9, secure: false, iceServers: [] });
        expect(PeerjsChannel.fromConnectionString(text, { allowedHosts: ["peer.example.org"] })).to.equal(null);
        expect(PeerjsChannel.fromConnectionString(text, { allowedHosts: [] })).to.equal(null);
        expect(PeerjsChannel.fromConnectionString(text, undefined)).to.equal(null);
        const channel = PeerjsChannel.fromConnectionString(text, { allowedHosts: ["localhost"] });
        expect(channel).to.be.instanceOf(PeerjsChannel);
        channel.peer.destroy();
        expect(channel.status).to.equal("receiver");
        expect(channel.key).to.equal(KEY);
        expect(channel.host).to.equal("localhost");
        expect(channel.options.iceServers).to.deep.equal([]);
    });
    it("getConnectionString round-trips through an allowed receiver", () => {
        const initiator = make(undefined, "initiator", LOCAL);
        const receiver = PeerjsChannel.fromConnectionString(initiator.getConnectionString(), { allowedHosts: ["localhost"] });
        receiver.peer.destroy();
        expect(receiver.key).to.equal(initiator.key);
        expect(receiver.options).to.deep.equal({ host: "localhost", port: 9, secure: false, iceServers: [] });
    });
    it("getConnectionString carries a non-default API key to the receiver", () => {
        const initiator = make(undefined, "initiator", { ...LOCAL, apiKey: "sas-relay" });
        const receiver = PeerjsChannel.fromConnectionString(initiator.getConnectionString(), { allowedHosts: ["localhost"] });
        receiver.peer.destroy();
        expect(receiver.options.apiKey).to.equal("sas-relay");
        expect(receiver.peer.options.key).to.equal("sas-relay");
    });
});
