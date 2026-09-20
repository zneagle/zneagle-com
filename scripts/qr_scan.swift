// Decode QR codes in raster images with Apple's Vision and CoreImage detectors
// (the same stack the iPhone camera uses). Prints one tab-separated line per image.
// Usage: swift scripts/qr_scan.swift image1.png [image2.png ...]
import CoreImage
import Foundation
import Vision

var anyMissing = false
for path in CommandLine.arguments.dropFirst() {
    guard let image = CIImage(contentsOf: URL(fileURLWithPath: path)) else {
        print("\(path)\tLOAD_ERROR")
        anyMissing = true
        continue
    }
    let request = VNDetectBarcodesRequest()
    request.symbologies = [.qr]
    var vision: [String] = []
    do {
        try VNImageRequestHandler(ciImage: image, options: [:]).perform([request])
        vision = (request.results ?? []).compactMap { $0.payloadStringValue }
    } catch {
        vision = ["ERROR: \(error.localizedDescription)"]
    }
    let detector = CIDetector(ofType: CIDetectorTypeQRCode, context: nil,
                              options: [CIDetectorAccuracy: CIDetectorAccuracyHigh])
    let coreImage = (detector?.features(in: image) ?? []).compactMap { ($0 as? CIQRCodeFeature)?.messageString }
    if vision.isEmpty && coreImage.isEmpty { anyMissing = true }
    print("\(path)\tvision=\(vision)\tcoreimage=\(coreImage)")
}
exit(anyMissing ? 1 : 0)
