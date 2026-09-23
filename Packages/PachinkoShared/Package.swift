// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "PachinkoShared",
    platforms: [.iOS(.v26), .macOS(.v15)],
    products: [
        .library(name: "PachinkoShared", targets: ["PachinkoShared"]),
    ],
    dependencies: [
        .package(path: "../PachinkoCore"),
    ],
    targets: [
        .target(name: "PachinkoShared", dependencies: ["PachinkoCore"]),
    ]
)
