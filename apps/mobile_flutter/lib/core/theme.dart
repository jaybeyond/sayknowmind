import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// SayKnowMind design system, ported from the web app's shadcn/ui tokens
/// (apps/web/app/globals.css). OKLCH source values were converted to sRGB.
///
/// Light mode  → navy primary (#000051 family), near-white surfaces.
/// Dark mode   → monochrome silver/white on near-black (matches the logo).
/// Brand accent → cyan #00E5FF (the splash/brand spark), used sparingly for
/// the FAB, active nav, and links — the neutral palette stays the base.
class AppColors {
  AppColors._();

  /// Brand accent — the one non-neutral color, used the way the web uses it.
  static const Color brandCyan = Color(0xFF00E5FF);

  // ---- Light ----
  static const lBackground = Color(0xFFF8F8F8);
  static const lForeground = Color(0xFF03060D);
  static const lCard = Color(0xFFFFFFFF);
  static const lPrimary = Color(0xFF010145); // navy
  static const lPrimaryFg = Color(0xFFFFFFFF);
  static const lSecondary = Color(0xFFE8EBF2);
  static const lMuted = Color(0xFFE9EBEF);
  static const lMutedFg = Color(0xFF535864);
  static const lAccent = Color(0xFFE8EBF2);
  static const lDestructive = Color(0xFFDF2225);
  static const lBorder = Color(0xFFD4D7DE);
  static const lSidebar = Color(0xFFF3F5F9);

  // ---- Dark (monochrome) ----
  static const dBackground = Color(0xFF0A0A0A); // brand near-black
  static const dForeground = Color(0xFFEDEDED);
  static const dCard = Color(0xFF161616);
  static const dPrimary = Color(0xFFC4C4C4); // silver
  static const dPrimaryFg = Color(0xFF0A0A0A);
  static const dSecondary = Color(0xFF1C1C1C);
  static const dMuted = Color(0xFF1C1C1C);
  static const dMutedFg = Color(0xFF8C8C8C);
  static const dAccent = Color(0xFF242424);
  static const dDestructive = Color(0xFFFF6367);
  static const dBorder = Color(0x1AFFFFFF); // white @10%
  static const dSidebar = Color(0xFF0D0D0D);
}

/// 0.625rem base radius from the web (--radius), in logical px.
const double kRadius = 10;
const double kRadiusSm = 6;
const double kRadiusLg = 14;
const double kRadiusXl = 18;

class AppTheme {
  AppTheme._();

  static ThemeData light() => _build(
        brightness: Brightness.light,
        background: AppColors.lBackground,
        foreground: AppColors.lForeground,
        card: AppColors.lCard,
        primary: AppColors.lPrimary,
        primaryFg: AppColors.lPrimaryFg,
        secondary: AppColors.lSecondary,
        muted: AppColors.lMuted,
        mutedFg: AppColors.lMutedFg,
        border: AppColors.lBorder,
        destructive: AppColors.lDestructive,
      );

  static ThemeData dark() => _build(
        brightness: Brightness.dark,
        background: AppColors.dBackground,
        foreground: AppColors.dForeground,
        card: AppColors.dCard,
        primary: AppColors.dPrimary,
        primaryFg: AppColors.dPrimaryFg,
        secondary: AppColors.dSecondary,
        muted: AppColors.dMuted,
        mutedFg: AppColors.dMutedFg,
        border: AppColors.dBorder,
        destructive: AppColors.dDestructive,
      );

  static ThemeData _build({
    required Brightness brightness,
    required Color background,
    required Color foreground,
    required Color card,
    required Color primary,
    required Color primaryFg,
    required Color secondary,
    required Color muted,
    required Color mutedFg,
    required Color border,
    required Color destructive,
  }) {
    final scheme = ColorScheme(
      brightness: brightness,
      primary: primary,
      onPrimary: primaryFg,
      secondary: secondary,
      onSecondary: foreground,
      tertiary: AppColors.brandCyan,
      onTertiary: const Color(0xFF002328),
      error: destructive,
      onError: Colors.white,
      surface: card,
      onSurface: foreground,
      surfaceContainerHighest: muted,
      onSurfaceVariant: mutedFg,
      outline: border,
      outlineVariant: border,
    );

    final baseText = GoogleFonts.interTextTheme(
      ThemeData(brightness: brightness).textTheme,
    ).apply(bodyColor: foreground, displayColor: foreground);

    // Headings use Space Grotesk (the web's --font-heading).
    final headingFont = GoogleFonts.spaceGrotesk(color: foreground);
    final textTheme = baseText.copyWith(
      displayLarge: baseText.displayLarge?.merge(headingFont),
      displayMedium: baseText.displayMedium?.merge(headingFont),
      displaySmall: baseText.displaySmall?.merge(headingFont),
      headlineLarge: baseText.headlineLarge?.merge(headingFont),
      headlineMedium: baseText.headlineMedium?.merge(headingFont),
      headlineSmall: baseText.headlineSmall?.merge(headingFont),
      titleLarge: baseText.titleLarge?.merge(headingFont),
    );

    return ThemeData(
      useMaterial3: true,
      brightness: brightness,
      colorScheme: scheme,
      scaffoldBackgroundColor: background,
      canvasColor: background,
      textTheme: textTheme,
      dividerTheme: DividerThemeData(color: border, thickness: 1, space: 1),
      appBarTheme: AppBarTheme(
        backgroundColor: background,
        foregroundColor: foreground,
        elevation: 0,
        scrolledUnderElevation: 0.5,
        surfaceTintColor: Colors.transparent,
        centerTitle: false,
        titleTextStyle: GoogleFonts.spaceGrotesk(
          color: foreground,
          fontSize: 20,
          fontWeight: FontWeight.w600,
        ),
      ),
      cardTheme: CardThemeData(
        color: card,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(kRadiusLg),
          side: BorderSide(color: border),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: card,
        hintStyle: TextStyle(color: mutedFg),
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(kRadius),
          borderSide: BorderSide(color: border),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(kRadius),
          borderSide: BorderSide(color: border),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(kRadius),
          borderSide: BorderSide(color: primary, width: 1.5),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: primary,
          foregroundColor: primaryFg,
          minimumSize: const Size.fromHeight(50),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(kRadius),
          ),
          textStyle: GoogleFonts.inter(fontWeight: FontWeight.w600, fontSize: 15),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: foreground,
          side: BorderSide(color: border),
          minimumSize: const Size.fromHeight(50),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(kRadius),
          ),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(foregroundColor: primary),
      ),
      floatingActionButtonTheme: FloatingActionButtonThemeData(
        backgroundColor: AppColors.brandCyan,
        foregroundColor: const Color(0xFF002328),
        elevation: 2,
      ),
      chipTheme: ChipThemeData(
        backgroundColor: muted,
        labelStyle: TextStyle(color: mutedFg, fontSize: 12),
        side: BorderSide(color: border),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(kRadiusXl),
        ),
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
      ),
      bottomNavigationBarTheme: BottomNavigationBarThemeData(
        backgroundColor: brightness == Brightness.dark
            ? AppColors.dSidebar
            : AppColors.lSidebar,
        selectedItemColor: AppColors.brandCyan,
        unselectedItemColor: mutedFg,
        type: BottomNavigationBarType.fixed,
        showUnselectedLabels: true,
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        backgroundColor: card,
        contentTextStyle: TextStyle(color: foreground),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(kRadius),
          side: BorderSide(color: border),
        ),
      ),
    );
  }
}
