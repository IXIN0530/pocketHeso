import PachinkoShared
import SwiftUI
import WidgetKit

struct StatusEntry: TimelineEntry {
    let date: Date
}

struct StatusProvider: TimelineProvider {
    func placeholder(in context: Context) -> StatusEntry { StatusEntry(date: .now) }

    func getSnapshot(in context: Context, completion: @escaping (StatusEntry) -> Void) {
        completion(StatusEntry(date: .now))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<StatusEntry>) -> Void) {
        completion(Timeline(entries: [StatusEntry(date: .now)], policy: .never))
    }
}

struct StatusWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "StatusWidget", provider: StatusProvider()) { _ in
            Text(SharedVersion.string)
                .font(.caption2)
                .containerBackground(.fill.tertiary, for: .widget)
        }
        .configurationDisplayName("PocketHeso")
        .supportedFamilies([.systemSmall])
    }
}
