import { LogLevel, Peer, PeerOptions } from "peerjs";
import { Channel, CryptoChannel, crypto } from "@vaultys/id";
const { randomBytes } = crypto;

export class PeerjsChannel implements Channel {
  host: string;
  status: "initiator" | "receiver";
  otherstatus: string;
  key: string;
  id: string;
  otherid: string;
  peer: Peer;
  conn: any;
  _onConnected?: () => void;
  _onStarted!: () => void;
  _onError!: (error: string) => void;
  _onData!: (data: crypto.Buffer) => void;
  /** Messages received while no receive() was pending (they used to be dropped). */
  private _queue: crypto.Buffer[] = [];
  private _waiting: ((data: crypto.Buffer) => void)[] = [];
  /** The data connection is open: start() resolves at once. */
  private _started = false;

  constructor(
    key?: string,
    status?: "initiator" | "receiver",
    host = "peerjs.92k.de",
  ) {
    this.host = host;
    if (status) {
      this.status = status;
    } else {
      this.status = key ? "receiver" : "initiator";
    }
    this.otherstatus = this.status == "initiator" ? "receiver" : "initiator";
    this.key = key ?? randomBytes(32).toString("hex");
    this.id = crypto
      .hash("sha256", crypto.Buffer.from(`vaultys-${this.status}-${this.key}`))
      .toString("hex");
    this.otherid = crypto
      .hash(
        "sha256",
        crypto.Buffer.from(`vaultys-${this.otherstatus}-${this.key}`),
      )
      .toString("hex");
    const options: PeerOptions = {
      debug: 2,
      host: this.host,
      secure: true,
      logFunction: (level, ...rest) => {
        console.log(level.toString(), rest);
        if (level.toString() === "Error:") {
          this._onError(rest[0]);
        }
      },
    };
    this.peer = new Peer(this.id, options);
    if (this.status == "initiator") {
      const that = this;
      that.peer.on("connection", (conn) => {
        console.log("PeerJs connection incoming...");
        that._onConnected?.();
        delete that._onConnected;
        that.conn = conn;
        that.conn.on("data", (data: string) => {
          console.log("receiving: ", data);
          that._deliver(crypto.Buffer.from(data, "base64"));
        });
        that.conn.on("close", () => that.peer.destroy());
        // "connection" fires before the data channel is open: a message sent now would be lost.
        // Resolve start() only once the connection is open.
        if (conn.open) that._markStarted();
        else conn.once("open", () => that._markStarted());
      });
    }
    CryptoChannel.encryptChannel(this, crypto.Buffer.from(this.key, "hex"));
  }

  static fromConnectionString(string: string) {
    if (string.startsWith("vaultys://peerjs?")) {
      const url = new URL(string);
      const key = url.searchParams.get("key");
      const host = url.searchParams.get("host");
      if (!key || !host) return null;
      return new PeerjsChannel(key, "receiver", host);
    }
    return null;
  }

  fromConnectionString(string: string) {
    return PeerjsChannel.fromConnectionString(string);
  }

  getConnectionString() {
    return `vaultys://peerjs?key=${this.key}&host=${this.host}`;
  }

  onConnected(callback: () => void) {
    this._onConnected = callback;
  }

  async start() {
    const that = this;
    if (this.status === "receiver") {
      this.conn = this.peer.connect(this.otherid, { reliable: true });
      that.conn.on("open", (id: string) => {
        console.log("opening PeerJS Channel...");
        that._onConnected?.();
        delete that._onConnected;
        that.conn.on("data", (data: string) => {
          console.log("receiving: ", data);
          that._deliver(crypto.Buffer.from(data, "base64"));
        });
        that.conn.on("close", () => that.peer.destroy());
        that._markStarted();
      });
    }
    return new Promise<void>((resolve, reject) => {
      // the initiator's connection may already be open when start() is called
      if (that._started) return resolve();
      that._onStarted = resolve;
      this._onError = reject;
    });
  }

  _markStarted() {
    this._started = true;
    this._onStarted?.();
  }

  /** Hands a message to the oldest pending receive(), or keeps it until the next one. */
  _deliver(data: crypto.Buffer) {
    const waiting = this._waiting.shift();
    if (waiting) waiting(data);
    else this._queue.push(data);
  }

  async send(data: crypto.Buffer) {
    console.log("sending: ", data.toString("base64"));
    this.conn.send(data.toString("base64"));
  }

  async receive(): Promise<crypto.Buffer> {
    const queued = this._queue.shift();
    if (queued) return queued;
    return new Promise((resolve) => this._waiting.push(resolve));
  }

  close() {
    if (this.conn) {
      this.conn.close();
    }
    this.peer.destroy();
    return Promise.resolve();
  }
}
