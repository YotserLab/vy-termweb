package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
)

type sysCPU struct {
	Name     string `json:"name"`
	Vendor   string `json:"vendor"`
	Arch     string `json:"arch"`
	Cores    int    `json:"cores"`
	Threads  int    `json:"threads"`
	MaxMhz   string `json:"maxMhz,omitempty"`
	CurMhz   string `json:"curMhz,omitempty"`
	CacheL1  string `json:"cacheL1,omitempty"`
	CacheL2  string `json:"cacheL2,omitempty"`
	CacheL3  string `json:"cacheL3,omitempty"`
	Socket   string `json:"socket,omitempty"`
	Stepping string `json:"stepping,omitempty"`
	Family   string `json:"family,omitempty"`
	Model    string `json:"model,omitempty"`
	Virt     string `json:"virt,omitempty"`
	Numa     string `json:"numa,omitempty"`
	Flags    string `json:"flags,omitempty"`
}

type sysMem struct {
	TotalBytes uint64    `json:"totalBytes"`
	AvailBytes uint64    `json:"availBytes,omitempty"`
	SwapTotal  uint64    `json:"swapTotal,omitempty"`
	SwapFree   uint64    `json:"swapFree,omitempty"`
	Type       string    `json:"type,omitempty"`
	Channels   string    `json:"channels,omitempty"`
	Slots      []memSlot `json:"slots,omitempty"`
}

type memSlot struct {
	Locator      string `json:"locator"`
	SizeBytes    uint64 `json:"sizeBytes"`
	Type         string `json:"type,omitempty"`
	SpeedMts     string `json:"speedMts,omitempty"`
	Manufacturer string `json:"manufacturer,omitempty"`
	PartNumber   string `json:"partNumber,omitempty"`
}

type sysBoard struct {
	Vendor   string `json:"vendor,omitempty"`
	Product  string `json:"product,omitempty"`
	BiosVer  string `json:"biosVersion,omitempty"`
	BiosDate string `json:"biosDate,omitempty"`
}

type sysGPU struct {
	Name     string `json:"name"`
	VramMB   int64  `json:"vramMB,omitempty"`
	Driver   string `json:"driver,omitempty"`
	PciAddr  string `json:"pciAddr,omitempty"`
	TempC    string `json:"tempC,omitempty"`
	ClockMhz string `json:"clockMhz,omitempty"`
}

type sysStorage struct {
	Device    string `json:"device"`
	Mount     string `json:"mount"`
	Fs        string `json:"fs,omitempty"`
	SizeBytes uint64 `json:"sizeBytes"`
	UsedBytes uint64 `json:"usedBytes"`
}

type sysOS struct {
	Name    string `json:"name"`
	Version string `json:"version,omitempty"`
	Kernel  string `json:"kernel,omitempty"`
	Arch    string `json:"arch"`
	Uptime  string `json:"uptime,omitempty"`
	Host    string `json:"hostname"`
}

type systemInfo struct {
	CPU     sysCPU       `json:"cpu"`
	Mem     sysMem       `json:"memory"`
	Board   sysBoard     `json:"board"`
	GPUs    []sysGPU     `json:"gpus"`
	Storage []sysStorage `json:"storage,omitempty"`
	OS      sysOS        `json:"os"`
}

func registerSysinfoRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/system/info", func(w http.ResponseWriter, r *http.Request) {
		info := collectSysinfo()
		jsonOK(w, info)
	})
}

func collectSysinfo() systemInfo {
	var info systemInfo
	host, _ := os.Hostname()
	info.OS.Host = host
	info.OS.Arch = runtime.GOARCH
	switch runtime.GOOS {
	case "windows":
		collectWindows(&info)
	case "darwin":
		collectDarwin(&info)
	default:
		collectLinux(&info)
	}
	if info.CPU.Name == "" {
		info.CPU.Name = runtime.GOARCH
	}
	if info.CPU.Threads == 0 {
		info.CPU.Threads = runtime.NumCPU()
	}
	return info
}

// ---------- Linux ----------

func collectLinux(info *systemInfo) {
	// lscpu -J gives a clean JSON tree
	if out, err := hostCommand("lscpu", "-J").Output(); err == nil {
		var doc struct {
			Lscpu []struct {
				Field    string          `json:"field"`
				Data     string          `json:"data"`
				Children json.RawMessage `json:"children,omitempty"`
			} `json:"lscpu"`
		}
		if json.Unmarshal(out, &doc) == nil {
			get := func(field string) string {
				for _, e := range doc.Lscpu {
					if e.Field == field {
						return e.Data
					}
				}
				return ""
			}
			info.CPU.Name = get("Model name:")
			info.CPU.Vendor = get("Vendor ID:")
			info.CPU.MaxMhz = fmtMhz(get("CPU max MHz:"))
			info.CPU.CurMhz = fmtMhz(get("CPU MHz:"))
			info.CPU.CacheL1 = get("L1d cache:") + "/" + get("L1i cache:")
			info.CPU.CacheL2 = get("L2 cache:")
			info.CPU.CacheL3 = get("L3 cache:")
			info.CPU.Socket = get("Socket(s):")
			info.CPU.Stepping = get("Stepping:")
			info.CPU.Family = get("CPU family:")
			info.CPU.Model = get("Model:")
			info.CPU.Virt = get("Virtualization:")
			info.CPU.Numa = get("NUMA node(s):")
			info.CPU.Flags = notableFlags(get("Flags:"))
			if v, err := strconv.Atoi(get("Core(s) per socket:")); err == nil {
				if sk, _ := strconv.Atoi(info.CPU.Socket); sk > 0 {
					info.CPU.Cores = v * sk
				}
			}
			if v, err := strconv.Atoi(get("CPU(s):")); err == nil {
				info.CPU.Threads = v
			}
			info.CPU.Arch = get("Architecture:")
		}
	}
	if info.CPU.Name == "" {
		if raw, err := os.ReadFile("/proc/cpuinfo"); err == nil {
			for _, l := range strings.Split(string(raw), "\n") {
				if strings.HasPrefix(l, "model name") {
					info.CPU.Name = strings.TrimSpace(strings.SplitN(l, ":", 2)[1])
					break
				}
			}
		}
	}
	info.OS.Kernel = cmdOut("uname", "-r")
	info.OS.Name = cmdOut("uname", "-o") + " " + cmdOut("uname", "-r")
	if raw, err := os.ReadFile("/etc/os-release"); err == nil {
		for _, l := range strings.Split(string(raw), "\n") {
			if strings.HasPrefix(l, "PRETTY_NAME=") {
				info.OS.Name = strings.Trim(strings.TrimPrefix(l, "PRETTY_NAME="), `"`)
			}
		}
	}
	if raw, err := os.ReadFile("/proc/uptime"); err == nil {
		var sec float64
		fmt.Sscanf(string(raw), "%f", &sec)
		info.OS.Uptime = fmtUptime(sec)
	}
	// Memory
	if raw, err := os.ReadFile("/proc/meminfo"); err == nil {
		kb := func(l string) uint64 {
			f := strings.Fields(l)
			n, _ := strconv.ParseUint(f[1], 10, 64)
			return n * 1024
		}
		for _, l := range strings.Split(string(raw), "\n") {
			switch {
			case strings.HasPrefix(l, "MemTotal:"):
				info.Mem.TotalBytes = kb(l)
			case strings.HasPrefix(l, "MemAvailable:"):
				info.Mem.AvailBytes = kb(l)
			case strings.HasPrefix(l, "SwapTotal:"):
				info.Mem.SwapTotal = kb(l)
			case strings.HasPrefix(l, "SwapFree:"):
				info.Mem.SwapFree = kb(l)
			}
		}
	}
	// DMI: board + BIOS are world-readable; memory slots need root via dmidecode
	read := func(p string) string {
		b, _ := os.ReadFile("/sys/devices/virtual/dmi/id/" + p)
		return strings.TrimSpace(string(b))
	}
	info.Board.Vendor = read("board_vendor")
	info.Board.Product = read("board_name")
	info.Board.BiosVer = read("bios_version")
	info.Board.BiosDate = read("bios_date")
	if info.Board.Vendor == "" {
		info.Board.Vendor = read("sys_vendor")
		info.Board.Product = read("product_name")
	}
	if out, err := hostCommand("dmidecode", "-t", "memory").Output(); err == nil {
		parseDmidecode(string(out), info)
	}
	// GPUs via lspci (VGA/3D/Display controllers)
	if out, err := hostCommand("lspci", "-mm").Output(); err == nil {
		for _, l := range strings.Split(string(out), "\n") {
			low := strings.ToLower(l)
			if strings.Contains(low, `"vga`) || strings.Contains(low, `"3d`) || strings.Contains(low, `"display`) {
				// format: slot "class" "vendor" "device" ...
				parts := strings.Split(l, `"`)
				if len(parts) >= 6 {
					info.GPUs = append(info.GPUs, sysGPU{
						Name:    strings.TrimSpace(parts[3] + " " + parts[5]),
						PciAddr: strings.TrimSpace(parts[0]),
					})
				}
			}
		}
	}
	collectLinuxGPUDrivers(info)
	collectNvidiaSmi(info)
	collectUnixStorage(info)
}

// collectLinuxGPUDrivers fills the kernel driver (and amdgpu VRAM) for each GPU.
func collectLinuxGPUDrivers(info *systemInfo) {
	out, err := hostCommand("lspci", "-k").Output()
	if err == nil {
		var cur *sysGPU
		for _, l := range strings.Split(string(out), "\n") {
			f := strings.Fields(l)
			isGPU := len(f) > 1 && (strings.HasPrefix(l, "0") || strings.HasPrefix(l, "1") ||
				strings.HasPrefix(l, "2") || strings.HasPrefix(l, "3") || strings.HasPrefix(l, "4") ||
				strings.HasPrefix(l, "5") || strings.HasPrefix(l, "6") || strings.HasPrefix(l, "7") ||
				strings.HasPrefix(l, "8") || strings.HasPrefix(l, "9")) &&
				(strings.Contains(l, "VGA compatible") || strings.Contains(l, "3D controller") || strings.Contains(l, "Display controller"))
			if isGPU {
				addr := f[0]
				cur = nil
				for i := range info.GPUs {
					if strings.HasSuffix(info.GPUs[i].PciAddr, addr) || strings.HasSuffix(addr, info.GPUs[i].PciAddr) {
						cur = &info.GPUs[i]
						break
					}
				}
				continue
			}
			if cur != nil && strings.Contains(l, "Kernel driver in use:") {
				cur.Driver = strings.TrimSpace(strings.SplitN(l, ":", 2)[1])
			}
		}
	}
	// amdgpu exposes real VRAM via sysfs; match by PCI addr
	for i := range info.GPUs {
		matches, _ := filepath.Glob("/sys/class/drm/card*/device/mem_info_vram_total")
		for _, m := range matches {
			link, err := filepath.EvalSymlinks(filepath.Dir(m))
			if err != nil || !strings.HasSuffix(filepath.Base(link), info.GPUs[i].PciAddr) {
				continue
			}
			if b, err := os.ReadFile(m); err == nil {
				if n, err := strconv.ParseInt(strings.TrimSpace(string(b)), 10, 64); err == nil {
					info.GPUs[i].VramMB = n >> 20
				}
			}
		}
	}
}

// collectNvidiaSmi queries nvidia-smi (when present) for driver, VRAM, clock and temp.
func collectNvidiaSmi(info *systemInfo) {
	out, err := hostCommand("nvidia-smi",
		"--query-gpu=index,name,memory.total,driver_version,clocks.current.graphics,temperature.gpu",
		"--format=csv,noheader,nounits").Output()
	if err != nil {
		return
	}
	for _, l := range strings.Split(string(out), "\n") {
		f := strings.Split(l, ",")
		if len(f) < 6 {
			continue
		}
		idx, _ := strconv.Atoi(strings.TrimSpace(f[0]))
		name := strings.TrimSpace(f[1])
		for i := range info.GPUs {
			if !strings.Contains(info.GPUs[i].Name, name) && !strings.Contains(name, info.GPUs[i].Name) {
				continue
			}
			_ = idx
			if n, err := strconv.ParseInt(strings.TrimSpace(f[2]), 10, 64); err == nil {
				info.GPUs[i].VramMB = n
			}
			info.GPUs[i].Driver = strings.TrimSpace(f[3])
			info.GPUs[i].ClockMhz = strings.TrimSpace(f[4]) + " MHz"
			info.GPUs[i].TempC = strings.TrimSpace(f[5]) + " °C"
		}
	}
}

// collectUnixStorage lists mounted filesystems with usage (POSIX df -kP).
func collectUnixStorage(info *systemInfo) {
	out, err := hostCommand("df", "-kP").Output()
	if err != nil {
		return
	}
	skip := map[string]bool{"tmpfs": true, "devtmpfs": true, "overlay": true,
		"squashfs": true, "proc": true, "sysfs": true, "cgroup": true, "cgroup2": true,
		"devpts": true, "mqueue": true, "shm": true, "securityfs": true, "debugfs": true,
		"tracefs": true, "configfs": true, "fusectl": true, "pstore": true, "bpf": true,
		"hugetlbfs": true, "ramfs": true, "nsfs": true, "efivarfs": true, "binfmt_misc": true}
	for _, l := range strings.Split(string(out), "\n")[1:] {
		f := strings.Fields(l)
		if len(f) < 6 {
			continue
		}
		fs := ""
		// df -kP on Linux doesn't show fstype; read it from /proc/mounts
		size, _ := strconv.ParseUint(f[1], 10, 64)
		used, _ := strconv.ParseUint(f[2], 10, 64)
		mount := strings.Join(f[5:], " ")
		if size == 0 || strings.HasPrefix(mount, "/snap/") || strings.HasPrefix(mount, "/boot/efi") {
			continue
		}
		fs = mountFsType(mount)
		if skip[fs] {
			continue
		}
		info.Storage = append(info.Storage, sysStorage{
			Device: f[0], Mount: mount, Fs: fs, SizeBytes: size * 1024, UsedBytes: used * 1024,
		})
	}
}

func mountFsType(mount string) string {
	if raw, err := os.ReadFile("/proc/mounts"); err == nil {
		for _, l := range strings.Split(string(raw), "\n") {
			f := strings.Fields(l)
			if len(f) >= 3 && f[1] == mount {
				return f[2]
			}
		}
	}
	return ""
}

// notableFlags reduces the full CPU flag list to the ones users care about.
func notableFlags(flags string) string {
	want := map[string]bool{
		"lm": true, "nx": true, "mmx": true, "sse": true, "sse2": true, "sse3": true,
		"ssse3": true, "sse4_1": true, "sse4_2": true, "avx": true, "avx2": true,
		"avx512f": true, "avx512dq": true, "aes": true, "sha_ni": true, "vaes": true,
		"pclmulqdq": true, "vmx": true, "svm": true, "ht": true, "hypervisor": true,
		"f16c": true, "fma": true, "bmi2": true, "rdseed": true, "rdrand": true,
	}
	var out []string
	for _, f := range strings.Fields(flags) {
		if want[f] {
			out = append(out, f)
		}
	}
	return strings.Join(out, " ")
}

func parseDmidecode(out string, info *systemInfo) {
	var cur *memSlot
	var types []string
	flush := func() {
		if cur != nil && cur.SizeBytes > 0 {
			info.Mem.Slots = append(info.Mem.Slots, *cur)
			if cur.Type != "" {
				types = append(types, cur.Type)
			}
		}
	}
	for _, l := range strings.Split(out, "\n") {
		l = strings.TrimSpace(l)
		switch {
		case strings.HasPrefix(l, "Memory Device"):
			flush()
			cur = &memSlot{}
		case cur == nil:
		case strings.HasPrefix(l, "Size:"):
			f := strings.Fields(l)
			if len(f) >= 2 && f[1] != "No" {
				n, _ := strconv.ParseUint(f[1], 10, 64)
				switch f[2] {
				case "GB":
					cur.SizeBytes = n << 30
				case "MB":
					cur.SizeBytes = n << 20
				case "KB":
					cur.SizeBytes = n << 10
				}
			}
		case strings.HasPrefix(l, "Locator:"):
			cur.Locator = strings.TrimSpace(strings.TrimPrefix(l, "Locator:"))
		case strings.HasPrefix(l, "Type:"):
			cur.Type = strings.TrimSpace(strings.TrimPrefix(l, "Type:"))
		case strings.HasPrefix(l, "Speed:"):
			cur.SpeedMts = strings.TrimSpace(strings.TrimPrefix(l, "Speed:"))
		case strings.HasPrefix(l, "Manufacturer:"):
			cur.Manufacturer = strings.TrimSpace(strings.TrimPrefix(l, "Manufacturer:"))
		case strings.HasPrefix(l, "Part Number:"):
			cur.PartNumber = strings.TrimSpace(strings.TrimPrefix(l, "Part Number:"))
		}
	}
	flush()
	if len(types) > 0 {
		info.Mem.Type = types[0]
	}
	if n := len(info.Mem.Slots); n > 0 {
		info.Mem.Channels = fmt.Sprintf("%d module(s)", n)
	}
}

// ---------- Windows (PowerShell + CIM) ----------

func collectWindows(info *systemInfo) {
	script := `
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$cs  = Get-CimInstance Win32_ComputerSystem
$bb  = Get-CimInstance Win32_BaseBoard
$bio = Get-CimInstance Win32_BIOS
$os  = Get-CimInstance Win32_OperatingSystem
$mem = Get-CimInstance Win32_PhysicalMemory | ForEach-Object {
  @{ locator=$_.DeviceLocator; size=[long]$_.Capacity; type=(Switch ($_.SMBIOSMemoryType) { 20 {"DDR"} 21 {"DDR2"} 24 {"DDR3"} 26 {"DDR4"} 34 {"DDR5"} default {$_.MemoryType} }); speed="$($_.Speed) MT/s"; manuf=$_.Manufacturer; part=($_.PartNumber -replace '\s+$','') }
}
$gpu = Get-CimInstance Win32_VideoController | ForEach-Object { @{ name=$_.Name; vram=[long]$_.AdapterRAM; driver=$_.DriverVersion; pci=$_.PNPDeviceID } }
$disk = Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object { @{ dev=$_.DeviceID; fs=$_.FileSystem; size=[long]$_.Size; free=[long]$_.FreeSpace } }
$osmem = Get-CimInstance Win32_OperatingSystem
@{
  cpu = @{ name=$cpu.Name.Trim(); vendor=$cpu.Manufacturer; cores=$cpu.NumberOfCores; threads=$cpu.NumberOfLogicalProcessors; maxMhz=$cpu.MaxClockSpeed; curMhz=$cpu.CurrentClockSpeed; socket=$cpu.SocketDesignation; l2=$cpu.L2CacheSize; l3=$cpu.L3CacheSize }
  mem = @{ total=[long]$cs.TotalPhysicalMemory; avail=[long]$osmem.FreePhysicalMemory*1024; slots=$mem }
  board = @{ vendor=$bb.Manufacturer; product=$bb.Product; bios=$bio.SMBIOSBIOSVersion; biosDate=$bio.ReleaseDate }
  gpu = $gpu
  disk = $disk
  os = @{ name=$os.Caption; version=$os.Version; build=$os.BuildNumber; uptime=((Get-Date) - $os.LastBootUpTime).ToString() }
} | ConvertTo-Json -Depth 4
`
	out, err := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-Command", script).Output()
	if err != nil {
		return
	}
	var d struct {
		CPU struct {
			Name, Vendor, Socket                   string
			Cores, Threads, MaxMhz, L2, L3, CurMhz int
		} `json:"cpu"`
		Mem struct {
			Total, Avail int64
			Slots        []struct {
				Locator, Type, Speed, Manuf, Part string
				Size                              int64
			} `json:"slots"`
		} `json:"mem"`
		Board struct {
			Vendor, Product, Bios, BiosDate string
		} `json:"board"`
		GPU []struct {
			Name, Driver, Pci string
			Vram              int64
		} `json:"gpu"`
		Disk []struct {
			Dev, Fs    string
			Size, Free int64
		} `json:"disk"`
		OS struct {
			Name, Version, Build, Uptime string
		} `json:"os"`
	}
	if json.Unmarshal(out, &d) != nil {
		return
	}
	info.CPU.Name = d.CPU.Name
	info.CPU.Vendor = d.CPU.Vendor
	info.CPU.Cores = d.CPU.Cores
	info.CPU.Threads = d.CPU.Threads
	info.CPU.MaxMhz = strconv.Itoa(d.CPU.MaxMhz)
	if d.CPU.CurMhz > 0 {
		info.CPU.CurMhz = strconv.Itoa(d.CPU.CurMhz)
	}
	info.CPU.Socket = d.CPU.Socket
	if d.CPU.L2 > 0 {
		info.CPU.CacheL2 = fmt.Sprintf("%d KB", d.CPU.L2)
	}
	if d.CPU.L3 > 0 {
		info.CPU.CacheL3 = fmt.Sprintf("%d KB", d.CPU.L3)
	}
	info.Mem.TotalBytes = uint64(d.Mem.Total)
	info.Mem.AvailBytes = uint64(d.Mem.Avail)
	for _, s := range d.Mem.Slots {
		info.Mem.Slots = append(info.Mem.Slots, memSlot{
			Locator: s.Locator, SizeBytes: uint64(s.Size), Type: s.Type,
			SpeedMts: s.Speed, Manufacturer: strings.TrimSpace(s.Manuf), PartNumber: s.Part,
		})
		if info.Mem.Type == "" && s.Type != "" && s.Type != "0" {
			info.Mem.Type = s.Type
		}
	}
	if len(info.Mem.Slots) > 0 {
		info.Mem.Channels = fmt.Sprintf("%d module(s)", len(info.Mem.Slots))
	}
	info.Board.Vendor = d.Board.Vendor
	info.Board.Product = d.Board.Product
	info.Board.BiosVer = d.Board.Bios
	info.Board.BiosDate = d.Board.BiosDate
	for _, g := range d.GPU {
		info.GPUs = append(info.GPUs, sysGPU{Name: g.Name, VramMB: g.Vram >> 20, Driver: g.Driver, PciAddr: g.Pci})
	}
	for _, ds := range d.Disk {
		info.Storage = append(info.Storage, sysStorage{
			Device: ds.Dev, Mount: ds.Dev, Fs: ds.Fs,
			SizeBytes: uint64(ds.Size), UsedBytes: uint64(ds.Size - ds.Free),
		})
	}
	info.OS.Name = strings.TrimSpace(d.OS.Name)
	info.OS.Version = d.OS.Version + " (build " + d.OS.Build + ")"
	info.OS.Uptime = d.OS.Uptime
	info.OS.Kernel = "Windows NT " + d.OS.Version
}

// ---------- macOS ----------

func collectDarwin(info *systemInfo) {
	sysctl := func(k string) string {
		out, _ := exec.Command("sysctl", "-n", k).Output()
		return strings.TrimSpace(string(out))
	}
	info.CPU.Name = sysctl("machdep.cpu.brand_string")
	info.CPU.Vendor = sysctl("machdep.cpu.vendor")
	info.CPU.Arch = runtime.GOARCH
	if n, err := strconv.Atoi(sysctl("hw.physicalcpu")); err == nil {
		info.CPU.Cores = n
	}
	if n, err := strconv.Atoi(sysctl("hw.logicalcpu")); err == nil {
		info.CPU.Threads = n
	}
	if n, err := strconv.ParseUint(sysctl("hw.memsize"), 10, 64); err == nil {
		info.Mem.TotalBytes = n
	}
	if n, err := strconv.Atoi(sysctl("hw.l3cachesize")); err == nil && n > 0 {
		info.CPU.CacheL3 = fmt.Sprintf("%d MB", n>>20)
	}
	if n, err := strconv.Atoi(sysctl("hw.l2cachesize")); err == nil && n > 0 {
		info.CPU.CacheL2 = fmt.Sprintf("%d KB", n>>10)
	}
	info.Board.Vendor = "Apple"
	info.Board.Product = sysctl("hw.model")
	info.OS.Name = "macOS " + sysctl("kern.osproductversion")
	info.OS.Kernel = sysctl("kern.osrelease")
	info.OS.Uptime = fmtUptime(0)
	// GPUs via system_profiler
	collectUnixStorage(info)
	// GPUs via system_profiler
	if out, err := exec.Command("system_profiler", "SPDisplaysDataType", "-json").Output(); err == nil {
		var sp struct {
			Displays []struct {
				Name  string `json:"_name"`
				Vram  string `json:"spdisplays_vram"`
				Metal string `json:"spdisplays_metalfamily"`
			} `json:"SPDisplaysDataType"`
		}
		if json.Unmarshal(out, &sp) == nil {
			for _, g := range sp.Displays {
				info.GPUs = append(info.GPUs, sysGPU{Name: g.Name, Driver: g.Metal})
			}
		}
	}
}

// fmtMhz normalizes lscpu MHz values like "3900.0000" → "3900".
func fmtMhz(s string) string {
	s = strings.TrimSpace(strings.TrimSuffix(s, "MHz"))
	if f, err := strconv.ParseFloat(s, 64); err == nil {
		return strconv.FormatFloat(f, 'f', -1, 64)
	}
	return s
}

func cmdOut(name string, args ...string) string {
	out, _ := hostCommand(name, args...).Output()
	return strings.TrimSpace(string(out))
}

func fmtUptime(sec float64) string {
	if sec <= 0 {
		return ""
	}
	d := int(sec) / 86400
	h := (int(sec) % 86400) / 3600
	m := (int(sec) % 3600) / 60
	if d > 0 {
		return fmt.Sprintf("%dd %dh %dm", d, h, m)
	}
	return fmt.Sprintf("%dh %dm", h, m)
}
