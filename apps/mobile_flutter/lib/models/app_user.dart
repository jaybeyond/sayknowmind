/// Authenticated user (better-auth user merged with /api/user/me profile).
class AppUser {
  AppUser({
    required this.id,
    required this.name,
    required this.email,
    this.image,
    this.locale,
    this.activeOrganizationId,
  });

  final String id;
  final String name;
  final String email;
  final String? image;
  final String? locale;
  final String? activeOrganizationId;

  String get initials {
    final base = name.trim().isNotEmpty ? name.trim() : email;
    final parts = base.split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
    if (parts.isEmpty) return '?';
    if (parts.length == 1) return parts.first.substring(0, 1).toUpperCase();
    return (parts.first.substring(0, 1) + parts.last.substring(0, 1)).toUpperCase();
  }

  factory AppUser.fromSession(Map<String, dynamic> user, {String? activeOrg}) =>
      AppUser(
        id: '${user['id']}',
        name: '${user['name'] ?? ''}',
        email: '${user['email'] ?? ''}',
        image: user['image'] as String?,
        activeOrganizationId: activeOrg,
      );
}
