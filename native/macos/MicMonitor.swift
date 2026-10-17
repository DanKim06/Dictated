// mic-monitor: prints which processes are currently capturing audio input.
//
// macOS 14+ exposes Core Audio "process objects" with a per-process
// kAudioProcessPropertyIsRunningInput flag, which is exactly "is this app
// recording from a microphone right now". On older systems we can only ask
// whether any input device is running, and report that instead.
//
// Output (one JSON line):
//   {"perProcess":true,"micInUse":true,"processes":[{"bundleId":"us.zoom.xos","pid":123}]}

import CoreAudio
import Foundation

func address(_ selector: AudioObjectPropertySelector,
             _ scope: AudioObjectPropertyScope = kAudioObjectPropertyScopeGlobal) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress(mSelector: selector, mScope: scope, mElement: kAudioObjectPropertyElementMain)
}

func objectList(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) -> [AudioObjectID] {
    var addr = address(selector)
    var size: UInt32 = 0
    guard AudioObjectGetPropertyDataSize(object, &addr, 0, nil, &size) == noErr, size > 0 else { return [] }
    var ids = [AudioObjectID](repeating: 0, count: Int(size) / MemoryLayout<AudioObjectID>.size)
    guard AudioObjectGetPropertyData(object, &addr, 0, nil, &size, &ids) == noErr else { return [] }
    return ids
}

func uint32(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) -> UInt32? {
    var addr = address(selector)
    var value: UInt32 = 0
    var size = UInt32(MemoryLayout<UInt32>.size)
    return AudioObjectGetPropertyData(object, &addr, 0, nil, &size, &value) == noErr ? value : nil
}

func int32(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) -> Int32? {
    var addr = address(selector)
    var value: Int32 = 0
    var size = UInt32(MemoryLayout<Int32>.size)
    return AudioObjectGetPropertyData(object, &addr, 0, nil, &size, &value) == noErr ? value : nil
}

func string(_ object: AudioObjectID, _ selector: AudioObjectPropertySelector) -> String? {
    var addr = address(selector)
    var value: Unmanaged<CFString>?
    var size = UInt32(MemoryLayout<Unmanaged<CFString>?>.size)
    guard AudioObjectGetPropertyData(object, &addr, 0, nil, &size, &value) == noErr else { return nil }
    return value?.takeRetainedValue() as String?
}

func hasInputStreams(_ device: AudioObjectID) -> Bool {
    var addr = address(kAudioDevicePropertyStreams, kAudioObjectPropertyScopeInput)
    var size: UInt32 = 0
    return AudioObjectGetPropertyDataSize(device, &addr, 0, nil, &size) == noErr && size > 0
}

let system = AudioObjectID(kAudioObjectSystemObject)

// Any input device running counts as "the mic is in use".
let micInUse = objectList(system, kAudioHardwarePropertyDevices)
    .filter(hasInputStreams)
    .contains { uint32($0, kAudioDevicePropertyDeviceIsRunningSomewhere) == 1 }

var result: [String: Any] = ["perProcess": false, "micInUse": micInUse, "processes": []]

if #available(macOS 14.0, *) {
    let processes = objectList(system, kAudioHardwarePropertyProcessObjectList)
        .filter { uint32($0, kAudioProcessPropertyIsRunningInput) == 1 }
        .map { process -> [String: Any] in
            ["bundleId": string(process, kAudioProcessPropertyBundleID) ?? "",
             "pid": Int(int32(process, kAudioProcessPropertyPID) ?? -1)]
        }
        .filter { ($0["bundleId"] as? String)?.isEmpty == false }
    result["perProcess"] = true
    result["processes"] = processes
}

let data = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
FileHandle.standardOutput.write(data)
FileHandle.standardOutput.write("\n".data(using: .utf8)!)
