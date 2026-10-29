// Well-known port knowledge for the network scanner: service names and the
// default action when a port chip is clicked.

const HTTP_PORTS = new Set([
  80, 81, 591, 3000, 5000, 5001, 5601, 8000, 8006, 8008, 8080, 8081, 8090,
  8112, 8888, 8989, 9000, 9090, 9091, 9117, 9200, 32400,
]);
const HTTPS_PORTS = new Set([443, 8443, 9443]);

const SERVICES: Record<number, string> = {
  20: "FTP-data", 21: "FTP", 22: "SSH", 23: "Telnet", 25: "SMTP", 53: "DNS",
  67: "DHCP", 69: "TFTP", 80: "HTTP", 110: "POP3", 111: "RPCbind", 123: "NTP",
  135: "MS-RPC", 139: "NetBIOS", 143: "IMAP", 161: "SNMP", 389: "LDAP",
  443: "HTTPS", 445: "SMB", 465: "SMTPS", 587: "SMTP-sub", 636: "LDAPS",
  873: "rsync", 993: "IMAPS", 995: "POP3S", 1080: "SOCKS", 1194: "OpenVPN",
  1433: "MSSQL", 1521: "Oracle", 2049: "NFS", 2375: "Docker", 2376: "Docker-TLS",
  3000: "HTTP-dev", 3128: "Squid", 3306: "MySQL", 3389: "RDP", 5000: "HTTP-alt",
  5432: "PostgreSQL", 5601: "Kibana", 5900: "VNC", 5985: "WinRM",
  5986: "WinRM-HTTPS", 6379: "Redis", 8006: "Proxmox", 8080: "HTTP-alt",
  8443: "HTTPS-alt", 8888: "HTTP-alt", 9000: "Portainer", 9042: "Cassandra",
  9090: "Cockpit/Prometheus", 9091: "Transmission", 9200: "Elasticsearch",
  11211: "Memcached", 27017: "MongoDB", 32400: "Plex", 51820: "WireGuard",
};

/** Human-readable service name for a port, e.g. 445 → "SMB". */
export const serviceName = (port: number) => SERVICES[port];

/** Protocol scheme if the port is very likely to serve a web UI. */
export const webProto = (port: number): "http" | "https" | null =>
  HTTPS_PORTS.has(port) ? "https" : HTTP_PORTS.has(port) ? "http" : null;
