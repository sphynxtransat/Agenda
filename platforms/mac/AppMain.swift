import Cocoa
import WebKit

// ─── Serveur HTTP local ───────────────────────────────────────────────────────
class LocalServer {
    private var process: Process?
    func start(dir: URL) throws {
        let kill = Process(); kill.executableURL = URL(fileURLWithPath: "/bin/sh")
        kill.arguments = ["-c", "lsof -ti:19432 | xargs kill -9 2>/dev/null; true"]
        try? kill.run(); kill.waitUntilExit(); Thread.sleep(forTimeInterval: 0.15)
        let candidates = ["/usr/bin/python3","/usr/local/bin/python3","/opt/homebrew/bin/python3"]
        guard let python = candidates.first(where: { FileManager.default.fileExists(atPath: $0) })
        else { throw NSError(domain:"Agenda",code:1,userInfo:[NSLocalizedDescriptionKey:"python3 introuvable"]) }
        process = Process(); process!.executableURL = URL(fileURLWithPath: python)
        process!.arguments = ["-m","http.server","19432","--bind","127.0.0.1"]
        process!.currentDirectoryURL = dir
        process!.standardOutput = FileHandle.nullDevice; process!.standardError = FileHandle.nullDevice
        try process!.run(); Thread.sleep(forTimeInterval: 0.6)
    }
    func stop() { process?.terminate(); process = nil }
}

// ─── Pont clipboard ───────────────────────────────────────────────────────────
class ClipboardHandler: NSObject, WKScriptMessageHandler {
    func userContentController(_ c: WKUserContentController, didReceive msg: WKScriptMessage) {
        if let t = msg.body as? String { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(t, forType: .string) }
    }
}

// ─── Pont API — fait l'appel HTTP depuis Swift (pas de CORS) ─────────────────
class APIHandler: NSObject, WKScriptMessageHandler {
    weak var webView: WKWebView?

    func userContentController(_ c: WKUserContentController, didReceive msg: WKScriptMessage) {
        guard let dict = msg.body as? [String: Any],
              let callId  = dict["callId"]  as? String,
              let urlStr  = dict["url"]     as? String,
              let apiKey  = dict["apiKey"]  as? String,
              let body    = dict["body"]    as? String,
              let url     = URL(string: urlStr)
        else { return }

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json",  forHTTPHeaderField: "Content-Type")
        req.setValue(apiKey,              forHTTPHeaderField: "x-api-key")
        req.setValue("2023-06-01",        forHTTPHeaderField: "anthropic-version")
        req.httpBody = body.data(using: .utf8)

        URLSession.shared.dataTask(with: req) { [weak self] data, response, error in
            DispatchQueue.main.async {
                if let error = error {
                    let safe = error.localizedDescription.replacingOccurrences(of: "\"", with: "\\\"")
                    self?.webView?.evaluateJavaScript("window._apiCallback('\(callId)', null, \"\(safe)\")", completionHandler: nil)
                    return
                }
                if let data = data, let str = String(data: data, encoding: .utf8) {
                    // Escape for JS string injection
                    let escaped = str
                        .replacingOccurrences(of: "\\", with: "\\\\")
                        .replacingOccurrences(of: "\"", with: "\\\"")
                        .replacingOccurrences(of: "\n", with: "\\n")
                        .replacingOccurrences(of: "\r", with: "\\r")
                    let httpRes = response as? HTTPURLResponse
                    let status  = httpRes?.statusCode ?? 0
                    self?.webView?.evaluateJavaScript(
                        "window._apiCallback('\(callId)', {status:\(status), body:\"\(escaped)\"})",
                        completionHandler: nil)
                }
            }
        }.resume()
    }
}

// ─── Application ──────────────────────────────────────────────────────────────
class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate {
    var window: NSWindow!
    var webView: WKWebView!
    let server = LocalServer()
    let apiHandler = APIHandler()
    let remoteAppURL = URL(string: "https://agenda-c6346.web.app/index.html")!
    let localAppURL  = URL(string: "http://localhost:19432/index.html")!
    var didFallbackToLocal = false

    func makeReloadRequest(url: URL) -> URLRequest {
        var req = URLRequest(url: url)
        req.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        req.timeoutInterval = 12
        return req
    }

    func loadPreferredApp() {
        didFallbackToLocal = false
        webView.load(makeReloadRequest(url: remoteAppURL))
    }

    func loadLocalFallback() {
        guard !didFallbackToLocal else { return }
        didFallbackToLocal = true
        webView.load(makeReloadRequest(url: localAppURL))
    }

    func applicationDidFinishLaunching(_ n: Notification) {
        let bin = URL(fileURLWithPath: CommandLine.arguments[0]).resolvingSymlinksInPath()
        let res = bin.deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("Resources")

        do { try server.start(dir: res) }
        catch { let a = NSAlert(); a.messageText = "Erreur serveur"; a.informativeText = error.localizedDescription; a.runModal(); NSApp.terminate(nil); return }

        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()

        // Clipboard bridge
        config.userContentController.add(ClipboardHandler(), name: "clipboard")
        config.userContentController.addUserScript(WKUserScript(
            source: "navigator.clipboard.writeText=function(t){window.webkit.messageHandlers.clipboard.postMessage(t);return Promise.resolve();};",
            injectionTime: .atDocumentStart, forMainFrameOnly: false))

        // API bridge — remplace fetch() pour éviter CORS
        config.userContentController.add(apiHandler, name: "nativeAPI")
        config.userContentController.addUserScript(WKUserScript(source: """
            window._apiCallbacks = {};
            window._apiCallback = function(callId, result, err) {
                var cb = window._apiCallbacks[callId];
                if (cb) { delete window._apiCallbacks[callId]; cb(result, err); }
            };
            window.nativeFetch = function(url, apiKey, body) {
                return new Promise(function(resolve, reject) {
                    var callId = Math.random().toString(36).slice(2);
                    window._apiCallbacks[callId] = function(result, err) {
                        if (err) { reject(new Error(err)); return; }
                        if (result.status === 401) { reject(new Error('invalid x-api-key')); return; }
                        if (result.status !== 200) { reject(new Error('Erreur API ' + result.status)); return; }
                        try { resolve(JSON.parse(result.body)); }
                        catch(e) { reject(new Error('JSON invalide')); }
                    };
                    window.webkit.messageHandlers.nativeAPI.postMessage({
                        callId: callId, url: url, apiKey: apiKey, body: body
                    });
                });
            };
        """, injectionTime: .atDocumentStart, forMainFrameOnly: false))
        config.userContentController.addUserScript(WKUserScript(source: """
            document.documentElement.setAttribute('data-platform', 'mac');
        """, injectionTime: .atDocumentStart, forMainFrameOnly: false))

        window = NSWindow(
            contentRect: NSRect(x:0,y:0,width:1400,height:920),
            styleMask: [.titled,.closable,.miniaturizable,.resizable],
            backing: .buffered, defer: false)
        window.title = "Agenda"; window.setFrameAutosaveName("AgendaMainWindow")
        window.minSize = NSSize(width:860,height:600); window.center()
        window.titlebarAppearsTransparent = false
        window.titleVisibility = .visible
        window.toolbarStyle = .automatic
        window.isMovableByWindowBackground = false

        webView = WKWebView(frame: window.contentView!.bounds, configuration: config)
        webView.autoresizingMask = [.width,.height]
        webView.navigationDelegate = self; webView.uiDelegate = self
        window.contentView!.addSubview(webView)
        apiHandler.webView = webView

        loadPreferredApp()
        window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
    }

    func applicationWillTerminate(_ n: Notification) { server.stop() }
    func applicationShouldTerminateAfterLastWindowClosed(_ s: NSApplication) -> Bool { true }

    func webView(_ wv: WKWebView, decidePolicyFor a: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let allowedHosts = Set(["localhost", remoteAppURL.host].compactMap { $0 })
        if a.navigationType == .other { decisionHandler(.allow); return }
        if let url = a.request.url, (url.scheme=="https"||url.scheme=="http"), !allowedHosts.contains(url.host ?? "") {
            NSWorkspace.shared.open(url); decisionHandler(.cancel); return
        }
        decisionHandler(.allow)
    }
    func webView(_ wv: WKWebView, createWebViewWith c: WKWebViewConfiguration,
                 for a: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = a.request.url { NSWorkspace.shared.open(url) }; return nil
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        loadLocalFallback()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        loadLocalFallback()
    }
}

func buildMenu() -> NSMenu {
    let m = NSMenu()
    let ai = NSMenuItem(); m.addItem(ai)
    let am = NSMenu(); am.addItem(NSMenuItem(title:"Quitter Agenda",action:#selector(NSApplication.terminate(_:)),keyEquivalent:"q")); ai.submenu = am
    let ei = NSMenuItem(); m.addItem(ei)
    let em = NSMenu(title:"Édition")
    em.addItem(NSMenuItem(title:"Couper",  action:#selector(NSText.cut(_:)),      keyEquivalent:"x"))
    em.addItem(NSMenuItem(title:"Copier",  action:#selector(NSText.copy(_:)),     keyEquivalent:"c"))
    em.addItem(NSMenuItem(title:"Coller",  action:#selector(NSText.paste(_:)),    keyEquivalent:"v"))
    em.addItem(NSMenuItem(title:"Tout sélectionner",action:#selector(NSText.selectAll(_:)),keyEquivalent:"a"))
    ei.submenu = em
    return m
}

autoreleasepool {
    let app = NSApplication.shared; app.setActivationPolicy(.regular); app.mainMenu = buildMenu()
    let exe = URL(fileURLWithPath: CommandLine.arguments[0]).resolvingSymlinksInPath()
    let ico = exe.deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("Resources/AppIcon.icns")
    if let img = NSImage(contentsOfFile: ico.path) { app.applicationIconImage = img }
    let d = AppDelegate(); app.delegate = d; app.run()
}
