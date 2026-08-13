import "package:flutter/material.dart";

class AppTheme {
  static const seed = Color(0xFF2563EB);

  static ThemeData light() => ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(seedColor: seed, brightness: Brightness.light),
        visualDensity: VisualDensity.adaptivePlatformDensity,
      );

  static ThemeData dark() => ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(seedColor: seed, brightness: Brightness.dark),
        visualDensity: VisualDensity.adaptivePlatformDensity,
      );
}
