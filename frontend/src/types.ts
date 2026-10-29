export interface MacroCommand {
  id: string;
  type: "command" | "delay";
  value: string; // command string or delay in ms
}

export interface Macro {
  id: string;
  name: string;
  description?: string;
  shortcut?: string; // e.g. "F2", "F5", "Ctrl+M"
  commands: MacroCommand[];
  createdAt: number;
}

export type SessionType = "SSH" | "Telnet" | "RDP" | "VNC" | "FTP" | "SFTP" | "Shell" | "Browser" | "Mosh";

export interface SSHTunnel {
  id: string;
  localPort: number;
  remoteHost: string;
  remotePort: number;
  type: "local" | "remote" | "dynamic";
}

export interface SSHKey {
  id: string;
  name: string;
  content: string; // The private key PEM content ("enc:v1:..." when the vault is enabled)
  type: "RSA" | "ED25519" | "ECDSA";
  createdAt: number;
}

export interface SessionGroup {
  id: string;
  name: string;
  color?: string;
  defaults?: Partial<Pick<Session, "user" | "port" | "authType" | "privateKeyId" | "jumpChain" | "startupMacroId" | "logging">>;
}

export interface Session {
  id: string;
  name: string;
  type: SessionType;
  host?: string;
  port?: number;
  user?: string;
  password?: string; // plaintext, or "enc:v1:<b64>" when the vault is enabled
  color?: string;
  authType?: "password" | "key";
  privateKeyPath?: string;
  privateKeyId?: string; // Reference to SSHKey.id
  tunnels?: SSHTunnel[];
  groupId?: string; // Reference to SessionGroup.id — inherits group defaults
  jumpChain?: string[]; // Session ids used as SSH jump hosts, in order
  startupMacroId?: string; // Macro.id executed after connect
  startupDelayMs?: number;
  env?: Record<string, string>; // exported as env vars before the startup macro
  logging?: "off" | "clean" | "raw"; // session log format ("off" disables)
}

export interface Tab {
  id: string;
  title: string;
  type: "dashboard" | "terminal" | "browser" | "settings" | "sftp" | "calculator" | "editor" | "network-scan" | "file-manager" | "system-info";
  sessionId?: string;
  content?: string;
  status?: "connecting" | "connected" | "idle" | "disconnected";
}
