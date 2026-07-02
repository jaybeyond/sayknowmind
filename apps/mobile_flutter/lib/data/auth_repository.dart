import 'package:dio/dio.dart';

import '../core/api_client.dart';
import '../core/storage.dart';
import '../models/app_user.dart';

class AuthRepository {
  AuthRepository(this._api, this._storage);
  final ApiClient _api;
  final AppStorage _storage;

  Future<AppUser> signIn(String email, String password) async {
    final res = await _api.postRaw('/api/auth/sign-in/email', body: {
      'email': email.trim(),
      'password': password,
      'rememberMe': true,
    });
    return _completeAuth(res);
  }

  Future<AppUser> signUp(String name, String email, String password) async {
    final res = await _api.postRaw('/api/auth/sign-up/email', body: {
      'name': name.trim(),
      'email': email.trim(),
      'password': password,
    });
    return _completeAuth(res);
  }

  Future<AppUser> _completeAuth(Response res) async {
    final status = res.statusCode ?? 0;
    final body = res.data;
    if (status < 200 || status >= 300) {
      final msg = body is Map
          ? (body['message'] ?? body['error'] ?? 'Sign in failed').toString()
          : 'Sign in failed';
      throw ApiException(msg, statusCode: status, data: body);
    }
    final token = (res.headers.value('set-auth-token')) ??
        (body is Map ? body['token']?.toString() : null);
    if (token == null || token.isEmpty) {
      throw ApiException('No session token returned by the server.',
          statusCode: status);
    }
    await _storage.writeToken(token);
    final user = (body is Map ? body['user'] : null) as Map?;
    final base = AppUser.fromSession((user ?? {}).cast<String, dynamic>());
    return _enrich(base);
  }

  /// Validates the stored token. Returns null when there is no valid session
  /// (better-auth returns HTTP 200 with a null body in that case).
  Future<AppUser?> currentUser() async {
    final token = await _storage.readToken();
    if (token == null || token.isEmpty) return null;
    try {
      final data = await _api.get('/api/auth/get-session');
      if (data == null || data is! Map) return null;
      final user = (data['user'] as Map?)?.cast<String, dynamic>();
      if (user == null) return null;
      final session = (data['session'] as Map?)?.cast<String, dynamic>();
      final base = AppUser.fromSession(user,
          activeOrg: session?['activeOrganizationId']?.toString());
      return _enrich(base);
    } on ApiException catch (e) {
      if (e.isUnauthorized) {
        await _storage.clearToken();
        return null;
      }
      rethrow;
    }
  }

  /// Pulls app-level profile fields (locale, image) not on the better-auth user.
  Future<AppUser> _enrich(AppUser base) async {
    try {
      final me = await _api.get('/api/user/me');
      if (me is Map) {
        return AppUser(
          id: '${me['id'] ?? base.id}',
          name: '${me['name'] ?? base.name}',
          email: '${me['email'] ?? base.email}',
          image: (me['image'] as String?) ?? base.image,
          locale: me['locale'] as String?,
          activeOrganizationId: base.activeOrganizationId,
        );
      }
    } catch (_) {
      // /api/user/me is best-effort enrichment; the session user is enough.
    }
    return base;
  }

  Future<void> signOut() async {
    try {
      await _api.post('/api/auth/sign-out');
    } catch (_) {
      // Sign-out is idempotent server-side; always clear locally.
    }
    await _storage.clearToken();
  }
}
