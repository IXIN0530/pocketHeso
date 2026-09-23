// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "PachinkoPresentation",
    platforms: [.iOS(.v26), .macOS(.v15)],
    products: [
        .library(name: "PachinkoPresentation", targets: ["PachinkoPresentation"]),
    ],
    dependencies: [
        .package(path: "../PachinkoCore"),
        .package(path: "../PachinkoShared"),
    ],
    targets: [
        .target(name: "PachinkoPresentation", dependencies: ["PachinkoCore", "PachinkoShared"]),
    ]
)
