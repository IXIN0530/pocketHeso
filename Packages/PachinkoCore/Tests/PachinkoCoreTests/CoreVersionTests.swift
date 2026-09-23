import Testing
@testable import PachinkoCore

@Test func versionIsNotEmpty() {
    #expect(!CoreVersion.string.isEmpty)
}
