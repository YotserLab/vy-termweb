package main

import (
	"fmt"
	"net"
	"os"
	"os/exec"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	siosocket "github.com/zishang520/socket.io/v2/socket"
)

var scanPorts = []int{22, 80, 443, 445, 139, 3389, 8080, 21, 23, 53, 111, 5900, 3000}
var deepScanPorts = []int{
	21, 22, 23, 25, 53, 80, 110, 111, 135, 139, 143, 443, 445, 465, 587, 993, 995,
	1433, 1521, 1723, 2049, 2375, 3000, 3128, 3306, 3389, 5000, 5060, 5432, 5900,
	5985, 6379, 8000, 8008, 8080, 8081, 8443, 8888, 9000, 9090, 9100, 11211, 27017,
}

// Compact OUI table (same prefixes as the Node implementation).
var ouiVendors = map[string]string{
	"00:50:56": "VMware", "00:0C:29": "VMware", "00:1C:14": "VMware", "00:05:69": "VMware",
	"00:15:5D": "Microsoft Hyper-V", "00:03:FF": "Microsoft Hyper-V",
	"52:54:00": "QEMU/KVM", "02:42:AC": "Docker", "BC:24:11": "Proxmox VE",
	"00:16:3E": "Xensource", "08:00:27": "VirtualBox", "0A:00:27": "VirtualBox",
	"B8:27:EB": "Raspberry Pi", "DC:A6:32": "Raspberry Pi", "E4:5F:01": "Raspberry Pi",
	"28:CD:C1": "Raspberry Pi", "D8:3A:DD": "Raspberry Pi", "2C:CF:67": "Raspberry Pi",
	"F4:03:2A": "Amazon", "FC:A6:67": "Amazon", "44:65:0D": "Amazon", "50:DC:E7": "Amazon",
	"74:75:48": "Amazon", "AC:63:BE": "Amazon", "34:D2:70": "Amazon",
	"3C:5A:B4": "Google", "F4:F5:D8": "Google", "54:60:09": "Google", "94:EB:2C": "Google",
	"A4:77:33": "Google", "DA:A1:19": "Google", "48:D6:D5": "Google",
	"F0:9F:C2": "Ubiquiti", "78:8A:20": "Ubiquiti", "24:5A:4C": "Ubiquiti", "18:E8:29": "Ubiquiti",
	"04:D9:F5": "ASUS", "AC:22:0B": "ASUS", "50:46:5D": "ASUS", "2C:56:DC": "ASUS",
	"00:0C:6E": "Hewlett-Packard", "3C:D9:2B": "Hewlett-Packard", "A0:1D:48": "Hewlett-Packard",
	"9C:B6:54": "Hewlett-Packard", "30:E1:71": "Hewlett-Packard",
	"00:11:32": "Synology", "00:11:33": "Synology",
	"00:04:4B": "Nvidia", "48:B0:2D": "Nvidia",
	"18:C0:86": "MikroTik", "48:8F:5A": "MikroTik", "74:4D:28": "MikroTik", "D4:CA:6D": "MikroTik",
	"64:D1:54": "MikroTik", "2C:C8:1B": "MikroTik",
	"50:C7:BF": "TP-Link", "14:EB:B6": "TP-Link", "30:DE:4B": "TP-Link", "98:DA:C4": "TP-Link",
	"C0:4A:00": "TP-Link", "5C:E9:31": "TP-Link", "E4:8D:8C": "TP-Link", "0C:80:63": "TP-Link",
	"1C:3B:F3": "Netgear", "20:E5:2A": "Netgear", "28:80:88": "Netgear", "84:1B:5E": "Netgear",
	"A0:63:91": "Netgear", "C0:FF:D4": "Netgear",
	"00:1A:2B": "Cisco", "00:1B:0D": "Cisco", "00:21:1B": "Cisco", "58:97:BD": "Cisco",
	"00:24:97": "Cisco", "00:26:99": "Cisco",
	"18:FE:34": "Espressif", "24:0A:C4": "Espressif", "24:6F:28": "Espressif", "30:AE:A4": "Espressif",
	"3C:71:BF": "Espressif", "5C:CF:7F": "Espressif", "84:F3:EB": "Espressif", "A4:CF:12": "Espressif",
	"B4:E6:2D": "Espressif", "C4:4F:33": "Espressif", "CC:50:E3": "Espressif", "D8:A0:1D": "Espressif",
	"E0:98:06": "Espressif", "EC:FA:BC": "Espressif", "84:CC:A8": "Espressif",
	"00:17:88": "Philips Hue", "EC:B5:FA": "Philips Hue",
	"D0:52:A8": "Tuya/Physical", "10:5A:17": "Tuya/Physical", "50:02:91": "Tuya/Physical",
	"7C:F6:66": "Tuya/Physical", "84:E3:42": "Tuya/Physical", "A4:E5:7C": "Tuya/Physical",
	"B0:4E:26": "TP-Link Kasa", "98:DA:C4:F0": "TP-Link Kasa",
	"18:B4:30": "Nest/Google", "64:16:66": "Nest/Google",
	"00:24:E4": "Withings", "70:EE:50": "Netatmo",
	"00:0D:4B": "Sonos", "5C:AA:FD": "Sonos", "94:9F:3E": "Sonos", "B8:E9:37": "Sonos",
	"00:04:20": "Slim Devices/Logitech", "74:DA:38": "Edimax",
	"6C:AD:F8": "Wyze", "2C:AA:8E": "Wyze", "D0:3F:27": "Wyze",
	"28:6C:07": "Xiaomi", "34:CE:00": "Xiaomi", "4C:49:E3": "Xiaomi", "50:EC:50": "Xiaomi",
	"58:B6:23": "Xiaomi", "64:09:80": "Xiaomi", "64:CC:2E": "Xiaomi", "78:11:DC": "Xiaomi",
	"7C:49:EB": "Xiaomi", "8C:BE:BE": "Xiaomi", "98:FA:E3": "Xiaomi", "9C:99:A0": "Xiaomi",
	"AC:C1:EE": "Xiaomi", "B0:E2:35": "Xiaomi", "F0:B4:29": "Xiaomi", "F8:A4:5F": "Xiaomi",
	"00:12:FB": "Samsung", "00:15:B9": "Samsung", "00:16:32": "Samsung", "00:1C:43": "Samsung",
	"00:1E:E1": "Samsung", "00:21:19": "Samsung", "00:23:39": "Samsung", "00:25:66": "Samsung",
	"08:FC:88": "Samsung", "10:1D:C0": "Samsung", "14:F4:2A": "Samsung", "30:CD:A7": "Samsung",
	"38:01:95": "Samsung", "44:4E:6D": "Samsung", "50:32:37": "Samsung", "54:92:BE": "Samsung",
	"5C:0A:5B": "Samsung", "60:D0:A9": "Samsung", "64:B3:10": "Samsung", "70:F9:27": "Samsung",
	"78:25:AD": "Samsung", "84:25:DB": "Samsung", "8C:77:12": "Samsung", "94:63:D1": "Samsung",
	"A8:7C:01": "Samsung", "B4:79:A7": "Samsung", "BC:44:86": "Samsung", "C0:BD:D1": "Samsung",
	"C8:BA:94": "Samsung", "D0:22:BE": "Samsung", "E4:40:E2": "Samsung", "F0:25:B7": "Samsung",
	"F8:04:2E": "Samsung", "FC:03:9F": "Samsung",
	"78:4F:43": "Apple", "8C:85:90": "Apple", "A4:5E:60": "Apple", "AC:BC:32": "Apple",
	"B0:34:95": "Apple", "B8:78:2E": "Apple", "C8:69:CD": "Apple", "D0:03:4B": "Apple",
	"F0:18:98": "Apple", "F4:F1:5A": "Apple", "00:3E:E1": "Apple", "3C:22:FB": "Apple",
	"40:A6:D9": "Apple", "68:D9:3C": "Apple", "70:81:EB": "Apple", "78:7E:61": "Apple",
	"88:63:DF": "Apple", "90:72:40": "Apple", "98:01:A7": "Apple", "A0:99:9B": "Apple",
	"B0:CA:68": "Apple", "BC:52:B7": "Apple", "C4:B3:01": "Apple", "D8:BB:2C": "Apple",
	"DC:A9:04": "Apple", "E0:B5:2D": "Apple", "E8:80:2E": "Apple", "F0:D1:A9": "Apple",
	"FC:FC:48": "Apple",
	"04:7B:CB": "LG Electronics", "10:68:3F": "LG Electronics", "20:3D:BD": "LG Electronics",
	"34:4D:F7": "LG Electronics", "40:5F:BE": "LG Electronics", "58:A2:B5": "LG Electronics",
	"64:99:5D": "LG Electronics", "74:A5:28": "LG Electronics", "7C:1C:68": "LG Electronics",
	"8C:3A:E3": "LG Electronics", "98:E8:FA": "LG Electronics", "A8:23:FE": "LG Electronics",
	"B4:E6:2A": "LG Electronics", "C4:36:6C": "LG Electronics", "D0:13:FD": "LG Electronics",
	"E8:5B:5B": "LG Electronics", "F8:A9:D0": "LG Electronics",
	"00:1B:63": "Sony", "00:1D:BA": "Sony", "00:24:BE": "Sony", "30:17:C8": "Sony",
	"54:42:49": "Sony", "70:9E:29": "Sony", "78:C8:81": "Sony", "AC:9B:0A": "Sony",
	"B4:1F:19": "Sony", "D8:D4:3C": "Sony", "FC:F1:52": "Sony",
	"00:04:1F": "Sony Interactive (PlayStation)", "78:C8:81:00": "Sony Interactive",
	"00:D9:D1": "Sony Interactive (PlayStation)",
	"28:CF:DA": "Huawei", "34:6B:D3": "Huawei", "4C:8B:EF": "Huawei", "54:A5:1B": "Huawei",
	"64:16:F0": "Huawei", "70:72:0D": "Huawei", "84:AD:58": "Huawei", "8C:34:FD": "Huawei",
	"94:04:9C": "Huawei", "A0:C5:89": "Huawei", "C8:0E:14": "Huawei", "D4:6A:A8": "Huawei",
	"E8:CD:2D": "Huawei", "F4:C7:14": "Huawei", "FC:48:EF": "Huawei",
	"00:15:5D:00": "Microsoft", "28:18:78": "Microsoft", "30:59:B7": "Microsoft",
	"50:1A:C5": "Microsoft", "60:45:BD": "Microsoft", "7C:1E:52": "Microsoft",
	"98:5F:D3": "Microsoft", "B4:AE:2B": "Microsoft", "C8:3F:26": "Microsoft",
	"DC:41:A9": "Intel", "3C:A9:F4": "Intel", "68:EC:C5": "Intel", "80:86:F2": "Intel",
	"8C:8D:28": "Intel", "A0:C5:F2": "Intel", "B4:6B:FC": "Intel", "CC:2F:71": "Intel",
	"F4:8C:50": "Intel", "F8:AC:65": "Intel",
	"00:E0:4C": "Realtek", "52:54:00:00": "Realtek",
	"00:0A:95": "Apple (legacy)", "00:0D:93": "Apple (legacy)",
	"38:60:77": "Canon", "58:08:F1": "Canon", "88:87:17": "Canon", "F8:81:1A": "Canon",
	"00:80:92": "Epson", "38:2A:E4": "Epson", "64:EB:2C": "Epson", "B4:6E:10": "Epson",
	"AC:18:26": "Seiko Epson", "C8:93:83": "Epson",
	"00:1E:8F": "Brother", "00:80:77": "Brother", "30:05:5C": "Brother",
	"3C:2A:F4": "Brother", "94:BF:2D": "Brother",
	"00:1F:A3": "Kodak/HP Imaging", "9C:32:CE": "HP Printer",
	"00:23:24": "HP Server/Printer", "2C:44:FD": "HP", "3C:52:82": "HP",
	"48:0F:CF": "HP", "68:B5:99": "HP", "94:57:A5": "HP", "D0:BF:9C": "HP",
}

func lookupVendor(mac string) string {
	if len(mac) < 8 {
		return ""
	}
	return ouiVendors[strings.ToUpper(mac[:8])]
}

func classifyDevice(vendor, hostname string, ports map[int]bool, isGateway, isSelf bool) string {
	if isSelf {
		return "self"
	}
	if isGateway {
		return "router"
	}
	v := strings.ToLower(vendor)
	n := strings.ToLower(hostname)
	has := func(p int) bool { return ports[p] }

	switch {
	case regexp.MustCompile(`ubiquiti|mikrotik|tp-link|netgear|cisco|router|edimax|asus`).MatchString(v):
		return "router"
	case regexp.MustCompile(`qemu|kvm|vmware|virtualbox|hyper-v|xensource|docker|proxmox`).MatchString(v):
		return "vm"
	case regexp.MustCompile(`esp|tuya|hue|kasa|nest|wyze|sonos|netatmo|withings`).MatchString(v):
		return "iot"
	case regexp.MustCompile(`samsung|lg electronics|sony`).MatchString(v) && !strings.Contains(v, "interactive") && !has(22):
		return "tv"
	case regexp.MustCompile(`playstation|sony interactive`).MatchString(v):
		return "console"
	case regexp.MustCompile(`apple`).MatchString(v):
		if regexp.MustCompile(`iphone|ipad`).MatchString(n) {
			return "phone"
		}
		return "computer"
	case regexp.MustCompile(`canon|epson|brother|printer|kodak|imaging`).MatchString(v):
		return "printer"
	case regexp.MustCompile(`raspberry`).MatchString(v):
		return "iot"
	case regexp.MustCompile(`synology`).MatchString(v):
		return "nas"
	case regexp.MustCompile(`amazon`).MatchString(v):
		return "iot"
	case regexp.MustCompile(`google|xiaomi|huawei`).MatchString(v):
		if regexp.MustCompile(`phone|android|mi |redmi|poco`).MatchString(n) {
			return "phone"
		}
		return "iot"
	case regexp.MustCompile(`android|phone|iphone|ipad|galaxy`).MatchString(n):
		return "phone"
	case regexp.MustCompile(`tv|bravia|webos|roku|chromecast|fire`).MatchString(n):
		return "tv"
	case regexp.MustCompile(`printer|hp-|canon|epson|brother`).MatchString(n):
		return "printer"
	case regexp.MustCompile(`cam|camera|hikvision|dahua|reolink|amcrest`).MatchString(n):
		return "camera"
	case has(3389):
		return "computer"
	case has(445) || has(139):
		return "computer"
	case has(9100):
		return "printer"
	case has(22) || has(111) || has(2049):
		return "server"
	case has(80) || has(443) || has(8080):
		return "iot"
	}
	return "device"
}

func tcpProbe(ip string, port int, timeout time.Duration) (int64, bool) {
	start := time.Now()
	conn, err := net.DialTimeout("tcp", fmt.Sprintf("%s:%d", ip, port), timeout)
	if err != nil {
		return 0, false
	}
	conn.Close()
	return time.Since(start).Milliseconds(), true
}

func pingProbe(ip string) (int64, bool) {
	var cmd *exec.Cmd
	start := time.Now()
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("ping", "-n", "1", "-w", "1000", ip)
	case "darwin":
		cmd = exec.Command("ping", "-c", "1", "-t", "1", ip)
	default:
		cmd = hostCommand("ping", "-c", "1", "-W", "1", ip)
	}
	if err := cmd.Run(); err != nil {
		return 0, false
	}
	return time.Since(start).Milliseconds(), true
}

var lladdrRe = regexp.MustCompile(`(?i)lladdr\s+([0-9a-f:]{17})`)
var arpRe = regexp.MustCompile(`(?i)([0-9a-f]{2}[:-]){5}[0-9a-f]{2}`)

func getMAC(ip string) string {
	var out []byte
	var err error
	if runtime.GOOS == "linux" {
		out, err = hostCommand("ip", "neigh", "show", ip).Output()
		if err == nil {
			if m := lladdrRe.FindSubmatch(out); m != nil {
				return strings.ToUpper(string(m[1]))
			}
		}
	}
	// Fallback: arp -a works on macOS/Windows/Linux (net-tools)
	out, err = hostCommand("arp", "-a", ip).CombinedOutput()
	if err == nil {
		if m := arpRe.Find(out); m != nil {
			return strings.ToUpper(strings.ReplaceAll(string(m), "-", ":"))
		}
	}
	return ""
}

var defaultRouteRe = regexp.MustCompile(`default via (\d+\.\d+\.\d+\.\d+)`)
var defaultRouteRe2 = regexp.MustCompile(`gateway: (\d+\.\d+\.\d+\.\d+)`)

func getGateway() string {
	var cmds [][]string
	switch runtime.GOOS {
	case "linux":
		cmds = [][]string{{"ip", "route", "show", "default"}}
	case "darwin":
		cmds = [][]string{{"route", "-n", "get", "default"}}
	default:
		cmds = [][]string{{"netstat", "-rn"}}
	}
	for _, c := range cmds {
		out, err := hostCommand(c[0], c[1:]...).CombinedOutput()
		if err != nil && len(out) == 0 {
			continue
		}
		if m := defaultRouteRe.FindSubmatch(out); m != nil {
			return string(m[1])
		}
		if m := defaultRouteRe2.FindSubmatch(out); m != nil {
			return string(m[1])
		}
		// Windows netstat -rn: "0.0.0.0   0.0.0.0   <gateway>"
		for _, line := range strings.Split(string(out), "\n") {
			fields := strings.Fields(line)
			if len(fields) >= 3 && fields[0] == "0.0.0.0" && fields[1] == "0.0.0.0" {
				return fields[2]
			}
		}
	}
	return ""
}

func localSubnets() ([]string, map[string]bool) {
	subnets := []string{}
	selfIPs := map[string]bool{}
	ifaces, err := net.Interfaces()
	if err != nil {
		return subnets, selfIPs
	}
	for _, iface := range ifaces {
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, a := range addrs {
			ipnet, ok := a.(*net.IPNet)
			if !ok {
				continue
			}
			ip4 := ipnet.IP.To4()
			if ip4 == nil {
				continue
			}
			selfIPs[ip4.String()] = true
			if ip4.IsLoopback() {
				continue
			}
			prefix := fmt.Sprintf("%d.%d.%d.", ip4[0], ip4[1], ip4[2])
			found := false
			for _, s := range subnets {
				if s == prefix {
					found = true
					break
				}
			}
			if !found {
				subnets = append(subnets, prefix)
			}
		}
	}
	return subnets, selfIPs
}

type hostResult struct {
	IP         string `json:"ip"`
	Hostname   string `json:"hostname"`
	MAC        string `json:"mac"`
	Vendor     string `json:"vendor"`
	IsGateway  bool   `json:"isGateway"`
	IsSelf     bool   `json:"isSelf"`
	Latency    int64  `json:"latency"`
	OpenPorts  []int  `json:"openPorts"`
	DeviceType string `json:"deviceType"`
}

func probeHost(ip, gateway string, selfIPs map[string]bool) *hostResult {
	openPorts := []int{}
	var minLatency int64 = -1
	var mu sync.Mutex
	var wg sync.WaitGroup
	for _, p := range scanPorts {
		wg.Add(1)
		go func(port int) {
			defer wg.Done()
			if ms, ok := tcpProbe(ip, port, 600*time.Millisecond); ok {
				mu.Lock()
				openPorts = append(openPorts, port)
				if minLatency < 0 || ms < minLatency {
					minLatency = ms
				}
				mu.Unlock()
			}
		}(p)
	}
	wg.Wait()
	sort.Ints(openPorts)

	isSelf := selfIPs[ip]
	if len(openPorts) == 0 && !isSelf {
		ms, ok := pingProbe(ip)
		if !ok {
			return nil
		}
		minLatency = ms
	}

	hostname := ""
	if names, err := net.LookupAddr(ip); err == nil && len(names) > 0 {
		hostname = strings.TrimSuffix(names[0], ".")
	}
	mac := getMAC(ip)
	vendor := lookupVendor(mac)
	isGateway := ip == gateway
	if isSelf && hostname == "" {
		hostname, _ = os.Hostname()
	}
	lat := minLatency
	if lat < 1 {
		lat = 1
	}
	portSet := map[int]bool{}
	for _, p := range openPorts {
		portSet[p] = true
	}
	return &hostResult{
		IP:         ip,
		Hostname:   hostname,
		MAC:        mac,
		Vendor:     vendor,
		IsGateway:  isGateway,
		IsSelf:     isSelf,
		Latency:    lat,
		OpenPorts:  openPorts,
		DeviceType: classifyDevice(vendor, hostname, portSet, isGateway, isSelf),
	}
}

func scanSubnet(prefix, gateway string, selfIPs map[string]bool, emit func(*hostResult)) {
	var wg sync.WaitGroup
	sem := make(chan struct{}, 64)
	for i := 1; i < 255; i++ {
		ip := fmt.Sprintf("%s%d", prefix, i)
		wg.Add(1)
		sem <- struct{}{}
		go func(ip string) {
			defer wg.Done()
			defer func() { <-sem }()
			if h := probeHost(ip, gateway, selfIPs); h != nil {
				emit(h)
			}
		}(ip)
	}
	wg.Wait()
}

var validHostRe = regexp.MustCompile(`^[a-zA-Z0-9.\-_:]+$`)
var ipv4Re = regexp.MustCompile(`^\d+\.\d+\.\d+\.\d+$`)
var rttRe = regexp.MustCompile(`([\d.]+)\s*ms`)

func registerNetscanHandlers(sock *siosocket.Socket) {
	sock.On("net-scan", func(args ...any) {
		subnets, selfIPs := localSubnets()
		gateway := getGateway()
		sock.Emit("scan-start", map[string]any{"subnets": subnets, "gateway": gateway})
		for _, prefix := range subnets {
			scanSubnet(prefix, gateway, selfIPs, func(h *hostResult) {
				sock.Emit("scan-result", h)
			})
		}
		sock.Emit("scan-done")
	})

	sock.On("net-ping", func(args ...any) {
		var payload struct {
			IP string `json:"ip"`
		}
		decodePayload(firstArg(args), &payload)
		if !validHostRe.MatchString(payload.IP) {
			sock.Emit("net-tool-error", map[string]any{"tool": "ping", "error": "Invalid host"})
			return
		}
		go func() {
			samples := []int64{}
			for i := 0; i < 4; i++ {
				ms, ok := pingProbe(payload.IP)
				var msVal any
				if ok {
					msVal = ms
					samples = append(samples, ms)
				} else {
					msVal = nil
				}
				sock.Emit("net-ping-result", map[string]any{"ip": payload.IP, "seq": i + 1, "ms": msVal})
			}
			var minV, maxV, sum int64
			for i, s := range samples {
				if i == 0 || s < minV {
					minV = s
				}
				if s > maxV {
					maxV = s
				}
				sum += s
			}
			var avg any
			if len(samples) > 0 {
				avg = sum / int64(len(samples))
			}
			sock.Emit("net-ping-done", map[string]any{
				"ip": payload.IP, "sent": 4, "received": len(samples),
				"min": nullableInt(len(samples) > 0, minV), "avg": avg, "max": nullableInt(len(samples) > 0, maxV),
			})
		}()
	})

	sock.On("net-portscan", func(args ...any) {
		var payload struct {
			IP    string `json:"ip"`
			Ports []int  `json:"ports"`
		}
		decodePayload(firstArg(args), &payload)
		if !ipv4Re.MatchString(payload.IP) {
			sock.Emit("net-tool-error", map[string]any{"tool": "portscan", "error": "Invalid IP"})
			return
		}
		list := payload.Ports
		if len(list) == 0 {
			list = deepScanPorts
		}
		filtered := []int{}
		for _, p := range list {
			if p > 0 && p < 65536 {
				filtered = append(filtered, p)
			}
			if len(filtered) >= 256 {
				break
			}
		}
		go func() {
			open := []int{}
			var mu sync.Mutex
			var wg sync.WaitGroup
			for _, p := range filtered {
				wg.Add(1)
				go func(port int) {
					defer wg.Done()
					if _, ok := tcpProbe(payload.IP, port, 800*time.Millisecond); ok {
						mu.Lock()
						open = append(open, port)
						mu.Unlock()
					}
				}(p)
			}
			wg.Wait()
			sort.Ints(open)
			sock.Emit("net-portscan-result", map[string]any{"ip": payload.IP, "open": open, "scanned": len(filtered)})
		}()
	})

	sock.On("net-traceroute", func(args ...any) {
		var payload struct {
			IP string `json:"ip"`
		}
		decodePayload(firstArg(args), &payload)
		if !validHostRe.MatchString(payload.IP) {
			sock.Emit("net-tool-error", map[string]any{"tool": "traceroute", "error": "Invalid host"})
			return
		}
		go func() {
			var cmd *exec.Cmd
			if runtime.GOOS == "windows" {
				cmd = exec.Command("tracert", "-d", "-h", "15", payload.IP)
			} else {
				cmd = hostCommand("traceroute", "-n", "-w", "2", "-m", "15", payload.IP)
			}
			out, err := cmd.CombinedOutput()
			if err != nil && len(out) == 0 {
				sock.Emit("net-tool-error", map[string]any{"tool": "traceroute", "error": "traceroute not available on server"})
				return
			}
			hops := []map[string]any{}
			for _, line := range strings.Split(string(out), "\n") {
				fields := strings.Fields(line)
				if len(fields) < 2 {
					continue
				}
				hopNum := 0
				fmt.Sscanf(fields[0], "%d", &hopNum)
				if hopNum == 0 {
					continue
				}
				rtts := []float64{}
				for _, m := range rttRe.FindAllStringSubmatch(line, -1) {
					var f float64
					fmt.Sscanf(m[1], "%f", &f)
					rtts = append(rtts, f)
				}
				host := fields[len(fields)-1]
				hops = append(hops, map[string]any{"hop": hopNum, "host": host, "rtt": rtts})
			}
			sock.Emit("net-traceroute-result", map[string]any{"ip": payload.IP, "hops": hops})
		}()
	})

	sock.On("net-dns", func(args ...any) {
		var payload struct {
			Query string `json:"query"`
		}
		decodePayload(firstArg(args), &payload)
		if payload.Query == "" || len(payload.Query) > 255 {
			return
		}
		go func() {
			if ipv4Re.MatchString(payload.Query) {
				names, err := net.LookupAddr(payload.Query)
				if err != nil {
					sock.Emit("net-dns-result", map[string]any{"query": payload.Query, "type": "error", "answers": []string{}, "error": err.Error()})
					return
				}
				for i := range names {
					names[i] = strings.TrimSuffix(names[i], ".")
				}
				sock.Emit("net-dns-result", map[string]any{"query": payload.Query, "type": "PTR", "answers": names})
				return
			}
			ips, err := net.LookupIP(payload.Query)
			if err != nil {
				sock.Emit("net-dns-result", map[string]any{"query": payload.Query, "type": "error", "answers": []string{}, "error": err.Error()})
				return
			}
			answers := []string{}
			for _, ip := range ips {
				if ip.To4() != nil {
					answers = append(answers, "A "+ip.String())
				} else {
					answers = append(answers, "AAAA "+ip.String())
				}
			}
			sock.Emit("net-dns-result", map[string]any{"query": payload.Query, "type": "A/AAAA", "answers": answers})
		}()
	})
}

func nullableInt(ok bool, v int64) any {
	if !ok {
		return nil
	}
	return v
}
