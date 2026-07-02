import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'config.dart';

/// Persistence: the session token in the OS keychain/keystore (secure), and
/// non-secret prefs (backend base URL, theme) in SharedPreferences.
class AppStorage {
  AppStorage(this._prefs);

  final SharedPreferences _prefs;
  static const _secure = FlutterSecureStorage(
    aOptions: AndroidOptions(encryptedSharedPreferences: true),
  );

  static const _kToken = 'session_token';
  static const _kBaseUrl = 'base_url';
  static const _kThemeMode = 'theme_mode'; // system | light | dark

  static Future<AppStorage> create() async =>
      AppStorage(await SharedPreferences.getInstance());

  // ---- session token (secure) ----
  Future<String?> readToken() => _secure.read(key: _kToken);
  Future<void> writeToken(String token) => _secure.write(key: _kToken, value: token);
  Future<void> clearToken() => _secure.delete(key: _kToken);

  // ---- backend base URL ----
  String get baseUrl => _prefs.getString(_kBaseUrl) ?? AppConfig.defaultBaseUrl;
  Future<void> setBaseUrl(String url) => _prefs.setString(_kBaseUrl, url.trim());

  // ---- theme ----
  String get themeMode => _prefs.getString(_kThemeMode) ?? 'system';
  Future<void> setThemeMode(String mode) => _prefs.setString(_kThemeMode, mode);
}
