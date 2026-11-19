import { LogLevel, Peer, PeerOptions } from "peerjs";
import { Channel, CryptoChannel, crypto } from "@vaultys/id";
const { randomBytes } = crypto;

/** Signalling server used when nothing else is given (unchanged default, for backward compatibility). */
export const DEFAULT_HOST = "peerjs.92k.de";

/** ICE server accepted in a connection string: STUN/TURN only, with optional TURN credentials. */
export interface IceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

/**
 * Where the channel connects. Everything here is also carried by the connection string, so that the party who scans
 * the QR code (the receiver) uses the SAME signalling server and the SAME ICE servers as the party who created it
 * (the initiator), instead of PeerJS defaults.
 */
export interface PeerjsChannelOptions {
  /** PeerJS signalling server host (default `peerjs.92k.de`). */
  host?: string;
  /** Port of the signalling server (default: 443 when `secure`). */
  port?: number;
  /** Path of the PeerJS server (default `/`). */
  path?: string;
  /** Use TLS for signalling (default true). */
  secure?: boolean;
  /**
   * ICE servers given to WebRTC. Absent: PeerJS defaults (public STUN/TURN servers). `[]`: no STUN/TURN at all (host
   * candidates only: same network, or a peer with a public address).
   */
  iceServers?: IceServer[];
  /** PeerJS log level (0 none … 3 all, default 0). Message contents are never logged. */
  debug?: 0 | 1 | 2 | 3;
}

/** Fields of a parsed `vaultys://peerjs?…` connection string. */
export interface PeerjsConnection {
  key: string;
  options: Required<Pick<PeerjsChannelOptions, "host" | "secure">> & Omit<PeerjsChannelOptions, "host" | "secure" | "debug">;
}

const MAX_ICE_SERVERS = 4;
const MAX_ICE_LENGTH = 2048;
const ICE_SCHEME = /^(stun|stuns|turn|turns):[^\s]{1,253}$/;
const HOST = /^[A-Za-z0-9.-]{1,253}$/;
const PATH = /^\/[A-Za-z0-9._~\/-]{0,200}$/;
const KEY = /^[0-9a-f]{64}$/;

const b64url = (text: string) => crypto.Buffer.from(text, "utf-8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (text: string) => crypto.Buffer.from(text.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");

/** Strictly validates ICE servers coming from a connection string (a QR code is untrusted input). */
export function validIceServers(value: unknown): IceServer[] | null {
  if (!Array.isArray(value) || value.length > MAX_ICE_SERVERS) return null;
  const out: IceServer[] = [];
  for (const server of value) {
    if (!server || typeof server !== "object") return null;
    const { urls, username, credential, ...rest } = server as Record<string, unknown>;
    if (Object.keys(rest).length) return null;
    const list = typeof urls === "string" ? [urls] : urls;
    if (!Array.isArray(list) || !list.length || list.length > MAX_ICE_SERVERS || !list.every((u) => typeof u === "string" && ICE_SCHEME.test(u))) return null;
    if (username !== undefined && (typeof username !== "string" || username.length > 256)) return null;
    if (credential !== undefined && (typeof credential !== "string" || credential.length > 256)) return null;
    out.push({ urls: urls as string | string[], ...(username !== undefined ? { username } : {}), ...(credential !== undefined ? { credential } : {}) });
  }
  return out;
}

/**
 * Builds `vaultys://peerjs?key=…&host=…[&port=…][&path=…][&secure=0][&ice=…]`. `ice` is the base64url of the JSON
 * array of ICE servers. Older receivers ignore the new parameters and keep their previous behaviour.
 */
export function buildConnectionString(key: string, options: PeerjsChannelOptions = {}): string {
  const params = new URLSearchParams({ key, host: options.host ?? DEFAULT_HOST });
  if (options.port !== undefined) params.set("port", String(options.port));
  if (options.path !== undefined && options.path !== "/") params.set("path", options.path);
  if (options.secure === false) params.set("secure", "0");
  if (options.iceServers !== undefined) params.set("ice", b64url(JSON.stringify(options.iceServers)));
  return `vaultys://peerjs?${params.toString()}`;
}

/** Parses a connection string ; `null` if it is not a PeerJS one or if any parameter is invalid (never a silent fallback). */
export function parseConnectionString(string: string): PeerjsConnection | null {
  if (!string.startsWith("vaultys://peerjs?")) return null;
  let url: URL;
  try {
    url = new URL(string);
  } catch {
    return null;
  }
  const p = url.searchParams;
  const key = p.get("key");
  const host = p.get("host");
  if (!key || !KEY.test(key) || !host || !HOST.test(host)) return null;
  const options: PeerjsConnection["options"] = { host, secure: p.get("secure") !== "0" };
  const port = p.get("port");
  if (port !== null) {
    const n = Number(port);
    if (!Number.isInteger(n) || n < 1 || n > 65535) return null;
    options.port = n;
  }
  const path = p.get("path");
  if (path !== null) {
    if (!PATH.test(path)) return null;
    options.path = path;
  }
  const ice = p.get("ice");
  if (ice !== null) {
    if (ice.length > MAX_ICE_LENGTH) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(fromB64url(ice));
    } catch {
      return null;
    }
    const servers = validIceServers(parsed);
    if (!servers) return null;
    options.iceServers = servers;
  }
  return { key, options };
}

export class PeerjsChannel implements Channel {
  host: string;
  options: PeerjsChannelOptions;
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

  /**
   * @param key shared secret (hex, 32 bytes) ; absent: a new one (initiator).
   * @param status initiator or receiver (default: receiver when a key is given).
   * @param hostOrOptions signalling host (former signature), or the full options.
   */
  constructor(key?: string, status?: "initiator" | "receiver", hostOrOptions: string | PeerjsChannelOptions = DEFAULT_HOST) {
    this.options = typeof hostOrOptions === "string" ? { host: hostOrOptions } : { ...hostOrOptions };
    this.host = this.options.host ?? DEFAULT_HOST;
    if (status) {
      this.status = status;
    } else {
      this.status = key ? "receiver" : "initiator";
    }
    this.otherstatus = this.status == "initiator" ? "receiver" : "initiator";
    this.key = key ?? randomBytes(32).toString("hex");
    this.id = crypto.hash("sha256", crypto.Buffer.from(`vaultys-${this.status}-${this.key}`)).toString("hex");
    this.otherid = crypto.hash("sha256", crypto.Buffer.from(`vaultys-${this.otherstatus}-${this.key}`)).toString("hex");
    const options: PeerOptions = {
      debug: this.options.debug ?? 0,
      host: this.host,
      secure: this.options.secure ?? true,
      ...(this.options.port !== undefined ? { port: this.options.port } : {}),
      ...(this.options.path !== undefined ? { path: this.options.path } : {}),
      // Without `config`, PeerJS uses its own public STUN/TURN servers ; with it, ONLY the given ones.
      ...(this.options.iceServers !== undefined ? { config: { iceServers: this.options.iceServers } } : {}),
      logFunction: (level: LogLevel | string, ...rest: unknown[]) => {
        if (level.toString() === "Error:") {
          this._onError?.(String(rest[0]));
        }
      },
    };
    this.peer = new Peer(this.id, options);
    if (this.status == "initiator") {
      const that = this;
      that.peer.on("connection", (conn) => {
        that._onConnected?.();
        delete that._onConnected;
        that.conn = conn;
        that.conn.on("data", (data: string) => {
          that._onData(crypto.Buffer.from(data, "base64"));
        });
        that.conn.on("close", () => that.peer.destroy());
        that._onStarted();
      });
    }
    CryptoChannel.encryptChannel(this, crypto.Buffer.from(this.key, "hex"));
  }

  static fromConnectionString(string: string, options: Pick<PeerjsChannelOptions, "debug"> = {}) {
    const parsed = parseConnectionString(string);
    if (!parsed) return null;
    return new PeerjsChannel(parsed.key, "receiver", { ...parsed.options, ...options });
  }

  fromConnectionString(string: string, options?: Pick<PeerjsChannelOptions, "debug">) {
    return PeerjsChannel.fromConnectionString(string, options);
  }

  getConnectionString() {
    return buildConnectionString(this.key, { ...this.options, host: this.host });
  }

  onConnected(callback: () => void) {
    this._onConnected = callback;
  }

  async start() {
    const that = this;
    if (this.status === "receiver") {
      const connect = () => {
        that.conn = that.peer.connect(that.otherid, { reliable: true });
        that.conn.on("open", () => {
          that._onConnected?.();
          delete that._onConnected;
          that.conn.on("data", (data: string) => {
            that._onData(crypto.Buffer.from(data, "base64"));
          });
          that.conn.on("close", () => that.peer.destroy());
          that._onStarted();
        });
      };
      // Dial only once our own peer is registered with the signalling server: an offer sent before
      // that can be dropped, leaving start() pending forever.
      if (this.peer.open) connect();
      else this.peer.once("open", connect);
    }
    return new Promise<void>((resolve, reject) => {
      that._onStarted = resolve;
      this._onError = reject;
    });
  }

  async send(data: crypto.Buffer) {
    this.conn.send(data.toString("base64"));
  }

  async receive(): Promise<crypto.Buffer> {
    const that = this;
    return new Promise((resolve) => (that._onData = resolve));
  }

  close() {
    if (this.conn) {
      this.conn.close();
    }
    this.peer.destroy();
    return Promise.resolve();
  }
}
