// swift-tools-version: 6.2
import PackageDescription

let package = Package(
    name: "PachinkoCore",
    platforms: [.macOS(.v15), .iOS(.v26)],
    products: [
        .library(name: "PachinkoCore", targets: ["PachinkoCore"]),
        .executable(name: "pachisim", targets: ["pachisim"]),
    ],
    targets: [
        .target(name: "PachinkoCore"),
        .executableTarget(name: "pachisim", dependencies: ["PachinkoCore"]),
        .testTarget(name: "PachinkoCoreTests", dependencies: ["PachinkoCore"]),
    ]
)
