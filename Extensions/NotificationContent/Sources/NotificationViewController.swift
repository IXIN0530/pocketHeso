import PachinkoPresentation
import UIKit
import UserNotifications
import UserNotificationsUI

final class NotificationViewController: UIViewController, UNNotificationContentExtension {
    private let label = UILabel()

    override func viewDidLoad() {
        super.viewDidLoad()
        label.text = PresentationVersion.string
        label.numberOfLines = 0
        label.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(label)
        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            label.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            label.widthAnchor.constraint(lessThanOrEqualTo: view.widthAnchor, constant: -16),
        ])
        preferredContentSize = CGSize(width: 0, height: 120)
    }

    func didReceive(_ notification: UNNotification) {
        label.text = notification.request.content.body
    }
}
