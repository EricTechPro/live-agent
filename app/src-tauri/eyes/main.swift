// jett-eyes: Jett's screen helper. One command per run, one JSON line on stdout.
//
//   jett-eyes screen-ok                      {"ok":true|false}   Screen Recording granted?
//   jett-eyes request                        {"ok":...}          ask macOS (shows the prompt once)
//   jett-eyes state [--exclude-pid N]...     {"display":{x,y,w,h},"front":{app,bundleId,pid,title,bounds}|null}
//   jett-eyes shot [--max 1568] [--rect x,y,w,h] [--ink JSON] [--exclude-pid N]...
//        {"jpeg":"<base64>","width":..,"height":..,"origin":{x,y},"size":{w,h}}
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
import ScreenCaptureKit
import UniformTypeIdentifiers

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

@available(macOS 14.0, *)
func shot() async {
    let maxSide = Double(values("--max").first ?? "") ?? 1568
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
    if let wanted = values("--rect").first.flatMap(parseRect) {
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
    let image: CGImage
    do {
        image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
    } catch {
        fail("could not capture the screen: \(error.localizedDescription)")
    }
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
default:
    fail("usage: jett-eyes screen-ok | request | state | shot [--max N] [--rect x,y,w,h] [--ink JSON] [--exclude-pid N]")
}
