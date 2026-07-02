import 'dart:convert';

import 'package:dio/dio.dart';

import 'storage.dart';

/// Normalized API failure surfaced to the UI.
class ApiException implements Exception {
  ApiException(this.message, {this.statusCode, this.code, this.data});
  final String message;
  final int? statusCode;
  final Object? code; // backend code is sometimes numeric, sometimes a string
  final Object? data;

  bool get isUnauthorized => statusCode == 401;

  @override
  String toString() => message;
}

/// Thin Dio wrapper. Adds the bearer token + a real app User-Agent (the ingest
/// routes 403 bot-like UAs), points at the user-configured base URL, exposes
/// the `set-auth-token` header from auth responses, and supports raw streaming
/// for the SSE chat endpoint.
class ApiClient {
  ApiClient(this._storage) {
    _dio = Dio(BaseOptions(
      connectTimeout: const Duration(seconds: 20),
      receiveTimeout: const Duration(seconds: 60),
      headers: {'User-Agent': userAgent},
      // We validate status ourselves so non-2xx bodies (errors, 409 dup, 200
      // null session) are returned instead of thrown by Dio.
      validateStatus: (_) => true,
    ));
  }

  static const String userAgent = 'SayKnowMindMobile/1.0 (Flutter)';

  late final Dio _dio;
  final AppStorage _storage;

  /// Called when any request comes back 401 so the app can drop the session.
  void Function()? onUnauthorized;

  String get baseUrl => _storage.baseUrl;

  Future<Options> _options({bool json = true, String? accept}) async {
    final token = await _storage.readToken();
    return Options(headers: {
      if (json) 'Content-Type': 'application/json',
      if (accept != null) 'Accept': accept,
      if (token != null && token.isNotEmpty) 'Authorization': 'Bearer $token',
    });
  }

  Uri _uri(String path, [Map<String, dynamic>? query]) {
    final base = _storage.baseUrl.replaceAll(RegExp(r'/+$'), '');
    final cleaned = (query ?? {})
      ..removeWhere((_, v) => v == null || (v is String && v.isEmpty));
    return Uri.parse('$base$path').replace(
      queryParameters:
          cleaned.isEmpty ? null : cleaned.map((k, v) => MapEntry(k, '$v')),
    );
  }

  Never _throw(Response res) {
    final body = res.data;
    String message = 'Request failed (${res.statusCode})';
    Object? code;
    if (body is Map) {
      message = (body['message'] ?? body['error'] ?? message).toString();
      code = body['code'];
    }
    if (res.statusCode == 401) message = 'Session expired. Please sign in again.';
    throw ApiException(message,
        statusCode: res.statusCode, code: code, data: body);
  }

  void _check(Response res) {
    final ok = res.statusCode != null &&
        res.statusCode! >= 200 &&
        res.statusCode! < 300;
    if (res.statusCode == 401) {
      onUnauthorized?.call();
      _throw(res);
    }
    if (!ok) _throw(res);
  }

  Future<dynamic> get(String path, {Map<String, dynamic>? query}) async {
    final res = await _dio.getUri(_uri(path, query), options: await _options());
    _check(res);
    return res.data;
  }

  Future<dynamic> post(String path, {Object? body}) async {
    final res = await _dio.postUri(_uri(path),
        data: body == null ? null : jsonEncode(body), options: await _options());
    _check(res);
    return res.data;
  }

  Future<dynamic> patch(String path, {Object? body}) async {
    final res = await _dio.patchUri(_uri(path),
        data: jsonEncode(body ?? {}), options: await _options());
    _check(res);
    return res.data;
  }

  Future<dynamic> delete(String path, {Object? body}) async {
    final res = await _dio.deleteUri(_uri(path),
        data: body == null ? null : jsonEncode(body), options: await _options());
    _check(res);
    return res.data;
  }

  /// POST that returns the full Response (used by auth to read set-auth-token).
  Future<Response> postRaw(String path, {Object? body}) async {
    final res = await _dio.postUri(_uri(path),
        data: body == null ? null : jsonEncode(body), options: await _options());
    return res;
  }

  /// Multipart POST for file ingest.
  Future<dynamic> postMultipart(String path, FormData form) async {
    final token = await _storage.readToken();
    final res = await _dio.postUri(
      _uri(path),
      data: form,
      options: Options(headers: {
        if (token != null && token.isNotEmpty) 'Authorization': 'Bearer $token',
      }),
    );
    _check(res);
    return res.data;
  }

  /// Opens a streaming POST (SSE) and yields decoded text chunks.
  Future<Response<ResponseBody>> openStream(String path, {Object? body}) async {
    final token = await _storage.readToken();
    return _dio.postUri<ResponseBody>(
      _uri(path),
      data: body == null ? null : jsonEncode(body),
      options: Options(
        responseType: ResponseType.stream,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
          if (token != null && token.isNotEmpty) 'Authorization': 'Bearer $token',
        },
      ),
    );
  }

  /// Builds an absolute URL for an API-relative asset path (og images, files)
  /// so CachedNetworkImage can fetch it with the bearer header.
  String absolute(String relativeOrAbsolute) {
    if (relativeOrAbsolute.startsWith('http')) return relativeOrAbsolute;
    final base = _storage.baseUrl.replaceAll(RegExp(r'/+$'), '');
    return '$base$relativeOrAbsolute';
  }

  Future<Map<String, String>> authHeaders() async {
    final token = await _storage.readToken();
    return {
      'User-Agent': userAgent,
      if (token != null && token.isNotEmpty) 'Authorization': 'Bearer $token',
    };
  }
}
