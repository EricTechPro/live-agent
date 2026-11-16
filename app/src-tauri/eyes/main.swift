// jett-eyes: Jett's screen helper. One command per run, one JSON line on stdout.
//
//   jett-eyes screen-ok                      {"ok":true|false}   Screen Recording granted?
//   jett-eyes request                        {"ok":...}          ask macOS (shows the prompt once)
//   jett-eyes state [--exclude-pid N]...     {"display":{x,y,w,h},"front":{app,bundleId,pid,title,bounds}|null}
//   jett-eyes shot [--max 1568] [--rect x,y,w,h] [--ink JSON] [--exclude-pid N]...
//        {"jpeg":"<base64>","width":..,"height":..,"origin":{x,y},"size":{w,h}}
//   jett-eyes watch [--exclude-pid N]...     JSON lines until stdin closes: {"front":..}, {"scroll":{x,y}}, {"click":{x,y}}
//   jett-eyes ax-ok | ax-request             {"ok":...}          Accessibility granted? (request shows macOS's prompt)
//   jett-eyes ax-find --text T [--pid N]     {"trusted","matches":[{label,role,frame,exact}],"window"}
//   jett-eyes ax-controls [--pid N]          {"trusted","controls":[{role,label?,frame}],"texts":[{frame}],"window"}
//   jett-eyes ocr [--rect x,y,w,h] [--text T] [--accurate]   {"lines":[{text,frame,confidence,match?}],"area"}
//
// Coordinates are global points, top-left origin, main display at 0,0. `shot` captures the
// main display with ScreenCaptureKit, leaving out Jett's own app (bundle id or --exclude-pid)
// and the pointer, shrinks the long side to --max, and draws --ink (loops of [x,y] points)
// on it in teal so the model sees what was circled.
//
// It runs as a child of the core, which runs as a child of Jett.app, so macOS asks for
// Screen Recording on behalf of Jett. Errors: {"error":"..."} and exit 1 (2 = no permission).
import AppKit
import CoreGraphics
import Foundation
import ImageIO
import ApplicationServices
import ScreenCaptureKit
import UniformTypeIdentifiers
import Vision

let jettBundleId = "dev.liveagent.app"

func emit(_ value: Any) {
    let data = try! JSONSerialization.data(withJSONObject: value, options: [])
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write("\n".data(using: .utf8)!)
}

func fail(_ message: String, code: Int32 = 1) -> Never {
    emit(["error": message])
    exit(code)
}

let args = Array(CommandLine.arguments.dropFirst())
let command = args.first ?? ""

func values(_ flag: String) -> [String] {
    var out: [String] = []
    var i = 0
    while i < args.count {
        if args[i] == flag, i + 1 < args.count { out.append(args[i + 1]); i += 1 }
        i += 1
    }
    return out
}

let excludePids = Set(values("--exclude-pid").compactMap { Int32($0) })

func isJett(pid: Int32, bundleId: String?) -> Bool {
    excludePids.contains(pid) || bundleId == jettBundleId || pid == getpid()
}

func rectJSON(_ r: CGRect) -> [String: Double] {
    ["x": Double(r.origin.x), "y": Double(r.origin.y), "w": Double(r.width), "h": Double(r.height)]
}

// ---- state: the main display and the window the user is working in ----

func frontWindow() -> [String: Any]? {
    let opts: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
    guard let list = CGWindowListCopyWindowInfo(opts, kCGNullWindowID) as? [[String: Any]] else { return nil }
    let frontPid = NSWorkspace.shared.frontmostApplication?.processIdentifier
    var candidates: [[String: Any]] = []
    for info in list {
        guard (info[kCGWindowLayer as String] as? Int) == 0,
              let pid = info[kCGWindowOwnerPID as String] as? Int32,
              let boundsDict = info[kCGWindowBounds as String] as? NSDictionary,
              let bounds = CGRect(dictionaryRepresentation: boundsDict),
              bounds.width >= 80, bounds.height >= 60,
              (info[kCGWindowAlpha as String] as? Double ?? 1) > 0
        else { continue }
        let app = NSRunningApplication(processIdentifier: pid)
        if isJett(pid: pid, bundleId: app?.bundleIdentifier) { continue }
        var entry: [String: Any] = [
            "app": (info[kCGWindowOwnerName as String] as? String) ?? app?.localizedName ?? "unknown",
            "pid": Int(pid),
            "bounds": rectJSON(bounds),
        ]
        if let id = app?.bundleIdentifier { entry["bundleId"] = id }
        if let number = info[kCGWindowNumber as String] as? Int { entry["windowId"] = number }
        // Window titles need Screen Recording; without it the field is just missing.
        if let title = info[kCGWindowName as String] as? String, !title.isEmpty { entry["title"] = title }
        candidates.append(entry)
    }
    // The frontmost app's top window, unless the frontmost app is Jett (quick type has the
    // keyboard): then the topmost window of anyone else.
    if let front = frontPid, let hit = candidates.first(where: { ($0["pid"] as? Int) == Int(front) }) { return hit }
    return candidates.first
}

// ---- shot ----

func parseRect(_ s: String) -> CGRect? {
    let n = s.split(separator: ",").compactMap { Double($0.trimmingCharacters(in: .whitespaces)) }
    guard n.count == 4, n[2] > 0, n[3] > 0 else { return nil }
    return CGRect(x: n[0], y: n[1], width: n[2], height: n[3])
}

func parseInk(_ s: String) -> [[CGPoint]] {
    guard let data = s.data(using: .utf8),
          let loops = try? JSONSerialization.jsonObject(with: data) as? [[[Double]]] else { return [] }
    return loops.map { $0.compactMap { $0.count >= 2 ? CGPoint(x: $0[0], y: $0[1]) : nil } }
}

func fit(_ w: Double, _ h: Double, _ maxSide: Double) -> (Int, Int) {
    let scale = min(1, maxSide / max(w, h))
    return (max(1, Int((w * scale).rounded())), max(1, Int((h * scale).rounded())))
}

/// Draw the loops (global points) on the image, mapped through origin/size -> pixels.
func drawInk(on image: CGImage, loops: [[CGPoint]], origin: CGPoint, size: CGSize) -> CGImage {
    let w = image.width, h = image.height
    guard !loops.isEmpty,
          let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0,
                              space: CGColorSpaceCreateDeviceRGB(),
                              bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
    else { return image }
    ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
    let sx = Double(w) / Double(size.width), sy = Double(h) / Double(size.height)
    // CoreGraphics draws bottom-up; our points are top-down.
    func px(_ p: CGPoint) -> CGPoint {
        CGPoint(x: (p.x - origin.x) * sx, y: Double(h) - (p.y - origin.y) * sy)
    }
    ctx.setStrokeColor(CGColor(red: 0.18, green: 0.83, blue: 0.75, alpha: 0.95))
    ctx.setLineWidth(max(3, 3.5 * sx))
    ctx.setLineCap(.round)
    ctx.setLineJoin(.round)
    for loop in loops where loop.count > 1 {
        ctx.beginPath()
        ctx.move(to: px(loop[0]))
        for p in loop.dropFirst() { ctx.addLine(to: px(p)) }
        ctx.strokePath()
    }
    return ctx.makeImage() ?? image
}

func jpeg(_ image: CGImage, quality: Double = 0.85) -> Data? {
    let data = NSMutableData()
    guard let dest = CGImageDestinationCreateWithData(data, UTType.jpeg.identifier as CFString, 1, nil) else { return nil }
    CGImageDestinationAddImage(dest, image, [kCGImageDestinationLossyCompressionQuality: quality] as CFDictionary)
    return CGImageDestinationFinalize(dest) ? data as Data : nil
}

/// Capture `wanted` (global points, default the whole main display), Jett's windows and the
/// pointer left out, at most `maxSide` pixels on the long side. Exits on failure.
@available(macOS 14.0, *)
func capture(_ wanted: CGRect?, maxSide: Double) async -> (CGImage, CGRect) {
    let content: SCShareableContent
    do {
        content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
    } catch {
        fail("Screen Recording is off for Jett: \(error.localizedDescription)", code: 2)
    }
    let mainId = CGMainDisplayID()
    guard let display = content.displays.first(where: { $0.displayID == mainId }) ?? content.displays.first else {
        fail("no display to capture")
    }
    let screen = CGDisplayBounds(display.displayID) // global points
    var area = screen
    if let wanted {
        area = wanted.intersection(screen)
        if area.isNull || area.width < 1 || area.height < 1 { fail("that area is not on the main screen") }
    }
    let ours = content.applications.filter { isJett(pid: $0.processID, bundleId: $0.bundleIdentifier) }
    let filter = SCContentFilter(display: display, excludingApplications: ours, exceptingWindows: [])
    let config = SCStreamConfiguration()
    config.showsCursor = false
    config.sourceRect = CGRect(x: area.minX - screen.minX, y: area.minY - screen.minY, width: area.width, height: area.height)
    let scale = Double(filter.pointPixelScale)
    let (pw, ph) = fit(area.width * scale, area.height * scale, maxSide)
    config.width = pw
    config.height = ph
    do {
        return (try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config), area)
    } catch {
        fail("could not capture the screen: \(error.localizedDescription)")
    }
}

@available(macOS 14.0, *)
func shot() async {
    let maxSide = Double(values("--max").first ?? "") ?? 1568
    let (image, area) = await capture(values("--rect").first.flatMap(parseRect), maxSide: maxSide)
    let inked = drawInk(on: image, loops: parseInk(values("--ink").first ?? ""), origin: area.origin, size: area.size)
    guard let data = jpeg(inked) else { fail("could not encode the screenshot") }
    emit([
        "jpeg": data.base64EncodedString(),
        "width": inked.width,
        "height": inked.height,
        "origin": ["x": Double(area.minX), "y": Double(area.minY)],
        "size": ["w": Double(area.width), "h": Double(area.height)],
    ])
}

// ---- watch: what changes on screen while Jett's marks are up ----
//
// Runs until stdin closes (the core went away). Every 200 ms: the front window (a line when
// its app, id, bounds or title change), and macOS's own event counters for scrolls and
// clicks (CGEventSourceCounterForEventType, no Input Monitoring or Accessibility needed),
// each with where the pointer was.

func watch() -> Never {
    Thread.detachNewThread {
        while !FileHandle.standardInput.availableData.isEmpty {}
        exit(0)
    }
    let src = CGEventSourceStateID.combinedSessionState
    func count(_ types: [CGEventType]) -> UInt32 {
        types.reduce(0) { $0 &+ CGEventSource.counterForEventType(src, eventType: $1) }
    }
    func pointer() -> [String: Double] {
        let p = CGEvent(source: nil)?.location ?? .zero
        return ["x": Double(p.x), "y": Double(p.y)]
    }
    var lastFront = ""
    var scrolls = count([.scrollWheel])
    var clicks = count([.leftMouseDown, .rightMouseDown])
    while true {
        let front: Any = frontWindow() ?? NSNull()
        if let data = try? JSONSerialization.data(withJSONObject: ["front": front], options: [.sortedKeys]),
           let text = String(data: data, encoding: .utf8), text != lastFront {
            lastFront = text
            emit(["front": front])
        }
        let s = count([.scrollWheel]), c = count([.leftMouseDown, .rightMouseDown])
        if s != scrolls { scrolls = s; emit(["scroll": pointer()]) }
        if c != clicks { clicks = c; emit(["click": pointer()]) }
        if getppid() == 1 { exit(0) }
        usleep(200_000)
    }
}

// ---- Accessibility: find real controls by their words ----
//
// Walks the AX tree of the front app's front window (breadth first, bounded in nodes and
// time). Chromium and Electron only build their tree when asked (AXManualAccessibility).
// Frames are global points, the same space as everything else here.

func axTrusted(prompt: Bool) -> Bool {
    let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
    return AXIsProcessTrustedWithOptions([key: prompt] as CFDictionary)
}

func axAttr(_ el: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    return AXUIElementCopyAttributeValue(el, name as CFString, &value) == .success ? value : nil
}

func axString(_ el: AXUIElement, _ name: String) -> String? {
    guard let s = axAttr(el, name) as? String else { return nil }
    let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
    return t.isEmpty ? nil : t
}

func axFrame(_ el: AXUIElement) -> CGRect? {
    guard let p = axAttr(el, kAXPositionAttribute), let s = axAttr(el, kAXSizeAttribute),
          CFGetTypeID(p) == AXValueGetTypeID(), CFGetTypeID(s) == AXValueGetTypeID() else { return nil }
    var point = CGPoint.zero, size = CGSize.zero
    AXValueGetValue(p as! AXValue, .cgPoint, &point)
    AXValueGetValue(s as! AXValue, .cgSize, &size)
    return CGRect(origin: point, size: size)
}

let controlRoles: Set<String> = [
    "AXButton", "AXLink", "AXTextField", "AXTextArea", "AXCheckBox", "AXRadioButton", "AXPopUpButton",
    "AXMenuButton", "AXComboBox", "AXSlider", "AXTab", "AXSearchField", "AXDisclosureTriangle",
    "AXIncrementor", "AXMenuBarItem", "AXSegmentedControl", "AXToggle", "AXSwitch", "AXCell", "AXRow",
]

func norm(_ s: String) -> String {
    s.lowercased().replacingOccurrences(of: "…", with: "").split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
        .trimmingCharacters(in: CharacterSet(charactersIn: ".:,;!?"))
}

struct AxNode { let el: AXUIElement; let control: (role: String, frame: CGRect)? ; let depth: Int }

/// The front app's front window as an AX element, plus its pid and frame.
func axFrontWindow() -> (AXUIElement, CGRect)? {
    let pid: Int32
    if let p = values("--pid").first.flatMap({ Int32($0) }) { pid = p }
    else if let f = frontWindow(), let p = f["pid"] as? Int { pid = Int32(p) }
    else { return nil }
    let app = AXUIElementCreateApplication(pid)
    AXUIElementSetMessagingTimeout(app, 0.5)
    // Chromium / Electron: build the tree now. Harmless elsewhere.
    AXUIElementSetAttributeValue(app, "AXManualAccessibility" as CFString, kCFBooleanTrue)
    let bundle = NSRunningApplication(processIdentifier: pid)?.bundleIdentifier ?? ""
    if bundle.hasPrefix("com.google.Chrome") || bundle == "com.brave.Browser" || bundle == "com.microsoft.edgemac" {
        AXUIElementSetAttributeValue(app, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue)
    }
    let wanted = frontWindow().flatMap { ($0["bounds"] as? [String: Double]) }
        .map { CGRect(x: $0["x"]!, y: $0["y"]!, width: $0["w"]!, height: $0["h"]!) }
    var windows: [AXUIElement] = []
    if let list = axAttr(app, kAXWindowsAttribute) as? [AXUIElement] { windows = list }
    if let focused = axAttr(app, kAXFocusedWindowAttribute), CFGetTypeID(focused) == AXUIElementGetTypeID() {
        windows.insert(focused as! AXUIElement, at: 0)
    }
    // The AX window whose frame is the front window's (the window list and AX agree on points).
    if let wanted, let hit = windows.first(where: { axFrame($0).map { abs($0.minX - wanted.minX) < 4 && abs($0.minY - wanted.minY) < 4 } ?? false }) {
        return (hit, axFrame(hit) ?? wanted)
    }
    guard let first = windows.first else { return nil }
    return (first, axFrame(first) ?? .zero)
}

/// Walk the window: every visible element, with its nearest control ancestor.
func axWalk(_ window: AXUIElement, frame: CGRect, visit: (AXUIElement, String, CGRect, (role: String, frame: CGRect)?) -> Void) -> (nodes: Int, truncated: Bool) {
    var queue = [AxNode(el: window, control: nil, depth: 0)]
    var head = 0
    let started = Date()
    let maxNodes = 9000
    while head < queue.count {
        if head >= maxNodes || Date().timeIntervalSince(started) > 2.5 { return (head, true) }
        let node = queue[head]
        head += 1
        let role = axString(node.el, kAXRoleAttribute) ?? ""
        let rect = axFrame(node.el)
        var control = node.control
        if let rect, rect.width >= 4, rect.height >= 4, rect.intersects(frame) {
            visit(node.el, role, rect, node.control)
            if controlRoles.contains(role) { control = (role, rect) }
        }
        if node.depth > 60 { continue }
        if let kids = axAttr(node.el, kAXChildrenAttribute) as? [AXUIElement] {
            for kid in kids { queue.append(AxNode(el: kid, control: control, depth: node.depth + 1)) }
        }
    }
    return (head, false)
}

func axLabels(_ el: AXUIElement) -> [String] {
    [kAXTitleAttribute, kAXDescriptionAttribute, kAXValueAttribute, "AXPlaceholderValue", kAXHelpAttribute]
        .compactMap { axString(el, $0) }
        .filter { $0.count <= 200 }
}

func axFind() {
    guard axTrusted(prompt: false) else { emit(["trusted": false, "matches": []]); exit(0) }
    let query = norm(values("--text").first ?? "")
    guard !query.isEmpty else { fail("ax-find needs --text") }
    guard let (window, frame) = axFrontWindow() else { emit(["trusted": true, "matches": []]); exit(0) }
    var matches: [[String: Any]] = []
    var seen = Set<String>()
    var walk = axWalk(window, frame: frame) { el, role, rect, parent in
        for label in axLabels(el) {
            let l = norm(label)
            guard l == query || l.contains(query) else { continue }
            // Words inside a control (a button's text): the control is the thing.
            let use = (role == "AXStaticText" || role == "AXImage") && parent != nil ? parent! : (role, rect)
            let key = "\(Int(use.1.minX)),\(Int(use.1.minY)),\(Int(use.1.width)),\(Int(use.1.height))"
            if seen.contains(key) { break }
            seen.insert(key)
            matches.append(["label": label, "role": use.0, "frame": rectJSON(use.1), "exact": l == query])
            break
        }
    }
    // A Chromium tree just switched on builds a moment later: one more try.
    if matches.isEmpty && walk.nodes < 40 {
        usleep(400_000)
        walk = axWalk(window, frame: frame) { el, role, rect, parent in
            for label in axLabels(el) where norm(label) == query || norm(label).contains(query) {
                let use = (role == "AXStaticText" || role == "AXImage") && parent != nil ? parent! : (role, rect)
                matches.append(["label": label, "role": use.0, "frame": rectJSON(use.1), "exact": norm(label) == query])
                break
            }
        }
    }
    emit(["trusted": true, "matches": Array(matches.prefix(30)), "window": rectJSON(frame), "nodes": walk.nodes, "truncated": walk.truncated])
}

func axControls() {
    guard axTrusted(prompt: false) else { emit(["trusted": false, "controls": []]); exit(0) }
    guard let (window, frame) = axFrontWindow() else { emit(["trusted": true, "controls": []]); exit(0) }
    var controls: [[String: Any]] = []
    var texts: [[String: Any]] = []
    let walk = axWalk(window, frame: frame) { el, role, rect, _ in
        if controlRoles.contains(role), rect.width < frame.width * 0.9 || rect.height < frame.height * 0.9 {
            var entry: [String: Any] = ["role": role, "frame": rectJSON(rect)]
            if let label = axLabels(el).first { entry["label"] = label }
            controls.append(entry)
        } else if role == "AXStaticText", texts.count < 600 {
            texts.append(["frame": rectJSON(rect)])
        }
    }
    emit(["trusted": true, "controls": Array(controls.prefix(800)), "texts": texts, "window": rectJSON(frame), "nodes": walk.nodes])
}

// ---- OCR: on-device Vision text with boxes ----
//
// Recognises the text in an area (default the front window) and returns every line with its
// box in global points; with --text, a line holding those words as whole words also gets the
// box of just those words.

func wholeWordRange(_ hay: String, _ needle: String) -> Range<String.Index>? {
    var from = hay.startIndex
    while let r = hay.range(of: needle, options: [.caseInsensitive], range: from..<hay.endIndex) {
        let before = r.lowerBound == hay.startIndex ? nil : hay[hay.index(before: r.lowerBound)]
        let after = r.upperBound == hay.endIndex ? nil : hay[r.upperBound]
        let edge = { (c: Character?) in c == nil || !(c!.isLetter || c!.isNumber) }
        if edge(before) && edge(after) { return r }
        from = r.upperBound
    }
    return nil
}

@available(macOS 14.0, *)
func ocr() async {
    var wanted = values("--rect").first.flatMap(parseRect)
    if wanted == nil, let b = frontWindow()?["bounds"] as? [String: Double] {
        wanted = CGRect(x: b["x"]!, y: b["y"]!, width: b["w"]!, height: b["h"]!)
    }
    let (image, area) = await capture(wanted, maxSide: 4096)
    let query = (values("--text").first ?? "").trimmingCharacters(in: .whitespaces)
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = args.contains("--accurate") ? .accurate : .fast
    request.usesLanguageCorrection = args.contains("--accurate")
    do {
        try VNImageRequestHandler(cgImage: image, options: [:]).perform([request])
    } catch {
        fail("could not read the text: \(error.localizedDescription)")
    }
    // Vision boxes are 0-1 with the origin bottom left; ours are points, top left.
    func toPoints(_ b: CGRect) -> CGRect {
        CGRect(x: area.minX + b.minX * area.width, y: area.minY + (1 - b.maxY) * area.height,
               width: b.width * area.width, height: b.height * area.height)
    }
    var lines: [[String: Any]] = []
    for observation in request.results ?? [] {
        guard let best = observation.topCandidates(1).first else { continue }
        var line: [String: Any] = ["text": best.string, "frame": rectJSON(toPoints(observation.boundingBox)), "confidence": Double(best.confidence)]
        if !query.isEmpty, let r = wholeWordRange(best.string, query),
           let box = try? best.boundingBox(for: r) {
            line["match"] = rectJSON(toPoints(box.boundingBox))
        }
        lines.append(line)
    }
    emit(["lines": Array(lines.prefix(800)), "area": rectJSON(area)])
}

switch command {
case "screen-ok":
    emit(["ok": CGPreflightScreenCaptureAccess()])
case "request":
    emit(["ok": CGRequestScreenCaptureAccess()])
case "state":
    var out: [String: Any] = ["display": rectJSON(CGDisplayBounds(CGMainDisplayID()))]
    out["front"] = frontWindow() ?? NSNull()
    emit(out)
case "shot":
    guard CGPreflightScreenCaptureAccess() else { fail("Screen Recording is off for Jett", code: 2) }
    if #available(macOS 14.0, *) {
        await shot()
    } else {
        fail("seeing the screen needs macOS 14 or newer")
    }
case "watch":
    watch()
case "ax-ok":
    emit(["ok": axTrusted(prompt: false)])
case "ax-request":
    emit(["ok": axTrusted(prompt: true)])
case "ax-find":
    axFind()
case "ax-controls":
    axControls()
case "ocr":
    guard CGPreflightScreenCaptureAccess() else { fail("Screen Recording is off for Jett", code: 2) }
    if #available(macOS 14.0, *) {
        await ocr()
    } else {
        fail("reading the screen needs macOS 14 or newer")
    }
default:
    fail("usage: jett-eyes screen-ok | request | state | shot [--max N] [--rect x,y,w,h] [--ink JSON] [--exclude-pid N]")
}
