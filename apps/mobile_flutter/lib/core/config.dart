/// App-wide configuration. The backend base URL is user-configurable (Settings)
/// so the same binary can point at production (Open edition) or a local dev
/// server. The value is persisted via [AppStorage]; this holds the defaults.
class AppConfig {
  AppConfig._();

  /// Default backend — the Open edition (email/password login).
  static const String defaultBaseUrl = 'https://mind.sayknow.ai';

  /// Common dev target, surfaced as a quick pick in Settings.
  static const String localBaseUrl = 'http://localhost:5400';

  /// Deep-link scheme registered as a trusted origin on the backend.
  static const String appScheme = 'sayknowmind';

  static const String appName = 'SayKnowMind';
}
