import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import '../core/theme.dart';

/// The wordmark. A cyan spark + "SayKnowMind" in the heading font, matching the
/// web/splash brand treatment.
class BrandWordmark extends StatelessWidget {
  const BrandWordmark({super.key, this.fontSize = 26, this.color});
  final double fontSize;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final c = color ?? Theme.of(context).colorScheme.onSurface;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: fontSize * 0.5,
          height: fontSize * 0.5,
          decoration: const BoxDecoration(
            color: AppColors.brandCyan,
            shape: BoxShape.circle,
          ),
        ),
        SizedBox(width: fontSize * 0.32),
        Text(
          'SayKnowMind',
          style: GoogleFonts.spaceGrotesk(
            fontSize: fontSize,
            fontWeight: FontWeight.w700,
            color: c,
            letterSpacing: -0.5,
          ),
        ),
      ],
    );
  }
}
