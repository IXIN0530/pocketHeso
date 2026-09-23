import PachinkoPresentation
import SwiftUI

struct ContentView: View {
    var body: some View {
        VStack(spacing: 8) {
            Text("PocketHeso").font(.title)
            Text(PresentationVersion.string).font(.caption).foregroundStyle(.secondary)
        }
        .padding()
    }
}
