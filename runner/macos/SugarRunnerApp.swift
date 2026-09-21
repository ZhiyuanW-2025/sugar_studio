import AppKit
import ServiceManagement
import WebKit

private struct RunnerStatus: Decodable {
    let state: String
    let message: String
}

private struct RunnerConfig: Decodable {
    let connected: Bool
    let cloudUrl: String?
    let deviceName: String?
    let paused: Bool
}

final class SugarRunnerAppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate, WKNavigationDelegate, WKUIDelegate {
    private lazy var controlURL: URL = {
        let port = ProcessInfo.processInfo.environment["SUGAR_RUNNER_DESKTOP_PORT"] ?? "4392"
        return URL(string: "http://127.0.0.1:\(port)")!
    }()
    private var backend: Process?
    private var statusItem: NSStatusItem!
    private var menu: NSMenu!
    private var statusMenuItem: NSMenuItem!
    private var pauseMenuItem: NSMenuItem!
    private var loginMenuItem: NSMenuItem!
    private var unpairMenuItem: NSMenuItem!
    private var window: NSWindow?
    private var webView: WKWebView?
    private var timer: Timer?
    private var latestStatus = RunnerStatus(state: "setup", message: "正在启动本地助手…")
    private var latestConfig = RunnerConfig(connected: false, cloudUrl: nil, deviceName: nil, paused: false)

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        startBackend()
        configureMenuBar()
        enableLoginItemWhenInstalled()
        waitForBackend(attempt: 0)
        timer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
            self?.refreshState()
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        timer?.invalidate()
        if let backend, backend.isRunning {
            backend.terminate()
        }
    }

    private func startBackend() {
        guard
            let resources = Bundle.main.resourceURL,
            let executable = Bundle.main.executableURL
        else { return }

        let process = Process()
        process.executableURL = resources.appendingPathComponent("runtime/node")
        process.arguments = [resources.appendingPathComponent("app/desktop.mjs").path]
        var environment = ProcessInfo.processInfo.environment
        environment["SUGAR_RUNNER_NO_OPEN"] = "true"
        environment["SUGAR_RUNNER_NATIVE_HOST"] = executable.path
        process.environment = environment
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        do {
            try process.run()
            backend = process
        } catch {
            latestStatus = RunnerStatus(state: "error", message: "本地执行服务启动失败。")
        }
    }

    private func configureMenuBar() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let button = statusItem.button {
            button.image = NSImage(systemSymbolName: "bolt.horizontal.circle.fill", accessibilityDescription: "Sugar Runner")
            button.toolTip = "Sugar Runner"
        }

        menu = NSMenu()
        menu.delegate = self
        statusMenuItem = NSMenuItem(title: "正在启动…", action: nil, keyEquivalent: "")
        statusMenuItem.isEnabled = false
        menu.addItem(statusMenuItem)
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "打开 Sugar Agent", action: #selector(openSugarAgent), keyEquivalent: "o"))
        menu.addItem(NSMenuItem(title: "打开 Runner 设置", action: #selector(showSettings), keyEquivalent: ","))
        pauseMenuItem = NSMenuItem(title: "暂停接收任务", action: #selector(togglePause), keyEquivalent: "")
        menu.addItem(pauseMenuItem)
        loginMenuItem = NSMenuItem(title: "登录 Mac 时自动启动", action: #selector(toggleLoginItem), keyEquivalent: "")
        menu.addItem(loginMenuItem)
        menu.addItem(.separator())
        unpairMenuItem = NSMenuItem(title: "解除设备配对…", action: #selector(unpair), keyEquivalent: "")
        menu.addItem(unpairMenuItem)
        menu.addItem(.separator())
        menu.addItem(NSMenuItem(title: "退出 Sugar Runner", action: #selector(quit), keyEquivalent: "q"))
        statusItem.menu = menu
    }

    func menuWillOpen(_ menu: NSMenu) {
        statusMenuItem.title = latestConfig.connected
            ? "\(latestConfig.deviceName ?? "这台 Mac") · \(latestStatus.message)"
            : latestStatus.message
        pauseMenuItem.title = latestConfig.paused ? "恢复接收任务" : "暂停接收任务"
        pauseMenuItem.isEnabled = latestConfig.connected
        unpairMenuItem.isEnabled = latestConfig.connected
        loginMenuItem.state = loginItemEnabled() ? .on : .off
    }

    private func waitForBackend(attempt: Int) {
        request(path: "/api/config") { [weak self] (config: RunnerConfig?) in
            guard let self else { return }
            if let config {
                self.latestConfig = config
                self.refreshState()
                if !config.connected { self.showSettings() }
                return
            }
            if attempt < 20 {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
                    self.waitForBackend(attempt: attempt + 1)
                }
            } else {
                self.latestStatus = RunnerStatus(state: "error", message: "本地助手未能启动。")
            }
        }
    }

    private func refreshState() {
        request(path: "/api/status") { [weak self] (status: RunnerStatus?) in
            if let status { self?.latestStatus = status }
        }
        request(path: "/api/config") { [weak self] (config: RunnerConfig?) in
            if let config { self?.latestConfig = config }
        }
    }

    private func request<T: Decodable>(path: String, completion: @escaping (T?) -> Void) {
        let url = controlURL.appendingPathComponent(path.trimmingCharacters(in: CharacterSet(charactersIn: "/")))
        URLSession.shared.dataTask(with: url) { data, response, _ in
            let value = data.flatMap { try? JSONDecoder().decode(T.self, from: $0) }
            DispatchQueue.main.async { completion(value) }
        }.resume()
    }

    private func post(path: String, completion: (() -> Void)? = nil) {
        let url = controlURL.appendingPathComponent(path.trimmingCharacters(in: CharacterSet(charactersIn: "/")))
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        URLSession.shared.dataTask(with: request) { _, _, _ in
            DispatchQueue.main.async {
                self.refreshState()
                completion?()
            }
        }.resume()
    }

    @objc private func showSettings() {
        if window == nil {
            let configuration = WKWebViewConfiguration()
            let view = WKWebView(frame: .zero, configuration: configuration)
            view.navigationDelegate = self
            view.uiDelegate = self
            let nextWindow = NSWindow(
                contentRect: NSRect(x: 0, y: 0, width: 760, height: 720),
                styleMask: [.titled, .closable, .miniaturizable, .resizable],
                backing: .buffered,
                defer: false
            )
            nextWindow.title = "Sugar Runner"
            nextWindow.minSize = NSSize(width: 620, height: 560)
            nextWindow.contentView = view
            nextWindow.center()
            window = nextWindow
            webView = view
        }
        webView?.load(URLRequest(url: controlURL))
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    @objc private func openSugarAgent() {
        guard let value = latestConfig.cloudUrl, let url = URL(string: value) else {
            showSettings()
            return
        }
        NSWorkspace.shared.open(url)
    }

    @objc private func togglePause() {
        post(path: latestConfig.paused ? "/api/resume" : "/api/pause")
    }

    @objc private func unpair() {
        let alert = NSAlert()
        alert.messageText = "解除这台 Mac 的 Sugar Runner 配对？"
        alert.informativeText = "解除后，牛牛将不能再使用这台电脑上的代码仓库。需要再次生成配对码才能重新连接。"
        alert.alertStyle = .warning
        alert.addButton(withTitle: "解除配对")
        alert.addButton(withTitle: "取消")
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        post(path: "/api/unpair") { [weak self] in
            self?.showSettings()
        }
    }

    @objc private func toggleLoginItem() {
        guard #available(macOS 13.0, *) else { return }
        do {
            if SMAppService.mainApp.status == .enabled {
                try SMAppService.mainApp.unregister()
            } else {
                try SMAppService.mainApp.register()
            }
        } catch {
            showAlert(title: "无法修改自动启动设置", message: "请在“系统设置 → 通用 → 登录项”中允许 Sugar Runner。")
        }
    }

    private func enableLoginItemWhenInstalled() {
        guard Bundle.main.bundleURL.path.hasPrefix("/Applications/") else { return }
        guard #available(macOS 13.0, *), SMAppService.mainApp.status == .notRegistered else { return }
        try? SMAppService.mainApp.register()
    }

    private func loginItemEnabled() -> Bool {
        guard #available(macOS 13.0, *) else { return false }
        return SMAppService.mainApp.status == .enabled
    }

    private func showAlert(title: String, message: String) {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = message
        alert.runModal()
    }

    @objc private func quit() {
        NSApp.terminate(nil)
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }
        if url.host == controlURL.host && url.port == controlURL.port {
            decisionHandler(.allow)
        } else {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
        }
    }

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = navigationAction.request.url { NSWorkspace.shared.open(url) }
        return nil
    }
}

@main
struct SugarRunnerMain {
    static func main() {
        let application = NSApplication.shared
        let delegate = SugarRunnerAppDelegate()
        application.delegate = delegate
        application.run()
    }
}
